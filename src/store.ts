import { editProjectYaml } from './core/bus/igh-edit';
import { invalidateHardwareConfirmation } from './core/hardware/edit';
import { create } from 'zustand';
import { assertEditableFile, fileModule, readonlyFile } from './core/modules/project';
import { deleteRecovery, newRecoveryKey, writeRecovery } from './adapters/recovery';
import { type Project, utf8, fileById, textOf, digest } from './core/project/types';
import { yamlDocument } from './core/documents/yaml';
import { xmlDocument } from './core/documents/xml';
import { saveProject, openProject } from './core/project/archive';
interface State {
  project: Project|null; workspaceEpoch:number; recoveryKey:string|null; past: Project[]; future: Project[]; savedRevision: number|null; persistence: string;
  load:(p:Project)=>void; change:(fn:(p:Project)=>void)=>void; undo:()=>void; redo:()=>void;
  yaml:(fileId:string,path:(string|number)[],value:unknown)=>void;
  buffer:(id:string,text:string)=>Promise<void>; apply:(id:string)=>Promise<void>; discard:(id:string)=>void;
  markDownloaded:(revision:number)=>void; markSaved:(revision:number,path:string)=>void; markOpened:(revision:number,native:boolean)=>void;
}
const cacheTimers=new Map<string,ReturnType<typeof setTimeout>>();
const cacheWrites=new Map<string,Promise<void>>();
const pendingBuffers = new Map<string,Promise<void>>();
let projectEpoch = 0;
const bufferGeneration = new Map<string,number>();
export async function flushBuffers(){await Promise.all([...pendingBuffers.values()]);}
export async function discardRecovery(key:string){
  if(useProject.getState().recoveryKey===key)throw new Error('当前工作区的恢复草稿不能清除');
  clearTimeout(cacheTimers.get(key));cacheTimers.delete(key);
  await cacheWrites.get(key);
  await deleteRecovery(key);
}
function cache(p:Project){
  const key=useProject.getState().recoveryKey;if(!key)return;
  clearTimeout(cacheTimers.get(key));const epoch=projectEpoch;
  const currentSnapshot=()=>{const current=useProject.getState();return projectEpoch===epoch&&current.recoveryKey===key&&current.project?.id===p.id&&current.project.revision===p.revision?current:undefined;};
  cacheTimers.set(key,setTimeout(()=>{
    cacheTimers.delete(key);
    // IndexedDB may throw before returning a promise (disabled storage, for
    // example). Treat that as a recoverable cache failure, not an uncaught edit.
    // Serialize writes within one workspace. Other workspaces have different
    // keys even when they share a project UUID and revision.
    const writing=(cacheWrites.get(key)||Promise.resolve()).then(()=>writeRecovery(key,p)).then(()=>{
      const current=currentSnapshot();if(current&&current.savedRevision!==p.revision)useProject.setState({persistence:'草稿已缓存；工程文件未保存'});
    }).catch(()=>{const current=currentSnapshot();if(current)useProject.setState({persistence:current.savedRevision===p.revision?`${current.persistence}；草稿缓存失败`:'缓存失败，请保存工程备份'});});
    cacheWrites.set(key,writing);
    void writing.then(()=>{if(cacheWrites.get(key)===writing)cacheWrites.delete(key);});
  },400));
}
export const useProject=create<State>((setState,getState)=>({
  project:null,workspaceEpoch:0,recoveryKey:null,past:[],future:[],savedRevision:null,persistence:'尚未打开工程',
  load:p=>{projectEpoch++;setState({project:p,workspaceEpoch:projectEpoch,recoveryKey:newRecoveryKey(),past:[],future:[],savedRevision:null,persistence:'工程已载入'});cache(p);},
  change:fn=>{const s=getState();if(!s.project)return;const p=structuredClone(s.project);fn(p);invalidateHardwareConfirmation(s.project,p);p.revision++;p.modifiedAt=new Date().toISOString();setState({project:p,past:[...s.past,s.project].slice(-40),future:[],persistence:'有未保存修改'});cache(p);},
  undo:()=>{projectEpoch++;const s=getState();if(!s.project||!s.past.length)return;const p=structuredClone(s.past.at(-1)!);p.revision=s.project.revision+1;setState({project:p,past:s.past.slice(0,-1),future:[s.project,...s.future]});cache(p);},
  redo:()=>{projectEpoch++;const s=getState();if(!s.project||!s.future.length)return;const p=structuredClone(s.future[0]);p.revision=s.project.revision+1;setState({project:p,past:[...s.past,s.project],future:s.future.slice(1)});cache(p);},
  yaml:(id,path,value)=>{
    const p=getState().project;if(!p)return;
    const original=fileById(p,id);if(!original)throw new Error('文件不存在');
    const candidate={...original};
    // Number controls may emit the same value on input and again on blur.
    // Run all edit/readonly/draft checks, but do not create an empty undo step.
    editProjectYaml({...p,files:p.files.map(file=>file.id===id?candidate:file)},id,doc=>doc.setIn(path,value));
    if(candidate.bytes.length===original.bytes.length&&candidate.bytes.every((byte,index)=>byte===original.bytes[index]))return;
    getState().change(next=>{const file=fileById(next,id)!;file.bytes=candidate.bytes;file.encoding=candidate.encoding;});
  },
  buffer:(id,text)=>{
    const p=getState().project,f=p&&fileById(p,id);
    if(!p||!f)return Promise.resolve();
    if(readonlyFile(p,f))return Promise.reject(new Error('文件只读，不能写入源码草稿'));
    const epoch=projectEpoch;
    const generation=(bufferGeneration.get(id)||0)+1;bufferGeneration.set(id,generation);
    if(p.editor.buffers[id]?.text===text || (!p.editor.buffers[id]&&textOf(f)===text))return Promise.resolve();
    const job=(async()=>{
      const baseHash=p.editor.buffers[id]?.baseHash||await digest(f.bytes);
      if(projectEpoch!==epoch||getState().project?.id!==p.id||bufferGeneration.get(id)!==generation)return;
      getState().change(next=>{next.editor.buffers[id]={text,baseHash};});
    })();
    pendingBuffers.set(id,job);
    const clean=()=>{if(pendingBuffers.get(id)===job)pendingBuffers.delete(id);};
    void job.then(clean,clean);return job;
  },
  discard:id=>{
    const project=getState().project, file=project&&fileById(project,id);
    if(project&&file)assertEditableFile(project,file);
    bufferGeneration.set(id,(bufferGeneration.get(id)||0)+1);
    if(getState().project?.editor.buffers[id])getState().change(p=>{delete p.editor.buffers[id];});
  },
  apply:async id=>{
    await flushBuffers();
    const p=getState().project,draft=p?.editor.buffers[id],f=p&&fileById(p,id);
    if(!p||!draft||!f)return;
    assertEditableFile(p,f);
    const epoch=projectEpoch;
    if(await digest(f.bytes)!==draft.baseHash)throw new Error('源文件已变化，源码草稿基线冲突；请保留工程副本并核对差异');
    if(f.path.match(/\.ya?ml$/i))yamlDocument(draft.text);
    else if(f.path.match(/\.(xml|urdf|dae)$/i))xmlDocument(draft.text);
    fileModule(p,f)!.parse({...f,bytes:utf8.encode(draft.text),encoding:'utf-8'});
    getState().change(next=>{
      const current=fileById(next,id),buffer=next.editor.buffers[id];
      if(projectEpoch!==epoch||next.id!==p.id||!current||buffer?.text!==draft.text||buffer?.baseHash!==draft.baseHash||
        current.bytes.length!==f.bytes.length||current.bytes.some((byte,i)=>byte!==f.bytes[i]))throw new Error('应用期间文件或草稿已变化，请重试');
      current.bytes=utf8.encode(draft.text);current.encoding='utf-8';delete next.editor.buffers[id];
    });
  },
  markDownloaded:revision=>setState({savedRevision:revision,persistence:getState().project?.revision===revision?'已生成工程下载':'已生成旧版本下载；仍有未保存修改'}),
  markSaved:(revision,path)=>setState({savedRevision:revision,persistence:getState().project?.revision===revision?'已保存工程文件':'已保存旧版本；仍有未保存修改'}),
  markOpened:(revision,native)=>setState({savedRevision:revision,persistence:native?'已打开工程文件':'已打开工程；修改后请下载留存'}),
}));
export {saveProject,openProject};

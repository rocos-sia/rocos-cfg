import { modules } from '../modules';
import type { ModuleRegistry } from '../modules/registry';
import { fileModule } from '../modules/project';
import { saveProject, openProject, validateManifest } from './archive';
import { recoverZip, LIMITS, type ArchiveLimits } from './zip';
import { collectReferences } from './references';
import { validTemplateUse } from './templates';
import { digest, uid, utf8, type Project, type ProjectFile, type ModuleSnapshot } from './types';
import type { ArchiveProgress } from './progress';

export interface RecoveryRecord {
  path:string; status:'verified'|'missing'|'damaged'|'unlisted'; message:string;
  expectedHash?:string; actualHash?:string;
}
export interface ProjectRecovery {
  project:Project; records:RecoveryRecord[]; notes:string[]; sourceHash:string;
  source:{id:string;name:string;snapshotId:string};
}
const object=(v:unknown):v is Record<string,any>=>!!v&&typeof v==='object'&&!Array.isArray(v);

/** Build a separate, reviewable draft. No caller state or source bytes mutate. */
export async function inspectProjectRecovery(bytes:Uint8Array,limits:ArchiveLimits=LIMITS,registry:ModuleRegistry=modules,version='development',progress?:ArchiveProgress):Promise<ProjectRecovery>{
  progress?.(5);
  const recovered=recoverZip(bytes,limits),manifestBytes=recovered.files.get('rocos-project.json');
  if(!manifestBytes)throw new Error('manifest 缺失或 ZIP CRC 不符，无法依据 SHA-256 清单恢复工程');
  if(manifestBytes.length>limits.manifest)throw new Error('manifest 超过限额');
  const manifest:unknown=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(manifestBytes));
  validateManifest(manifest);
  const ep=manifest.entrypoints;
  const coreIds=[ep.master.fileId,ep.master.eniFileId,ep.app,ep.urdf,ep.hardware,ep.binding,manifest.editorStateFileId];
  for(const m of manifest.modules)if(!registry.get(m.id,m.version)&&(m.required||[...m.fileIds,...(m.stateFileIds||[])].some(id=>coreIds.includes(id)))){
    throw new Error(`必要模块 ${m.id} v${m.version} 不受支持；请保留原包并使用对应版本处理`);
  }
  const records:RecoveryRecord[]=[],verified=new Map<string,ProjectFile>(),notes=[...recovered.warnings];
  let checked=0;progress?.(20);
  for(const f of manifest.files){
    progress?.(20+45*(checked++)/manifest.files.length);
    const data=recovered.files.get(f.path),failure=recovered.failures.get(f.path);
    if(!data){records.push({path:f.path,status:failure?'damaged':'missing',expectedHash:f.sha256,message:failure||'文件缺失或未能完整读取'});continue;}
    const actualHash=await digest(data);
    if(data.length!==f.size||actualHash!==f.sha256){records.push({path:f.path,status:'damaged',expectedHash:f.sha256,actualHash,message:data.length!==f.size?'长度与 manifest 不符':'SHA-256 与 manifest 不符'});continue;}
    verified.set(f.id,{id:f.id,path:f.path,role:f.role,owner:f.owner,encoding:f.encoding,bytes:new Uint8Array(data)});
    records.push({path:f.path,status:'verified',expectedHash:f.sha256,actualHash,message:'CRC、长度和 SHA-256 一致'});
  }
  const listed=new Set(manifest.files.map(f=>f.path));listed.add('rocos-project.json');
  for(const path of new Set([...recovered.files.keys(),...recovered.failures.keys()]))if(!listed.has(path))records.push({path,status:'unlisted',message:'未在 manifest 登记，不提取到恢复工程'});
  if(![...verified.keys()].some(id=>id!==manifest.editorStateFileId))throw new Error('没有通过校验的配置或资源文件可恢复');

  // An incomplete module may have private references in opaque state. Preserve
  // surviving bytes as attachments instead of silently inventing a new module.
  const retained:ModuleSnapshot[]=[],quarantined=new Set<string>([manifest.editorStateFileId]);
  for(const m of manifest.modules){
    const owned=[...m.fileIds,...(m.stateFileIds||[])];
    const compatible=owned.every(id=>verified.has(id)&&id!==manifest.editorStateFileId)&&m.fileIds.every(id=>{
      const file=verified.get(id)!,adapter=fileModule({modules:manifest.modules},file,registry);
      return !adapter||adapter.role===file.role;
    });
    if(compatible)retained.push(structuredClone(m));
    else{
      for(const id of owned)quarantined.add(id);
      // Preserve a runtime blocker even if every file of a required runtime
      // module is missing. Dropping its declaration would silently relax export.
      if(m.requiredForRuntime||m.runtimeFileIds?.length)retained.push({id:'recovery.quarantine',version:1,instanceId:`recovery:${uid()}`,sourceModule:m.instanceId||m.id,required:false,requiredForRuntime:true,fileIds:owned.filter(id=>verified.has(id))});
      if(!(m.id==='editor-state'&&owned.length===1&&owned[0]===manifest.editorStateFileId)){
        const first=manifest.files.find(f=>f.id===owned[0])?.path;
        notes.push(`模块 ${m.id}${first?`（${first}${owned.length>1?' 等':''}）`:''} 未作为完整模块恢复；校验通过的文件仅只读保留，原声明见原 manifest。`);
      }
    }
  }
  const files=[...verified.values()];
  for(const file of files){
    const adapter=fileModule({modules:manifest.modules},file,registry);
    if(adapter&&adapter.role!==file.role&&!manifest.modules.some(m=>m.stateFileIds?.includes(file.id)))quarantined.add(file.id);
    if(quarantined.has(file.id)){file.role='attachment';file.owner='recovery.quarantine';records.find(r=>r.path===file.path)!.message+='；仅保留只读原文，不参与运行导出';}
  }
  const available=(id:string|null)=>id&&verified.has(id)&&!quarantined.has(id)?id:null;
  const now=new Date().toISOString(),id=uid(),folder=`recovery-${id}`;
  const stateId=uid(),statePath=`${folder}/editor-state.json`,reportId=uid();
  const p:Project={
    id,name:manifest.project.name+'（恢复）',description:manifest.project.description,revision:0,createdAt:now,modifiedAt:now,snapshotId:uid(),
    targets:structuredClone(manifest.targets),entrypoints:{
      master:{kind:manifest.entrypoints.master.kind,fileId:available(manifest.entrypoints.master.fileId),eniFileId:available(manifest.entrypoints.master.eniFileId)},
      app:available(manifest.entrypoints.app),urdf:available(manifest.entrypoints.urdf),hardware:available(manifest.entrypoints.hardware),binding:available(manifest.entrypoints.binding),
    },files,modules:retained,packageMap:structuredClone(manifest.packageMap),references:[],editor:{buffers:Object.create(null),confirmations:{}},
    archiveMetadata:{...structuredClone(manifest),createdWith:{name:'ROCOS Configurator',version},editorStateFileId:stateId,
      files:[...structuredClone(manifest.files),{id:stateId,path:statePath}]},
  };
  p.references=manifest.references.filter(r=>available(r.sourceFileId)).map(r=>{
    const ref=structuredClone(r);
    if(ref.state==='internal'&&(ref.kind==='directory'?!p.files.some(f=>f.path.startsWith(ref.targetPath+'/')):!verified.has(ref.targetFileId!))){ref.state='missing';delete ref.targetFileId;}
    return ref;
  });
  const editorFile=verified.get(manifest.editorStateFileId);
  if(editorFile){
    try{
      const editor=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(editorFile.bytes));
      if(!object(editor)||!object(editor.buffers))throw new Error('编辑状态结构无效');
      for(const [fileId,buffer] of Object.entries(editor.buffers)){
        const file=verified.get(fileId);
        if(available(fileId)&&file?.role!=='eni'&&object(buffer)&&typeof buffer.text==='string'&&typeof buffer.baseHash==='string'&&/^[0-9a-f]{64}$/.test(buffer.baseHash))p.editor.buffers[fileId]=structuredClone(buffer) as Project['editor']['buffers'][string];
        else notes.push(`未自动恢复源码草稿 ${fileId}；可在原编辑状态附件中核对。`);
      }
      if(Array.isArray(editor.notices))p.editor.notices=editor.notices.filter((n:unknown)=>object(n)&&available(n.fileId)&&typeof n.message==='string');
      if(Array.isArray(editor.templateUses))p.editor.templateUses=editor.templateUses.filter(validTemplateUse);
      notes.push('原编辑状态以只读附件保留；合法源码草稿已恢复，未自动应用。');
    }catch{notes.push('原编辑状态未能解析，只作为原文附件保留；未自动应用其中的草稿。');}
  }else notes.push('编辑状态未通过完整性校验，未恢复源码草稿。');
  notes.push('设备、机械参数和绑定的人工确认全部重置；恢复工程需要重新校验。');
  const sourceHash=await digest(bytes),source={id:manifest.project.id,name:manifest.project.name,snapshotId:manifest.snapshotId};
  p.files.push({id:uid(),path:`${folder}/original-manifest.json`,role:'attachment',owner:'attachment',bytes:new Uint8Array(manifestBytes)});
  p.files.push({id:reportId,path:`${folder}/report.json`,role:'attachment',owner:'attachment',bytes:utf8.encode(JSON.stringify({format:'rocos-recovery-report',version:1,createdAt:now,source,sourceHash,newProjectId:id,records,notes},null,2))});
  p.editor.notices=[...(p.editor.notices||[]),{fileId:reportId,message:'此工程从损坏包恢复；请核对恢复报告、补齐遗漏文件并重新确认配置。'}];
  p.references=collectReferences(p,registry);
  // Exercise the real serializer and reader before offering the draft to UI.
  const packed=await saveProject(p,version,registry,value=>progress?.(65+value*.25));
  const project=await openProject(packed,limits,registry,value=>progress?.(90+value*.1));
  return {project,records,notes,sourceHash,source};
}

import { m as msg, MessageError } from '../core/project/messages';
import type { Project } from '../core/project/types';
import { saveProject } from '../core/project/archive';
import { copyAsNewProject } from '../core/project/create';
import { filenameFor } from './files';
import { type FileAccess, type FileHandle, type TransferOptions, type WriteResult } from './file-access';
export type SaveMode='save'|'saveAs'|'copy'|'fork';
export const retainsSaveTarget=(mode:SaveMode)=>mode==='copy'||mode==='fork';
// The destination capability is session state; it must never enter .rcproj.
export class ProjectSession {
  private generation=0;
  private target?:FileHandle;
  private protectedSource?:FileHandle;
  private projectId?:string;
  private writing=false;
  constructor(private access:FileAccess,private serialize:(project:Project,version:string,options:TransferOptions)=>Promise<Uint8Array>=(p,v)=>saveProject(p,v)){}
  get handle(){return this.target;}
  get project(){return this.projectId;}
  async adopt(projectId:string,handle?:FileHandle,protectedSource?:FileHandle){
    this.generation++;const old=[this.target,this.protectedSource];this.projectId=projectId;this.target=handle;this.protectedSource=protectedSource;
    const retained=new Set([handle?.token,protectedSource?.token]);
    for(const prior of new Map(old.filter((h):h is FileHandle=>!!h).map(h=>[h.token,h])).values())if(!retained.has(prior.token))await this.access.release(prior);
  }
  async save(snapshot:Project,mode:SaveMode,version:string,options:TransferOptions={}):Promise<{result:WriteResult;current:boolean;revision:number}|undefined>{
    if(this.writing)throw new MessageError(msg("已有工程保存任务，请等待完成"));
    this.writing=true;const generation=this.generation;
    const same=this.projectId===snapshot.id,target=same?this.target:undefined,protectedSource=same?this.protectedSource:undefined;
    try{
      const exported=mode==='fork'?copyAsNewProject(snapshot,version):snapshot;
      const bytes=await this.serialize(exported,version,options);if(options.signal?.aborted)throw new DOMException('操作已取消','AbortError');
      const result=await this.access.write(bytes,filenameFor(exported.name),{...options,target:mode==='save'?target:undefined,exclude:mode==='save'?undefined:target,protectedTargets:protectedSource?[protectedSource]:undefined});
      if(!result)return;
      const current=this.generation===generation&&this.projectId===snapshot.id;
      if(result.kind==='written'){
        if(current&&!retainsSaveTarget(mode)){const old=this.target;this.target=result.handle;if(old&&old.token!==result.handle.token)await this.access.release(old);}
        else if(result.handle.token!==this.target?.token)await this.access.release(result.handle);
      }
      return {result,current,revision:snapshot.revision};
    }finally{this.writing=false;}
  }
}

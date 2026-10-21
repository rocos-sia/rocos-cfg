import type { Project } from '../core/project/types';
import type { TransferOptions } from './file-access';
import type { ArchiveTasks, ArchiveResponse } from './archive-protocol';

type JobWorker=Pick<Worker,'postMessage'|'terminate'|'addEventListener'|'removeEventListener'>;
export type WorkerFactory=()=>JobWorker;
const createWorker:WorkerFactory=()=>new Worker(new URL('./archive.worker.ts',import.meta.url),{type:'module'});

export function runArchiveTask<K extends keyof ArchiveTasks>(
  request:{kind:K}&ArchiveTasks[K]['input'],options:TransferOptions={},factory:WorkerFactory=createWorker,
):Promise<ArchiveTasks[K]['output']>{
  return new Promise((resolve,reject)=>{
    const cancelled=()=>new DOMException('操作已取消','AbortError');
    if(options.signal?.aborted){reject(cancelled());return;}
    let worker:JobWorker;
    try{worker=factory();}catch(error){reject(error);return;}
    let ended=false;
    const dispose=()=>{
      ended=true;options.signal?.removeEventListener('abort',abort);
      worker.removeEventListener('message',message);worker.removeEventListener('error',error);worker.removeEventListener('messageerror',decodeError);
      worker.terminate();
    };
    const fail=(reason:unknown)=>{if(ended)return;dispose();reject(reason);};
    const abort=()=>fail(cancelled());
    const error=(event:Event)=>fail(new Error((event as ErrorEvent).message||'工程处理 Worker 无法运行，请保留当前草稿并重试'));
    const decodeError=()=>fail(new Error('无法接收工程处理结果，当前工作区保持不变'));
    const message=(event:Event)=>{
      if(ended)return;
      const data=(event as MessageEvent<ArchiveResponse>).data;
      if(data.type==='progress'){options.progress?.(data.percent,100);return;}
      if(data.type==='error'){fail(new Error(data.message));return;}
      if(data.type==='result'){dispose();resolve(data.result as ArchiveTasks[K]['output']);}
    };
    worker.addEventListener('message',message);worker.addEventListener('error',error);worker.addEventListener('messageerror',decodeError);
    options.signal?.addEventListener('abort',abort,{once:true});
    try{
      // Clone input, never transfer workspace buffers: undo and cancelled jobs
      // must retain every byte. A worker owns no native file capability.
      worker.postMessage(request);
    }catch(reason){fail(reason);}
  });
}
export const saveArchive=(project:Project,version:string,options:TransferOptions={})=>runArchiveTask({kind:'save',project,version},options);
export const inspectArchive=(bytes:Uint8Array,options:TransferOptions={})=>runArchiveTask({kind:'inspect',bytes},options);
export const recoverArchive=(bytes:Uint8Array,version:string,options:TransferOptions={})=>runArchiveTask({kind:'recover',bytes,version},options);

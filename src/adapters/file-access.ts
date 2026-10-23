import { invoke, isTauri } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { digest } from '../core/project/types';
import { checkPaths } from '../core/project/paths';
import { LIMITS } from '../core/project/zip';
import { m as msg, MessageError, errorMessage, messageFields, validMessageTemplate, type MessageInput, type MessageTemplate } from '../core/project/messages';

export interface FileHandle { token:string; name:string; displayPath:string; size:number; sha256:string|null; relativePath?:string|null }
export interface OpenedFile { name:string; bytes:Uint8Array; handle?:FileHandle }
export interface TransferOptions { signal?:AbortSignal; progress?:(completed:number,total:number)=>void }
export interface ImportOptions extends TransferOptions { accept?:string; multiple?:boolean }
export interface WriteOptions extends TransferOptions { target?:FileHandle; exclude?:FileHandle; protectedTargets?:FileHandle[] }
export type WriteResult = { kind:'downloaded' } | { kind:'written'; handle:FileHandle; backupPath?:string|null; warning?:string|null; warningText?:MessageTemplate };
export interface DirectoryFile { path:string; bytes:Uint8Array }
export interface DirectoryWritten { displayPath:string; files:number; warning?:string|null; warningText?:MessageTemplate }
export interface FileAccess {
  readonly kind:'browser'|'desktop';
  readonly busy?:boolean;
  open(options?:TransferOptions):Promise<OpenedFile|undefined>;
  read(handle:FileHandle,options?:TransferOptions):Promise<OpenedFile>;
  import(directory:boolean,options?:ImportOptions):Promise<File[]|undefined>;
  write(bytes:Uint8Array,name:string,options?:WriteOptions):Promise<WriteResult|undefined>;
  writeDirectory?(files:DirectoryFile[],name:string,options?:TransferOptions):Promise<DirectoryWritten|undefined>;
  refresh(handle:FileHandle,options?:TransferOptions):Promise<OpenedFile>;
  release(handle:FileHandle):Promise<void>;
  onClose?(handler:()=>void):Promise<()=>void>;
  close?():Promise<void>;
}
export class FileAccessError extends MessageError {
  constructor(public code:string,message:MessageInput,public currentHash?:string|null){super(message);this.name='FileAccessError';}
}
export const cancelled=()=>new DOMException('操作已取消，工作区保留','AbortError');
function check(options:TransferOptions){if(options.signal?.aborted)throw cancelled();}
function normalize(error:unknown):Error {
  if(error instanceof Error)return error;
  if(error&&typeof error==='object'&&'code'in error&&'message'in error){
    const e=error as {code:unknown;message:unknown;currentHash?:string|null;text?:unknown};
    if(typeof e.code==='string'&&typeof e.message==='string')return new FileAccessError(e.code,{message:e.message,text:validMessageTemplate(e.text)?e.text:undefined},e.currentHash);
  }
  return new Error(String(error));
}
export function browserDownload(bytes:Uint8Array,name:string,type='application/octet-stream') {
  const url=URL.createObjectURL(new Blob([new Uint8Array(bytes).buffer],{type}));
  const link=document.createElement('a');link.href=url;link.download=name;link.click();setTimeout(()=>URL.revokeObjectURL(url),30000);
}
function pick(accept?:string,directory=false,multiple=false):Promise<File[]|undefined> {
  return new Promise(resolve=>{
    const input=document.createElement('input');input.type='file';input.hidden=true;input.multiple=multiple;
    if(accept)input.accept=accept;if(directory)input.setAttribute('webkitdirectory','');
    const done=(files?:File[])=>{input.remove();resolve(files);};
    input.addEventListener('change',()=>done(Array.from(input.files||[])),{once:true});input.addEventListener('cancel',()=>done(),{once:true});
    document.body.append(input);input.click();
  });
}
export async function readBrowserFile(file:File,options:TransferOptions={}):Promise<OpenedFile> {
  check(options);if(file.size>LIMITS.total+1024**2)throw new FileAccessError('limit',msg("工程压缩包超过限额"));
  const bytes=new Uint8Array(await file.arrayBuffer());check(options);options.progress?.(bytes.length,bytes.length);return {name:file.name,bytes};
}
export class BrowserFileAccess implements FileAccess {
  readonly kind='browser' as const;
  async open(options:TransferOptions={}){const files=await pick('.rcproj,.zip');return files?.[0]?readBrowserFile(files[0],options):undefined;}
  async import(directory:boolean,options:ImportOptions={}){check(options);return pick(options.accept,directory,options.multiple??true);}
  async write(bytes:Uint8Array,name:string,options:WriteOptions={}):Promise<WriteResult>{check(options);browserDownload(bytes,name);return {kind:'downloaded'};}
  async writeDirectory(files:DirectoryFile[],name:string,options:TransferOptions={}):Promise<DirectoryWritten|undefined>{
    const picker=(window as unknown as {showDirectoryPicker?:()=>Promise<any>}).showDirectoryPicker;
    if(!picker)throw new Error('当前浏览器不支持目录导出，请使用桌面版或下载 ZIP 文件夹');
    checkPaths(files.map(f=>f.path));
    let parent:any;try{parent=await picker();}catch(e){if(e instanceof DOMException&&e.name==='AbortError')return;throw e;}
    const folder=(name.replace(/[\\/:*?"<>|]/g,'_').trim()||'rocos')+'-'+crypto.randomUUID();
    const root=await parent.getDirectoryHandle(folder,{create:true});let completed=0;
    for(const file of files){check(options);const parts=file.path.split('/');let dir=root;for(const part of parts.slice(0,-1))dir=await dir.getDirectoryHandle(part,{create:true});const handle=await dir.getFileHandle(parts.at(-1),{create:true}),writer=await handle.createWritable();try{await writer.write(new Uint8Array(file.bytes));await writer.close();}catch(e){await writer.abort();throw e;}options.progress?.(++completed,files.length);}
    return {displayPath:folder,files:completed};
  }
  async read():Promise<OpenedFile>{throw new MessageError(msg("此浏览器使用文件选择与下载，不持有磁盘写入授权"));}
  async refresh():Promise<OpenedFile>{throw new MessageError(msg("请重新选择磁盘文件"));}
  async release(){}
}
export type Invoke = typeof invoke;
const CHUNK=4*1024**2;
export class DesktopFileAccess implements FileAccess {
  readonly kind='desktop' as const;
  private pending=0;
  get busy(){return this.pending>0;}
  constructor(private call:Invoke=invoke){}
  private async track<T>(work:()=>Promise<T>):Promise<T>{this.pending++;try{return await work();}finally{this.pending--;}}
  private async command<T>(name:string,args?:Parameters<Invoke>[1],options?:Parameters<Invoke>[2]):Promise<T>{try{return await this.call<T>(name,args,options);}catch(e){throw normalize(e);}}
  async release(handle:FileHandle){await this.command('release_file',{token:handle.token});}
  async read(handle:FileHandle,options:TransferOptions={}):Promise<OpenedFile>{
    check(options);if(!Number.isSafeInteger(handle.size)||handle.size<0||handle.size>LIMITS.total+1024**2||!handle.sha256)throw new FileAccessError('limit',msg("文件大小或哈希无效"));
    const bytes=new Uint8Array(handle.size);
    for(let offset=0;offset<bytes.length;offset+=CHUNK){check(options);const length=Math.min(CHUNK,bytes.length-offset);const part=await this.command<ArrayBuffer>('read_chunk',{token:handle.token,offset,length});if(part.byteLength!==length)throw new FileAccessError('changed',msg("文件读取长度发生变化"));bytes.set(new Uint8Array(part),offset);options.progress?.(offset+length,bytes.length);}
    check(options);if(await digest(bytes)!==handle.sha256)throw new FileAccessError('changed',msg("文件读取期间已变化，请重新打开"));
    return {name:handle.name,bytes,handle};
  }
  async open(options:TransferOptions={}){return this.track(async()=>{const h=await this.command<FileHandle|null>('choose_project');if(!h)return;try{return await this.read(h,options);}catch(e){await this.release(h);throw e;}});}
  async refresh(handle:FileHandle,options:TransferOptions={}){return this.track(async()=>{const h=await this.command<FileHandle>('refresh_file',{token:handle.token});try{return await this.read(h,options);}finally{await this.release(h);}});}
  async import(directory:boolean,options:TransferOptions={}){return this.track(()=>this.importFiles(directory,options));}
  private async importFiles(directory:boolean,options:TransferOptions){
    const handles=await this.command<FileHandle[]|null>('choose_import',{directory});if(!handles)return;
    try{
      if(handles.length>LIMITS.entries||handles.reduce((sum,h)=>sum+h.size,0)>LIMITS.total+1024**2)throw new FileAccessError('limit',msg("导入文件超过资源限额"));
      const files:File[]=[];
      for(const h of handles){const opened=await this.read(h,options);const f=new File([new Uint8Array(opened.bytes).buffer],h.name);if(h.relativePath)Object.defineProperty(f,'webkitRelativePath',{value:'selected/'+h.relativePath});files.push(f);}
      return files;
    }finally{await Promise.all(handles.map(h=>this.release(h)));}
  }
  async write(bytes:Uint8Array,name:string,options:WriteOptions={}):Promise<WriteResult|undefined>{
    return this.track(()=>this.writeBytes(bytes,name,options));
  }
  private async writeBytes(bytes:Uint8Array,name:string,options:WriteOptions):Promise<WriteResult|undefined>{
    check(options);const target=options.target||await this.command<FileHandle|null>('choose_target',{suggestedName:name,excludeToken:options.exclude?.token,protectedTokens:options.protectedTargets?.map(h=>h.token)});if(!target)return;
    let transfer:string|undefined,committed=false;
    try{
      check(options);const sha256=await digest(bytes);check(options);
      transfer=await this.command<string>('begin_write',{token:target.token,length:bytes.length,sha256});
      for(let offset=0;offset<bytes.length;offset+=CHUNK){check(options);const part=bytes.subarray(offset,offset+CHUNK);await this.command('write_chunk',part,{headers:{'x-transfer-id':transfer,'x-offset':String(offset)}});options.progress?.(offset+part.length,bytes.length);}
      check(options);const result=await this.command<{handle:FileHandle;backupPath?:string|null;warning?:string|null;warningText?:MessageTemplate}>('finish_write',{transfer});committed=true;
      return {kind:'written',...result};
    }finally{
      if(transfer&&!committed)await this.command('cancel_write',{transfer}).catch(()=>{});
      if(!options.target&&!committed)await this.release(target);
    }
  }
  async writeDirectory(files:DirectoryFile[],name:string,options:TransferOptions={}):Promise<DirectoryWritten|undefined>{
    return this.track(async()=>{
      check(options);checkPaths(files.map(f=>f.path));
      const total=files.reduce((n,f)=>n+f.bytes.length,0);
      if(!files.length||files.length>LIMITS.entries||total>LIMITS.total||files.some(f=>f.bytes.length>LIMITS.file))throw new FileAccessError('limit',msg("导出文件超过限额"));
      const entries=[];
      for(const f of files){check(options);entries.push({path:f.path,size:f.bytes.length,sha256:await digest(f.bytes)});}
      check(options);const transfer=await this.command<string|null>('choose_directory_export',{name,entries});if(!transfer)return;
      let committed=false,completed=0;
      try{
        for(const [index,f] of files.entries())for(let offset=0;offset<f.bytes.length;offset+=CHUNK){
          check(options);const part=f.bytes.subarray(offset,offset+CHUNK);
          await this.command('write_directory_chunk',part,{headers:{'x-transfer-id':transfer,'x-file-index':String(index),'x-offset':String(offset)}});
          completed+=part.length;options.progress?.(completed,total);
        }
        check(options);const result=await this.command<DirectoryWritten>('finish_directory_export',{transfer});committed=true;return result;
      }finally{
        if(!committed)try{await this.command('cancel_directory_export',{transfer});}catch(error){
          const detail=messageFields(errorMessage(normalize(error)));
          throw new FileAccessError('cleanup',msg('目录导出未完成，暂存目录清理失败；请检查所选父目录中的 ROCOS-EXPORT.json：{detail}',{detail:detail.text||detail.message}));
        }
      }
    });
  }
  onClose(handler:()=>void){return listen('desktop-close-requested',handler);}
  async close(){if(this.busy)throw new FileAccessError('busy',msg("文件操作尚未完成，请等待或取消后再关闭"));await this.command('close_confirmed');}
}
let instance:FileAccess|undefined;
export const isDesktop=()=>isTauri();
export const fileAccess=():FileAccess=>instance??=(isDesktop()?new DesktopFileAccess():new BrowserFileAccess());

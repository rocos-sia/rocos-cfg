import { m as msg, MessageError } from '../core/project/messages';
import { delMany, get, getMany, keys, setMany } from 'idb-keyval';
import { uid, type Project } from '../core/project/types';
import { openProject, saveProject } from '../core/project/archive';

const PREFIX='rocos-recovery-session:', META='rocos-recovery-summary:', LEGACY='rocos-recovery';
export interface RecoverySummary {
  key:string; name:string; projectId:string; snapshotId:string; revision:number;
  modifiedAt:string; cachedAt:string; fileCount:number; bytes:number;
}
function summary(key:string,p:Project):RecoverySummary {
  return {key,name:p.name,projectId:p.id,snapshotId:p.snapshotId,revision:p.revision,
    modifiedAt:p.modifiedAt,cachedAt:new Date().toISOString(),fileCount:p.files.length,
    bytes:p.files.reduce((sum,f)=>sum+f.bytes.byteLength,0)};
}
function validKey(key:string){return /^rocos-recovery-session:[0-9a-f-]{36}$/.test(key);}
export const newRecoveryKey=()=>PREFIX+uid();
export async function writeRecovery(key:string,project:Project):Promise<void>{
  if(!validKey(key))throw new MessageError(msg("草稿缓存标识无效"));
  const snapshot=structuredClone(project);
  // Keep the lightweight list and full draft consistent in one transaction.
  await setMany([[key,{schema:1,project:snapshot}],[META+key,summary(key,snapshot)]]);
}
export async function listRecovery():Promise<RecoverySummary[]>{
  const all=await keys<string>();
  const metadata=await getMany<RecoverySummary>(all.filter(key=>typeof key==='string'&&key.startsWith(META)));
  const result=metadata.filter((row):row is RecoverySummary=>!!row&&typeof row.key==='string'&&validKey(row.key)&&
    typeof row.name==='string'&&typeof row.projectId==='string'&&Number.isSafeInteger(row.revision)&&typeof row.cachedAt==='string');
  // Read-only compatibility with the early single-slot cache. Never delete it
  // just because a newer workspace has been opened.
  if(all.includes(LEGACY)){
    const old=await get<Project>(LEGACY);
    if(old&&typeof old.id==='string'&&typeof old.name==='string'&&Array.isArray(old.files)){
      try{result.push({...summary(LEGACY,old),cachedAt:old.modifiedAt});}catch{/* Leave an unrecognized legacy value untouched. */}
    }
  }
  return result.sort((a,b)=>b.cachedAt.localeCompare(a.cachedAt));
}
export async function readRecovery(key:string):Promise<Project>{
  if(key!==LEGACY&&!validKey(key))throw new MessageError(msg("草稿缓存标识无效"));
  const value=await get(key),project=key===LEGACY?value:value?.schema===1?value.project:undefined;
  if(!project)throw new MessageError(msg("草稿不存在或缓存版本不受支持"));
  // Treat recovery as an import: validate against the current archive contract
  // before replacing a workspace. Failure leaves the stored draft intact.
  return openProject(await saveProject(project));
}
export async function deleteRecovery(key:string):Promise<void>{
  if(key!==LEGACY&&!validKey(key))throw new MessageError(msg("草稿缓存标识无效"));
  await delMany(key===LEGACY?[key]:[key,META+key]);
}

import { m as msg, MessageError, messageFields, errorMessage, type MessageInput } from './messages';
import { Inflate, Unzip, UnzipInflate, zipSync } from 'fflate';
import { checkPaths, safePath } from './paths';
export interface ArchiveLimits { manifest: number; entries: number; file: number; total: number }
export const LIMITS: ArchiveLimits = { manifest: 4 * 1024 ** 2, entries: 10_000, file: 256 * 1024 ** 2, total: 1024 ** 3 };

/** Inspect the central directory before allocating decompression buffers. ZIP64 and encrypted archives are not supported. */
export function inspectZip(data: Uint8Array, limits = LIMITS) {
  const v = new DataView(data.buffer, data.byteOffset, data.byteLength);
  if (data.length < 22 || data.length > limits.total + 1024 ** 2) throw new MessageError(msg("工程压缩包大小不受支持"));
  let end = -1;
  for (let i = data.length - 22; i >= Math.max(0, data.length - 65557); i--) {
    if (v.getUint32(i, true) === 0x06054b50 && i + 22 + v.getUint16(i + 20, true) === data.length) { end = i; break; }
  }
  if (end < 0) throw new MessageError(msg("ZIP 已损坏或截断"));
  const count = v.getUint16(end + 10, true), start = v.getUint32(end + 16, true), size = v.getUint32(end + 12, true);
  if (v.getUint16(end + 4, true) || v.getUint16(end + 6, true) || count === 65535 || count !== v.getUint16(end + 8, true) || count > limits.entries || start + size !== end) throw new MessageError(msg("不支持分卷、ZIP64 或超限归档"));
  const entries: ZipEntry[] = [];
  const decoder = new TextDecoder('utf-8', { fatal: true });
  let pos = start, total = 0;
  const offsets = new Set<number>();
  for (let i = 0; i < count; i++) {
    if (pos + 46 > end || v.getUint32(pos, true) !== 0x02014b50) throw new MessageError(msg("ZIP 文件目录无效"));
    const flags = v.getUint16(pos + 8, true), method = v.getUint16(pos + 10, true);
    const compressed = v.getUint32(pos + 20, true), unpacked = v.getUint32(pos + 24, true);
    const nameSize = v.getUint16(pos + 28, true), extra = v.getUint16(pos + 30, true), comment = v.getUint16(pos + 32, true);
    if (pos + 46 + nameSize + extra + comment > end) throw new MessageError(msg("ZIP 文件名已截断"));
    const path = decoder.decode(data.subarray(pos + 46, pos + 46 + nameSize));
    const directory = path.endsWith('/'); safePath(directory ? path.slice(0, -1) : path);
    const fileMode = v.getUint32(pos + 38, true) >>> 16;
    if ((fileMode & 0xf000) === 0xa000) throw new MessageError(msg("不支持符号链接"));
    if (flags & 1 || ![0, 8].includes(method)) throw new MessageError(msg("不支持加密或此压缩方式"));
    if (unpacked > limits.file || (path === 'rocos-project.json' && unpacked > limits.manifest) || (directory && unpacked !== 0)) throw new MessageError(msg("文件超过限额：{v0}", {v0:String(path)}));
    total += unpacked; if (total > limits.total) throw new MessageError(msg("工程解压大小超过限额"));
    const offset = v.getUint32(pos + 42, true);
    if (offset + 30 > start || v.getUint32(offset, true) !== 0x04034b50 || offsets.has(offset)) throw new MessageError(msg("ZIP 本地文件头无效"));
    offsets.add(offset);
    const localNameSize = v.getUint16(offset + 26, true), localExtra = v.getUint16(offset + 28, true);
    const body = offset + 30 + localNameSize + localExtra;
    if (body + compressed > start || decoder.decode(data.subarray(offset + 30, offset + 30 + localNameSize)) !== path || v.getUint16(offset + 8, true) !== method || v.getUint16(offset + 6, true) !== flags) throw new MessageError(msg("ZIP 本地索引不一致"));
    entries.push({ path, size: unpacked, compressed, offset, body, method, directory, crc: v.getUint32(pos + 16, true) });
    pos += 46 + nameSize + extra + comment;
  }
  if (pos !== end) throw new MessageError(msg("ZIP 文件目录长度不一致"));
  checkPaths(entries.filter(e => !e.directory).map(e => e.path));
  const all = new Set<string>();
  for (const entry of entries) {
    const key = entry.path.replace(/\/$/, '').normalize('NFC').toLowerCase();
    if (all.has(key)) throw new MessageError(msg("重复 ZIP 条目：{v0}", {v0:String(entry.path)})); all.add(key);
  }
  return entries;
}
interface ZipEntry { path:string; size:number; compressed:number; offset:number; body:number; method:number; directory:boolean; crc:number }
const crcTable = Uint32Array.from({ length: 256 }, (_, n) => {
  for (let i = 0; i < 8; i++) n = (n & 1) ? 0xedb88320 ^ (n >>> 1) : n >>> 1;
  return n >>> 0;
});
function crc32(data: Uint8Array) { let crc = 0xffffffff; for (const b of data) crc = crcTable[(crc ^ b) & 255] ^ (crc >>> 8); return (crc ^ 0xffffffff) >>> 0; }
export function unpackZip(data: Uint8Array, limits = LIMITS): Map<string, Uint8Array> {
  const entries = inspectZip(data, limits);
  const expected = new Map(entries.map(e => [e.path, e]));
  const files = new Map<string, Uint8Array>(); const seen = new Set<string>(); let total = 0;
  const unzip = new Unzip(file => {
    const entry = expected.get(file.name);
    if (!entry || seen.has(file.name)) throw new MessageError(msg("ZIP 存在未登记或重复本地条目"));
    seen.add(file.name);
    const chunks: Uint8Array[] = []; let length = 0;
    file.ondata = (error, chunk, final) => {
      if (error) throw error;
      length += chunk.length; total += chunk.length;
      if (length > entry.size || length > limits.file || total > limits.total) { file.terminate(); throw new MessageError(msg("ZIP 实际解压量超限")); }
      chunks.push(chunk);
      if (final) {
        if (length !== entry.size) throw new MessageError(msg("ZIP 实际文件长度不一致"));
        const bytes = new Uint8Array(length); let offset = 0;
        for (const part of chunks) { bytes.set(part, offset); offset += part.length; }
        if (crc32(bytes) !== entry.crc) throw new MessageError(msg("ZIP 校验失败：{v0}", {v0:String(file.name)}));
        if (!entry.directory) files.set(file.name, bytes);
      }
    };
    file.start();
  });
  unzip.register(UnzipInflate);
  for (let i = 0; i < data.length; i += 16384) unzip.push(data.subarray(i, i + 16384), i + 16384 >= data.length);
  if (seen.size !== expected.size || files.size !== entries.filter(e => !e.directory).length) throw new MessageError(msg("ZIP 缺少文件"));
  return files;
}
export function packZip(files: Map<string, Uint8Array>): Uint8Array {
  checkPaths([...files.keys()]);
  const input = Object.create(null) as Record<string, Uint8Array>;
  for (const [path, bytes] of files) input[path] = bytes;
  return zipSync(input, { level: 6 });
}

export interface ZipRecovery { files:Map<string,Uint8Array>; failures:Map<string,string>; warnings:string[]; failureMessages:Map<string,ReturnType<typeof messageFields>>; warningMessages:ReturnType<typeof messageFields>[] }
class RecoveryLimitError extends MessageError {}
/** Explicit salvage only. This never replaces the strict ordinary ZIP reader. */
export function recoverZip(data:Uint8Array,limits=LIMITS):ZipRecovery {
  if(data.length>limits.total+1024**2)throw new MessageError(msg("工程压缩包大小不受支持"));
  const v=new DataView(data.buffer,data.byteOffset,data.byteLength),warnings:string[]=[];
  const warningMessages:ReturnType<typeof messageFields>[]=[];
  const warn=(value:MessageInput)=>{const fields=messageFields(value);warnings.push(fields.message);warningMessages.push(fields);};
  let entries:ZipEntry[];
  try{entries=inspectZip(data,limits);}catch(error){
    // A missing end record can leave a verifiable prefix of local entries.
    // Structural/path/limit errors in a present directory are never bypassed.
    if(!(error instanceof Error)||error.message!=='ZIP 已损坏或截断')throw error;
    entries=[];let offset=0,total=0;
    const names=new Set<string>(),decoder=new TextDecoder('utf-8',{fatal:true});
    warn(msg("ZIP 中央目录或结束记录已截断；仅检查具有完整本地头、明确长度和 CRC 的文件。"));
    while(offset+4<=data.length){
      const signature=v.getUint32(offset,true);
      if(signature===0x02014b50||signature===0x06054b50)break;
      if(signature!==0x04034b50||offset+30>data.length){warn(msg("后续本地文件头不完整，停止扫描。"));break;}
      if(entries.length>=limits.entries)throw new RecoveryLimitError(msg("恢复条目数量超过限额"));
      const flags=v.getUint16(offset+6,true),method=v.getUint16(offset+8,true),compressed=v.getUint32(offset+18,true),size=v.getUint32(offset+22,true);
      const nameSize=v.getUint16(offset+26,true),extra=v.getUint16(offset+28,true),body=offset+30+nameSize+extra;
      if(body>data.length){warn(msg("后续文件名或扩展头被截断，停止扫描。"));break;}
      const path=decoder.decode(data.subarray(offset+30,offset+30+nameSize)),directory=path.endsWith('/');safePath(directory?path.slice(0,-1):path);
      const key=path.replace(/\/$/,'').normalize('NFC').toLowerCase();if(names.has(key))throw new MessageError(msg("重复 ZIP 条目：{v0}", {v0:String(path)}));names.add(key);
      if(flags&1||![0,8].includes(method))throw new MessageError(msg("不支持加密或此压缩方式"));
      if(flags&8){warn(msg("无法在中央目录缺失时确定数据描述符条目的边界：{v0}；停止扫描。", {v0:String(path)}));break;}
      if(size>limits.file||(path==='rocos-project.json'&&size>limits.manifest)||(directory&&size!==0))throw new RecoveryLimitError(msg("文件超过限额：{v0}", {v0:String(path)}));
      total+=size;if(total>limits.total)throw new RecoveryLimitError(msg("工程解压大小超过限额"));
      if(body+compressed>data.length){warn(msg("文件数据被截断：{v0}；停止扫描。", {v0:String(path)}));break;}
      entries.push({path,size,compressed,offset,body,method,directory,crc:v.getUint32(offset+14,true)});
      offset=body+compressed;
    }
    checkPaths(entries.filter(e=>!e.directory).map(e=>e.path));
  }
  const ordered=[...entries].sort((a,b)=>a.offset-b.offset);
  for(let i=1;i<ordered.length;i++)if(ordered[i-1].body+ordered[i-1].compressed>ordered[i].offset)throw new MessageError(msg("ZIP 文件区域重叠，不能安全恢复"));
  const files=new Map<string,Uint8Array>(),failures=new Map<string,string>(),failureMessages=new Map<string,ReturnType<typeof messageFields>>();let total=0;
  for(const entry of entries){
    try{
      const chunks:Uint8Array[]=[];let length=0,ended=false;
      const receive=(chunk:Uint8Array,final:boolean)=>{
        length+=chunk.length;total+=chunk.length;
        if(length>limits.file||total>limits.total)throw new RecoveryLimitError(msg("ZIP 实际解压量超限"));
        if(length>entry.size)throw new MessageError(msg("实际文件长度超出声明"));
        chunks.push(chunk);ended=final;
      };
      const compressed=data.subarray(entry.body,entry.body+entry.compressed);
      if(entry.method===0)receive(compressed,true);
      else{
        const inflater=new Inflate(receive);
        for(let i=0;i<compressed.length;i+=16384)inflater.push(compressed.subarray(i,i+16384),i+16384>=compressed.length);
      }
      if(!ended||length!==entry.size)throw new MessageError(msg("实际文件长度不一致"));
      const bytes=new Uint8Array(length);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
      if(crc32(bytes)!==entry.crc)throw new MessageError(msg("ZIP CRC 不匹配"));
      if(!entry.directory)files.set(entry.path,bytes);
    }catch(error){
      if(error instanceof RecoveryLimitError)throw error;
      const fields=messageFields(errorMessage(error));failures.set(entry.path,fields.message);failureMessages.set(entry.path,fields);
    }
  }
  return {files,failures,warnings,failureMessages,warningMessages};
}

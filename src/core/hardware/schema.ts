import { m as msg, MessageError } from '../project/messages';
import { isAlias, isCollection, isScalar, isSeq, type Document } from 'yaml';
import { yamlDocument } from '../documents/yaml';
import { textOf, type ProjectFile } from '../project/types';
import { appRules } from '../project/profiles';

export type HardwareType = 'driver'|'ft_sensor'|'io';
export const hardwareTypes:readonly HardwareType[] = appRules.hardwareTypes as HardwareType[];
export type SignalSpec = { key: string; bytes: number; kind: 'signed'|'unsigned'|'bits'; required?: boolean; index?: number };
const signal = (key: string, bytes: number, kind: SignalSpec['kind'] = 'signed', required = false, index?: number): SignalSpec => ({ key, bytes, kind, required, index });
export const axes = ['fx','fy','fz','tx','ty','tz'];
export const channels = ['digital_in_channels','digital_out_channels','analog_in_channels','analog_out_channels'];
// rocos-app 7093bcd: parseDrive/parseFTSensor/parseIO and buildPDOCache.
// Required means completeness for the default position controller, not YAML parser acceptance.
export const signals: Record<HardwareType, { inputs: SignalSpec[]; outputs: SignalSpec[] }> = {
  driver: {
    inputs: [signal('status_word',2,'unsigned',true,0x6041),signal('position_actual_value',4,'signed',true,0x6064),signal('velocity_actual_value',4,'signed',false,0x606c),signal('torque_actual_value',2,'signed',false,0x6077),signal('load_torque_value',2),signal('secondary_position_value',4),signal('digital_inputs',4,'bits'),signal('digital_outputs',4,'bits')],
    outputs: [signal('control_word',2,'unsigned',true,0x6040),signal('mode_of_operation',1,'signed',true,0x6060),signal('target_position',4,'signed',true,0x607a),signal('target_velocity',4,'signed',false,0x60ff),signal('target_torque',2,'signed',false,0x6071),signal('digital_outputs',4,'bits')],
  },
  ft_sensor: { inputs: axes.map(k=>signal(k,2,'signed',true)), outputs: [] },
  io: { inputs: [signal('digital_inputs',4,'bits'),signal('digital_outputs',4,'bits'),signal('analog_inputs',2)], outputs: [signal('digital_outputs',4,'bits'),signal('analog_outputs',2)] },
};
export const isRecord = (v: unknown): v is Record<string, any> => v !== null && typeof v === 'object' && !Array.isArray(v);
export function finiteNumber(v: unknown): number {
  if (typeof v === 'bigint' || typeof v === 'number') return Number(v);
  return typeof v === 'string' && /^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i.test(v.trim()) ? Number(v) : NaN;
}
// yaml-cpp uses C++ integer extraction with base autodetection, unlike YAML 1.2.
export function nativeInt(doc: Document, path: (string|number)[], fallback = NaN): number {
  const node = nativeNode(doc,path);
  if (node === undefined) return fallback;
  if (!isScalar(node) || node.value === null) return NaN;
  const raw = String(node.source ?? node.value).replace(/[ \t\r\n\f\v]+$/, '');
  const match = /^([+-]?)(0[xX][\da-fA-F]+|0[0-7]*|[1-9]\d*)$/.exec(raw);
  if (!match) return NaN;
  const digits = match[2];
  const n = BigInt(digits.startsWith('0') && !/^0x/i.test(digits) && digits.length>1 ? '0o'+digits.slice(1) : digits) * (match[1]==='-'?-1n:1n);
  return n < -2147483648n || n > 2147483647n ? NaN : Number(n);
}
export function hardwareDocument(file: ProjectFile) {
  const doc=yamlDocument(textOf(file)), data=doc.toJS({maxAliasCount:100});
  const devices: Record<string, any>[] = Array.isArray(data?.hardware) ? data.hardware : [];
  devices.forEach((d,i)=>{if(!isRecord(d))return;d.id=nativeInt(doc,['hardware',i,'id']);
    if(isRecord(d.transform)){d.transform.offset_pos_cnt=nativeInt(doc,['hardware',i,'transform','offset_pos_cnt']);for(const k of ['ratio','cnt_per_unit','torque_per_unit'])if(k in d.transform&&d.transform[k]!==null)d.transform[k]=nativeFloat(doc,['hardware',i,'transform',k]);}
    if(isRecord(d.limit))for(const k of ['lower','upper','vel','acc','jerk','effort'])if(k in d.limit&&d.limit[k]!==null)d.limit[k]=nativeFloat(doc,['hardware',i,'limit',k]);
    if(isRecord(d.offset))for(const k of axes)if(k in d.offset&&d.offset[k]!==null)d.offset[k]=nativeFloat(doc,['hardware',i,'offset',k]);
    if(d.type==='io')channels.forEach(k=>d[k]=nativeInt(doc,['hardware',i,k],0));
  });
  return {doc,data,devices};
}
export function bindingDocument(file: ProjectFile) {
  const doc=yamlDocument(textOf(file)), data=doc.toJS({maxAliasCount:100});
  const bindings: Record<string,any>[] = Array.isArray(data?.joint_bindings)?data.joint_bindings:[];
  bindings.forEach((b,i)=>{if(isRecord(b))b.drive_id=nativeInt(doc,['joint_bindings',i,'drive_id']);});
  return {doc,data,bindings};
}

// Resolve aliases at each path component (Document.getIn does not follow them).
export function nativeNode(doc:Document,path:(string|number)[]):unknown {
  let node:unknown=doc.contents;
  const resolve=(v:unknown)=>{const seen=new Set<unknown>();while(isAlias(v)){if(seen.has(v))throw new MessageError(msg("YAML alias 存在循环"));seen.add(v);v=v.resolve(doc);}return v;};
  for(const key of path){node=resolve(node);if(!isCollection(node))return undefined;node=node.get(key,true);}
  return resolve(node);
}
// YAML 1.2 serialization of an unchanged `010` becomes `10`. Canonicalize
// native integer fields to their yaml-cpp value before any form transaction.
export function normalizeHardwareIntegers(doc:Document,role:string) {
  const paths:(string|number)[][]=[];
  if(role==='hardware'){
    const list=nativeNode(doc,['hardware']);
    if(isSeq(list))list.items.forEach((_,i)=>{
      const type=nativeNode(doc,['hardware',i,'type']);
      if(!isScalar(type)||!hardwareTypes.includes(type.value as HardwareType))return;
      paths.push(['hardware',i,'id']);
      if(type.value==='driver')paths.push(['hardware',i,'transform','offset_pos_cnt']);
      if(type.value==='io')channels.forEach(k=>paths.push(['hardware',i,k]));
    });
  } else if(role==='binding'){
    const list=nativeNode(doc,['joint_bindings']);
    if(isSeq(list))list.items.forEach((_,i)=>paths.push(['joint_bindings',i,'drive_id']));
  }
  const floatPaths:(string|number)[][]=[];
  if(role==='hardware'){
    const list=nativeNode(doc,['hardware']);
    if(isSeq(list))list.items.forEach((_,i)=>{
      const t=nativeNode(doc,['hardware',i,'type']);
      if(!isScalar(t))return;
      if(t.value==='driver'){
        for(const k of ['ratio','cnt_per_unit','torque_per_unit'])floatPaths.push(['hardware',i,'transform',k]);
        for(const k of ['lower','upper','vel','acc','jerk','effort'])floatPaths.push(['hardware',i,'limit',k]);
      } else if(t.value==='ft_sensor')for(const k of axes)floatPaths.push(['hardware',i,'offset',k]);
    });
  }
  const floatNodes=new Set(floatPaths.map(path=>nativeNode(doc,path)));
  for(const path of floatPaths){const node=nativeNode(doc,path);if(isScalar(node)&&node.value!==null&&!Number.isFinite(nativeFloat(doc,path))){node.value=String(node.source??node.value);node.type='QUOTE_DOUBLE';}}
  for(const path of paths){const node=nativeNode(doc,path);if(!isScalar(node))continue;const value=nativeInt(doc,path);if(Number.isInteger(value)){if(floatNodes.has(node)&&value!==nativeFloat(doc,path)){node.value=String(node.source??node.value);node.type='QUOTE_DOUBLE';}else{node.value=value;node.source=String(value);}node.format=undefined;}else if(node.value!==null){node.value=String(node.source??node.value);node.type='QUOTE_DOUBLE';}}
}

export function nativeFloat(doc:Document,path:(string|number)[]):number {
  const node=nativeNode(doc,path);
  if(!isScalar(node)||node.value===null)return NaN;
  const raw=String(node.source??node.value).replace(/[ \t\r\n\f\v]+$/, '');
  return /^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i.test(raw)?Number(raw):NaN;
}

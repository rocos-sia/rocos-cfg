import { type BusCatalog, type BusSignal, type BusSlave } from '../project/types';
import { m as msg, joinMessages, type DiagnosticMessage, type MessageTemplate } from '../project/messages';
export interface BusChange { key: string; object: string; objectText:MessageTemplate; change: '新增' | '删除' | '变化'; before: string; beforeText:MessageTemplate; after: string; afterText:MessageTemplate }
// Compare runtime slots, not physical device identity. No migration is inferred
// from list order or from a coincidentally equal name.
export function compareBus(before: BusCatalog, after: BusCatalog): BusChange[] {
  const changes: BusChange[] = [];
  function compare<T>(kind: DiagnosticMessage, left: T[], right: T[], keyOf: (v: T) => string, describe: (v: T) => DiagnosticMessage) {
    const grouped = (items: T[]) => {
      const map = new Map<string, DiagnosticMessage[]>();
      for (const item of items) { const key = keyOf(item); map.set(key, [...(map.get(key) || []), describe(item)]); }
      return new Map([...map].map(([key, values]) => [key, joinMessages(values.sort((a,b)=>a.message<b.message?-1:a.message>b.message?1:0),'\n')]));
    };
    const a = grouped(left), b = grouped(right);
    for (const key of new Set([...a.keys(), ...b.keys()])) if (a.get(key)?.message !== b.get(key)?.message) {
      const object=msg('{kind} {key}',{kind:kind.text,key}),old=a.get(key)||msg('—'),next=b.get(key)||msg('—');
      changes.push({ key: `${kind.message}:${key}`, object:object.message,objectText:object.text,
        change: !a.has(key) ? '新增' : !b.has(key) ? '删除' : '变化', before:old.message,beforeText:old.text,after:next.message,afterText:next.text });
    }
  }
  compare<BusSlave>(msg('从站'), before.slaves, after.slaves, s => String(s.id), s =>
    msg('名称={name}；地址={address}；厂商={vendor}；产品={product}',{name:s.name,address:String(s.address??'—'),vendor:s.vendor??'—',product:s.product??'—'}));
  compare<BusSignal>(msg('信号'), before.signals, after.signals, s => `${s.slaveId} / ${s.direction} / ${s.runtimeName}`, s =>
    msg('{name}；类型={type}；位宽={bits}；偏移={offset}；存储={storage} B；对象={index}:{subIndex}；解析={resolution}',{name:s.sourceName,type:s.dataType??'—',bits:String(s.bitLength),offset:String(s.bitOffset??'—'),storage:String(s.storageBytes),index:String(s.index??'—'),subIndex:String(s.subIndex??'—'),resolution:s.resolution}));
  return changes;
}

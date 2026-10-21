import { type BusCatalog, type BusSignal, type BusSlave } from '../project/types';
export interface BusChange { key: string; object: string; change: '新增' | '删除' | '变化'; before: string; after: string }
// Compare runtime slots, not physical device identity. No migration is inferred
// from list order or from a coincidentally equal name.
export function compareBus(before: BusCatalog, after: BusCatalog): BusChange[] {
  const changes: BusChange[] = [];
  function compare<T>(kind: string, left: T[], right: T[], keyOf: (v: T) => string, describe: (v: T) => string) {
    const grouped = (items: T[]) => {
      const map = new Map<string, string[]>();
      for (const item of items) { const key = keyOf(item); map.set(key, [...(map.get(key) || []), describe(item)]); }
      return new Map([...map].map(([key, values]) => [key, values.sort().join('\n')]));
    };
    const a = grouped(left), b = grouped(right);
    for (const key of new Set([...a.keys(), ...b.keys()])) if (a.get(key) !== b.get(key)) changes.push({ key: `${kind}:${key}`, object: `${kind} ${key}`,
      change: !a.has(key) ? '新增' : !b.has(key) ? '删除' : '变化', before: a.get(key) || '—', after: b.get(key) || '—' });
  }
  compare<BusSlave>('从站', before.slaves, after.slaves, s => String(s.id), s =>
    `名称=${s.name}；地址=${s.address ?? '—'}；厂商=${s.vendor ?? '—'}；产品=${s.product ?? '—'}`);
  compare<BusSignal>('信号', before.signals, after.signals, s => `${s.slaveId} / ${s.direction} / ${s.runtimeName}`, s =>
    `${s.sourceName}；类型=${s.dataType ?? '—'}；位宽=${s.bitLength}；偏移=${s.bitOffset ?? '—'}；存储=${s.storageBytes} B；对象=${s.index ?? '—'}:${s.subIndex ?? '—'}；解析=${s.resolution}`);
  return changes;
}

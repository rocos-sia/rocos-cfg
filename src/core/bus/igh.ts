import { isMap, isScalar, isSeq } from 'yaml';
import { yamlDocument } from '../documents/yaml';
import { textOf, type BusCatalog, type ProjectFile } from '../project/types';
import { ighRules } from '../project/profiles';

export const SDO_TYPES = ['int8', 'uint8', 'int16', 'uint16', 'int32', 'uint32', 'int64', 'uint64'];
export function exactInteger(text: string, type: string): bigint {
  const match = /^(u?)int(8|16|32|64)$/.exec(type);
  if (!match) throw new Error('不支持的 SDO 整数类型');
  const unsigned = match[1] === 'u', bits = BigInt(match[2]);
  if (!(unsigned ? /^(?:[0-9]+|0[xX][0-9a-fA-F]+)$/ : /^(?:-?[0-9]+|0[xX][0-9a-fA-F]+)$/).test(text)) {
    throw new Error('请输入十进制整数或非负 0x 十六进制整数');
  }
  const value = BigInt(text);
  const min = unsigned ? 0n : -(1n << (bits - 1n));
  const max = unsigned ? (1n << bits) - 1n : (1n << (bits - 1n)) - 1n;
  if (value < min || value > max) throw new Error(`${type} 范围为 ${min}–${max}`);
  return value;
}

// Rules follow rocos-igh 3c92f2a pdo_config.cpp. Inspect scalar tokens as well
// as values: the native loader rejects quoted integers, explicit tags and +1.
export function buildIghCatalog(file: ProjectFile): BusCatalog {
  const result: BusCatalog = { slaves: [], signals: [], diagnostics: [] };
  const report = (field: string, message: string, code = 'igh.schema', severity: 'error' | 'warning' = 'error') => {
    result.diagnostics.push({ code, severity, fileId: file.id, field, message: `${field}：${message}` });
  };
  const doc = yamlDocument(textOf(file));
  const node = (path: (string | number)[]) => doc.getIn(path, true);
  const label = (path: (string | number)[]) => path.join('.') || 'root';
  const keys = (path: (string | number)[], allowed: string[]) => {
    const n = node(path);
    if (!isMap(n)) { report(label(path), '必须为映射'); return false; }
    for (const pair of n.items) {
      const k = isScalar(pair.key) ? String(pair.key.value) : '';
      if (!allowed.includes(k)) report(label([...path, k]), '目标加载器不支持此字段', 'igh.unknown');
    }
    return true;
  };
  const integer = (path: (string | number)[], type: string, minimum = 0n, fallback?: bigint) => {
    const n = node(path);
    if (n === undefined && fallback !== undefined) return fallback;
    try {
      if (!isScalar(n) || n.type !== 'PLAIN' || n.tag) throw new Error('必须为不带引号和显式标签的整数');
      const value = exactInteger(n.source ?? '', type);
      if (value < minimum) throw new Error(`必须大于等于 ${minimum}`);
      return value;
    } catch (e) { report(label(path), (e as Error).message, 'igh.integer'); return undefined; }
  };
  const name = (path: (string | number)[], max: number) => {
    const n = node(path);
    const value = isScalar(n) && n.value !== null ? String(n.source ?? n.value) : '';
    if (!value || new TextEncoder().encode(value).length > max || value.includes('\0')) report(label(path), `名称必须非空且不超过 ${max} 字节`, 'igh.name');
    return value;
  };
  if (!keys([], ['version', 'master', 'slaves'])) return result;
  if (integer(['version'], 'uint64') !== 1n) report('version', '仅支持 1', 'igh.version');
  result.masterId = 0; result.cycleUs = 1000;
  let dc = 'off';
  if (node(['master']) !== undefined && keys(['master'], ['master_id', 'period_us', 'cpu', 'dc', 'preop_timeout_ms', 'op_timeout_ms', 'pdo_config_attempts'])) {
    result.masterId = Number(integer(['master', 'master_id'], 'uint32', 0n, 0n));
    const period = integer(['master', 'period_us'], 'uint32', BigInt(ighRules.minCycleUs), 1000n); result.cycleUs = Number(period);
    for (const field of ['preop_timeout_ms', 'op_timeout_ms', 'pdo_config_attempts']) integer(['master', field], 'uint32', 1n, 1n);
    const cpu = node(['master', 'cpu']);
    if (cpu !== undefined && !(isScalar(cpu) && cpu.value === null)) integer(['master', 'cpu'], 'uint32');
    const clock = node(['master', 'dc']);
    if (clock !== undefined) {
      dc = isScalar(clock) ? String(clock.value) : '';
      if (!['on', 'off'].includes(dc)) report('master.dc', '必须为字符串 on 或 off', 'igh.dc');
    }
    if (dc === 'on' && period !== undefined && period > BigInt(ighRules.maxDcCycleUs)) report('master.period_us', `开启 DC 时不能超过 ${ighRules.maxDcCycleUs} μs`, 'igh.cycle');
  }
  const slaves = node(['slaves']);
  if (!isSeq(slaves) || !slaves.items.length || slaves.items.length > ighRules.maxSlaves) {
    report('slaves', `从站数量须在 1–${ighRules.maxSlaves} 之间`, 'igh.slaves'); return result;
  }
  let referenceCount = 0;
  slaves.items.forEach((_, i) => {
    const path = ['slaves', i];
    if (!keys(path, ['id', 'name', 'dc_ref', 'rx_pdos', 'tx_pdos', 'init_commands'])) return;
    if (integer([...path, 'id'], 'uint16') !== BigInt(i)) report(label(path), 'id 必须与零起始物理序号一致', 'igh.slave-id');
    result.slaves.push({ id: i, name: name([...path, 'name'], ighRules.slaveNameBytes) });
    const ref = node([...path, 'dc_ref']);
    if (ref !== undefined) {
      if (!isScalar(ref) || ref.type !== 'PLAIN' || ref.tag || !['true', 'false'].includes(ref.source ?? '')) report(label([...path, 'dc_ref']), '必须为 true 或 false');
      else if (ref.value === true) referenceCount++;
    }
    for (const [key, direction] of [['rx_pdos', 'output'], ['tx_pdos', 'input']] as const) {
      const pdos = node([...path, key]);
      if (!isSeq(pdos) || !pdos.items.length) { report(label([...path, key]), '必须为非空 PDO 列表', 'igh.pdos'); continue; }
      pdos.items.forEach((_, p) => {
        const pp = [...path, key, p];
        if (!keys(pp, ['index', 'entries'])) return;
        integer([...pp, 'index'], 'uint16');
        const entries = node([...pp, 'entries']);
        if ((isScalar(entries) && entries.value === null) || (isMap(entries) && !entries.items.length) || (isSeq(entries) && !entries.items.length)) {
          report(label([...pp, 'entries']), '运行时待发现', 'igh.discovery', 'warning'); return;
        }
        if (!isSeq(entries)) { report(label([...pp, 'entries']), '必须为条目序列，或显式空值 [] / null / {}', 'igh.entries'); return; }
        entries.items.forEach((_, n) => {
          const ep = [...pp, 'entries', n];
          if (!keys(ep, ['name', 'index', 'sub_index', 'bit_length'])) return;
          const entryName = name([...ep, 'name'], ighRules.variableNameBytes);
          const index = integer([...ep, 'index'], 'uint16');
          const sub = integer([...ep, 'sub_index'], 'uint8');
          const bits = integer([...ep, 'bit_length'], 'uint8', 1n);
          result.signals.push({ uid: `${file.id}:${i}:${direction}:${p}:${n}`, slaveId: i, direction, sourceName: entryName, runtimeName: entryName,
            bitLength: Number(bits), storageBytes: Math.ceil(Number(bits) / 8), index: Number(index), subIndex: Number(sub),
            resolution: index === undefined || sub === undefined || bits === undefined ? 'unresolved' : 'resolved' });
        });
      });
    }
    const commands = node([...path, 'init_commands']);
    if (commands !== undefined) {
      if (!isSeq(commands)) { report(label([...path, 'init_commands']), '必须为有序列表'); return; }
      commands.items.forEach((_, c) => {
        const cp = [...path, 'init_commands', c];
        if (!keys(cp, ['name', 'index', 'sub_index', 'type', 'Type', 'value', 'Value'])) return;
        if (node([...cp, 'name']) !== undefined) name([...cp, 'name'], ighRules.variableNameBytes);
        integer([...cp, 'index'], 'uint16'); integer([...cp, 'sub_index'], 'uint8');
        for (const [lower, upper] of [['type', 'Type'], ['value', 'Value']]) {
          if (node([...cp, lower]) !== undefined && node([...cp, upper]) !== undefined) report(label(cp), `${lower} 与 ${upper} 不能同时出现`, 'igh.sdo-alias');
        }
        const typeKey = node([...cp, 'Type']) !== undefined ? 'Type' : 'type';
        const valueKey = node([...cp, 'Value']) !== undefined ? 'Value' : 'value';
        const t = node([...cp, typeKey]);
        const type = isScalar(t) ? String(t.value) : '';
        if (!SDO_TYPES.includes(type)) report(label([...cp, typeKey]), '不支持的 SDO 整数类型', 'igh.sdo-type');
        else integer([...cp, valueKey], type, type.startsWith('u') ? 0n : -(1n << (BigInt(type.slice(3)) - 1n)));
      });
    }
  });
  if (referenceCount > 1 || (dc === 'on' && referenceCount !== 1)) report('slaves.dc_ref', 'DC 开启时恰有一个参考从站；关闭时也不能超过一个', 'igh.dc-ref');
  return result;
}

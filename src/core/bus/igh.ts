import { m as msg, MessageError, messageFields, errorMessage, type MessageInput } from '../project/messages';
import { isMap, isScalar, isSeq } from 'yaml';
import { yamlDocument } from '../documents/yaml';
import { textOf, type BusCatalog, type ProjectFile } from '../project/types';
import { readIghEni } from './igh-eni';
import { ighRules } from '../project/profiles';

export const SDO_TYPES = ['int8', 'uint8', 'int16', 'uint16', 'int32', 'uint32', 'int64', 'uint64'];
export function exactInteger(text: string, type: string): bigint {
  const match = /^(u?)int(8|16|32|64)$/.exec(type);
  if (!match) throw new MessageError(msg("不支持的 SDO 整数类型"));
  const unsigned = match[1] === 'u', bits = BigInt(match[2]);
  if (!(unsigned ? /^(?:[0-9]+|0[xX][0-9a-fA-F]+)$/ : /^(?:-?[0-9]+|0[xX][0-9a-fA-F]+)$/).test(text)) {
    throw new MessageError(msg("请输入十进制整数或非负 0x 十六进制整数"));
  }
  const value = BigInt(text);
  const min = unsigned ? 0n : -(1n << (bits - 1n));
  const max = unsigned ? (1n << bits) - 1n : (1n << (bits - 1n)) - 1n;
  if (value < min || value > max) throw new MessageError(msg("{v0} 范围为 {v1}–{v2}", {v0:String(type), v1:String(min), v2:String(max)}));
  return value;
}

// Rules follow rocos-igh 9001c87, including its legacy inline format. Inspect tokens as well
// as values: the native loader rejects quoted integers, explicit tags and +1.
export function buildIghCatalog(file: ProjectFile, eni?: ProjectFile): BusCatalog {
  const result: BusCatalog = { slaves: [], signals: [], diagnostics: [] };
  const report = (field: string, message: MessageInput, code = 'igh.schema', severity: 'error' | 'warning' = 'error') => {
    result.diagnostics.push({ code, severity, fileId: file.id, field, ...msg('{field}：{detail}',{field,detail:typeof message==='string'?message:message.text||message.message}) });
  };
  const doc = yamlDocument(textOf(file));
  const node = (path: (string | number)[]) => doc.getIn(path, true);
  const label = (path: (string | number)[]) => path.join('.') || 'root';
  const keys = (path: (string | number)[], allowed: string[]) => {
    const n = node(path);
    if (!isMap(n)) { report(label(path), msg("必须为映射")); return false; }
    for (const pair of n.items) {
      const k = isScalar(pair.key) ? String(pair.key.value) : '';
      if (!allowed.includes(k)) report(label([...path, k]), msg("目标加载器不支持此字段"), 'igh.unknown');
    }
    return true;
  };
  const integer = (path: (string | number)[], type: string, minimum = 0n, fallback?: bigint) => {
    const n = node(path);
    if (n === undefined && fallback !== undefined) return fallback;
    try {
      if (!isScalar(n) || n.type !== 'PLAIN' || n.tag) throw new MessageError(msg("必须为不带引号和显式标签的整数"));
      const value = exactInteger(n.source ?? '', type);
      if (value < minimum) throw new MessageError(msg("必须大于等于 {v0}", {v0:String(minimum)}));
      return value;
    } catch (e) { report(label(path), errorMessage(e), 'igh.integer'); return undefined; }
  };
  const name = (path: (string | number)[], max: number) => {
    const n = node(path);
    const value = isScalar(n) && n.value !== null ? String(n.source ?? n.value) : '';
    if (!value || new TextEncoder().encode(value).length > max || value.includes('\0')) report(label(path), msg("名称必须非空且不超过 {v0} 字节", {v0:String(max)}), 'igh.name');
    return value;
  };
  const flatFields = ['id', 'cycle', 'cpuidx', 'dc', 'preop_timeout_ms', 'op_timeout_ms', 'pdo_config_attempts'];
  if (!keys([], ['version', 'master', 'slaves', 'eni', ...flatFields])) return result;
  const fromEni = node(['eni']) !== undefined;
  if (fromEni && node(['slaves']) !== undefined) report('slaves', 'eni 与 slaves 不能同时出现');
  const legacy = node(['master']) !== undefined;
  if (legacy && flatFields.some(key => node([key]) !== undefined)) report('master', 'master 块不能与顶层启动参数混用');
  let imported: ReturnType<typeof readIghEni> | undefined;
  if (fromEni) {
    const path = node(['eni']);
    if (!isScalar(path) || path.value === null || !String(path.source ?? path.value) || new TextEncoder().encode(String(path.source ?? path.value)).length > 4096) report('eni', 'ENI 路径必须为非空字符串，最多 4096 字节');
    if (!eni) report('eni', msg('请导入 ENI 文件'), 'eni.missing');
    else try { imported = readIghEni(eni.bytes); }
    catch (error) { result.diagnostics.push({code:'igh.eni', severity:'error', fileId:eni.id, ...messageFields(errorMessage(error))}); }
  }
  if ((!fromEni || node(['version']) !== undefined) && integer(['version'], 'uint64') !== 1n) report('version', msg("仅支持 1"), 'igh.version');
  result.masterId = 0; result.cycleUs = imported?.master.period_us ?? 1000;
  let dc = imported?.master.dc ?? 'off';
  const prefix = legacy ? ['master'] : [];
  if (!legacy || keys(['master'], ['master_id', 'period_us', 'cpu', 'dc', 'preop_timeout_ms', 'op_timeout_ms', 'pdo_config_attempts'])) {
    result.masterId = Number(integer([...prefix, legacy ? 'master_id' : 'id'], 'uint32', 0n, 0n));
    const periodPath = [...prefix, legacy ? 'period_us' : 'cycle'];
    const period = integer(periodPath, 'uint32', BigInt(ighRules.minCycleUs), BigInt(result.cycleUs)); result.cycleUs = Number(period);
    for (const field of ['preop_timeout_ms', 'op_timeout_ms', 'pdo_config_attempts']) integer([...prefix, field], 'uint32', 1n, 1n);
    const cpuPath = [...prefix, legacy ? 'cpu' : 'cpuidx'], cpu = node(cpuPath);
    if (cpu !== undefined && !(isScalar(cpu) && cpu.value === null)) integer(cpuPath, 'uint32');
    const clock = node([...prefix, 'dc']);
    if (clock !== undefined) {
      dc = isScalar(clock) ? String(clock.value) : '';
      if (!['on', 'off'].includes(dc)) report(label([...prefix, 'dc']), msg("必须为字符串 on 或 off"), 'igh.dc');
    }
    if (dc === 'on' && period !== undefined && period > BigInt(ighRules.maxDcCycleUs)) report(label(periodPath), msg("开启 DC 时不能超过 {v0} μs", {v0:String(ighRules.maxDcCycleUs)}), 'igh.cycle');
  }
  if (fromEni) {
    if (imported && eni) {
      result.slaves = imported.slaves.map(({id, name, address, vendor, product}) => ({id, name, address, vendor:String(vendor), product:String(product)}));
      if (dc === 'on' && imported.slaves.some(s => s.clock && s.clock.cycle !== result.cycleUs! * 1000)) report(legacy ? 'master.period_us' : 'cycle', '启用 DC 时通信周期必须与 ENI CycleTime0 一致', 'igh.cycle');
      for (const slave of imported.slaves) for (const [key, direction] of [['rx_pdos','output'],['tx_pdos','input']] as const) {
        slave[key].forEach((pdo, p) => pdo.entries.forEach((entry, n) => {
          result.signals.push({uid:`${eni.id}:${slave.id}:${direction}:${p}:${n}`, slaveId:slave.id, direction,
            sourceName:entry.name, runtimeName:entry.name, index:entry.index, subIndex:entry.sub_index,
            bitLength:entry.bit_length, storageBytes:entry.bit_length / 8, resolution:'resolved', source:{fileId:eni.id,field:`Config.Slave.${slave.xmlIndex}.ProcessData.${key==='rx_pdos'?'RxPdo':'TxPdo'}.${pdo.xmlIndex}.Entry.${n}`}});
        }));
      }
    }
    return result;
  }
  const slaves = node(['slaves']);
  if (!isSeq(slaves) || !slaves.items.length || slaves.items.length > ighRules.maxSlaves) {
    report('slaves', msg("从站数量须在 1–{v0} 之间", {v0:String(ighRules.maxSlaves)}), 'igh.slaves'); return result;
  }
  let referenceCount = 0;
  slaves.items.forEach((_, i) => {
    const path = ['slaves', i];
    if (!keys(path, ['id', 'name', 'dc_ref', 'rx_pdos', 'tx_pdos', 'init_commands'])) return;
    if (integer([...path, 'id'], 'uint16') !== BigInt(i)) report(label(path), msg("id 必须与零起始物理序号一致"), 'igh.slave-id');
    result.slaves.push({ id: i, name: name([...path, 'name'], ighRules.slaveNameBytes) });
    const ref = node([...path, 'dc_ref']);
    if (ref !== undefined) {
      if (!isScalar(ref) || ref.type !== 'PLAIN' || ref.tag || !['true', 'false'].includes(ref.source ?? '')) report(label([...path, 'dc_ref']), msg("必须为 true 或 false"));
      else if (ref.value === true) referenceCount++;
    }
    for (const [key, direction] of [['rx_pdos', 'output'], ['tx_pdos', 'input']] as const) {
      const pdos = node([...path, key]);
      if (!isSeq(pdos) || !pdos.items.length) { report(label([...path, key]), msg("必须为非空 PDO 列表"), 'igh.pdos'); continue; }
      pdos.items.forEach((_, p) => {
        const pp = [...path, key, p];
        if (!keys(pp, ['index', 'entries'])) return;
        integer([...pp, 'index'], 'uint16');
        const entries = node([...pp, 'entries']);
        if ((isScalar(entries) && entries.value === null) || (isMap(entries) && !entries.items.length) || (isSeq(entries) && !entries.items.length)) {
          return; // Empty entries remain editable; configure PDO signals manually.
        }
        if (!isSeq(entries)) { report(label([...pp, 'entries']), msg("必须为条目序列，或显式空值 [] / null / {}"), 'igh.entries'); return; }
        entries.items.forEach((_, n) => {
          const ep = [...pp, 'entries', n];
          if (!keys(ep, ['name', 'index', 'sub_index', 'bit_length'])) return;
          const entryName = name([...ep, 'name'], ighRules.variableNameBytes);
          const index = integer([...ep, 'index'], 'uint16');
          const sub = integer([...ep, 'sub_index'], 'uint8');
          const bits = integer([...ep, 'bit_length'], 'uint8', 1n);
          result.signals.push({ uid: `${file.id}:${i}:${direction}:${p}:${n}`, slaveId: i, direction, sourceName: entryName, runtimeName: entryName,
            source:{fileId:file.id,field:label(ep)},bitLength: Number(bits), storageBytes: Math.ceil(Number(bits) / 8), index: Number(index), subIndex: Number(sub),
            resolution: index === undefined || sub === undefined || bits === undefined ? 'unresolved' : 'resolved' });
        });
      });
    }
    const commands = node([...path, 'init_commands']);
    if (commands !== undefined) {
      if (!isSeq(commands)) { report(label([...path, 'init_commands']), msg("必须为有序列表")); return; }
      commands.items.forEach((_, c) => {
        const cp = [...path, 'init_commands', c];
        if (!keys(cp, ['name', 'index', 'sub_index', 'type', 'Type', 'value', 'Value'])) return;
        if (node([...cp, 'name']) !== undefined) name([...cp, 'name'], ighRules.variableNameBytes);
        integer([...cp, 'index'], 'uint16'); integer([...cp, 'sub_index'], 'uint8');
        for (const [lower, upper] of [['type', 'Type'], ['value', 'Value']]) {
          if (node([...cp, lower]) !== undefined && node([...cp, upper]) !== undefined) report(label(cp), msg("{v0} 与 {v1} 不能同时出现", {v0:String(lower), v1:String(upper)}), 'igh.sdo-alias');
        }
        const typeKey = node([...cp, 'Type']) !== undefined ? 'Type' : 'type';
        const valueKey = node([...cp, 'Value']) !== undefined ? 'Value' : 'value';
        const t = node([...cp, typeKey]);
        const type = isScalar(t) ? String(t.value) : '';
        if (!SDO_TYPES.includes(type)) report(label([...cp, typeKey]), msg("不支持的 SDO 整数类型"), 'igh.sdo-type');
        else integer([...cp, valueKey], type, type.startsWith('u') ? 0n : -(1n << (BigInt(type.slice(3)) - 1n)));
      });
    }
  });
  if (referenceCount > 1 || (dc === 'on' && referenceCount !== 1)) report('slaves.dc_ref', msg("DC 开启时恰有一个参考从站；关闭时也不能超过一个"), 'igh.dc-ref');
  return result;
}

import { children, decodeXml, xmlDocument } from '../documents/xml';
import { ighRules } from '../project/profiles';

// Mirrors rocos-igh@9001c87 src/eni_config.cpp. IgH builds its own domain;
// ProcessImage offsets belong to ECM and must not be used for IgH signals.
export function readIghEni(bytes: Uint8Array) {
  const one = (node: Element | undefined, tag: string, required = false): Element | undefined => {
    const matches = node ? children(node, tag) : [];
    if (matches.length > 1 || required && !matches.length) throw new Error(`ENI ${tag} 缺失或重复`);
    return matches[0];
  };
  const text = (node: Element | undefined) => node?.textContent?.trim() ?? '';
  const num = (value: string, max = 65535) => {
    if (!/^(?:[0-9]+|(?:#x|0x)[0-9a-f]+)$/i.test(value)) throw new Error(`ENI 无效整数：${value}`);
    const n = Number(value.replace(/^#x/i, '0x'));
    if (!Number.isSafeInteger(n) || n < 0 || n > max) throw new Error(`ENI 整数越界：${value}`);
    return n;
  };
  const value = (node: Element | undefined, tag: string, max = 65535) => num(text(one(node, tag, true)), max);
  const label = (node: Element, fallback: string, max: number) => {
    const name = text(one(node, 'Name')) || fallback;
    if (!name || name.includes('\0') || new TextEncoder().encode(name).length > max) throw new Error('ENI 名称为空或超过 ABI 容量');
    return name;
  };
  const data = (cmd: Element) => {
    const hex = text(one(cmd, 'Data', true)).replace(/\s/g, '');
    if (!/^(?:[0-9a-f]{2})+$/i.test(hex)) throw new Error('ENI InitCmd Data 必须为十六进制字节');
    return hex.match(/../g)!.map(v => parseInt(v, 16));
  };
  const root = xmlDocument(decodeXml(bytes).text).documentElement;
  if (root.localName !== 'EtherCATConfig') throw new Error('请选择 EtherCAT ENI 文件');
  const config = one(root, 'Config', true)!;
  const cyclic = one(config, 'Cyclic');
  const cycle = cyclic ? value(cyclic, 'CycleTime', 0xffffffff) : 1000;
  if (cycle < 1000) throw new Error('ENI CycleTime 必须至少为 1000 μs');
  const stations = new Set<number>();
  const slaves = children(config, 'Slave').map((slave, xmlIndex) => {
    const info = one(slave, 'Info', true)!;
    const id = (0x10000 - value(info, 'AutoIncAddr')) & 0xffff;
    const address = value(info, 'PhysAddr');
    if (!address || stations.has(address)) throw new Error('ENI PhysAddr 必须非零且唯一');
    stations.add(address);
    const vendor = value(info, 'VendorId', 0xffffffff), product = value(info, 'ProductCode', 0xffffffff);
    if (!vendor || !product) throw new Error('ENI VendorId / ProductCode 必须非零');
    const name = label(info, '', ighRules.slaveNameBytes), process = one(slave, 'ProcessData');
    for (const sm of process ? children(process) : []) {
      if (/^Sm/.test(sm.localName) && !['Sm2', 'Sm3'].includes(sm.localName) && ['Inputs', 'Outputs'].includes(text(one(sm, 'Type')))) throw new Error('ENI 仅支持过程数据 SM2 / SM3');
    }
    const pdos = (tag: 'RxPdo' | 'TxPdo', sm: number) => {
      const manager = one(process, `Sm${sm}`);
      const assigned = manager ? children(manager, 'Pdo').map(p => num(text(p))) : [];
      if (manager) {
        if (text(one(manager, 'Type', true)) !== (sm === 2 ? 'Outputs' : 'Inputs')) throw new Error('ENI SM Type 与 PDO 方向不一致');
        const enable = one(manager, 'Enable');
        if (enable && !num(text(enable), 1) && assigned.length) throw new Error('ENI 禁用的 SM 仍有 PDO 分配');
      }
      const all = process ? children(process, tag) : [], seen = new Set<number>();
      const selected = all.filter(p => {
        const index = value(p, 'Index'), attr = p.getAttribute('Sm')?.trim();
        if (seen.has(index)) throw new Error('ENI PDO Index 重复');
        seen.add(index);
        if (attr && (num(attr, 255) !== sm || assigned.length && !assigned.includes(index))) throw new Error('ENI PDO Sm 与分配列表不一致');
        return assigned.length ? assigned.includes(index) : !!attr;
      });
      if (new Set(assigned).size !== assigned.length) throw new Error('ENI PDO 分配重复');
      const ordered = assigned.length ? assigned.map(index => {
        const pdo = selected.find(p => value(p, 'Index') === index);
        if (!pdo) throw new Error('ENI 已分配 PDO 缺少定义');
        return pdo;
      }) : selected;
      let count = 0;
      return ordered.map(p => {
        const su = p.getAttribute('Su')?.trim();
        if (su && num(su) !== 0) throw new Error('ENI 仅支持 SyncUnit 0');
        return { xmlIndex: all.indexOf(p), index: value(p, 'Index'), entries: children(p, 'Entry').map(e => {
          const index = value(e, 'Index'), sub = one(e, 'SubIndex', index !== 0);
          const sub_index = sub ? num(text(sub), 255) : 0, bit_length = value(e, 'BitLen', 255);
          if (!bit_length || bit_length % 8) throw new Error('ENI IgH PDO 必须为非零且字节对齐');
          if (++count > ighRules.variablesPerDirection) throw new Error('ENI PDO 条目超过 ABI 容量');
          return {name: label(e, index === 0 ? 'Padding' : `Object_${index}_${sub_index}`, ighRules.variableNameBytes), index, sub_index, bit_length};
        }) };
      });
    };
    const rx_pdos = pdos('RxPdo', 2), tx_pdos = pdos('TxPdo', 3);
    const dc = one(slave, 'DC');
    let clock: {cycle: number; reference: boolean} | undefined;
    if (dc) {
      const sync0 = value(dc, 'CycleTime0', 0xffffffff), sync1 = value(dc, 'CycleTime1', 0xffffffff), reference = !!value(dc, 'ReferenceClock', 1);
      const shift = text(one(dc, 'ShiftTime', true));
      if (!/^-?\d+$/.test(shift) || Number(shift) < -2147483648 || Number(shift) > 2147483647) throw new Error('ENI DC ShiftTime 无效');
      if (!sync0 && (sync1 || reference)) throw new Error('ENI 非活动 DC 含参考时钟或 SYNC1');
      if (sync0) {
        let activation: number | undefined;
        const commands = one(slave, 'InitCmds');
        for (const cmd of commands ? children(commands, 'InitCmd') : []) {
          if (!children(cmd, 'Transition').some(t => text(t) === 'PS')) continue;
          const ado = value(cmd, 'Ado');
          if (![0x980, 0x981].includes(ado)) continue;
          if (![2, 5].includes(value(cmd, 'Cmd', 255))) throw new Error('ENI DC 激活命令不受支持');
          const payload = data(cmd);
          if (payload.length !== (ado === 0x980 ? 2 : 1)) throw new Error('ENI DC 激活数据长度无效');
          const assign = ado === 0x980 ? payload[0] | payload[1] << 8 : payload[0] << 8;
          if (activation !== undefined && activation !== assign) throw new Error('ENI DC 激活命令冲突');
          activation = assign;
        }
        if (activation === undefined || !(activation & 0x100)) throw new Error('ENI DC 缺少启用 SYNC0 的 PS 激活命令');
        clock = {cycle: sync0, reference};
      }
    }
    const commands = one(one(one(slave, 'Mailbox'), 'CoE'), 'InitCmds');
    const init_commands = (commands ? children(commands, 'InitCmd') : []).flatMap(cmd => {
      if (text(one(cmd, 'Transition', true)) !== 'PS' || value(cmd, 'Ccs', 255) !== 1) throw new Error('ENI 仅支持 PS CoE 下载命令');
      const index = value(cmd, 'Index');
      if (index >= 0x1600 && index <= 0x1bff || index === 0x1c12 || index === 0x1c13) return [];
      const ca = cmd.getAttribute('CompleteAccess')?.trim();
      if (ca && num(ca, 1)) throw new Error('ENI 不支持应用 SDO CompleteAccess');
      const sub_index = value(cmd, 'SubIndex', 255), payload = data(cmd);
      if (![1, 2, 4, 8].includes(payload.length)) throw new Error('ENI SDO 仅支持 1/2/4/8 字节');
      return [{index, sub_index, type: `uint${payload.length * 8}`, value: BigInt('0x' + [...payload].reverse().map(b => b.toString(16).padStart(2, '0')).join(''))}];
    });
    return {id, xmlIndex, name, address, vendor, product, clock, dc_ref: clock?.reference ?? false, rx_pdos, tx_pdos, init_commands};
  }).sort((a, b) => a.id - b.id);
  if (!slaves.length || slaves.length > ighRules.maxSlaves || slaves.some((s, i) => s.id !== i)) throw new Error('ENI AutoIncAddr 必须从物理位置 0 连续且唯一，从站数须在容量内');
  const dc = slaves.some(s => s.clock);
  if (dc && slaves.filter(s => s.dc_ref).length !== 1) throw new Error('ENI DC 必须恰有一个参考时钟');
  return {version: 1, master: {master_id: 0, period_us: cycle, dc: dc ? 'on' : 'off'}, slaves};
}

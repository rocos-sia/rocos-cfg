import { buildIghCatalog } from './igh';
import { type Project, type BusCatalog, type Diagnostic, fileById, textOf } from '../project/types';
import { readYaml } from '../documents/yaml';
import { ecmDocument } from './ecm';
import { xmlDocument, child, children, content, xmlNumber } from '../documents/xml';
import { busRules, ecmRules, targetStatus } from '../project/profiles';

export function buildBusCatalog(p: Project): BusCatalog {
  const result: BusCatalog = { slaves: [], signals: [], diagnostics: [] };
  const source = fileById(p, p.entrypoints.master.fileId);
  const report = (code: string, message: string, severity: Diagnostic['severity'] = 'error') => result.diagnostics.push({ code, message, severity, fileId: source?.id });
  const profile=targetStatus(p,'master'),rules=busRules(p.entrypoints.master.kind);
  if(!profile.supported){report('master.profile',profile.message);return result;}
  if (!source) { report('master.missing', '尚未配置主站文件'); return result; }
  try {
    const config = readYaml(textOf(source));
    if (!config || typeof config !== 'object') throw new Error('主站配置必须为映射');
    if (p.entrypoints.master.kind === 'igh') {
      Object.assign(result, buildIghCatalog(source));
    } else {
      const startup=ecmDocument(source);
      result.masterId=startup.data.id;result.cycleUs=startup.data.cycle;
      for(const issue of startup.diagnostics)report('ecm.startup',issue.message);
      const eni = fileById(p, p.entrypoints.master.eniFileId);
      if (!eni) { report('eni.missing', '请导入 ENI 文件'); return result; }
      const root = xmlDocument(textOf(eni)).documentElement;
      if (root.localName !== 'EtherCATConfig' || root.getAttribute('Version') !== ecmRules.eniVersion) throw new Error(`当前仅支持 EtherCATConfig Version ${ecmRules.eniVersion}；原文件保留`);
      const cfg = child(root, 'Config'); if (!cfg) throw new Error('ENI 缺少 Config');
      const slaves = children(cfg, 'Slave');
      const ranges: { id: number; name: string; input: [number,number]; output: [number,number] }[] = [];
      slaves.forEach((s, i) => {
        const info = child(s,'Info'), pd = child(s,'ProcessData');
        const address = xmlNumber(content(info,'PhysAddr')); const name = content(info,'Name');
        if(!name||name.includes('\0')||new TextEncoder().encode(name).length>rules.slaveNameBytes)report('ecm.slave-name',`从站名称必须非空且不超过 ${rules.slaveNameBytes} 字节：${name}`);
        result.slaves.push({ id: i, name, address, vendor: content(info,'VendorId'), product: content(info,'ProductCode') });
        if (address !== ecmRules.firstSlaveAddress + i) report('ecm.address', `当前 ECM 要求从站 ${i} 固定地址为 ${ecmRules.firstSlaveAddress+i}，ENI 为 ${address}`);
        const rangeFor = (tag: string): [number,number] => { const n = pd && child(pd,tag); return [xmlNumber(content(n,'BitStart')),xmlNumber(content(n,'BitLength'))]; };
        ranges.push({ id: i, name, input: rangeFor('Recv'), output: rangeFor('Send') });
      });
      if (!slaves.length || slaves.length > rules.maxSlaves) report('ecm.slaves', `当前共享内存支持 1–${rules.maxSlaves} 个从站`);
      const image = child(cfg, 'ProcessImage');
      if (!image) throw new Error('ENI 缺少 ProcessImage');
      for (const [key,direction] of [['Inputs','input'],['Outputs','output']] as const) {
        const area = child(image,key); if (!area) continue;
        const totalBits = xmlNumber(content(area,'ByteSize')) * 8;
        children(area,'Variable').forEach((variable, n) => {
          const name = content(variable,'Name'), bits = xmlNumber(content(variable,'BitSize')), offset = xmlNumber(content(variable,'BitOffs'));
          const candidates = ranges.filter(s => name.startsWith(s.name + '.') && offset >= s[direction][0] && offset + bits <= s[direction][0] + s[direction][1]);
          const resolved = candidates.length === 1;
          if (!resolved) report('eni.association', `无法唯一确定变量所属从站：${name}`);
          if (!Number.isInteger(offset) || !Number.isInteger(bits) || offset < 0 || bits <= 0 || offset + bits > totalBits) report('eni.bounds', `过程映像越界：${name}`);
          if (offset % 8 || bits % 8) report('ecm.alignment', `当前 ECM 不支持非字节对齐变量：${name}`);
          result.signals.push({ uid: `${eni.id}:${direction}:${n}`, slaveId: resolved ? candidates[0].id : -1, direction, sourceName: name, runtimeName: name.split('.').filter(Boolean).at(-1) || '', bitLength: bits, bitOffset: offset, storageBytes: bits / 8, dataType: content(variable,'DataType'), resolution: resolved ? 'resolved' : 'unresolved' });
        });
      }
    }
    const seen = new Map<string, typeof result.signals[number][]>();
    for (const signal of result.signals) {
      const key = `${signal.slaveId}:${signal.direction}:${signal.runtimeName}`;
      if (!signal.runtimeName || new TextEncoder().encode(signal.runtimeName).length > rules.variableNameBytes) report('bus.name', `变量名称缺失或超过 ${rules.variableNameBytes} 字节：${signal.runtimeName}`);
      const matches = seen.get(key) || [];
      matches.push(signal); seen.set(key, matches);
      if (matches.length > 1) { for (const match of matches) match.resolution = 'ambiguous'; report('bus.duplicate', `从站内运行时变量重名：${signal.runtimeName}`); }
    }
    for (const slave of result.slaves) for (const direction of ['input','output']) if (result.signals.filter(s => s.slaveId === slave.id && s.direction === direction).length > rules.variablesPerDirection) report('bus.capacity', `从站 ${slave.id} 每方向变量数超过 ${rules.variablesPerDirection}`);
  } catch (e) { report('master.parse', e instanceof Error ? e.message : String(e)); }
  return result;
}

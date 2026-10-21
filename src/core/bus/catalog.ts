import { m as msg, messageFields, MessageError, errorMessage, type MessageInput } from '../project/messages';
import { buildIghCatalog } from './igh';
import { type Project, type BusCatalog, type Diagnostic, fileById, textOf } from '../project/types';
import { readYaml } from '../documents/yaml';
import { ecmDocument } from './ecm';
import { xmlDocument, child, children, content, xmlNumber } from '../documents/xml';
import { busRules, ecmRules, targetStatus } from '../project/profiles';

export function buildBusCatalog(p: Project): BusCatalog {
  const result: BusCatalog = { slaves: [], signals: [], diagnostics: [] };
  const source = fileById(p, p.entrypoints.master.fileId);
  const report = (code: string, message: MessageInput, severity: Diagnostic['severity'] = 'error') => result.diagnostics.push({ code, ...messageFields(message), severity, fileId: source?.id });
  const profile=targetStatus(p,'master'),rules=busRules(p.entrypoints.master.kind);
  if(!profile.supported){report('master.profile',profile);return result;}
  if (!source) { report('master.missing', msg("尚未配置主站文件")); return result; }
  try {
    const config = readYaml(textOf(source));
    if (!config || typeof config !== 'object') throw new MessageError(msg("主站配置必须为映射"));
    if (p.entrypoints.master.kind === 'igh') {
      Object.assign(result, buildIghCatalog(source));
    } else {
      const startup=ecmDocument(source);
      result.masterId=startup.data.id;result.cycleUs=startup.data.cycle;
      for(const issue of startup.diagnostics)report('ecm.startup',issue);
      const eni = fileById(p, p.entrypoints.master.eniFileId);
      if (!eni) { report('eni.missing', msg("请导入 ENI 文件")); return result; }
      const root = xmlDocument(textOf(eni)).documentElement;
      if (root.localName !== 'EtherCATConfig' || root.getAttribute('Version') !== ecmRules.eniVersion) throw new MessageError(msg("当前仅支持 EtherCATConfig Version {v0}；原文件保留", {v0:String(ecmRules.eniVersion)}));
      const cfg = child(root, 'Config'); if (!cfg) throw new MessageError(msg("ENI 缺少 Config"));
      const slaves = children(cfg, 'Slave');
      const ranges: { id: number; name: string; input: [number,number]; output: [number,number] }[] = [];
      slaves.forEach((s, i) => {
        const info = child(s,'Info'), pd = child(s,'ProcessData');
        const address = xmlNumber(content(info,'PhysAddr')); const name = content(info,'Name');
        if(!name||name.includes('\0')||new TextEncoder().encode(name).length>rules.slaveNameBytes)report('ecm.slave-name',msg("从站名称必须非空且不超过 {v0} 字节：{v1}", {v0:String(rules.slaveNameBytes), v1:String(name)}));
        result.slaves.push({ id: i, name, address, vendor: content(info,'VendorId'), product: content(info,'ProductCode') });
        if (address !== ecmRules.firstSlaveAddress + i) report('ecm.address', msg("当前 ECM 要求从站 {v0} 固定地址为 {v1}，ENI 为 {v2}", {v0:String(i), v1:String(ecmRules.firstSlaveAddress+i), v2:String(address)}));
        const rangeFor = (tag: string): [number,number] => { const n = pd && child(pd,tag); return [xmlNumber(content(n,'BitStart')),xmlNumber(content(n,'BitLength'))]; };
        ranges.push({ id: i, name, input: rangeFor('Recv'), output: rangeFor('Send') });
      });
      if (!slaves.length || slaves.length > rules.maxSlaves) report('ecm.slaves', msg("当前共享内存支持 1–{v0} 个从站", {v0:String(rules.maxSlaves)}));
      const image = child(cfg, 'ProcessImage');
      if (!image) throw new MessageError(msg("ENI 缺少 ProcessImage"));
      for (const [key,direction] of [['Inputs','input'],['Outputs','output']] as const) {
        const area = child(image,key); if (!area) continue;
        const totalBits = xmlNumber(content(area,'ByteSize')) * 8;
        children(area,'Variable').forEach((variable, n) => {
          const name = content(variable,'Name'), bits = xmlNumber(content(variable,'BitSize')), offset = xmlNumber(content(variable,'BitOffs'));
          const candidates = ranges.filter(s => name.startsWith(s.name + '.') && offset >= s[direction][0] && offset + bits <= s[direction][0] + s[direction][1]);
          const resolved = candidates.length === 1;
          if (!resolved) report('eni.association', msg("无法唯一确定变量所属从站：{v0}", {v0:String(name)}));
          if (!Number.isInteger(offset) || !Number.isInteger(bits) || offset < 0 || bits <= 0 || offset + bits > totalBits) report('eni.bounds', msg("过程映像越界：{v0}", {v0:String(name)}));
          if (offset % 8 || bits % 8) report('ecm.alignment', msg("当前 ECM 不支持非字节对齐变量：{v0}", {v0:String(name)}));
          result.signals.push({ uid: `${eni.id}:${direction}:${n}`, slaveId: resolved ? candidates[0].id : -1, direction, sourceName: name, runtimeName: name.split('.').filter(Boolean).at(-1) || '', bitLength: bits, bitOffset: offset, storageBytes: bits / 8, dataType: content(variable,'DataType'), resolution: resolved ? 'resolved' : 'unresolved' });
        });
      }
    }
    const seen = new Map<string, typeof result.signals[number][]>();
    for (const signal of result.signals) {
      const key = `${signal.slaveId}:${signal.direction}:${signal.runtimeName}`;
      if (!signal.runtimeName || new TextEncoder().encode(signal.runtimeName).length > rules.variableNameBytes) report('bus.name', msg("变量名称缺失或超过 {v0} 字节：{v1}", {v0:String(rules.variableNameBytes), v1:String(signal.runtimeName)}));
      const matches = seen.get(key) || [];
      matches.push(signal); seen.set(key, matches);
      if (matches.length > 1) { for (const match of matches) match.resolution = 'ambiguous'; report('bus.duplicate', msg("从站内运行时变量重名：{v0}", {v0:String(signal.runtimeName)})); }
    }
    for (const slave of result.slaves) for (const direction of ['input','output']) if (result.signals.filter(s => s.slaveId === slave.id && s.direction === direction).length > rules.variablesPerDirection) report('bus.capacity', msg("从站 {v0} 每方向变量数超过 {v1}", {v0:String(slave.id), v1:String(rules.variablesPerDirection)}));
  } catch (e) { report('master.parse', errorMessage(e)); }
  return result;
}

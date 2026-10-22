import { m as msg, MessageError, type DiagnosticMessage } from '../project/messages';
import { child, children, xmlDocument, serializeXml } from './xml';
export interface GeometryView {
  index: number; name: string; kind: string; xyz: string; rpy: string;
  size: string; radius: string; length: string; filename: string; scale: string;
}
const attr = (element: Element | undefined, name: string, fallback = '') => element?.getAttribute(name) || fallback;
export function linkProperties(text: string, name: string) {
  const doc = xmlDocument(text), link = children(doc.documentElement, 'link').find(l => l.getAttribute('name') === name);
  if (!link) throw new MessageError(msg("Link 不存在"));
  return propertiesOfLink(link);
}
function propertiesOfLink(link: Element) {
  const list = (group: 'visual' | 'collision'): GeometryView[] => children(link, group).map((item, index) => {
    const geometry = child(item, 'geometry'), shape = geometry && children(geometry)[0], origin = child(item, 'origin');
    return { index, name: attr(item, 'name'), kind: shape?.localName || 'unknown', xyz: attr(origin, 'xyz', '0 0 0'), rpy: attr(origin, 'rpy', '0 0 0'),
      size: attr(shape, 'size'), radius: attr(shape, 'radius'), length: attr(shape, 'length'), filename: attr(shape, 'filename'), scale: attr(shape, 'scale', '1 1 1') };
  });
  const inertial = child(link, 'inertial'), inertia = inertial && child(inertial, 'inertia');
  return { visual: list('visual'), collision: list('collision'), inertial: inertial ? {
    mass: attr(child(inertial, 'mass'), 'value'), xyz: attr(child(inertial, 'origin'), 'xyz', '0 0 0'), rpy: attr(child(inertial, 'origin'), 'rpy', '0 0 0'),
    inertia: Object.fromEntries(['ixx', 'ixy', 'ixz', 'iyy', 'iyz', 'izz'].map(key => [key, attr(inertia, key)])),
  } : null };
}
export function editGeometry(text: string, name: string, group: 'visual' | 'collision', index: number, field: keyof GeometryView, value: string) {
  const doc = xmlDocument(text), matches = children(doc.documentElement, 'link').filter(l => l.getAttribute('name') === name), link = matches[0];
  if (!name.trim() || matches.length > 1) throw new MessageError(msg('Link 名称不唯一，请在源码中修复'));
  const item = link && children(link, group)[index]; if (!item) throw new MessageError(msg("几何节点已不存在"));
  if (field === 'xyz' || field === 'rpy') {
    let origin = child(item, 'origin'); if (!origin) { origin = doc.createElement('origin'); item.appendChild(origin); } origin.setAttribute(field, value);
  } else {
    const geometry = child(item, 'geometry'), shape = geometry && children(geometry)[0];
    const allowed: Record<string, string[]> = { box: ['size'], sphere: ['radius'], cylinder: ['radius', 'length'], mesh: ['filename', 'scale'] };
    if (!shape || !allowed[shape.localName]?.includes(field)) throw new MessageError(msg("当前几何类型不支持此属性"));
    shape.setAttribute(field, value);
  }
  return serializeXml(doc);
}
export function geometryDiagnostics(text: string, names: string[], parsed?: Document): DiagnosticMessage[] {
  const byName = new Map(children((parsed || xmlDocument(text)).documentElement, 'link').map(link => [link.getAttribute('name') || '', link]));
  const errors: DiagnosticMessage[] = [];
  const tuple = (value: string, label: string, nonzero = false, positive = false) => {
    const v = value.trim().split(/\s+/).map(Number);
    if (v.length !== 3 || v.some(n => !Number.isFinite(n) || (nonzero && n === 0) || (positive && n <= 0))) errors.push(msg("{v0} 需要三个{v1}数值", {v0:String(label), v1:(positive ? msg("正").text : (nonzero ? msg("非零").text : msg("有限").text))}));
  };
  const scalar = (value: string, label: string, positive: boolean) => {
    if (!value.trim() || !Number.isFinite(Number(value)) || (positive ? Number(value) <= 0 : Number(value) < 0)) errors.push(msg("{v0} 必须为{v1}", {v0:String(label), v1:(positive ? msg("正数").text : msg("非负数").text)}));
  };
  for (const name of names) {
    const element = byName.get(name); if (!element) continue;
    const properties = propertiesOfLink(element);
    for (const group of ['visual', 'collision'] as const) for (const g of properties[group]) {
      const label = `${name}.${group}[${g.index}]`; tuple(g.xyz, label + '.xyz'); tuple(g.rpy, label + '.rpy');
      if (g.kind === 'box') tuple(g.size, label + '.size', false, true);
      else if (g.kind === 'sphere' || g.kind === 'cylinder') { scalar(g.radius, label + '.radius', true); if (g.kind === 'cylinder') scalar(g.length, label + '.length', true); }
      else if (g.kind === 'mesh') { if (!g.filename.trim()) errors.push(msg("{v0} Mesh 路径为空", {v0:String(label)})); tuple(g.scale, label + '.scale', true); }
      else errors.push(msg("{v0} 几何类型不受支持或缺失", {v0:String(label)}));
    }
    if (properties.inertial) {
      const i = properties.inertial; scalar(i.mass, `${name}.mass`, false); tuple(i.xyz, `${name}.inertial.xyz`); tuple(i.rpy, `${name}.inertial.rpy`);
      const values = Object.values(i.inertia);
      if (values.some(v => !v.trim() || !Number.isFinite(Number(v)))) errors.push(msg("{v0} 惯性矩阵必须包含六个有限数值", {v0:String(name)}));
      else {
        const [a, b, c, d, e, f] = values.map(Number), scale = Math.max(...values.map(v => Math.abs(Number(v))), 1e-12);
        const [A, B, C, D, E, F] = [a, b, c, d, e, f].map(v => v / scale), eps = 1e-10;
        if ([A, D, F, A * D - B * B, A * F - C * C, D * F - E * E, A * D * F + 2 * B * C * E - A * E * E - D * C * C - F * B * B].some(v => v < -eps)) errors.push(msg("{v0} 惯性矩阵不是半正定矩阵", {v0:String(name)}));
      }
    }
  }
  return errors;
}

export function geometryErrors(text:string,names:string[],parsed?:Document):string[]{
  return geometryDiagnostics(text,names,parsed).map(issue=>issue.message);
}

import type { ConfigModule, ModuleExportContext, ModuleReference } from './contracts';
import { textOf, utf8 } from '../project/types';
import { readYaml, yamlDocument } from '../documents/yaml';
import { xmlDocument, serializeXml, elements, isLegacyHardware } from '../documents/xml';
import { appDocument, preserveAppScalars } from '../documents/app-config';
import { ecmDocument, preserveEcmScalars } from '../bus/ecm';
import { readRobot } from '../documents/urdf';
const capabilities = { readonly: false, generate: false, advancedEdit: true, desktop: false };
const copy = (_: unknown, ctx: ModuleExportContext) => [{ path: ctx.path, bytes: ctx.file.bytes, fileId: ctx.file.id }];
const refs = (fields: [string, unknown, ('file' | 'directory')?][]): ModuleReference[] => fields.filter(([,v]) => typeof v === 'string' && v).map(([field, original, kind]) => ({ field, original: original as string, kind }));
const yaml = (id: string, detect: (v: any) => boolean): ConfigModule => ({ id, version: 1, role: id, syntax: 'yaml', capabilities,
  detect: file => /\.ya?ml$/i.test(file.path) && detect(readYaml(textOf(file))), parse: file => readYaml(textOf(file)),
  validate: () => [], references: () => [], export: (value, ctx) => {
    if (!ctx.rewrites.length) return copy(value, ctx);
    const doc = yamlDocument(textOf(ctx.file));
    if(ctx.file.role==='ecm')preserveEcmScalars(doc);
    if(ctx.file.role==='app')preserveAppScalars(doc);
    for (const { field, value } of ctx.rewrites) doc.setIn(field.split('.'), value);
    return [{ path: ctx.path, bytes: utf8.encode(doc.toString()), fileId: ctx.file.id }];
  },
});
const has = (v: any, key: string) => v && typeof v === 'object' && !Array.isArray(v) && key in v;
// Legacy hardware subtrees are opaque, including any mesh/texture-like fields.
const urdfResources = (doc: Document, tag: string) => elements(doc, tag).filter(node => !isLegacyHardware(node));
export const nativeModules: ConfigModule[] = [
  yaml('igh', v => has(v, 'slaves') && has(v, 'version')),
  { ...yaml('ecm', v => has(v, 'eni')), parse:file=>ecmDocument(file).data, references: v => refs([['eni', v?.eni]]) },
  yaml('hardware', v => has(v, 'hardware')), yaml('binding', v => has(v, 'joint_bindings')),
  { ...yaml('app', v => has(v, 'robot') || has(v, 'http_port')), parse:file=>appDocument(file).data,
    validate:(_,ctx)=>appDocument(ctx.file).diagnostics.map(d=>({...d,code:'app.startup',severity:'error',fileId:ctx.file.id})), references: v => refs([
    ...['hardware_config', 'urdf', 'joint_binding', 'payload'].map(k => [`robot.${k}`, v?.robot?.[k]] as [string, unknown]),
    ['scripts', v?.scripts, 'directory'], ['web_root', v?.web_root, 'directory'],
  ]) },
  { id: 'eni', version: 1, role: 'eni', syntax: 'xml', capabilities: { ...capabilities, readonly: true, advancedEdit: false },
    detect: f => /\.xml$/i.test(f.path) && xmlDocument(textOf(f)).documentElement.localName === 'EtherCATConfig',
    parse: f => xmlDocument(textOf(f)), validate: () => [], references: () => [], export: (v, ctx) => {
      if (ctx.rewrites.length) throw new Error('ENI 只读，不能改写内部路径'); return copy(v, ctx);
    },
  },
  { id: 'urdf', version: 1, role: 'urdf', syntax: 'xml', capabilities,
    detect: f => /\.(xml|urdf)$/i.test(f.path) && xmlDocument(textOf(f)).documentElement.localName === 'robot', parse: f => xmlDocument(textOf(f)),
    validate: (_, ctx) => readRobot(textOf(ctx.file)).issues.map(issue => ({ code: 'urdf.structure', severity: 'error', ...issue, fileId: ctx.file.id })),
    references: doc => ['mesh', 'texture'].flatMap(tag => urdfResources(doc, tag).map((n, i) => ({ field: `${tag}[${i}].filename`, original: n.getAttribute('filename') || '', uri: true }))),
    export: (doc, ctx) => xmlExport(doc, ctx),
  },
  { id: 'model.dae', version: 1, role: 'resource', syntax: 'xml', capabilities: { ...capabilities, advancedEdit: false },
    detect: f => /\.dae$/i.test(f.path), parse: f => { const doc = xmlDocument(textOf(f)); if (doc.documentElement.localName !== 'COLLADA') throw new Error('DAE 根节点须为 COLLADA'); return doc; },
    validate: () => [], references: doc => elements(doc, 'image').flatMap((im, i) => elements(im, 'init_from').map((n, j) => ({ field: `image[${i}].init_from[${j}]`, original: n.textContent?.trim() || '', uri: true }))),
    export: (doc, ctx) => xmlExport(doc, ctx),
  },
  { id: 'model.gltf', version: 1, role: 'resource', capabilities: { ...capabilities, advancedEdit: false },
    detect: f => /\.gltf$/i.test(f.path), parse: f => { const data = JSON.parse(textOf(f)); if (!data || typeof data !== 'object' || !data.asset) throw new Error('glTF 缺少 asset 描述'); return data; },
    validate: () => [], references: data => ['buffers', 'images'].flatMap(group => Array.isArray(data[group]) ? data[group].flatMap((n: any, i: number) => typeof n?.uri === 'string' ? [{ field: `${group}[${i}].uri`, original: n.uri, uri: true }] : []) : []),
    export: (data, ctx) => {
      if (!ctx.rewrites.length) return copy(data, ctx);
      for (const { field, value } of ctx.rewrites) {
        const match = /^(buffers|images)\[(\d+)\]\.uri$/.exec(field); if (!match) throw new Error('glTF 引用位置无效');
        data[match[1]][Number(match[2])].uri = value;
      }
      return [{ path: ctx.path, bytes: utf8.encode(JSON.stringify(data, null, 2)), fileId: ctx.file.id }];
    },
  },
  ...['resource', 'attachment', 'editor-state', 'profile', 'template'].map(id => ({ id, version: 1, role: id, capabilities: { ...capabilities, readonly: !['resource', 'attachment'].includes(id), advancedEdit: false },
    detect: () => false, parse: () => null, validate: () => [], references: () => [], export: (v: unknown, ctx: ModuleExportContext) => {
      if (ctx.rewrites.length) throw new Error(`尚不支持改写 ${ctx.file.path} 的资源引用`); return copy(v, ctx);
    },
  })),
];
function xmlExport(doc: Document, ctx: ModuleExportContext) {
  if (!ctx.rewrites.length) return copy(doc, ctx);
  for (const { field, value } of ctx.rewrites) {
    const urdf = /^(mesh|texture)\[(\d+)\]\.filename$/.exec(field), dae = /^image\[(\d+)\]\.init_from\[(\d+)\]$/.exec(field);
    if (urdf) {
      const node = urdfResources(doc, urdf[1])[Number(urdf[2])]; if (!node) throw new Error('URDF 引用位置已变化'); node.setAttribute('filename', value);
    } else if (dae) {
      const image = elements(doc, 'image')[Number(dae[1])], node = image && elements(image, 'init_from')[Number(dae[2])];
      if (!node) throw new Error('DAE 引用位置已变化'); node.textContent = value;
    } else throw new Error(`无法安全改写引用：${ctx.file.path} ${field}`);
  }
  return [{ path: ctx.path, bytes: utf8.encode(serializeXml(doc).replace(/(<\?xml\b[^?]*\bencoding\s*=\s*)["'][^"']+["']/i, '$1"UTF-8"')), fileId: ctx.file.id }];
}

import { attachProfile, baseTarget } from '../project/profiles';
import { decodeXml } from '../documents/xml';
import { readYaml, yamlDocument } from '../documents/yaml';
import { configure, masterProject, selectMaster } from '../project/configuration';
import { makeFile } from '../project/create';
import { relativePath } from '../project/paths';
import { collectReferences } from '../project/references';
import { starterData } from '../project/templates';
import { fileById, textOf, utf8, type Project } from '../project/types';
import { buildBusCatalog } from './catalog';
import { preserveEcmScalars } from './ecm';
import { readIghEni } from './igh-eni';

// Kept as a parser entrypoint for tools inspecting active PDO declarations.
// Runtime YAML always references the original ENI instead of serializing this model.
export const eniToIgh = readIghEni;

export function planEniImport(base: Project, bytes: Uint8Array) {
  const parsed = readIghEni(bytes), project = structuredClone(base), active = project.entrypoints.master.kind;
  const references=collectReferences(base);
  let overwrite = false;
  for (const kind of ['igh','ecm'] as const) {
    const view = masterProject(base, kind);
    const file = view.entrypoints.master.kind === kind ? fileById(base, view.entrypoints.master.fileId) : base.files.find(f=>f.role===kind);
    if (file) {
      let data;try{data=readYaml(textOf(file));}catch{if(kind==='ecm')throw new Error('请先修复 ECM 启动配置');overwrite=true;}
      overwrite ||= references.some(r=>r.sourceFileId===file.id&&r.field==='eni'&&!!r.targetFileId) || !!view.entrypoints.master.eniFileId || !!base.editor.buffers[file.id] || !!data?.slaves?.length;
      if (kind === 'ecm' && base.editor.buffers[file.id]) throw new Error('请先处理主站源码草稿');
    }
  }
  const currentId = buildBusCatalog(base).masterId;
  const eniRef=collectReferences(project).find(r=>r.sourceFileId===project.entrypoints.master.fileId&&r.field==='eni');
  let eni = fileById(project,eniRef?.targetFileId)??fileById(project, project.entrypoints.master.eniFileId);
  if (!eni) {
    let path = 'master/imported-eni.xml', i = 1;
    while (project.files.some(f=>f.path===path)) path=`master/imported-eni-${i++}.xml`;
    eni=makeFile(path,'eni','');project.files.push(eni);
  }
  eni.bytes=new Uint8Array(bytes);eni.encoding=decodeXml(bytes).encoding;
  for (const kind of ['igh','ecm'] as const) {
    selectMaster(project,kind);
    if(project.targets.master.version!==baseTarget(kind).version){project.targets.master=baseTarget(kind);attachProfile(project,'master',true);}
    const file=fileById(project,project.entrypoints.master.fileId)!;
    let doc;try{doc=yamlDocument(textOf(file));}catch{if(kind==='ecm')throw new Error('请先修复 ECM 启动配置');doc=yamlDocument('');for(const [key,value] of Object.entries(starterData().igh))doc.set(key,value);}
    if(kind==='ecm')preserveEcmScalars(doc);
    if (kind==='igh') {
      // Flatten legacy startup settings without carrying inline topology into ENI YAML.
      const master=doc.toJS({maxAliasCount:100})?.master;
      if (master && typeof master==='object') {
        doc.delete('master');
        for (const [key,value] of Object.entries(master)) doc.set(({master_id:'id',period_us:'cycle',cpu:'cpuidx'} as Record<string,string>)[key]??key,value);
      }
      doc.delete('slaves');
    }
    doc.set('eni',relativePath(file.path,eni.path));
    doc.set('cycle',parsed.master.period_us);
    doc.set('id',Number.isFinite(currentId)?currentId:0);
    file.bytes=utf8.encode(doc.toString());file.encoding='utf-8';
    project.entrypoints.master.eniFileId=eni.id;
    delete project.editor.buffers[file.id];
  }
  configure(project).enabled.bus=true;
  project.references=collectReferences(project);
  for (const kind of ['igh','ecm'] as const) {
    const errors=buildBusCatalog(masterProject(project,kind)).diagnostics.filter(d=>d.severity==='error');
    if (errors.length) throw new Error(`ENI 不符合 ${kind.toUpperCase()} 配置规则：${errors.map(d=>d.message).join('；')}`);
  }
  selectMaster(project,active);
  project.editor.confirmations={};project.references=collectReferences(project);
  return {project,overwrite};
}

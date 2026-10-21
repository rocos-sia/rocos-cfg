import { stringify } from 'yaml';
import { masterProfile } from './import';
import { attachProfile, baseTarget } from './profiles';
import { recordTemplate, robotTemplate, starterData, starterTemplate } from './templates';
import { xmlDocument, serializeXml } from '../documents/xml';
import { uid, utf8, type Project, type FileRole, type MasterKind } from './types';
export function makeFile(path: string, role: FileRole, text: string) {
  return { id: uid(), path, role, owner: role, bytes: utf8.encode(text), encoding: 'utf-8' };
}
export interface ProjectOptions { robotTemplate?:'robot.two-axis'; parameters?:{prefix?:string;linkLength?:number} }
export function createProject(name: string, kind: MasterKind, options:ProjectOptions={}): Project {
  const now = new Date().toISOString(),data=starterData();
  const master = makeFile(`master/${kind}.yaml`, kind, stringify(data[kind]));
  const robot = makeFile('models/robot.urdf', 'urdf', `<?xml version="1.0"?>\n<robot name="${data.robot.name}">\n  <link name="${data.robot.root}"/>\n</robot>\n`);
  const hardware = makeFile('app/hardware_config.yaml', 'hardware', stringify(data.hardware));
  const binding = makeFile('app/joint_binding.yaml', 'binding', stringify(data.binding));
  const app = makeFile('app/config.yaml', 'app', stringify(data.app));
  const project:Project={ id: uid(), name, description: '', createdAt: now, modifiedAt: now, revision: 0, snapshotId: uid(), targets: { app: baseTarget('app'), master: masterProfile(kind) }, entrypoints: { master: { kind, fileId: master.id, eniFileId: null }, urdf: robot.id, hardware: hardware.id, binding: binding.id, app: app.id }, files: [master, robot, hardware, binding, app], references: [], packageMap: {}, editor: { buffers: {}, confirmations: {} } };
  attachProfile(project,'master');attachProfile(project,'app');
  recordTemplate(project,starterTemplate(),{},[master.id,robot.id,hardware.id,binding.id,app.id]);
  if(options.robotTemplate){
    const template=robotTemplate(),prefix=options.parameters?.prefix??template.defaults.prefix,length=options.parameters?.linkLength??template.defaults.linkLength;
    if(!/^[A-Za-z_][A-Za-z0-9_]{0,39}$/.test(prefix)||!Number.isFinite(length)||length<=0||length>10)throw new Error('模型前缀须为字母/数字/下划线，连杆长度须在 0–10 m 之间且大于 0');
    const doc=xmlDocument('<robot/>');doc.documentElement.setAttribute('name',prefix);
    const add=(parent:Element,tag:string,attrs:Record<string,string|number>)=>{const n=doc.createElement(tag);for(const [key,value] of Object.entries(attrs))n.setAttribute(key,String(value));parent.appendChild(n);return n;};
    const base=prefix+'_base';add(doc.documentElement,'link',{name:base});
    for(let i=1;i<=template.data.joints;i++){
      const link=add(doc.documentElement,'link',{name:prefix+'_link_'+i}),visual=add(link,'visual',{});
      add(visual,'origin',{xyz:`${length/2} 0 0`});add(add(visual,'geometry',{}),'box',{size:`${length} ${template.data.thickness} ${template.data.thickness}`});
      add(add(visual,'material',{name:'template_blue'}),'color',{rgba:template.data.color.join(' ')});
      const joint=add(doc.documentElement,'joint',{name:prefix+'_joint_'+i,type:'revolute'});
      add(joint,'parent',{link:i===1?base:prefix+'_link_'+(i-1)});add(joint,'child',{link:prefix+'_link_'+i});
      add(joint,'origin',{xyz:`${i===1?0:length} 0 0`});add(joint,'axis',{xyz:template.data.axis.join(' ')});
      add(joint,'limit',{lower:template.data.lower,upper:template.data.upper,velocity:template.data.velocity,effort:template.data.effort});
    }
    robot.bytes=utf8.encode(serializeXml(doc));data.app.robot.base_link=base;data.app.robot.tip_link=prefix+'_link_'+template.data.joints;app.bytes=utf8.encode(stringify(data.app));
    recordTemplate(project,template,{prefix,linkLength:length},[robot.id,app.id]);
    project.editor.notices=[{fileId:robot.id,message:template.notice}];
  }
  return project;
}

// File IDs remain local to the new archive, so all references, module state and
// unapplied source buffers can survive without guessing at vendor-owned data.
export function copyAsNewProject(source: Project, version: string): Project {
  const project = structuredClone(source), now = new Date().toISOString();
  project.id = uid();
  project.snapshotId = uid();
  project.name = `${source.name}（副本）`;
  project.revision = 0;
  project.createdAt = now;
  project.modifiedAt = now;
  if (project.archiveMetadata) project.archiveMetadata.createdWith = { name: 'ROCOS Configurator', version };
  return project;
}

import { stringify } from 'yaml';
import { createProject, makeFile } from './create';
import { recordTemplate, teachingTemplate } from './templates';
import { collectReferences } from './references';
import { fileById, utf8, type MasterKind } from './types';

/** Fully local, authored teaching data. Each opening creates an independent project.
 * The illustrative ENI is never represented as SDK-generated or device-tested.
 */
export function createExample(kind: MasterKind) {
  const p=createProject('教学示例',kind);
  const template=teachingTemplate(),data=template.data;
  p.description='教学示例 / Teaching example. All mechanical values are illustrative; ENI is not SDK-generated or device-tested.';
  for(const [id,value] of [
    [p.entrypoints.master.fileId,data[kind]], [p.entrypoints.hardware,data.hardware],
    [p.entrypoints.binding,data.binding], [p.entrypoints.app,data.app],
  ] as const) fileById(p,id)!.bytes=utf8.encode(stringify(value));
  fileById(p,p.entrypoints.urdf)!.bytes=utf8.encode(data.urdf);
  if(kind==='ecm') {
    const eni=makeFile('master/eni.xml','eni',data.eni);
    p.files.push(eni);p.entrypoints.master.eniFileId=eni.id;
  }
  for(const [path,text] of Object.entries(data.resources))p.files.push(makeFile(path,path.endsWith('payload.yaml')?'app.payload':'resource',text));
  p.editor.confirmations={};
  p.references=collectReferences(p);
  recordTemplate(p,template,{master:kind},p.files.filter(f=>!['profile','template'].includes(f.role)).map(f=>f.id));
  return p;
}

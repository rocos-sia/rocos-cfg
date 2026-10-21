import { expect, it } from 'vitest';
import { appDocument } from '../src/core/documents/app-config';
import { createProject, makeFile } from '../src/core/project/create';
import { fileById, textOf, utf8 } from '../src/core/project/types';
import { planRobotChange } from '../src/core/documents/robot-edit';
import { editProjectYaml } from '../src/core/bus/igh-edit';
import { analyzeProject } from '../src/core/project/analysis';
import { validateProject } from '../src/core/validation';
import { collectReferences } from '../src/core/project/references';
import { resourceProject } from './fixtures/resources';

it('shows consumer defaults and scalar conversions without writing them into the source',()=>{
  const file=makeFile('app/config.yaml','app','http_host: &n 010\nhttp_port: *n\nrobot: {ecat_id: "0x10", base_link: null}\n');
  const before=file.bytes.slice(),result=appDocument(file);
  expect(result.diagnostics).toEqual([]);expect(result.data).toMatchObject({http_host:'010',http_port:8,http_control_ttl_seconds:300,robot:{ecat_id:16,base_link:'null',tip_link:'link_7',hardware_config:'hardware_talon_config.yaml'}});
  expect(file.bytes).toEqual(before);
});
it('blocks invalid startup field types and TTL values in cross-file validation',()=>{
  const p=resourceProject(),file=fileById(p,p.entrypoints.app)!;
  file.bytes=utf8.encode(textOf(file).replace('http_control_ttl_seconds: 300','http_control_ttl_seconds: text'));
  expect(validateProject(p)).toContainEqual(expect.objectContaining({code:'app.startup',field:'http_control_ttl_seconds',severity:'error'}));
  expect(()=>appDocument({...file,bytes:utf8.encode('robot: null')})).toThrow('robot 必须为映射');
});
it('uses implicit APP defaults for dependencies and model endpoint renames',()=>{
  const p=createProject('default-chain','igh'),file=fileById(p,p.entrypoints.app)!,robot=fileById(p,p.entrypoints.urdf)!;
  file.bytes=utf8.encode('# native defaults\nhttp_port: 010\n');
  robot.bytes=utf8.encode('<robot name="r"><link name="base_link"/><link name="link_7"/><joint name="joint" type="revolute"><parent link="base_link"/><child link="link_7"/><limit lower="-1" upper="1" effort="10" velocity="1"/></joint></robot>');
  expect(analyzeProject(p,1).chain.map(j=>j.name)).toEqual(['joint']);
  expect(collectReferences(p).find(r=>r.sourceFileId===file.id&&r.field==='robot.urdf')?.original).toBe('robot.urdf');
  const next=planRobotChange(p,{kind:'rename',node:'link',name:'base_link',value:'new_base'}).project;
  expect(appDocument(fileById(next,next.entrypoints.app)!).data).toMatchObject({http_port:8,robot:{base_link:'new_base',tip_link:'link_7'}});
  expect(analyzeProject(next,2).chain.map(j=>j.name)).toEqual(['joint']);
  expect(textOf(file)).toBe('# native defaults\nhttp_port: 010\n');
});
it('preserves native numbers and shared scalar anchors through form and model transactions',()=>{
  const p=resourceProject(),file=fileById(p,p.entrypoints.app)!,hw=fileById(p,p.entrypoints.hardware)!;
  file.bytes=utf8.encode(textOf(file).replace('http_host: 0.0.0.0','http_host: &n 010').replace('http_port: 8080','http_port: *n'));
  hw.bytes=utf8.encode(textOf(hw).replace('offset_pos_cnt: 0','offset_pos_cnt: 010'));
  editProjectYaml(p,file.id,doc=>doc.setIn(['http_control_ttl_seconds'],600));
  const next=planRobotChange(p,{kind:'rename',node:'joint',name:'joint',value:'renamed'}).project;
  expect(appDocument(fileById(next,next.entrypoints.app)!).data).toMatchObject({http_host:'010',http_port:8,http_control_ttl_seconds:600});
  // Renaming a joint also rewrites Hardware; its octal zero offset must stay 8.
  expect(textOf(fileById(next,next.entrypoints.hardware)!)).toContain('offset_pos_cnt: 8');
});

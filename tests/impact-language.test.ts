import { afterEach, expect, it } from 'vitest';
import { resourceProject } from './fixtures/resources';
import { planRobotChange } from '../src/core/documents/robot-edit';
import { planSlaveChange, editProjectYaml } from '../src/core/bus/igh-edit';
import { planHardware, planLegacyBinding } from '../src/core/hardware/edit';
import { openProject, saveProject } from '../src/core/project/archive';
import { fileById, textOf, utf8 } from '../src/core/project/types';
import { validMessageTemplate } from '../src/core/project/messages';
import { diagnosticText, setLocale } from '../src/i18n';
import { validateProject } from '../src/core/validation';

afterEach(()=>setLocale('zh-CN'));
function namedProject(){
  return planRobotChange(resourceProject(),{kind:'rename',node:'joint',name:'joint',value:'工程总览-{v0}'}).project;
}
it('translates slave and hardware removal plans without translating joint names or applying the plans',()=>{
  const p=namedProject(),before=structuredClone(p);
  const hw=planHardware(p,{kind:'delete',index:0}),slave=planSlaveChange(p,{kind:'delete',index:0});
  setLocale('en-US');
  expect(hw.impactMessages.map(diagnosticText)).toEqual(['Delete device 0 and its bindings.','工程总览-{v0}: Remove binding']);
  expect(slave.impactMessages.map(diagnosticText)).toEqual([
    'Delete Slave 0, including its hardware devices and joint bindings.',
    'Remove hardware entry 0 (工程总览-{v0})',
    'Remove joint_bindings entry 0 (工程总览-{v0})',
    'Verify the actual wiring order. This operation can be undone.',
  ]);
  expect(p).toEqual(before);
  expect(planHardware(p,{kind:'delete',index:0})).toEqual(hw);
  expect(planSlaveChange(p,{kind:'delete',index:0})).toEqual(slave);
  setLocale('zh-CN');expect(hw.impactMessages.map(diagnosticText)).toEqual(hw.impacts);expect(slave.impactMessages.map(diagnosticText)).toEqual(slave.impacts);
});
it('translates driver suggestions and legacy binding provenance while retaining actual configuration values',()=>{
  const p=namedProject();editProjectYaml(p,p.entrypoints.hardware!,doc=>doc.set('hardware',[]));editProjectYaml(p,p.entrypoints.binding!,doc=>doc.set('joint_bindings',[]));
  const plan=planHardware(p,{kind:'add',type:'driver',id:0,joint:'工程总览-{v0}'});
  setLocale('en-US');const messages=plan.impactMessages.map(diagnosticText);
  expect(messages).toContain('Add driver using Slave 0.');
  expect(messages).toContain('工程总览-{v0} → Drive 0 → Slave 0; copy the limits provided by standard URDF. Missing values remain empty for review.');
  expect(messages).toContain('inputs.position_actual_value → position_actual_value (candidate; review required)');
  const legacy=namedProject();legacy.files=legacy.files.filter(f=>f.id!==legacy.entrypoints.binding);legacy.entrypoints.binding=null;
  const generated=planLegacyBinding(legacy);
  expect(generated.impactMessages.map(diagnosticText)).toContain('工程总览-{v0} → Drive 0 (source: Driver order in Hardware YAML)');
  expect(textOf(fileById(generated.project,generated.project.entrypoints.binding)!)).toContain('工程总览-{v0}');
});
it('persists localizable extension review notices and leaves legacy hardware unexamined',async()=>{
  const p=namedProject(),file=fileById(p,p.entrypoints.urdf)!;
  const legacy='<hardware target="工程总览-{v0}"><nested reference="工程总览-{v0}"/></hardware>';
  file.bytes=utf8.encode(textOf(file).replace('</robot>','<custom target="工程总览-{v0}"/>'+legacy+'</robot>'));
  const plan=planRobotChange(p,{kind:'rename',node:'joint',name:'工程总览-{v0}',value:'工具'});
  const restored=await openProject(await saveProject(plan.project));
  expect(restored.editor.notices).toEqual(plan.project.editor.notices);
  expect(textOf(fileById(restored,restored.entrypoints.urdf)!)).toContain(legacy);
  setLocale('en-US');
  const expected='Keep extension/unknown reference <custom target="工程总览-{v0}"> unchanged; review required.';
  expect(plan.warningMessages.map(diagnosticText)).toEqual([expected]);
  expect(restored.editor.notices!.map(diagnosticText)).toEqual([expected]);
  expect(validateProject(restored).filter(d=>d.code==='editor.review').map(diagnosticText)).toEqual([expected]);
  expect(plan.impactMessages.map(diagnosticText)).toContain('Control chain: 工程总览-{v0} → 工具; review bindings.');
  setLocale('zh-CN');expect(plan.warningMessages.map(diagnosticText)).toEqual(plan.warnings);
});
it('uses raw notice text for absent, malformed, cyclic or incompatible optional message metadata',async()=>{
  const cycle:any={key:'{nested}',values:{}};cycle.values.nested=cycle;
  for(const text of [undefined,null,{key:1,values:{}},{key:'x',values:null},cycle]){
    expect(validMessageTemplate(text)).toBe(false);
    expect(diagnosticText({message:'保留的原文',text:text as any})).toBe('保留的原文');
  }
  const p=resourceProject();p.editor.notices=[{fileId:p.entrypoints.urdf!,message:'保留的原文',text:{key:'目录',values:{bad:null}} as any},{fileId:p.entrypoints.urdf!,message:'旧版本复核提示'}];
  const restored=await openProject(await saveProject(p));setLocale('en-US');
  expect(restored.editor.notices!.map(diagnosticText)).toEqual(['保留的原文','旧版本复核提示']);
  expect(restored.editor.notices).toEqual(p.editor.notices);
  expect(diagnosticText({message:'保留的原文',text:{key:'工程总览',values:{}}})).toBe('保留的原文');
  let repeated:any='leaf';
  for(let i=0;i<12;i++)repeated={key:'{part}'.repeat(10),values:{part:repeated}};
  expect(validMessageTemplate(repeated)).toBe(true);
  expect(diagnosticText({message:'保留的原文',text:repeated})).toBe('保留的原文');
});

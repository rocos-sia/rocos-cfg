import { expect, it } from 'vitest';
import { createExample } from '../src/core/project/examples';
import { validateProject } from '../src/core/validation';
import { buildBusCatalog } from '../src/core/bus/catalog';
import { openProject, saveProject } from '../src/core/project/archive';
import { planRuntime } from '../src/core/export';
import { assertEditableFile } from '../src/core/modules/project';
import { fileById, textOf } from '../src/core/project/types';
import { teachingTemplate, validateTemplates } from '../src/core/project/templates';
import { setLocale } from '../src/i18n';

for(const kind of ['igh','ecm'] as const)it(`${kind} example has complete local dependencies and only an explicit mechanical-review gate`,async()=>{
  const p=createExample(kind),other=createExample(kind);
  expect(other.id).not.toBe(p.id);expect(other.snapshotId).not.toBe(p.snapshotId);
  expect(validateProject(p).filter(d=>d.severity==='error').map(d=>d.code)).toEqual(['hardware.confirmation']);
  expect(p.editor.confirmations).toEqual({});expect(validateTemplates(p)).toEqual([]);
  const bus=buildBusCatalog(p);expect(bus.diagnostics).toEqual([]);expect(bus.slaves).toHaveLength(1);expect(bus.signals).toHaveLength(5);
  expect(p.references.every(r=>r.state==='internal')).toBe(true);
  const restored=await openProject(await saveProject(p));expect(restored.files.filter(f=>f.role!=='editor-state')).toEqual(p.files);expect(restored.editor.confirmations).toEqual({});
  const use=restored.editor.templateUses!.find(use=>use.templateId==='project.teaching')!;
  expect(JSON.parse(textOf(fileById(restored,use.snapshotFileId)!))).toEqual(teachingTemplate());
  restored.editor.confirmations['drive:0']=true;
  expect(validateProject(restored).filter(d=>d.severity==='error')).toEqual([]);
  const plan=planRuntime(restored);expect(plan.external).toEqual([]);
  expect(plan.files.map(f=>f.path)).toEqual(expect.arrayContaining([`master/${kind}.yaml`,'models/robot.urdf','app/hardware_config.yaml','app/joint_binding.yaml','app/config.yaml','app/payload.yaml','scripts/example.lua','web/index.html']));
  expect(plan.files.some(f=>f.path.startsWith('project-data/'))).toBe(false);
  try{setLocale('en-US');expect(planRuntime(restored)).toEqual(plan);}finally{setLocale('zh-CN');}
  if(kind==='ecm'){
    const eni=fileById(p,p.entrypoints.master.eniFileId)!;
    expect(()=>assertEditableFile(p,eni)).toThrow('ENI 始终只读');
    expect(plan.files.find(f=>f.fileId===eni.id)!.bytes).toEqual(eni.bytes);
  }
});

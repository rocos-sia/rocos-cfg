import { afterEach, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import english from '../src/i18n/en.json';
import { diagnosticText, setLocale } from '../src/i18n';
import { m, MessageError, errorMessage, messageFields } from '../src/core/project/messages';
import { validateProject } from '../src/core/validation';
import { resourceProject } from './fixtures/resources';
import { editProjectYaml } from '../src/core/bus/igh-edit';
import { buildBusCatalog } from '../src/core/bus/catalog';
import { validateHardware } from '../src/core/hardware/validation';
import { runArchiveTask } from '../src/adapters/archive-tasks';
import { readRobot, controlChain } from '../src/core/documents/urdf';
import { geometryErrors } from '../src/core/documents/urdf-geometry';
import { analyzeProject } from '../src/core/project/analysis';
import { fileById, utf8 } from '../src/core/project/types';

afterEach(()=>setLocale('zh-CN'));
it('renders serialized nested messages without translating user values or reinterpreting braces inside them',()=>{
  const original=m('{v0}：{v1} {v2}',{v0:'robot.urdf',v1:'中文目录/工程总览-{v2}.urdf',v2:m('未找到').text});
  const transported=JSON.parse(JSON.stringify(original));setLocale('en-US');
  expect(diagnosticText(transported)).toBe('robot.urdf: 中文目录/工程总览-{v2}.urdf — not found');
  expect(original.message).toBe('robot.urdf：中文目录/工程总览-{v2}.urdf 未找到');
  setLocale('zh-CN');expect(diagnosticText(transported)).toBe(original.message);
  expect(diagnosticText({message:'外部错误原文：工程总览'})).toBe('外部错误原文：工程总览');
});
it('keeps diagnostics and project data identical across locales while rendering hardware type fragments in English',()=>{
  const project=resourceProject();editProjectYaml(project,project.entrypoints.hardware!,doc=>doc.setIn(['hardware',0,'transform','ratio'],0));
  const original=structuredClone(project),chinese=validateProject(project);setLocale('en-US');
  expect(validateProject(project)).toEqual(chinese);expect(project).toEqual(original);
  const conversion=chinese.find(d=>d.code==='hardware.transform')!;
  expect(diagnosticText(structuredClone(conversion))).toBe('ratio requires an explicit finite nonzero number');
  const bus=buildBusCatalog(project);bus.signals.forEach(s=>{s.dataType='工程总览';});
  const diagnostic=validateHardware(project,bus).find(d=>d.code==='hardware.datatype')!;
  expect(diagnosticText(diagnostic)).toMatch(/^工程总览 does not match the APP \d+-bit (bit mask|signed integer|unsigned integer)/);
  expect(diagnosticText(diagnostic)).not.toContain('Overview');
});
it('retains structured error messages across the worker boundary and falls back to unmodified third-party errors',async()=>{
  class WorkerStub extends EventTarget { postMessage(){} terminate(){} }
  const worker=new WorkerStub(),pending=runArchiveTask({kind:'inspect',bytes:new Uint8Array()},{},()=>worker);
  const original=new MessageError(m('ECM 不支持字段：{v0}',{v0:'工程总览'}));
  worker.dispatchEvent(new MessageEvent('message',{data:structuredClone({type:'error',...messageFields(errorMessage(original))})}));
  const returned=await pending.catch(error=>error);setLocale('en-US');
  expect(diagnosticText(messageFields(errorMessage(returned)))).toBe('ECM does not support field 工程总览');
  expect(returned.message).toBe(original.message);
  expect(diagnosticText(messageFields(errorMessage(new Error('third-party {v0} 中文'))))).toBe('third-party {v0} 中文');
});
it('localizes URDF geometry and control-chain diagnostics while keeping legacy hardware opaque and names unchanged',()=>{
  const legacy='<hardware><limit lower="bad" upper="bad"/><mesh filename="missing.stl"/></hardware>';
  const xml='<robot name="r"><link name="base"/><link name="tip"><visual><geometry><box size="0 1 1"/></geometry></visual></link><joint name="工程总览-{v0}" type="continuous"><parent link="base"/><child link="tip"/><axis xyz="0 0 0"/>'+legacy+'</joint></robot>';
  const robot=readRobot(xml);
  expect(robot.errors).toEqual(['工程总览-{v0} 轴向不能为零','tip.visual[0].size 需要三个正数值']);
  expect(geometryErrors(xml,robot.links)).toEqual(robot.errors.slice(1));
  expect(readRobot(xml.replace(legacy,''))).toMatchObject({joints:robot.joints,errors:robot.errors,issues:robot.issues});
  const project=resourceProject();fileById(project,project.entrypoints.urdf)!.bytes=utf8.encode(xml);
  const analysis=structuredClone(analyzeProject(project,1));
  setLocale('en-US');
  expect(analysis.robot!.issues.map(diagnosticText)).toEqual(['工程总览-{v0} axis must not be zero','tip.visual[0].size requires three positive numbers']);
  const chain={message:analysis.chainError!,text:analysis.chainErrorText};
  expect(diagnosticText(chain)).toBe('工程总览-{v0} axis must not be zero; tip.visual[0].size requires three positive numbers');
  expect(()=>controlChain(xml,'base','tip')).toThrow(robot.errors.join('；'));
  setLocale('zh-CN');expect(diagnosticText(chain)).toBe(robot.errors.join('；'));
});
it('preserves a parser failure template in analysis results without inventing a robot or control chain',()=>{
  const project=resourceProject();fileById(project,project.entrypoints.urdf)!.bytes=utf8.encode('<notRobot/>');
  const analysis=JSON.parse(JSON.stringify(analyzeProject(project,2)));
  expect(analysis.robot).toBeUndefined();expect(analysis.chain).toEqual([]);
  setLocale('en-US');
  expect(diagnosticText({message:analysis.robotError,text:analysis.robotErrorText})).toBe('The URDF root element must be robot');
  expect(diagnosticText({message:analysis.chainError,text:analysis.chainErrorText})).toBe('The URDF root element must be robot');
});
it('has English entries for every explicitly localized core diagnostic template',()=>{
  const paths=['validation.ts','hardware/validation.ts','bus/catalog.ts','bus/igh.ts','bus/ecm.ts','documents/app-config.ts','modules/project.ts','modules/payload.ts','project/profiles.ts','project/templates.ts','documents/urdf.ts','documents/urdf-geometry.ts','documents/robot-edit.ts','documents/xml.ts','project/analysis.ts','bus/igh-edit.ts','hardware/edit.ts','project/archive.ts','project/zip.ts','project/paths.ts','project/import.ts','project/recover.ts','bus/compare.ts','../adapters/files.ts','../adapters/file-access.ts','project/migrations.ts','../adapters/project-session.ts','../adapters/recovery.ts','../adapters/archive-tasks.ts','../adapters/archive.worker.ts','project/resources.ts','project/create.ts','modules/builtin.ts','modules/registry.ts','export.ts','hardware/schema.ts','../store.ts','../modules/ui.tsx'];
  for(const path of paths){
    const source=ts.createSourceFile(path,readFileSync(new URL('../src/core/'+path,import.meta.url),'utf8'),ts.ScriptTarget.Latest,true);
    const visit=(node:ts.Node)=>{
      if(ts.isCallExpression(node)&&node.expression.getText(source)==='msg'&&node.arguments[0]&&ts.isStringLiteralLike(node.arguments[0]))expect(Object.hasOwn(english,node.arguments[0].text),path+': '+node.arguments[0].text).toBe(true);
      ts.forEachChild(node,visit);
    };visit(source);
  }
});

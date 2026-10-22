import { expect, test } from '@playwright/test';
import { readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { createProject } from '../../src/core/project/create';
import { editProjectYaml } from '../../src/core/bus/igh-edit';
import { openProject, saveProject } from '../../src/core/project/archive';
import { digest, fileById, uid } from '../../src/core/project/types';
const source=process.env.ROCOS_APP_SOURCE;

test('actual Talon meshes render with seven tree joints and opaque legacy hardware, and survive project roundtrip',async({page},info)=>{
  test.skip(!source,'Set ROCOS_APP_SOURCE to inspect the actual model without redistributing its assets.');test.setTimeout(60000);
  expect(execFileSync('git',['-C',source!,'rev-parse','--short=7','HEAD'],{encoding:'utf8'}).trim()).toBe('7093bcd');
  expect(execFileSync('git',['-C',source!,'status','--porcelain','--','models/talon'],{encoding:'utf8'}).trim()).toBe('');
  const folder=resolve(source!,'models/talon'),p=createProject('Talon consumer sample','igh'),robot=fileById(p,p.entrypoints.urdf)!;
  robot.bytes=new Uint8Array(await readFile(resolve(folder,'robot.urdf')));p.packageMap.self_robot_description='models/talon';
  editProjectYaml(p,p.entrypoints.app!,doc=>doc.setIn(['robot','tip_link'],'link_7'));
  const counts:number[]=[];
  for(const name of (await readdir(folder)).filter(name=>/\.stl$/i.test(name))){
    const bytes=await readFile(resolve(folder,name));expect(bytes.length).toBe(84+bytes.readUInt32LE(80)*50);counts.push(bytes.readUInt32LE(80)*3);
    p.files.push({id:uid(),path:'models/talon/meshes/'+name,role:'resource',owner:'resource',bytes:new Uint8Array(bytes)});
  }
  expect(counts).toHaveLength(8);
  await page.addInitScript(()=>{
    (window as any).__talonDrawCounts=[];
    for(const context of [window.WebGLRenderingContext,window.WebGL2RenderingContext])if(context){
      const proto=context.prototype;
      for(const name of ['drawArrays','drawElements'] as const){
        const original=proto[name];(proto as any)[name]=function(...args:any[]){
          if(args[0]===this.TRIANGLES){const n=args[name==='drawArrays'?2:1],seen=(window as any).__talonDrawCounts;if(!seen.includes(n))seen.push(n);}
          return (original as any).apply(this,args);
        };
      }
    }
  });
  const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
  await page.goto('/');await page.locator('input[type=file]').first().setInputFiles({name:'talon.rcproj',mimeType:'application/zip',buffer:Buffer.from(await saveProject(p))});
  await page.getByRole('menuitem',{name:'机器人模型'}).click();
  for(let i=1;i<=7;i++)await expect(page.getByText(`joint_${i} [continuous]`,{exact:true})).toBeVisible();
  // Confirm every STL vertex count reaches a triangle draw call, not just that
  // a canvas or resource request exists. The screenshot also supports visual QA.
  await expect.poll(()=>page.evaluate(expected=>expected.every(n=>(window as any).__talonDrawCounts.includes(n)),counts),{timeout:15000}).toBe(true);
  await page.getByText('joint_7 [continuous]',{exact:true}).click();
  const tree=page.locator('.model-tree'),last=page.getByText('joint_7 [continuous]',{exact:true}),root=page.getByText('base_link [控制链端点]',{exact:true});
  expect(await tree.evaluate(node=>node.scrollLeft)).toBe(0);
  // A bounded panel scrolls long chains vertically; both ends remain reachable.
  await expect(last).toBeInViewport();expect(await tree.evaluate(node=>node.scrollTop)).toBeGreaterThan(0);
  await root.scrollIntoViewIfNeeded();await expect(root).toBeInViewport();
  await expect(tree.locator('.ant-tree-treenode-selected')).toContainText('joint_7');
  expect(await tree.evaluate(node=>node.scrollLeft)).toBe(0);
  await expect(page.locator('.ant-alert').filter({hasText:'APP 模型有效限位'})).toHaveCount(0);
  await expect(page.getByText(/部分模型资源无法加载|缺少或外部模型资源|模型预览失败/)).toHaveCount(0);
  await page.screenshot({path:info.outputPath('talon-model.png'),fullPage:true});
  const download=page.waitForEvent('download');await page.getByRole('button',{name:'下载工程',exact:true}).click();
  const path=info.outputPath('talon.rcproj');await(await download).saveAs(path);const restored=await openProject(await readFile(path));
  for(const original of p.files.filter(f=>f.role==='resource'||f.role==='urdf'))expect(await digest(fileById(restored,original.id)!.bytes)).toBe(await digest(original.bytes));
  expect(errors).toEqual([]);
});

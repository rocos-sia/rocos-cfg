import { expect, test, type Page } from '@playwright/test';
import { multiaxisProject } from '../fixtures/multiaxis';
import { createExample } from '../../src/core/project/examples';
import { saveProject } from '../../src/core/project/archive';
import { editProjectYaml } from '../../src/core/bus/igh-edit';
import { fileById, textOf, utf8, digest, type Project } from '../../src/core/project/types';
import { projectSnapshot } from './helpers/project';
import { tabTo } from './helpers/input';
async function open(page:Page,p:Project){await page.goto('/');await page.locator('input[type=file]').first().setInputFiles({name:'diagnostic.rcproj',mimeType:'application/zip',buffer:Buffer.from(await saveProject(p))});await expect(page.locator('.project-name strong')).toHaveText(p.name);}
async function row(page:Page,field:string,code?:string){
  const table=page.locator('.diagnostic-table');await expect(table).toBeVisible();const first=table.locator('.ant-pagination-item-1');if(await first.count())await first.click();
  for(let i=0;i<20;i++){
    const rows=table.locator('.ant-table-row').filter({has:page.getByRole('cell',{name:field,exact:true})}),target=code?rows.filter({has:page.getByRole('cell',{name:code,exact:true})}).first():rows.first();
    if(await target.count())return target;
    const next=table.locator('.ant-pagination-next');if(!await next.count())break;if(await next.getAttribute('aria-disabled')==='true'||(await next.getAttribute('class'))?.includes('ant-pagination-disabled'))break;
    await next.click();
  }
  throw Error('Diagnostic not found: '+field+' '+code);
}
async function validate(page:Page){await page.getByRole('button',{name:'校验工程',exact:true}).click();await expect(page.locator('.diagnostic-table .ant-table-row').first()).toBeVisible();}

test('diagnostics select the correct hardware record and focus its field with keyboard, keeping navigation read-only and stale results inactive',async({page},info)=>{
  const p=multiaxisProject();editProjectYaml(p,p.entrypoints.hardware!,doc=>doc.setIn(['hardware',1,'transform','ratio'],0));
  await open(page,p);await validate(page);const before=await projectSnapshot(page),target=await row(page,'hardware.1.transform.ratio','hardware.transform'),button=target.getByRole('button',{name:'定位',exact:true});
  await tabTo(page,button);await page.keyboard.press('Enter');
  await expect(page.getByRole('radio',{name:'选择设备 0（driver）',exact:true})).toBeChecked();const ratio=page.getByRole('spinbutton',{name:'ratio',exact:true});await expect(ratio).toBeFocused();expect(await projectSnapshot(page)).toBe(before);
  await page.screenshot({path:info.outputPath('located-hardware.png')});
  await page.getByRole('button',{name:'切换语言',exact:true}).click();await page.getByRole('menuitem',{name:'English',exact:true}).click();
  await expect(page.getByText('Diagnostic location',{exact:true})).toBeVisible();await expect(page.getByRole('spinbutton',{name:'ratio',exact:true})).not.toBeFocused();
  await ratio.fill('8');await ratio.blur();await page.getByRole('menuitem',{name:'Validate & export',exact:true}).click();await expect(page.getByText('Results are outdated',{exact:true})).toBeVisible();
  await expect(page.locator('.diagnostic-table').getByRole('button',{name:'Locate',exact:true}).first()).toBeDisabled();
});

test('PDO and SDO errors open the right slave and exact input without changing a configuration',async({page})=>{
  const p=multiaxisProject(),id=p.entrypoints.master.fileId!;
  editProjectYaml(p,id,doc=>{doc.setIn(['slaves',2,'rx_pdos',0,'entries',0,'bit_length'],0);doc.setIn(['slaves',2,'init_commands'],[{index:8192,sub_index:0,Type:'uint64',Value:'unfinished'}]);});
  await open(page,p);await validate(page);const before=await projectSnapshot(page);
  await(await row(page,'slaves.2.rx_pdos.0.entries.0.bit_length','igh.integer')).getByRole('button',{name:'定位',exact:true}).click();
  await expect(page.getByRole('tab',{name:'PDO / SDO 编辑',exact:true})).toHaveAttribute('aria-selected','true');await expect(page.getByRole('textbox',{name:'RxPDO 1 条目 1 位宽',exact:true})).toBeFocused();
  await page.getByRole('button',{name:'返回诊断结果',exact:true}).click();
  await(await row(page,'slaves.2.init_commands.0.Value','igh.integer')).getByRole('button',{name:'定位',exact:true}).click();await expect(page.getByRole('textbox',{name:'SDO 1 值',exact:true})).toBeFocused();expect(await projectSnapshot(page)).toBe(before);
});

test('ECM scalar diagnostics focus forms while ENI errors reveal the actual read-only XML node and retain every byte',async({page})=>{
  const p=createExample('ecm'),eni=fileById(p,p.entrypoints.master.eniFileId)!;eni.bytes=utf8.encode(textOf(eni).replace('<PhysAddr>1001</PhysAddr>','<PhysAddr>9999</PhysAddr>'));
  editProjectYaml(p,p.entrypoints.master.fileId!,doc=>doc.set('cycle',0));await open(page,p);await validate(page);const before=await projectSnapshot(page);
  await(await row(page,'cycle','ecm.startup')).getByRole('button',{name:'定位',exact:true}).click();await expect(page.getByRole('spinbutton',{name:/^通信周期/})).toBeFocused();
  await page.getByRole('button',{name:'返回诊断结果',exact:true}).click();await(await row(page,'Config.Slave.0.Info.PhysAddr','ecm.address')).getByRole('button',{name:'定位',exact:true}).click();
  const source=page.getByRole('textbox',{name:'ENI 只读源码',exact:true});await expect(source).toBeFocused();await expect(source).toHaveAttribute('contenteditable','false');expect(await page.evaluate(()=>getSelection()?.toString())).toBe('<PhysAddr');expect(await projectSnapshot(page)).toBe(before);
});

test('source fallback selects repeated YAML values structurally and pending invalid drafts remain unchanged',async({page})=>{
  const p=createExample('igh'),master=p.entrypoints.master.fileId!,binding=p.entrypoints.binding!;
  editProjectYaml(p,master,doc=>doc.set('version',2));const f=fileById(p,binding)!;p.editor.buffers[binding]={text:'joint_bindings: [unfinished',baseHash:await digest(f.bytes)};
  await open(page,p);await validate(page);const before=await projectSnapshot(page);
  await(await row(page,'version','igh.version')).getByRole('button',{name:'定位',exact:true}).click();await expect(page.getByRole('textbox',{name:'配置源码',exact:true})).toBeFocused();expect(await page.evaluate(()=>getSelection()?.toString())).toBe('2');
  await page.getByRole('button',{name:'返回诊断结果',exact:true}).click();const pending=page.locator('.diagnostic-table .ant-table-row').filter({has:page.getByRole('cell',{name:'editor.pending',exact:true})});await pending.getByRole('button',{name:'定位',exact:true}).click();
  const source=page.getByRole('textbox',{name:'配置源码',exact:true});await expect(source).toHaveText('joint_bindings: [unfinished');await expect(source).toBeFocused();await expect(page.getByText('诊断基于已应用配置；当前源码草稿保持不变，请先核对草稿。',{exact:true})).toBeVisible();expect(await projectSnapshot(page)).toBe(before);
});

test('resource navigation reveals a mapping on a later page, and a same-UUID same-revision replacement invalidates old diagnostics',async({page},info)=>{
  const p=createExample('igh');fileById(p,p.entrypoints.urdf)!.bytes=utf8.encode('<robot name="resources"><link name="base_link">'+Array.from({length:14},(_,i)=>`<visual><geometry><mesh filename="missing-${i}.stl"/></geometry></visual>`).join('')+'</link><link name="tool_link"/><joint name="axis" type="continuous"><parent link="base_link"/><child link="tool_link"/></joint></robot>');
  await open(page,p);await validate(page);const before=await projectSnapshot(page);await(await row(page,'mesh[13].filename','reference.missing')).getByRole('button',{name:'定位',exact:true}).click();
  const mapping=page.getByRole('combobox',{name:'映射 mesh[13].filename',exact:true});await expect(mapping).toBeFocused();await expect(mapping).toBeInViewport();expect(await projectSnapshot(page)).toBe(before);await page.screenshot({path:info.outputPath('located-resource.png')});
  await page.getByRole('button',{name:'返回诊断结果',exact:true}).click();await page.evaluate(async()=>{const path='/src/store.ts';const {useProject}=await import(path);const p=structuredClone(useProject.getState().project!);useProject.getState().load(p);});
  await expect(page.getByText('结果已过期',{exact:true})).toBeVisible();await expect(page.locator('.diagnostic-table').getByRole('button',{name:'定位',exact:true}).first()).toBeDisabled();
});

test('configuration and diagnostic pages keep narrow-window overflow inside their tables',async({page},info)=>{
  await page.setViewportSize({width:390,height:844});const p=multiaxisProject();
  editProjectYaml(p,p.entrypoints.hardware!,doc=>doc.setIn(['hardware',1,'transform','ratio'],0));
  await open(page,p);
  for(const name of ['主站配置','硬件与绑定','APP 配置']){
    await page.getByRole('button',{name:'展开导航',exact:true}).click();await page.getByRole('menuitem',{name,exact:true}).click();
    await expect(page.getByRole('heading',{name,exact:true})).toBeVisible();
    const overflow=await page.evaluate(()=>{const w=document.querySelector('.workspace')!;return {window:document.documentElement.scrollWidth-innerWidth,workspace:w.scrollWidth-w.clientWidth};});
    const wide=await page.locator('.workspace').evaluate(w=>[...w.querySelectorAll('*')].filter(e=>e.getBoundingClientRect().right>w.getBoundingClientRect().right+1).slice(0,12).map(e=>e.tagName+'.'+e.className+':'+Math.round(e.getBoundingClientRect().width)));
    expect(overflow,name+JSON.stringify(wide)).toEqual({window:0,workspace:0});await page.screenshot({path:info.outputPath(name+'.png')});
  }
  await validate(page);expect(await page.evaluate(()=>{const w=document.querySelector('.workspace')!;return w.scrollWidth-w.clientWidth;})).toBe(0);
  const target=await row(page,'hardware.1.transform.ratio','hardware.transform');await target.getByRole('button',{name:'定位',exact:true}).click();await expect(page.getByRole('spinbutton',{name:'ratio',exact:true})).toBeFocused();await expect(page.getByRole('spinbutton',{name:'ratio',exact:true})).toBeInViewport();
});

test('a diagnostic source editor remains mounted through asynchronous draft changes and apply',async({page})=>{
  const p=createExample('igh'),id=p.entrypoints.master.fileId!,file=fileById(p,id)!;editProjectYaml(p,id,doc=>doc.set('version',2));
  await open(page,p);await validate(page);await(await row(page,'version','igh.version')).getByRole('button',{name:'定位',exact:true}).click();
  const source=page.getByRole('textbox',{name:'配置源码',exact:true});await expect(source).toBeFocused();
  await source.evaluate(e=>(window as any).__diagnosticEditor=e);
  const modified=textOf(file).replace('version: 2','version: 1');await source.fill(modified);
  await expect.poll(async()=>JSON.parse(await projectSnapshot(page)).editor.buffers[id]?.text).toBe(modified);
  expect(await source.evaluate(e=>(window as any).__diagnosticEditor===e)).toBe(true);
  await page.getByRole('button',{name:'应用修改',exact:true}).click();await expect(source).toContainText('version: 1');expect(await source.evaluate(e=>(window as any).__diagnosticEditor===e)).toBe(true);
  await page.getByRole('button',{name:'返回配置页面',exact:true}).click();await expect(page.getByRole('heading',{name:'主站配置',exact:true})).toBeVisible();
});

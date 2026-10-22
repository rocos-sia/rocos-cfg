import {test,expect} from '@playwright/test';
import {projectSnapshot} from './helpers/project';

test('optional APP supports manual hardware and distinct application tabs',async({page})=>{
 await page.goto('/');await page.getByRole('button',{name:'新建工程',exact:true}).click();
 const dialog=page.getByRole('dialog',{name:'新建配置工程'});
 await dialog.getByLabel('总线配置',{exact:true}).click();await expect(dialog.getByLabel('总线配置',{exact:true})).not.toBeChecked();await dialog.getByRole('button',{name:'创建工程',exact:true}).click();
 await page.getByRole('menuitem',{name:'应用配置',exact:true}).click();
 await page.getByRole('tab',{name:'硬件'}).click();
 await page.getByRole('button',{name:'新增 io',exact:true}).click();
 await page.locator('#new-hardware-slave').fill('12');await page.getByRole('button',{name:'预览配置草稿'}).click();
 await page.getByRole('button',{name:'应用变更',exact:true}).click();
 await expect(page.locator('.hardware-device-table')).toContainText('12');
 await page.getByRole('tab',{name:'绑定'}).click();await expect(page.getByText('显式关节绑定',{exact:true})).toBeVisible();
 await expect(page.locator('.hardware-layout')).toHaveCount(0);
});

test('simulation-only MJCF preview and folder export',async({page})=>{
 await page.goto('/');await page.getByRole('button',{name:'新建工程',exact:true}).click();
 const dialog=page.getByRole('dialog',{name:'新建配置工程'});
 await dialog.getByLabel('总线配置',{exact:true}).click();await expect(dialog.getByLabel('总线配置',{exact:true})).not.toBeChecked();await dialog.getByLabel('应用配置',{exact:true}).click();await expect(dialog.getByLabel('应用配置',{exact:true})).not.toBeChecked();await dialog.getByLabel('仿真配置',{exact:true}).click();await expect(dialog.getByLabel('仿真配置',{exact:true})).toBeChecked();await dialog.getByRole('button',{name:'创建工程',exact:true}).click();
 await page.getByRole('menuitem',{name:'仿真配置',exact:true}).click();
 const chooser=page.waitForEvent('filechooser');await page.getByRole('button',{name:'导入 MJCF / 资源',exact:true}).click();
 await (await chooser).setFiles({name:'scene.xml',mimeType:'text/xml',buffer:Buffer.from('<mujoco><worldbody><geom type="box" size=".1 .2 .3" rgba=".2 .6 .9 1"/></worldbody></mujoco>')});
 await page.getByRole('button',{name:'加载模型预览',exact:true}).click();await expect(page.locator('.mjcf-preview canvas')).toBeVisible({timeout:30000});
 await page.screenshot({path:'test-results/simulation-preview.png'});
 const model=await page.locator('.simulation-model').boundingBox(),parameters=await page.locator('.simulation-parameters').boundingBox();
 expect(model!.width).toBeGreaterThan(parameters!.width);expect(model!.y).toBe(parameters!.y);
 await page.getByRole('button',{name:'切换主题',exact:true}).click();
 await page.screenshot({path:'test-results/simulation-preview-dark.png'});
 await page.getByRole('button',{name:'切换主题',exact:true}).click();
 for(const width of [390,1024,1440]){await page.setViewportSize({width,height:1000});await expect.poll(()=>page.locator('body').evaluate(el=>el.scrollWidth<=innerWidth)).toBe(true);}

 await page.evaluate(()=>{const w=window as any;w.exported=[];w.showDirectoryPicker=async()=>{const dir=(path:string):any=>({getDirectoryHandle:async(name:string)=>dir(path+'/'+name),getFileHandle:async(name:string)=>({createWritable:async()=>({write:async(bytes:Uint8Array)=>w.exported.push({path:path+'/'+name,size:bytes.length}),close:async()=>{},abort:async()=>{}})})});return dir('');};});
 await page.getByRole('menuitem',{name:'校验和导出',exact:true}).click();await page.getByRole('button',{name:'导出到新目录',exact:true}).click();
 await page.getByRole('button',{name:'选择父目录并导出',exact:true}).click();
 await expect(page.getByRole('dialog',{name:'运行目录已导出',exact:true})).toBeVisible();
 const paths=await page.evaluate(()=>(window as any).exported.map((x:any)=>x.path));expect(paths).toHaveLength(4);expect(paths.some((p:string)=>p.endsWith('/simulation/models/scene.xml'))).toBe(true);
});

test('dual master navigation retains both configurations',async({page})=>{
 await page.goto('/');await page.getByRole('button',{name:'新建工程',exact:true}).click();
 const preset=page.locator('.ant-select[aria-label="PDO 模板"]:visible');await preset.click();await preset.getByRole('combobox').fill('Elmo · Twitter · Talon');await page.getByTitle('Elmo · Twitter · Talon',{exact:true}).click();
 await page.getByRole('button',{name:'创建工程',exact:true}).click();
 await page.getByRole('menuitem',{name:'总线配置',exact:true}).click();await page.getByRole('tab',{name:'ECM',exact:true}).click();
 await expect(page.getByText('来自 ENI · 只读',{exact:true})).toBeVisible();await page.getByRole('tab',{name:'IGH',exact:true}).click();await expect(page.getByRole('tab',{name:'PDO / SDO 编辑',exact:true})).toBeVisible();
 await page.getByRole('menuitem',{name:'应用配置',exact:true}).click();
 await expect(page.getByRole('button',{name:'ECM',exact:true})).toHaveCount(0);
 await page.getByRole('tab',{name:'硬件'}).click();
 await page.getByRole('button',{name:'复用主站 PDO 映射',exact:true}).click();
 const mapping=page.getByRole('dialog',{name:'复用主站 PDO 映射'});
 await mapping.locator('.ant-select-selector').click();
 await expect(page.getByTitle('ECM',{exact:true})).toBeVisible();
 await page.getByTitle('ECM',{exact:true}).click();
 await mapping.press('Escape');
 await page.getByRole('button',{name:'复用主站 PDO 映射',exact:true}).click();
 await expect(mapping.locator('.ant-select-selection-item')).toHaveText('IGH');
 await mapping.getByRole('button',{name:'应用映射',exact:true}).click();
 await expect(mapping).not.toBeVisible();
 await page.getByRole('menuitem',{name:'总线配置',exact:true}).click();await expect(page.getByRole('tab',{name:'PDO / SDO 编辑',exact:true})).toBeVisible();
});


test('project modules live in settings and disabled pages link back to settings',async({page})=>{
 await page.goto('/');await page.getByRole('button',{name:'新建工程',exact:true}).click();await page.getByRole('button',{name:'创建工程',exact:true}).click();
 await expect(page.getByText('工程配置模块',{exact:true})).toHaveCount(0);
 await page.getByRole('button',{name:'设置',exact:true}).click();
 const settings=page.getByRole('dialog',{name:'设置',exact:true});
 await settings.getByLabel('01 总线配置',{exact:true}).click();
 await expect(settings.getByLabel('01 总线配置',{exact:true})).not.toBeChecked();
 await settings.press('Escape');await expect(settings).not.toBeVisible();
 await page.getByRole('menuitem',{name:'总线配置',exact:true}).click();
 await page.getByRole('button',{name:'打开设置',exact:true}).click();
 await settings.getByLabel('01 总线配置',{exact:true}).click();
 await expect(settings.getByLabel('01 总线配置',{exact:true})).toBeChecked();
 await settings.press('Escape');
 await expect(page.getByRole('heading',{name:'主站配置',exact:true})).toBeVisible();
 await expect(page.getByRole('tab',{name:'IGH',exact:true})).toHaveAttribute('aria-selected','true');
 await page.screenshot({path:'test-results/master-tabs.png'});
 for(const width of [390,1024,1440]){await page.setViewportSize({width,height:1000});await expect.poll(()=>page.locator('body').evaluate(el=>el.scrollWidth<=innerWidth)).toBe(true);}

});

test('direct Talon example opens both masters and horizontal application tabs',async({page})=>{
 await page.setViewportSize({width:1440,height:1080});
 await page.goto('/');await page.getByRole('button',{name:'打开示例',exact:true}).click();
 await expect(page.locator('.project-name strong')).toHaveText('Talon');
 await expect(page.locator('#project-name')).toHaveValue('Talon');
 await expect(page.getByRole('dialog',{name:'打开示例',exact:true})).toHaveCount(0);
 await expect(page.locator('.topbar')).not.toContainText('开发模式');
 await expect(page.locator('.topbar')).not.toContainText('ROCOS-IGH');
 await expect(page.getByText('目标规则与模板来源',{exact:true})).toHaveCount(0);
 const overviewBottom=await page.locator('.overview-grid').evaluate(el=>el.getBoundingClientRect().bottom);
 const contentBottom=await page.locator('.workspace').evaluate(el=>el.getBoundingClientRect().bottom-parseFloat(getComputedStyle(el).paddingBottom));
 expect(Math.abs(overviewBottom-contentBottom)).toBeLessThan(2);
 await page.screenshot({path:'test-results/overview-filled.png'});
 await page.getByRole('menuitem',{name:'总线配置',exact:true}).click();
 await page.getByRole('tab',{name:'ECM',exact:true}).click();
 await expect(page.getByRole('tab',{name:'过程映像 (91)',exact:true})).toBeVisible();
 await expect(page.getByRole('tab',{name:'ENI 原文 · 只读',exact:true})).toBeVisible();
 await page.getByRole('tab',{name:'IGH',exact:true}).click();
 await expect(page.getByRole('tab',{name:'过程映像 (77)',exact:true})).toBeVisible();
 await page.getByRole('menuitem',{name:'应用配置',exact:true}).click();
 const nav=page.locator('.application-tabs');
 await expect(nav.locator(':scope > .ant-tabs-nav').getByRole('tab')).toHaveText(['启动参数','模型','硬件','绑定','负载']);
 const first=await nav.getByRole('tab',{name:'启动参数',exact:true}).boundingBox(),last=await nav.getByRole('tab',{name:'负载',exact:true}).boundingBox();
 expect(first!.y).toBe(last!.y);expect(last!.x).toBeGreaterThan(first!.x);
 await page.getByRole('tab',{name:'硬件',exact:true}).click();
 await expect(page.locator('.hardware-layout')).toBeVisible();
 await page.getByRole('tab',{name:'绑定',exact:true}).focus();await page.keyboard.press('Enter');
 await expect(page.getByText('显式关节绑定',{exact:true})).toBeVisible();
 await page.screenshot({path:'test-results/application-navigation.png'});
 await page.getByRole('button',{name:'切换语言',exact:true}).click();await page.getByRole('menuitem',{name:'English',exact:true}).click();
 await expect(nav.locator(':scope > .ant-tabs-nav').getByRole('tab')).toHaveText(['Startup parameters','Model','Hardware','Binding','Payload']);
 for(const width of [390,1024,1440]){await page.setViewportSize({width,height:1000});await expect.poll(()=>page.locator('body').evaluate(el=>el.scrollWidth<=innerWidth)).toBe(true);}
});

test('application headings precede tabs, resource cards form a grid and chain controls share the model toolbar',async({page})=>{
 await page.goto('/');await page.getByRole('button',{name:'打开示例',exact:true}).click();await expect(page.locator('.project-name strong')).toHaveText('Talon');
 await page.getByRole('menuitem',{name:'应用配置',exact:true}).click();
 const heading=await page.getByRole('heading',{name:'APP 配置',exact:true}).boundingBox(),tabs=await page.locator('.application-tabs > .ant-tabs-nav').boundingBox();
 expect(heading!.y+heading!.height).toBeLessThan(tabs!.y);
 const cards=page.locator('.app-config-column > .ant-card');await expect(cards).toHaveCount(4);
 const positions=await cards.evaluateAll(nodes=>nodes.map(n=>{const b=n.getBoundingClientRect();return {x:b.x,y:b.y,bottom:b.bottom};}));
 expect(positions[0].y).toBe(positions[2].y);expect(positions[1].y-positions[0].bottom).toBe(16);expect(positions[3].y-positions[2].bottom).toBe(16);expect(positions[0].x).toBe(positions[1].x);expect(positions[2].x).toBeGreaterThan(positions[0].x);
 await page.screenshot({path:'test-results/app-config-grid.png'});
 await page.setViewportSize({width:390,height:844});await expect.poll(()=>page.locator('body').evaluate(el=>el.scrollWidth<=innerWidth)).toBe(true);
 await page.setViewportSize({width:1440,height:1000});
 await page.getByRole('tab',{name:'模型',exact:true}).click();
 const toolbar=page.locator('.model-panel-tools');
 await expect(toolbar.getByRole('button',{name:'新增关节与 Link',exact:true})).toBeVisible();
 await expect(toolbar.locator('#base-link')).toBeAttached();await expect(toolbar.locator('#tip-link')).toBeAttached();
 await toolbar.locator('.ant-select').filter({has:page.locator('#tip-link')}).click();await page.locator('.ant-select-dropdown:visible').getByTitle('link_6',{exact:true}).click();
 const confirm=page.getByRole('dialog',{name:'确认模型与引用变更',exact:true});await expect(confirm).toBeVisible();await confirm.press('Escape');
 await expect(toolbar.locator('.ant-select').filter({has:page.locator('#tip-link')})).toContainText('link_7');
 await page.screenshot({path:'test-results/model-chain-toolbar.png'});
 for(const width of [390,1024,1440]){await page.setViewportSize({width,height:1000});await expect.poll(()=>page.locator('body').evaluate(el=>el.scrollWidth<=innerWidth)).toBe(true);}
});


test('compact navigation, hardware parameters and resizable panels preserve configuration',async({page})=>{
 await page.setViewportSize({width:1920,height:1080});
 await page.goto('/');await page.getByRole('button',{name:'打开示例',exact:true}).click();
 await page.getByRole('menuitem',{name:'应用配置',exact:true}).click();
 await expect(page.getByRole('menuitem',{name:'应用配置',exact:true})).toHaveCSS('font-weight','700');
 const heading=await page.locator('.application-page-heading h1').boundingBox(),subtitle=await page.locator('.application-page-heading p').boundingBox();
 expect(subtitle!.x).toBeGreaterThan(heading!.x+heading!.width);expect(subtitle!.y).toBeLessThan(heading!.y+heading!.height);
 await page.locator('.brand-toggle').click();await expect(page.locator('.sidebar-slot')).toHaveAttribute('data-collapsed','true');
 await page.reload();await page.getByRole('button',{name:'恢复草稿',exact:true}).first().click();await expect(page.locator('.sidebar-slot')).toHaveAttribute('data-collapsed','true');
 await page.locator('.brand-toggle').click();await page.getByRole('menuitem',{name:'应用配置',exact:true}).click();
 await page.getByRole('tab',{name:'硬件',exact:true}).click();
 const alert=await page.locator('.hardware-actions .ant-alert').boundingBox(),actions=await page.locator('.hardware-actions > .ant-space').boundingBox();
 expect(Math.abs(alert!.y+alert!.height/2-actions!.y-actions!.height/2)).toBeLessThan(2);
 const params=await page.locator('.hardware-details .fields > .field').evaluateAll(nodes=>nodes.map(n=>{const b=n.getBoundingClientRect();return {x:b.x,y:b.y};}));
 expect(params.slice(0,5).every(p=>p.y===params[0].y)).toBe(true);expect(params[5].y).toBeGreaterThan(params[0].y);
 const panels=await page.locator('.hardware-workspace > .ant-card').evaluateAll(nodes=>nodes.map(n=>n.getBoundingClientRect().height));
 expect(panels[0]).toBe(panels[1]);
 const groups=await page.locator('.hardware-details .signal-fields > div').evaluateAll(nodes=>nodes.map(n=>{const b=n.getBoundingClientRect();return {x:b.x,y:b.y};}));
 expect(groups[0].y).toBe(groups[1].y);expect(groups[1].x).toBeGreaterThan(groups[0].x);
 await expect(page.locator('label[for="signal-inputs-status_word"]')).toHaveText('status_word * · uint16');
 await expect(page.locator('label[for="signal-inputs-position_actual_value"]')).toHaveText('position_actual_value * · int32');
 await expect(page.locator('.hardware-details').getByText('设备检查',{exact:true})).toHaveCount(0);
 await expect(page.locator('#signal-inputs-digital_outputs')).toHaveCount(0);
 await expect(page.locator('#signal-outputs-digital_outputs')).toBeAttached();
 await expect(page.locator('.hardware-details .signal-fields')).not.toContainText('类型待核对');
 await expect(page.locator('.hardware-details .signal-fields')).not.toContainText('/ 2 B');
 const statusField=page.locator('.signal-fields .field').filter({has:page.locator('#signal-inputs-status_word')});
 const labelBox=await statusField.locator('.field-heading').boundingBox(),selectBox=await statusField.locator('.ant-select').boundingBox();
 expect(labelBox!.x+labelBox!.width).toBeLessThan(selectBox!.x);
 expect(Math.abs(labelBox!.y+labelBox!.height/2-selectBox!.y-selectBox!.height/2)).toBeLessThan(1);
 await expect(page.locator('.hardware-details .field small')).toHaveCount(0);
 const before=await projectSnapshot(page),separator=page.getByRole('separator',{name:'调整硬件面板宽度'});
 const initial=Number(await separator.getAttribute('aria-valuenow')),box=await separator.boundingBox();
 await page.mouse.move(box!.x+box!.width/2,box!.y+24);await page.mouse.down();await page.mouse.move(box!.x+box!.width/2+80,box!.y+24);await page.mouse.up();
 await expect(separator).toHaveAttribute('aria-valuenow',String(initial+80));
 await separator.focus();await page.keyboard.press('ArrowLeft');await expect(separator).toHaveAttribute('aria-valuenow',String(initial+56));
 await page.keyboard.press('ArrowRight');await expect(separator).toHaveAttribute('aria-valuenow',String(initial+80));
 expect(await projectSnapshot(page)).toBe(before);
 await page.locator('.workspace').evaluate(el=>el.scrollTop=0);
 await page.screenshot({path:'test-results/hardware-compact.png'});
 await page.getByRole('button',{name:'切换主题',exact:true}).click();await page.screenshot({path:'test-results/hardware-compact-dark.png'});await page.getByRole('button',{name:'切换主题',exact:true}).click();
 await page.reload();await page.getByRole('button',{name:'恢复草稿',exact:true}).first().click();await page.getByRole('menuitem',{name:'应用配置',exact:true}).click();await page.getByRole('tab',{name:'硬件',exact:true}).click();
 await expect(separator).toHaveAttribute('aria-valuenow',String(initial+80));
 await page.setViewportSize({width:390,height:844});await expect(separator).toHaveCount(0);
 await expect.poll(()=>page.locator('body').evaluate(el=>el.scrollWidth<=innerWidth)).toBe(true);
 await page.screenshot({path:'test-results/hardware-compact-mobile.png'});
 await page.setViewportSize({width:844,height:390});await expect(page.locator('.brand-toggle')).toBeVisible();
});

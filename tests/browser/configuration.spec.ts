import {test,expect} from '@playwright/test';

test('optional APP supports manual hardware and distinct application tabs',async({page})=>{
 await page.goto('/');await page.getByRole('button',{name:'新建工程',exact:true}).click();
 const dialog=page.getByRole('dialog',{name:'新建配置工程'});
 await dialog.getByLabel('总线配置',{exact:true}).click();await expect(dialog.getByLabel('总线配置',{exact:true})).not.toBeChecked();await dialog.getByRole('button',{name:'创建工程',exact:true}).click();
 await page.getByRole('menuitem',{name:'02 应用配置',exact:true}).click();
 await page.getByRole('tab',{name:'硬件 · Hardware'}).click();
 await page.getByRole('button',{name:'新增 io',exact:true}).click();
 await page.locator('#new-hardware-slave').fill('12');await page.getByRole('button',{name:'预览配置草稿'}).click();
 await page.getByRole('button',{name:'应用变更',exact:true}).click();
 await expect(page.locator('.hardware-device-table')).toContainText('12');
 await page.getByRole('tab',{name:'绑定 · Binding'}).click();await expect(page.getByText('显式关节绑定',{exact:true})).toBeVisible();
 await expect(page.locator('.hardware-layout')).toHaveCount(0);
});

test('simulation-only MJCF preview and folder export',async({page})=>{
 await page.goto('/');await page.getByRole('button',{name:'新建工程',exact:true}).click();
 const dialog=page.getByRole('dialog',{name:'新建配置工程'});
 await dialog.getByLabel('总线配置',{exact:true}).click();await expect(dialog.getByLabel('总线配置',{exact:true})).not.toBeChecked();await dialog.getByLabel('应用配置',{exact:true}).click();await expect(dialog.getByLabel('应用配置',{exact:true})).not.toBeChecked();await dialog.getByLabel('仿真配置',{exact:true}).click();await expect(dialog.getByLabel('仿真配置',{exact:true})).toBeChecked();await dialog.getByRole('button',{name:'创建工程',exact:true}).click();
 await page.getByRole('menuitem',{name:'03 仿真配置',exact:true}).click();
 const chooser=page.waitForEvent('filechooser');await page.getByRole('button',{name:'导入 MJCF / 资源',exact:true}).click();
 await (await chooser).setFiles({name:'scene.xml',mimeType:'text/xml',buffer:Buffer.from('<mujoco><worldbody><geom type="box" size=".1 .2 .3" rgba=".2 .6 .9 1"/></worldbody></mujoco>')});
 await page.getByRole('button',{name:'加载模型预览',exact:true}).click();await expect(page.locator('.mjcf-preview canvas')).toBeVisible({timeout:30000});
 await page.screenshot({path:'test-results/simulation-preview.png'});
 for(const width of [390,1024,1440]){await page.setViewportSize({width,height:1000});expect(await page.locator('body').evaluate(el=>el.scrollWidth<=innerWidth)).toBe(true);}

 await page.evaluate(()=>{const w=window as any;w.exported=[];w.showDirectoryPicker=async()=>{const dir=(path:string):any=>({getDirectoryHandle:async(name:string)=>dir(path+'/'+name),getFileHandle:async(name:string)=>({createWritable:async()=>({write:async(bytes:Uint8Array)=>w.exported.push({path:path+'/'+name,size:bytes.length}),close:async()=>{},abort:async()=>{}})})});return dir('');};});
 await page.getByRole('menuitem',{name:'04 校验和导出',exact:true}).click();await page.getByRole('button',{name:'导出到新目录',exact:true}).click();
 await page.getByRole('button',{name:'选择父目录并导出',exact:true}).click();
 await expect(page.getByRole('dialog',{name:'运行目录已导出',exact:true})).toBeVisible();
 const paths=await page.evaluate(()=>(window as any).exported.map((x:any)=>x.path));expect(paths).toHaveLength(4);expect(paths.some((p:string)=>p.endsWith('/simulation/models/scene.xml'))).toBe(true);
});

test('dual master navigation retains both configurations',async({page})=>{
 await page.goto('/');await page.getByRole('button',{name:'新建工程',exact:true}).click();await page.getByRole('button',{name:'创建工程',exact:true}).click();
 await page.getByRole('menuitem',{name:'01 总线配置',exact:true}).click();await page.getByRole('button',{name:'ECM · 添加',exact:true}).click();
 await expect(page.getByText('来自 ENI · 只读',{exact:true})).toBeVisible();await page.getByRole('button',{name:'IGH',exact:true}).click();await expect(page.getByRole('tab',{name:'PDO / SDO 编辑',exact:true})).toBeVisible();
 await page.getByRole('menuitem',{name:'02 应用配置',exact:true}).click();await page.getByRole('button',{name:'ECM',exact:true}).click();
 await page.getByRole('menuitem',{name:'01 总线配置',exact:true}).click();await expect(page.getByRole('tab',{name:'PDO / SDO 编辑',exact:true})).toBeVisible();
});

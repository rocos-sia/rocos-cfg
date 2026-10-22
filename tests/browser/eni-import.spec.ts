import {test,expect,type Page} from '@playwright/test';
import {resolve} from 'node:path';
const chooseEni=async(page:Page)=>{
 const picker=page.waitForEvent('filechooser');await page.getByRole('button',{name:'导入 ENI',exact:true}).click();
 await (await picker).setFiles(resolve('public/examples/talon/ecm/eni7.xml'));
};
test('ENI imports into a blank project without overwrite confirmation and supports undo',async({page})=>{
 await page.goto('/');await page.getByRole('button',{name:'新建工程',exact:true}).click();await page.getByRole('button',{name:'创建工程',exact:true}).click();
 await page.getByRole('menuitem',{name:'总线配置',exact:true}).click();await chooseEni(page);
 await expect(page.getByRole('tab',{name:'过程映像 (105)',exact:true})).toBeVisible();
 await expect(page.getByRole('dialog',{name:'覆盖已有 IGH 配置？',exact:true})).toHaveCount(0);
 await page.getByRole('button',{name:'撤销',exact:true}).click();await expect(page.getByRole('tab',{name:'从站 (0)',exact:true})).toBeVisible();
});
test('existing IGH requires confirmation before either master changes; actions align right',async({page})=>{
 await page.goto('/');await page.getByRole('button',{name:'打开示例',exact:true}).click();await expect(page.locator('.project-name strong')).toHaveText('Talon');
 await page.getByRole('menuitem',{name:'总线配置',exact:true}).click();
 const revision=await page.locator('.shell').getAttribute('data-project-revision');
 await chooseEni(page);const dialog=page.getByRole('dialog',{name:'覆盖已有 IGH 配置？',exact:true});await expect(dialog).toBeVisible();
 await dialog.getByRole('button',{name:/取\s*消/}).click();await expect(page.locator('.shell')).toHaveAttribute('data-project-revision',revision!);
 await expect(page.getByRole('tab',{name:'过程映像 (77)',exact:true})).toBeVisible();
 await chooseEni(page);await dialog.getByRole('button',{name:'覆盖并导入',exact:true}).click();
 await expect(page.getByRole('tab',{name:'过程映像 (105)',exact:true})).toBeVisible();
 const heading=await page.getByRole('heading',{name:'主站配置',exact:true}).boundingBox(),importButton=await page.getByRole('button',{name:'导入 ENI',exact:true}).boundingBox();
 expect(importButton!.x).toBeGreaterThan(heading!.x+heading!.width);expect(Math.abs(importButton!.y-heading!.y)).toBeLessThan(60);
 const toolbar=await page.locator('.master-primary-actions').boundingBox(),disable=await page.getByRole('button',{name:'停用当前主站',exact:true}).boundingBox();
 expect(Math.abs(toolbar!.x+toolbar!.width-disable!.x-disable!.width)).toBeLessThan(2);
 await expect(page.locator('.master-actions')).toHaveCount(0);
 const exportButton=page.getByRole('button',{name:'导出 ROCOS-IGH 主站文件',exact:true});
 await expect(page.locator('.master-primary-actions').getByRole('button',{name:'导出 ROCOS-IGH 主站文件',exact:true})).toBeVisible();
 expect((await exportButton.boundingBox())!.y).toBe(importButton!.y);
 expect(disable!.y).toBe(importButton!.y);
 await page.screenshot({path:'test-results/master-eni-actions.png'});
 await page.getByRole('tab',{name:'ECM',exact:true}).click();await expect(exportButton).toHaveCount(0);await expect(page.locator('.master-primary-actions').getByRole('button',{name:'导入 ENI',exact:true})).toBeVisible();await expect(page.getByRole('tab',{name:'过程映像 (91)',exact:true})).toBeVisible();
 await page.getByRole('tab',{name:'ENI 原文 · 只读',exact:true}).click();
 for(const width of [390,1024,1440]){await page.setViewportSize({width,height:1000});expect(await page.locator('body').evaluate(el=>el.scrollWidth<=innerWidth)).toBe(true);}
});

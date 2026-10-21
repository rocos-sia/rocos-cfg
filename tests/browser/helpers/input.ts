import { expect, type Locator, type Page } from '@playwright/test';
export type InputMode='keyboard'|'touch';
export async function tabTo(page:Page,target:Locator,backward=false){
  await expect(target).toBeVisible();
  const trail=new Set<string>();
  for(const direction of backward?['Shift+Tab','Tab']:['Tab','Shift+Tab'])for(let i=0;i<120;i++){
    trail.add(await page.evaluate(()=>document.activeElement?.tagName+':'+document.activeElement?.getAttribute('role')+':'+document.activeElement?.textContent?.trim().slice(0,35)));
    if(await target.evaluate(el=>el===document.activeElement||el.contains(document.activeElement)))return;
    await page.keyboard.press(direction);
    await page.evaluate(()=>new Promise<void>(resolve=>requestAnimationFrame(()=>resolve())));
  }
  throw new Error('Not reachable with Tab: '+await target.evaluate(el=>el.outerHTML.slice(0,350))+'; visited: '+[...trail].join(' | ')+'; active: '+await page.evaluate(()=>document.activeElement?.outerHTML.slice(0,350)));
}
export async function activate(page:Page,target:Locator,mode:InputMode){
  if(mode==='touch')await target.tap();else{await tabTo(page,target,await target.evaluate(el=>!!el.closest('header')));await page.keyboard.press('Enter');}
}
export async function edit(page:Page,target:Locator,value:string,mode:InputMode){
  if(mode==='touch')await target.tap();else await tabTo(page,target);
  await page.keyboard.press('ControlOrMeta+A');await page.keyboard.insertText(value);await page.keyboard.press('Tab');
}
export async function navigate(page:Page,label:string,mode:InputMode){
  if(mode==='touch')await page.getByRole('menuitem',{name:label,exact:true}).tap();
  else {
    const labels=['工程总览','主站配置','机器人模型','硬件与绑定','APP 配置','校验与导出'];
    await tabTo(page,page.getByRole('menu'),true);await page.keyboard.press('Home');
    await expect(page.getByRole('menuitem',{name:labels[0],exact:true})).toBeFocused();
    for(let i=0;i<labels.indexOf(label);i++){await page.keyboard.press('ArrowDown');await expect(page.getByRole('menuitem',{name:labels[i+1],exact:true})).toBeFocused();}
    await page.keyboard.press('Enter');
  }
  await expect(page.getByRole('heading',{name:label,exact:true})).toBeVisible();
}

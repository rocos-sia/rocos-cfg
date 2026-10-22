import { expect, test, type Page } from '@playwright/test';
import { previewProject } from '../fixtures/preview';
import { saveProject } from '../../src/core/project/archive';
import { projectSnapshot } from './helpers/project';
import { renderedFrame } from './helpers/preview';

async function open(page:Page){
 await page.goto('/');await page.locator('input[type=file]').first().setInputFiles({name:'pose.rcproj',mimeType:'application/zip',buffer:Buffer.from(await saveProject(previewProject()))});
 await page.getByRole('menuitem',{name:'应用配置',exact:true}).click();await page.getByRole('tab',{name:'模型',exact:true}).click();
 await expect(page.locator('.robot-preview canvas')).toBeVisible();
 await page.getByRole('button',{name:'展开视图',exact:true}).click();
 await page.getByRole('button',{name:'俯视',exact:true}).click();
}
async function blueLink(page:Page){
 return page.locator('.robot-preview canvas').evaluate(el=>new Promise<{x:number;y:number}>((resolve,reject)=>requestAnimationFrame(()=>{
  const canvas=el as HTMLCanvasElement,gl=canvas.getContext('webgl2')!,pixels=new Uint8Array(canvas.width*canvas.height*4);gl.readPixels(0,0,canvas.width,canvas.height,gl.RGBA,gl.UNSIGNED_BYTE,pixels);
  const points:{x:number;y:number}[]=[];
  for(let y=canvas.height*.2|0;y<canvas.height*.8;y+=2)for(let x=canvas.width*.15|0;x<canvas.width*.85;x+=2){const i=(y*canvas.width+x)*4;if(pixels[i+2]>pixels[i]*1.6&&pixels[i+2]>pixels[i+1]*1.25)points.push({x,y});}
  if(!points.length){reject(Error('No visible blue link'));return;}
  const mean=points.reduce((a,p)=>({x:a.x+p.x/points.length,y:a.y+p.y/points.length}),{x:0,y:0});
  const point=points.sort((a,b)=>(a.x-mean.x)**2+(a.y-mean.y)**2-(b.x-mean.x)**2-(b.y-mean.y)**2)[0];
  const b=canvas.getBoundingClientRect();resolve({x:b.x+point.x/canvas.width*b.width,y:b.y+(1-point.y/canvas.height)*b.height});
 })));
}

test('tree joint slider fades, reopens on the same joint and reset ends the single toolbar',async({page})=>{
 await open(page);await page.getByRole('button',{name:'退出展开视图',exact:true}).click();
 const before=await projectSnapshot(page),slider=page.getByRole('slider',{name:'关节预览位置',exact:true});
 await expect(slider).toHaveCount(0);await expect(page.getByRole('combobox',{name:'预览关节',exact:true})).toHaveCount(0);
 const buttons=page.getByRole('group',{name:'显示选项',exact:true}).getByRole('button');await expect(buttons.last()).toHaveAttribute('aria-label','重置姿态');
 await page.getByText('joint_1 [revolute]',{exact:true}).click();await expect(slider).toBeVisible();
 await slider.focus();await slider.press('End');await expect(slider).toHaveAttribute('aria-valuenow','1');
 const canvas=page.locator('.robot-preview canvas'),b=(await canvas.boundingBox())!;
 await canvas.click({position:{x:b.width-24,y:b.height/2}});await expect(slider).toHaveCount(0);
 await page.getByText('joint_1 [revolute]',{exact:true}).click();await expect(slider).toBeVisible();await expect(slider).toHaveAttribute('aria-valuenow','1');
 await page.getByRole('button',{name:'重置姿态',exact:true}).click();await expect(slider).toHaveAttribute('aria-valuenow','0');
 expect(await projectSnapshot(page)).toBe(before);await page.screenshot({path:'test-results/joint-slider-popover.png'});
});

test('link dragging poses the joint without orbiting, double-click tints only the selection, cancel restores pose',async({page})=>{
 await open(page);const before=await projectSnapshot(page),canvas=page.locator('.robot-preview canvas'),surface=page.locator('.robot-preview');
 let point=await blueLink(page);await page.mouse.click(point.x,point.y);await expect(surface).toHaveAttribute('data-selected','link:visual_arm');
 const neutral=await renderedFrame(canvas);
 await page.mouse.dblclick(point.x,point.y);await expect(surface).toHaveAttribute('data-highlighted-link','visual_arm');
 await expect.poll(async()=>Buffer.compare(neutral,await renderedFrame(canvas))).not.toBe(0);
 await page.mouse.move(point.x,point.y);await page.mouse.down();await page.mouse.move(point.x+70,point.y-60,{steps:12});await page.mouse.up();
 await page.screenshot({path:'test-results/link-drag-pose.png'});
 await page.getByRole('button',{name:'退出展开视图',exact:true}).click();await page.getByText('joint_1 [revolute]',{exact:true}).click();
 const slider=page.getByRole('slider',{name:'关节预览位置',exact:true});await expect(slider).toBeVisible();
 const value=Number(await slider.getAttribute('aria-valuenow'));expect(Math.abs(value)).toBeGreaterThan(.02);expect(value).toBeGreaterThanOrEqual(-1);expect(value).toBeLessThanOrEqual(1);
 await page.getByRole('button',{name:'重置姿态',exact:true}).click();await page.getByRole('button',{name:'展开视图',exact:true}).click();
 point=await blueLink(page);await page.mouse.click(point.x,point.y);
 await expect.poll(async()=>Buffer.compare(neutral,await renderedFrame(canvas))).toBe(0);
 await page.mouse.move(point.x,point.y);await page.mouse.down();await page.mouse.move(point.x-80,point.y+70,{steps:10});await page.keyboard.press('Escape');await page.mouse.up();
 await expect(page.getByRole('dialog',{name:'模型展开视图',exact:true})).toBeVisible();
 await expect.poll(async()=>Buffer.compare(neutral,await renderedFrame(canvas))).toBe(0);
 expect(await projectSnapshot(page)).toBe(before);
});

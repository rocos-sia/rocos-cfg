import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { jointDrag, tintLink } from '../src/components/previewInteraction';
const bounds={left:0,top:0,width:800,height:800};
function camera(position=new THREE.Vector3(0,0,5)){
 const c=new THREE.PerspectiveCamera(40,1,.01,100);c.position.copy(position);c.up.set(0,1,0);c.lookAt(0,0,0);c.updateMatrixWorld(true);return c;
}
const pixel=(v:THREE.Vector3,c:THREE.Camera)=>{const p=v.clone().project(c);return {x:(p.x+1)*400,y:(1-p.y)*400};};
describe('preview joint drag',()=>{
 it('rotates about the world joint axis, unwraps angles and clamps limits',()=>{
  const c=camera(),point=new THREE.Vector3(1,0,0),start=pixel(point,c);
  const update=jointDrag({camera:c,bounds,origin:new THREE.Vector3(),axis:new THREE.Vector3(0,0,1),point,...start,value:0,min:-2,max:2,prismatic:false});
  let p=pixel(new THREE.Vector3(0,1,0),c);expect(update(p.x,p.y)).toBeCloseTo(Math.PI/2);
  p=pixel(new THREE.Vector3(-1,.01,0),c);expect(update(p.x,p.y)).toBe(2);
  p=pixel(new THREE.Vector3(-1,-.01,0),c);expect(update(p.x,p.y)).toBe(2);
 });
 it('uses transformed axes for prismatic movement and respects limits',()=>{
  const c=camera(),origin=new THREE.Vector3(.1,0,0),point=origin.clone(),start=pixel(point,c);
  const update=jointDrag({camera:c,bounds,origin,axis:new THREE.Vector3(0,1,0),point,...start,value:.2,min:0,max:.5,prismatic:true});
  let p=pixel(point.clone().add(new THREE.Vector3(0,.1,0)),c);expect(update(p.x,p.y)).toBeCloseTo(.3);
  p=pixel(point.clone().add(new THREE.Vector3(0,1,0)),c);expect(update(p.x,p.y)).toBe(.5);
 });
 it('handles an edge-on rotation without unstable plane intersections',()=>{
  const c=camera(new THREE.Vector3(0,-5,0)),point=new THREE.Vector3(0,-1,0),start=pixel(point,c);
  const update=jointDrag({camera:c,bounds,origin:new THREE.Vector3(),axis:new THREE.Vector3(0,0,1),point,...start,value:0,min:-1,max:1,prismatic:false});
  expect(update(start.x,start.y)).toBe(0);expect(update(start.x+30,start.y)).toBeGreaterThan(0);expect(update(start.x+10000,start.y)).toBe(1);
 });
 it('darkens only the picked link, restoring shared authored materials exactly',()=>{
  const material=new THREE.MeshPhongMaterial({color:0xabcdef,opacity:.5,transparent:true});
  const link=new THREE.Group(),child=new THREE.Group();Object.assign(child,{isURDFLink:true});
  const own=new THREE.Mesh(new THREE.BoxGeometry(),material),descendant=new THREE.Mesh(new THREE.BoxGeometry(),material);link.add(own,child);child.add(descendant);
  const restore=tintLink(link);expect(own.material).not.toBe(material);expect(descendant.material).toBe(material);expect(own.material.color.r).toBeLessThan(material.color.r);
  expect(own.material.opacity).toBe(.5);restore();expect(own.material).toBe(material);
 });
});

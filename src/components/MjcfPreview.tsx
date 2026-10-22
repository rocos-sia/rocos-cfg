import { t } from '../i18n';
import { compileMjcf } from '../adapters/mujoco';
import { useEffect, useRef, useState } from 'react';
import { Alert } from 'antd';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { ProjectFile } from '../core/project/types';

/** MuJoCo compiles the model; Three displays its resolved world-space geometry. */
export function MjcfPreview({files,path}:{files:ProjectFile[];path:string}) {
 const host=useRef<HTMLDivElement>(null),[error,setError]=useState(''),[loading,setLoading]=useState(true);
 useEffect(()=>{
  let disposed=false,cleanup=()=>{};
  setError('');setLoading(true);
  void (async()=>{
   const {mj,model}=await compileMjcf(files,path);
   if(disposed){model.delete();return;}
   let data:any;
   try{data=new mj.MjData(model);mj.mj_forward(model,data);}catch(e){data?.delete();model.delete();throw e;}
   const scene=new THREE.Scene();scene.background=new THREE.Color('#182437');
   const renderer=new THREE.WebGLRenderer({antialias:true});host.current!.appendChild(renderer.domElement);
   const camera=new THREE.PerspectiveCamera(45,1,.001,10000);camera.up.set(0,0,1);
   const controls=new OrbitControls(camera,renderer.domElement);
   scene.add(new THREE.HemisphereLight(0xffffff,0x667788,3));const light=new THREE.DirectionalLight(0xffffff,3);light.position.set(3,-4,5);scene.add(light);
   const group=new THREE.Group();scene.add(group);
   for(let i=0;i<model.ngeom;i++){
    const size=Array.from(model.geom_size.slice(i*3,i*3+3)) as number[],type=model.geom_type[i];let geometry:THREE.BufferGeometry;
    if(type===7){const id=model.geom_dataid[i],v=model.mesh_vertadr[id],n=model.mesh_vertnum[id],f=model.mesh_faceadr[id],count=model.mesh_facenum[id];geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute(model.mesh_vert.slice(v*3,(v+n)*3),3));geometry.setIndex(Array.from(model.mesh_face.slice(f*3,(f+count)*3)));geometry.computeVertexNormals();}
    else if(type===6)geometry=new THREE.BoxGeometry(size[0]*2,size[1]*2,size[2]*2);
    else if(type===0)geometry=new THREE.PlaneGeometry(size[0]?size[0]*2:10,size[1]?size[1]*2:10);
    else if(type===2||type===4){geometry=new THREE.SphereGeometry(1,24,16);geometry.scale(size[0],type===2?size[0]:size[1],type===2?size[0]:size[2]);}
    else if(type===3){geometry=new THREE.CapsuleGeometry(size[0],size[1]*2,8,16);geometry.rotateX(Math.PI/2);}
    else if(type===5){geometry=new THREE.CylinderGeometry(size[0],size[0],size[1]*2,24);geometry.rotateX(Math.PI/2);}
    else continue;
    const rgba=model.geom_rgba.slice(i*4,i*4+4),material=new THREE.MeshStandardMaterial({color:new THREE.Color(rgba[0],rgba[1],rgba[2]),opacity:rgba[3],transparent:rgba[3]<1,side:THREE.DoubleSide});
    const mesh=new THREE.Mesh(geometry,material),r=data.geom_xmat.slice(i*9,i*9+9);
    mesh.position.fromArray(data.geom_xpos,i*3);mesh.quaternion.setFromRotationMatrix(new THREE.Matrix4().set(r[0],r[1],r[2],0,r[3],r[4],r[5],0,r[6],r[7],r[8],0,0,0,0,1));mesh.userData.ground=type===0;group.add(mesh);
   }
   group.updateMatrixWorld(true);const box=new THREE.Box3();for(const mesh of group.children)if(!mesh.userData.ground)box.expandByObject(mesh);
   const center=box.isEmpty()?new THREE.Vector3():box.getCenter(new THREE.Vector3()),radius=box.isEmpty()?1:Math.max(.1,box.getSize(new THREE.Vector3()).length()/2);
   controls.target.copy(center);let fitted=false;
   const render=()=>{if(!disposed){const el=host.current!;renderer.setSize(el.clientWidth,400);camera.aspect=el.clientWidth/400;camera.updateProjectionMatrix();if(!fitted){const angle=Math.atan(Math.tan(Math.PI/8)*Math.min(1,camera.aspect));camera.position.copy(center).add(new THREE.Vector3(1,-1,1).normalize().multiplyScalar(radius*1.3/Math.sin(angle)));fitted=true;controls.update();}renderer.render(scene,camera);}};
   controls.addEventListener('change',render);const observer=new ResizeObserver(render);observer.observe(host.current!);render();
   cleanup=()=>{observer.disconnect();controls.dispose();group.traverse(o=>{if(o instanceof THREE.Mesh){o.geometry.dispose();o.material.dispose();}});renderer.dispose();renderer.domElement.remove();data.delete();model.delete();};
   setLoading(false);
  })().catch(e=>{if(!disposed){setError(String(e));setLoading(false);}});
  return()=>{disposed=true;cleanup();};
 },[files,path]);
 return <>{loading&&<p role="status">{t("正在使用 MuJoCo WASM 编译模型…")}</p>}{error&&<Alert type="error" message={t("MJCF 加载失败")} description={error}/>}<div ref={host} className="mjcf-preview" style={{height:400,width:'100%'}}/><p className="muted">{t("MuJoCo 编译后的静态几何预览；支持旋转、缩放。未运行控制程序，纹理及高度场暂不显示。")}</p></>;
}

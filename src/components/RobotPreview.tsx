import { m as msg, MessageError, errorMessage, messageFields, joinMessages, type MessageInput } from '../core/project/messages';
import { diagnosticText, t, useLocale } from '../i18n';
import { useEffect, useRef, useState } from 'react';
import { Alert, Button, Select, Slider, Space } from 'antd';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import URDFLoader, { type URDFRobot } from 'urdf-loader';
import { type Project, textOf, fileById } from '../core/project/types';
import { resourceResolver } from '../core/project/resources';
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js';
import { ColladaLoader } from 'three/examples/jsm/loaders/ColladaLoader.js';
import type { RobotModel } from '../core/documents/urdf';
import { previewPose, type PreviewPose } from './previewPose';

function disposeObject(object: THREE.Object3D) {
  object.traverse(node => {
    if (node instanceof THREE.Mesh || node instanceof THREE.LineSegments) {
      node.geometry.dispose();
      for (const material of Array.isArray(node.material) ? node.material : [node.material]) {
        for (const value of Object.values(material)) if (value instanceof THREE.Texture) value.dispose();
        material.dispose();
      }
    }
  });
}
class PreviewError extends MessageError {
  constructor(source:string,values:Record<string,string|number>){super(msg(source,values));}
}
type PreviewMessage=MessageInput;
const previewError=(error:unknown):PreviewMessage=>{
  const detail=messageFields(errorMessage(error,!(error instanceof PreviewError)));
  return error instanceof PreviewError?detail:msg('模型预览失败：{error}',{error:detail.text||detail.message});
};
interface Runtime {
  scene: THREE.Scene; renderer: THREE.WebGLRenderer; camera: THREE.PerspectiveCamera;
  controls: OrbitControls; model?: URDFRobot; highlight?: THREE.BoxHelper; fit: (view?: string) => void;
}
interface PoseSnapshot extends PreviewPose { projectId: string; fileId: string }
export function createPreviewState() {
  return {
    pose: { current: undefined as PoseSnapshot | undefined }, touched: { current: false }, joint: '',
    camera: undefined as { position: number[]; target: number[]; far: number } | undefined,
  };
}
export function RobotPreview({ project, robot, selected = '', onSelect, viewState }: { project: Project; robot:RobotModel; selected?: string; onSelect?: (key: string) => void; viewState?: ReturnType<typeof createPreviewState> }) {
  const locale=useLocale();
  const host = useRef<HTMLDivElement>(null), runtime = useRef<Runtime | null>(null);
  const localState = useRef(createPreviewState()), memory = viewState || localState.current;
  const previousPose = memory.pose, viewTouched = memory.touched;
  const select = useRef(onSelect); select.current = onSelect;
  const selection = useRef(selected); selection.current = selected;
  const [error, setError] = useState<PreviewMessage>(''), [poseJoint, setPoseJoint] = useState(memory.joint), [pose, setPose] = useState<Record<string, number>>(previousPose.current?.values || {});
  const file = fileById(project, project.entrypoints.urdf), source = file ? textOf(file) : '';
  const joints=robot.joints.filter(j => ['revolute', 'continuous', 'prismatic'].includes(j.type) && !j.mimic);
  const current = joints.find(j => j.name === poseJoint) || joints.find(j => `joint:${j.name}` === selected) || joints[0];
  const min = current?.type === 'continuous' ? -Math.PI : Number(current?.lower);
  const max = current?.type === 'continuous' ? Math.PI : Number(current?.upper);
  const validLimits = !!current && (current.type === 'continuous' || !!current.lower && !!current.upper) && Number.isFinite(min) && Number.isFinite(max) && min < max;
  const highlight = () => {
    const r = runtime.current; if (!r) return;
    if (r.highlight) { r.scene.remove(r.highlight); disposeObject(r.highlight); r.highlight = undefined; }
    const key = selection.current, name = key.slice(key.indexOf(':') + 1);
    const object = key.startsWith('joint:') ? r.model?.joints[name] : r.model?.links[name];
    if (object) { r.highlight = new THREE.BoxHelper(object, 0x2563eb); r.scene.add(r.highlight); }
  };
  useEffect(() => {
    const node = host.current!; let renderer: THREE.WebGLRenderer;
    try { renderer = new THREE.WebGLRenderer({ antialias: true }); }
    catch { setError('当前环境无法创建 WebGL 预览，仍可编辑模型结构。'); return; }
    renderer.domElement.setAttribute('aria-label', t("机器人三维预览"));
    const scene = new THREE.Scene(); scene.background = new THREE.Color('#f8f9fa');
    const camera = new THREE.PerspectiveCamera(40, 1, .001, 1000); camera.up.set(0, 0, 1); camera.position.set(2, 2, 1.5);
    const controls = new OrbitControls(camera, renderer.domElement); controls.target.set(0, 0, .4); controls.update();
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2)); node.appendChild(renderer.domElement);
    scene.add(new THREE.HemisphereLight(0xffffff, 0x667788, 2.5));
    const light = new THREE.DirectionalLight(0xffffff, 3); light.position.set(3, 2, 5); scene.add(light);
    const grid = new THREE.GridHelper(4, 40, 0xa9b8cb, 0xdce3ec); grid.rotation.x = Math.PI / 2; scene.add(grid); scene.add(new THREE.AxesHelper(.5));
    const fit = (view = 'iso') => {
      const box = runtime.current?.model ? new THREE.Box3().setFromObject(runtime.current.model) : new THREE.Box3();
      const center = box.isEmpty() ? new THREE.Vector3(0, 0, .3) : box.getCenter(new THREE.Vector3());
      const size = box.isEmpty() ? 1 : Math.max(box.getSize(new THREE.Vector3()).length(), .2);
      const direction = view === 'front' ? new THREE.Vector3(0, -1, .0001) : view === 'side' ? new THREE.Vector3(1, 0, .0001) : view === 'top' ? new THREE.Vector3(.0001, 0, 1) : new THREE.Vector3(1, -1, .8);
      camera.position.copy(center).add(direction.normalize().multiplyScalar(size * 1.8)); camera.far = Math.max(1000, size * 20); camera.updateProjectionMatrix();
      controls.target.copy(center); controls.update();
    };
    const touchView = () => { viewTouched.current = true; };
    controls.addEventListener('start', touchView);
    runtime.current = { scene, renderer, camera, controls, fit };
    if (memory.camera && previousPose.current?.projectId === project.id && previousPose.current?.fileId === file?.id) {
      camera.position.fromArray(memory.camera.position); camera.far = memory.camera.far;
      controls.target.fromArray(memory.camera.target); camera.updateProjectionMatrix(); controls.update();
    }
    let down = new THREE.Vector2();
    const pointerDown = (event: PointerEvent) => { down.set(event.clientX, event.clientY); };
    const pointerUp = (event: PointerEvent) => {
      const r = runtime.current; if (!r?.model || down.distanceTo(new THREE.Vector2(event.clientX, event.clientY)) > 5) return;
      const bounds = renderer.domElement.getBoundingClientRect();
      const ray = new THREE.Raycaster(); ray.setFromCamera(new THREE.Vector2((event.clientX - bounds.left) / bounds.width * 2 - 1, -(event.clientY - bounds.top) / bounds.height * 2 + 1), camera);
      let object: THREE.Object3D | null = ray.intersectObject(r.model, true)[0]?.object || null;
      while (object) {
        if ('isURDFLink' in object && 'urdfName' in object) { select.current?.(`link:${object.urdfName}`); return; }
        object = object.parent;
      }
    };
    renderer.domElement.addEventListener('pointerdown', pointerDown); renderer.domElement.addEventListener('pointerup', pointerUp);
    const observer = new ResizeObserver(() => { const w = Math.max(node.clientWidth, 1), h = Math.max(node.clientHeight, 1); renderer.setSize(w, h); camera.aspect = w / h; camera.updateProjectionMatrix(); }); observer.observe(node);
    renderer.setAnimationLoop(() => { runtime.current?.highlight?.update(); renderer.render(scene, camera); });
    return () => {
      memory.camera = { position: camera.position.toArray(), target: controls.target.toArray(), far: camera.far };
      observer.disconnect(); renderer.setAnimationLoop(null); controls.removeEventListener('start', touchView); controls.dispose(); disposeObject(scene); renderer.dispose(); node.replaceChildren(); runtime.current = null;
    };
  }, []);
  useEffect(() => {
    const r = runtime.current; if (!r || !file) return;
    let disposed = false; const urls: string[] = []; setError('');
    const sameModel = previousPose.current?.projectId === project.id && previousPose.current?.fileId === file.id;
    if (!sameModel) viewTouched.current = false;
    const resolve = resourceResolver(project);
    const managerFor = (sourceId: string) => {
      const manager = new THREE.LoadingManager();
      manager.setURLModifier(url => {
        if (url.startsWith('data:')) return url;
        const asset = resolve(sourceId, url);
        if (!asset) { if (!disposed) setError(msg('缺少或外部模型资源：{path}。结构编辑仍可继续。',{path:url})); return 'data:application/octet-stream;base64,'; }
        const blob = URL.createObjectURL(new Blob([new Uint8Array(asset.bytes).buffer])); urls.push(blob); return blob;
      });
      manager.onLoad = () => { if (!disposed) { if (!sameModel && !viewTouched.current) r.fit(); highlight(); } };
      manager.onError = () => { if (!disposed) setError('部分模型资源无法加载，请核对文件与路径。'); };
      return manager;
    };
    const manager = managerFor(file.id);
    try {
      if (robot.errors.length) throw new MessageError(joinMessages(robot.issues));
      const loader = new URDFLoader(manager); loader.packages = name => `package://${name}`;
      loader.loadMeshCb = (url, _, done) => {
        try {
          const asset = resolve(file.id, url);
          if (!asset) throw new PreviewError('Mesh 尚未纳入工程：{path}',{path:url});
          if (/\.stl$/i.test(asset.path)) {
            const geometry = new STLLoader().parse(new Uint8Array(asset.bytes).buffer);
            done(new THREE.Mesh(geometry, new THREE.MeshPhongMaterial()));
          } else if (/\.dae$/i.test(asset.path)) {
            // A per-document manager resolves texture URIs against the DAE's
            // virtual file and explicit mappings, never the URDF or a Blob URL.
            const scene = new ColladaLoader(managerFor(asset.id)).parse(textOf(asset), '').scene;
            scene.traverse(object => {
              if (object instanceof THREE.Mesh && !object.geometry.getAttribute('normal')) object.geometry.computeVertexNormals();
            });
            done(scene);
          } else throw new PreviewError('预览支持 STL / DAE，当前资源仅保留：{path}',{path:asset.path});
        } catch (error) { if (!disposed) setError(previewError(error)); done(new THREE.Group(), error as Error); }
      };
      r.model = loader.parse(source);
      const nextPose = previewPose(joints, sameModel ? previousPose.current : undefined);
      r.model.setJointValues(nextPose.values);
      previousPose.current = { ...nextPose, projectId: project.id, fileId: file.id };
      r.scene.add(r.model); if (!sameModel) r.fit(); highlight();
      setPose(nextPose.values);
      memory.joint = sameModel && joints.some(j => j.name === memory.joint) ? memory.joint : '';
      setPoseJoint(memory.joint);
    } catch (error) { setError(previewError(error)); }
    return () => {
      disposed = true; urls.forEach(url => URL.revokeObjectURL(url));
      if (r.highlight) { r.scene.remove(r.highlight); disposeObject(r.highlight); r.highlight = undefined; }
      if (r.model) { r.scene.remove(r.model); disposeObject(r.model); r.model = undefined; }
    };
  }, [source, project.id, file?.id, project.files, project.packageMap]);
  useEffect(()=>{runtime.current?.renderer.domElement.setAttribute('aria-label',t('机器人三维预览'));},[locale]);
  useEffect(highlight, [selected]);
  const applyPose = (values: Record<string, number>) => {
    viewTouched.current = true;
    runtime.current?.model?.setJointValues(values);
    if (previousPose.current) previousPose.current.values = values;
    setPose(values);
  };
  const setJoint = (name: string, value: number) => applyPose({ ...pose, [name]: value });
  const fitView = (view?: string) => { viewTouched.current = true; runtime.current?.fit(view); };
  return <>
    <div className="robot-preview" ref={host} data-selected={selected} />
    {error && <Alert type="warning" message={typeof error==='string'?t(error):diagnosticText(error)} />}
    <Space wrap className="space-top"><Button size="small" onClick={() => fitView()}>{t("适应模型")}</Button>{[['front', t("正视")], ['side', t("侧视")], ['top', t("俯视")]].map(([key, label]) => <Button size="small" key={key} onClick={() => fitView(key)}>{label}</Button>)}<Button size="small" onClick={() => applyPose(previewPose(joints).values)}>{t("重置姿态")}</Button></Space>
    {!!joints.length && <div className="space-top"><Select aria-label={t("预览关节")} style={{ width: '100%' }} value={current?.name} options={joints.map(j => ({ value: j.name, label: `${j.name} · ${j.type === 'prismatic' ? 'm' : 'rad'}` }))} onChange={name => { memory.joint = name; setPoseJoint(name); }} />
      <Slider ariaLabelForHandle={t("关节预览位置")} disabled={!validLimits} min={validLimits ? min : 0} max={validLimits ? max : 1} step={.001} value={pose[current?.name] ?? 0} onChange={value => current && setJoint(current.name, value)} />
      <small>{t("仅改变预览姿态，不写入 URDF 或驱动器参数。")}</small>
    </div>}
  </>;
}

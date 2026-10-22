import { m as msg, MessageError, errorMessage, messageFields, joinMessages, type MessageInput } from '../core/project/messages';
import { diagnosticText, t, useLocale } from '../i18n';
import { useEffect, useRef, useState } from 'react';
import { Alert, Button, Select, Slider, Space } from 'antd';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import URDFLoader, { type URDFRobot, type URDFJoint } from 'urdf-loader';
import { type Project, textOf, fileById } from '../core/project/types';
import { resourceResolver } from '../core/project/resources';
import { collectReferences } from '../core/project/references';
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js';
import { ColladaLoader } from 'three/examples/jsm/loaders/ColladaLoader.js';
import type { RobotModel } from '../core/documents/urdf';
import { previewPose } from './previewPose';
import { createPreviewState, type GeometryMode } from './modelViewState';
import { ModelViewport } from './ModelViewport';
import { disposeObject, visibleBounds, previewBounds, fitPreviewCamera, hasJointAxis, missingMeshPlaceholder, normalizePlaceholders, validMeshGeometry, updateJointAxis, updateJointConnection } from './previewGeometry';
import { previewMeshReferences, uniqueOwners, type PreviewResourceProblem, type GeometryOwner } from './previewResources';

function applyGeometry(model: THREE.Object3D, mode: GeometryMode) {
  model.traverse(node => {
    if ('isURDFVisual' in node) node.visible = mode === 'visual';
    if ('isURDFCollider' in node) node.visible = mode === 'collision';
  });
}
function isVisible(object: THREE.Object3D) {
  for (let node: THREE.Object3D | null = object; node; node = node.parent) if (!node.visible) return false;
  return true;
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
  grid: THREE.GridHelper; axis: THREE.ArrowHelper; connection: THREE.Line; axisJoint?: URDFJoint; axisLength: number;
  controls: OrbitControls; model?: URDFRobot; highlight?: THREE.Box3Helper; highlightTarget?: THREE.Object3D; fit: (view?: string) => void;
}
export function RobotPreview({ project, robot, selected = '', onSelect, onExpandedChange, viewState, dark = false }: { project: Project; robot:RobotModel; selected?: string; onSelect?: (key: string) => void; onExpandedChange?: (expanded: boolean) => void; viewState?: ReturnType<typeof createPreviewState>; dark?: boolean }) {
  const locale=useLocale();
  const host = useRef<HTMLDivElement>(null), runtime = useRef<Runtime | null>(null);
  const localState = useRef(createPreviewState()), memory = viewState || localState.current;
  const previousPose = memory.pose, viewTouched = memory.touched;
  const [geometry, setGeometry] = useState<GeometryMode>(memory.geometry);
  const [hasCollision, setHasCollision] = useState(true);
  const [problems, setProblems] = useState<PreviewResourceProblem[]>([]);
  const geometryRef = useRef(geometry); geometryRef.current = geometry;
  const select = useRef(onSelect); select.current = onSelect;
  const selection = useRef(selected); selection.current = selected;
  const [error, setError] = useState<PreviewMessage>(''), [poseJoint, setPoseJoint] = useState(memory.joint), [pose, setPose] = useState<Record<string, number>>(previousPose.current?.values || {});
  const file = fileById(project, project.entrypoints.urdf), source = file ? textOf(file) : '';
  const joints=robot.joints.filter(j => ['revolute', 'continuous', 'prismatic'].includes(j.type) && !j.mimic);
  const current = joints.find(j => j.name === poseJoint) || joints.find(j => `joint:${j.name}` === selected) || joints[0];
  const selectedJoint = selected.startsWith('joint:') ? robot.joints.find(j => `joint:${j.name}` === selected) : undefined;
  const min = current?.type === 'continuous' ? -Math.PI : Number(current?.lower);
  const max = current?.type === 'continuous' ? Math.PI : Number(current?.upper);
  const validLimits = !!current && (current.type === 'continuous' || !!current.lower && !!current.upper) && Number.isFinite(min) && Number.isFinite(max) && min < max;
  const highlight = () => {
    const r = runtime.current; if (!r) return;
    if (r.highlight) { r.scene.remove(r.highlight); disposeObject(r.highlight); r.highlight = undefined; r.highlightTarget = undefined; }
    const key = selection.current, name = key.slice(key.indexOf(':') + 1);
    r.axisJoint = key.startsWith('joint:') ? r.model?.joints[name] : undefined;
    r.axisLength = Math.max(.06, Math.min(previewBounds(r.model || new THREE.Group()).getSize(new THREE.Vector3()).length() * .25, 1));
    updateJointAxis(r.axis, r.axisJoint, r.axisLength); updateJointConnection(r.connection, r.axisJoint);
    const object = key.startsWith('joint:') ? r.model?.joints[name] : r.model?.links[name];
    if (object) { r.highlight = new THREE.Box3Helper(visibleBounds(object), 0x2563eb); r.highlight.visible = !r.highlight.box.isEmpty(); r.highlightTarget = object; r.scene.add(r.highlight); }
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
    const grid = new THREE.GridHelper(4, 40, 0xa9b8cb, 0xdce3ec); grid.rotation.x = Math.PI / 2; scene.add(grid); scene.add(new THREE.AxesHelper(.5).setColors(0xff0000, 0x00ff00, 0x0000ff));
    const fit = (view = 'iso') => {
      const box = runtime.current?.model ? previewBounds(runtime.current.model) : new THREE.Box3();
      const direction = view === 'front' ? new THREE.Vector3(0, -1, .0001) : view === 'side' ? new THREE.Vector3(1, 0, .0001) : view === 'top' ? new THREE.Vector3(.0001, 0, 1) : new THREE.Vector3(1, -1, .8);
      camera.aspect = Math.max(node.clientWidth, 1) / Math.max(node.clientHeight, 1);
      const center = fitPreviewCamera(camera, box, direction);
      controls.target.copy(center); controls.update();
    };
    const touchView = () => { viewTouched.current = true; };
    controls.addEventListener('start', touchView);
    const axis = new THREE.ArrowHelper(new THREE.Vector3(1, 0, 0), new THREE.Vector3(), .1, 0xd97706);
    for (const part of [axis.line, axis.cone]) {
      for (const material of Array.isArray(part.material) ? part.material : [part.material]) { material.depthTest = false; material.transparent = true; material.opacity = .95; }
      part.renderOrder = 999;
    }
    axis.visible = false; scene.add(axis);
    const connection = new THREE.Line(new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(6), 3)), new THREE.LineBasicMaterial({ color: 0x2563eb, depthTest: false, transparent: true, opacity: .85 }));
    connection.visible = false; connection.frustumCulled = false; connection.renderOrder = 998; scene.add(connection);
    runtime.current = { scene, renderer, camera, controls, grid, axis, connection, axisLength: .1, fit };
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
      let object: THREE.Object3D | null = ray.intersectObject(r.model, true).find(hit => isVisible(hit.object))?.object || null;
      while (object) {
        if ('isURDFLink' in object && 'urdfName' in object) { select.current?.(`link:${object.urdfName}`); return; }
        object = object.parent;
      }
    };
    renderer.domElement.addEventListener('pointerdown', pointerDown); renderer.domElement.addEventListener('pointerup', pointerUp);
    const observer = new ResizeObserver(() => { const w = Math.max(node.clientWidth, 1), h = Math.max(node.clientHeight, 1); renderer.setSize(w, h); camera.aspect = w / h; camera.updateProjectionMatrix(); }); observer.observe(node);
    renderer.setAnimationLoop(() => {
      const r = runtime.current;
      if (r?.highlight && r.highlightTarget) { r.highlight.box.copy(visibleBounds(r.highlightTarget)); r.highlight.visible = !r.highlight.box.isEmpty(); }
      if (r) { updateJointAxis(r.axis, r.axisJoint, r.axisLength); updateJointConnection(r.connection, r.axisJoint); }
      renderer.render(scene, camera);
    });
    return () => {
      memory.camera = { position: camera.position.toArray(), target: controls.target.toArray(), far: camera.far };
      observer.disconnect(); renderer.setAnimationLoop(null); controls.removeEventListener('start', touchView); controls.dispose(); disposeObject(scene); renderer.dispose(); node.replaceChildren(); runtime.current = null;
    };
  }, []);
  useEffect(() => {
    const r = runtime.current; if (!r || !file) return;
    let disposed = false; const urls: string[] = []; setError(''); setProblems([]);
    const sameModel = previousPose.current?.projectId === project.id && previousPose.current?.fileId === file.id;
    if (!sameModel) viewTouched.current = false;
    const references = collectReferences(project), resolve = resourceResolver(project, references);
    const document = new DOMParser().parseFromString(source, 'application/xml');
    const meshReferences = previewMeshReferences(document);
    const assetOwners = new Map<string, GeometryOwner[]>();
    for (const ref of meshReferences) {
      const asset = resolve(file.id, ref.uri);
      if (asset) assetOwners.set(asset.id, uniqueOwners([...(assetOwners.get(asset.id) || []), ref.owner]));
    }
    const registry = new Map<string, PreviewResourceProblem>();
    const report = (sourceId: string, uri: string, kind: 'mesh' | 'texture', reason: PreviewMessage) => {
      if (disposed) return;
      const owners = sourceId === file.id ? meshReferences.filter(ref => ref.uri === uri).map(ref => ref.owner) : assetOwners.get(sourceId) || [];
      registry.set(JSON.stringify([sourceId, uri, kind]), { sourceId, uri, kind, reason, owners: uniqueOwners(owners) });
      setProblems([...registry.values()]);
    };
    // Include declared DAE images even when no current material samples them.
    // The same reference graph drives portable export and APP resource mapping.
    for (const ref of references) {
      const texture = ref.sourceFileId === file.id ? /^texture\[/.test(ref.field) : assetOwners.has(ref.sourceFileId) && /^image\[/.test(ref.field);
      if (texture && ref.state !== 'internal') report(ref.sourceFileId, ref.original, 'texture', msg('缺少或外部模型资源：{path}。结构编辑仍可继续。', { path: ref.original }));
    }
    // Missing textures retain the mesh and use a local neutral replacement.
    const fallback = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"><path fill="#ffb347" d="M0 0h1v1H0z"/></svg>');
    const managerFor = (sourceId: string) => {
      const manager = new THREE.LoadingManager(), originals = new Map<string, string>();
      manager.setURLModifier(url => {
        // DAE init_from is XML text; the reference adapter trims its whitespace.
        if (sourceId !== file.id) url = url.trim();
        if (url.startsWith('data:')) { originals.set(url, url); return url; }
        const asset = resolve(sourceId, url);
        if (!asset) {
          report(sourceId, url, 'texture', msg('缺少或外部模型资源：{path}。结构编辑仍可继续。', { path: url }));
          return fallback;
        }
        const blob = URL.createObjectURL(new Blob([new Uint8Array(asset.bytes).buffer])); urls.push(blob);
        originals.set(blob, url); originals.set(url, url); return blob;
      });
      manager.onLoad = () => { if (!disposed) { if (!sameModel && !viewTouched.current) r.fit(); highlight(); } };
      manager.onError = url => {
        const original = originals.get(url) || url;
        if (original === fallback) return;
        report(sourceId, original, 'texture', original.startsWith('data:') ? '内嵌纹理无法解码。' : msg('模型资源无法加载：{path}', { path: original }));
      };
      return manager;
    };
    const manager = managerFor(file.id);
    try {
      if (robot.errors.length) throw new MessageError(joinMessages(robot.issues));
      const loader = new URDFLoader(manager); loader.parseCollision = true; loader.packages = name => `package://${name}`;
      loader.loadMeshCb = (url, _, done) => {
        try {
          const asset = resolve(file.id, url);
          if (!asset) throw new PreviewError('Mesh 尚未纳入工程：{path}',{path:url});
          if (/\.stl$/i.test(asset.path)) {
            const geometry = new STLLoader().parse(new Uint8Array(asset.bytes).buffer);
            if (!validMeshGeometry(geometry)) { geometry.dispose(); throw new PreviewError('STL 不包含有效三角形：{path}', { path: asset.path }); }
            done(new THREE.Mesh(geometry, new THREE.MeshPhongMaterial()));
          } else if (/\.dae$/i.test(asset.path)) {
            // A per-document manager resolves texture URIs against the DAE's
            // virtual file and explicit mappings, never the URDF or a Blob URL.
            const scene = new ColladaLoader(managerFor(asset.id)).parse(textOf(asset), '').scene;
            let valid = true, meshes = 0;
            scene.traverse(object => {
              if (object instanceof THREE.Mesh) {
                meshes++; valid = valid && validMeshGeometry(object.geometry);
                if (!object.geometry.getAttribute('normal')) object.geometry.computeVertexNormals();
              }
            });
            if (!valid || !meshes) { disposeObject(scene); throw new PreviewError('DAE 不包含可预览几何：{path}', { path: asset.path }); }
            done(scene);
          } else throw new PreviewError('预览支持 STL / DAE，当前资源仅保留：{path}',{path:asset.path});
        } catch (error) { report(file.id, url, 'mesh', previewError(error)); done(missingMeshPlaceholder()); }
      };
      r.model = loader.parse(document); normalizePlaceholders(r.model); applyGeometry(r.model, geometryRef.current);
      let collision = false; r.model.traverse(node => { if ('isURDFCollider' in node) collision = true; }); setHasCollision(collision);
      // Use the canonical URDF axis (including whitespace/default handling) for
      // the renderer as well as the form and diagnostics.
      for (const joint of robot.joints) {
        const rendered = r.model.joints[joint.name];
        if (rendered && hasJointAxis(joint.type)) rendered.axis.fromArray(joint.axis.trim().split(/\s+/).map(Number)).normalize();
      }
      const nextPose = previewPose(joints, sameModel ? previousPose.current : undefined);
      r.model.setJointValues(nextPose.values);
      previousPose.current = { ...nextPose, projectId: project.id, fileId: file.id };
      r.scene.add(r.model); if (!sameModel) { r.fit(); requestAnimationFrame(() => { if (!disposed && !viewTouched.current) r.fit(); }); } highlight();
      setPose(nextPose.values);
      memory.joint = sameModel && joints.some(j => j.name === memory.joint) ? memory.joint : '';
      setPoseJoint(memory.joint);
    } catch (error) { setError(previewError(error)); }
    return () => {
      disposed = true; r.axisJoint = undefined; r.axis.visible = false; r.connection.visible = false; urls.forEach(url => URL.revokeObjectURL(url));
      if (r.highlight) { r.scene.remove(r.highlight); disposeObject(r.highlight); r.highlight = undefined; r.highlightTarget = undefined; }
      if (r.model) { r.scene.remove(r.model); disposeObject(r.model); r.model = undefined; }
    };
  }, [source, project.id, file?.id, project.files, project.packageMap]);
  useEffect(()=>{runtime.current?.renderer.domElement.setAttribute('aria-label',t('机器人三维预览'));},[locale]);
  useEffect(() => {
    const r = runtime.current; if (r?.model) applyGeometry(r.model, geometry);
    memory.geometry = geometry; highlight();
  }, [geometry]);
  useEffect(() => {
    const r = runtime.current; if (!r) return;
    r.scene.background = new THREE.Color(dark ? '#111318' : '#f8f9fa');
    for (const material of Array.isArray(r.grid.material) ? r.grid.material : [r.grid.material]) {
      if (material instanceof THREE.LineBasicMaterial) {
        material.vertexColors = !dark; material.color.set(dark ? '#2c3542' : '#ffffff'); material.needsUpdate = true;
      }
    }
  }, [dark]);
  useEffect(highlight, [selected]);
  const applyPose = (values: Record<string, number>) => {
    viewTouched.current = true;
    const r = runtime.current; r?.model?.setJointValues(values);
    if (r?.model) r.axisLength = Math.max(.06, Math.min(previewBounds(r.model).getSize(new THREE.Vector3()).length() * .25, 1));
    if (previousPose.current) previousPose.current.values = values;
    setPose(values);
  };
  const setJoint = (name: string, value: number) => applyPose({ ...pose, [name]: value });
  const fitView = (view?: string) => { viewTouched.current = true; runtime.current?.fit(view); };
  return <ModelViewport onExpandedChange={onExpandedChange}>{({ expanded, toggle, buttonRef }) => <>
    <div className="robot-preview" ref={host} data-selected={selected} data-geometry={geometry} />
    <div className="preview-notices">
    {error && <Alert type="warning" message={typeof error==='string'?t(error):diagnosticText(error)} />}
    {problems.length > 0 && <section className="preview-resource-issues" aria-label={t('模型资源问题')} tabIndex={0}>
      <strong>{t('模型资源问题（{count}）', { count: problems.length })}</strong>
      <p>{t('橙色占位标记仅用于定位，不代表实际几何或尺寸。请在 APP 配置中导入或映射资源。')}</p>
      <ul>{problems.map((problem, index) => <li key={index}>
        <div>{problem.kind === 'mesh' ? 'Mesh' : t('纹理')} · {fileById(project, problem.sourceId)?.path || problem.sourceId} → <code>{problem.uri.startsWith('data:') ? t('内嵌纹理') : problem.uri}</code></div>
        <div>{typeof problem.reason === 'string' ? t(problem.reason) : diagnosticText(problem.reason)}</div>
        <Space wrap>{problem.owners.map(owner => <Button size="small" key={JSON.stringify(owner)} disabled={!onSelect} onClick={() => { setGeometry(owner.mode); select.current?.(`link:${owner.link}`); }}>{t('定位 {link} · {mode}', { link: owner.link, mode: owner.mode === 'visual' ? t('外观（Visual）') : t('碰撞（Collision）') })}</Button>)}</Space>
      </li>)}</ul>
    </section>}
    {geometry === 'collision' && !hasCollision && <Alert type="info" message={t('当前模型没有碰撞几何，可切换至外观显示。')} />}
    </div>
    <div className="preview-top-overlay">
      <div className="preview-heading"><strong>{robot.name || t('模型预览')}</strong><Button size="small" ref={buttonRef} onClick={toggle}>{expanded ? t('退出展开视图') : t('展开视图')}</Button></div>
      <small>{t('配置预览 · m / rad · 拖动旋转，滚轮缩放')}</small>
    {selectedJoint && <div className="preview-axis-status" role="status" aria-label={t('选中关节轴向')}>
      <strong>{selectedJoint.name} · {selectedJoint.type}</strong> · {hasJointAxis(selectedJoint.type) ? (selectedJoint.type === 'planar' ? t('局部平面法向：{axis}；橙色箭头随当前预览姿态变换。', { axis: selectedJoint.axis }) : t('局部轴向：{axis}；橙色箭头随当前预览姿态变换。', { axis: selectedJoint.axis })) : t('该关节没有单一运动轴。')}
      <div>{t('蓝线：{parent} → {child}，连接父 Link 原点与当前关节坐标系。', { parent: selectedJoint.parent, child: selectedJoint.child })}</div>
    </div>}
    </div>
    <div className="preview-controls">
      <div className="preview-display-tools"><Select size="small" showSearch optionFilterProp="label" aria-label={t('模型显示')} value={geometry} getPopupContainer={trigger => trigger.parentElement!} options={[{value:'visual',label:t('外观（Visual）')},{value:'collision',label:t('碰撞（Collision）')}]} onChange={setGeometry} />
    <Space wrap className="preview-view-tools"><Button size="small" onClick={() => fitView()}>{t("适应模型")}</Button>{[['front', t("正视")], ['side', t("侧视")], ['top', t("俯视")]].map(([key, label]) => <Button size="small" key={key} onClick={() => fitView(key)}>{label}</Button>)}<Button size="small" onClick={() => applyPose(previewPose(joints).values)}>{t("重置姿态")}</Button></Space>
    </div>
    {!!joints.length && <div className="preview-joint-tools"><Select size="small" showSearch optionFilterProp="label" aria-label={t("预览关节")} value={current?.name} getPopupContainer={trigger => trigger.parentElement!} options={joints.map(j => ({ value: j.name, label: `${j.name} · ${j.type === 'prismatic' ? 'm' : 'rad'}` }))} onChange={name => { memory.joint = name; setPoseJoint(name); }} />
      <Slider ariaLabelForHandle={t("关节预览位置")} disabled={!validLimits} min={validLimits ? min : 0} max={validLimits ? max : 1} step={.001} value={pose[current?.name] ?? 0} onChange={value => current && setJoint(current.name, value)} />
    </div>}
      <small>{t("仅改变预览姿态，不写入 URDF 或驱动器参数。")}</small>
    </div>
  </>}</ModelViewport>;
}

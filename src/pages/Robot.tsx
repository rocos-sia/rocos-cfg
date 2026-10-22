import { useLocalizedMessage } from '../components/useLocalizedMessage';
import { useLocalizedModal } from '../components/useLocalizedModal';
import { diagnosticText, errorText, t } from '../i18n';
import { LinkProperties } from '../components/LinkProperties';
import { useEffect, useRef, useState } from 'react';
import { Alert, Button, Card, Input, Modal, Select, Space } from 'antd';
import { type Project, fileById, textOf } from '../core/project/types';
import { type RobotJointParameters } from '../core/documents/urdf';
import type { ProjectAnalysis } from '../core/project/analysis';
import { appDocument } from '../core/documents/app-config';
import { changeJointParameter, planRobotChange, type RobotAction, type RobotPlan } from '../core/documents/robot-edit';
import { useProject } from '../store';
import { SourceEditor } from '../components/SourceEditor';
import { RobotPreview } from '../components/RobotPreview';
import type { ModelViewState } from '../components/modelViewState';
import { RobotStructureTree, type StructureTreeHandle } from '../components/RobotStructureTree';
import { robotStructure } from '../components/robotStructure';
import type { UrdfSourceReveal } from '../core/documents/urdf-source';
import { ModelWorkspace } from '../components/ModelWorkspace';
import { createModelLayoutState } from '../components/modelLayout';

type Form = { kind: 'rename' | 'add'; node: 'link' | 'joint'; name: string; value: string; link: string; parent: string };
export function Robot({ p, analysis, onImport, viewState, dark }: { p: Project; analysis?:ProjectAnalysis; onImport: () => void; viewState: ModelViewState; dark: boolean }) {
  const file = fileById(p, p.entrypoints.urdf), app = fileById(p, p.entrypoints.app);
  const [selected, setSelected] = useState(viewState.selected), [search, setSearch] = useState(viewState.search), [form, setForm] = useState<Form | null>(null);
  useEffect(() => { viewState.selected = selected; viewState.search = search; }, [selected, search, viewState]);
  const treeRef = useRef<StructureTreeHandle>(null);
  const message=useLocalizedMessage();const modal=useLocalizedModal();
  const [pending,setPending]=useState<{plan:RobotPlan;revision:number;epoch:number}>();
  const [sourceReveal, setSourceReveal] = useState<UrdfSourceReveal>();
  const layoutState = viewState.layout || (viewState.layout = createModelLayoutState());
  if(!analysis)return null;
  if (!file) return <Button onClick={onImport}>{t("导入 URDF")}</Button>;
  const robot=analysis.robot;
  if(!robot)return <><Alert message={analysis.robotError?diagnosticText({message:analysis.robotError,text:analysis.robotErrorText}):t("URDF 无法解析")} type="error" /><SourceEditor file={file} /></>;
  let startup: any; try { startup = app && appDocument(app).data; } catch {}
  const structure = robotStructure(robot, [startup?.robot?.base_link, startup?.robot?.tip_link]);
  const tree = structure.nodes, target = structure.targets.get(selected);
  const selectedKind = target?.kind || 'joint', selectedName = target?.name || '';
  const joint = target?.kind === 'joint' && !target.ambiguous ? robot.joints[target.index] : undefined;
  const link = target?.kind === 'link' && !target.ambiguous ? robot.links[target.index] : undefined;
  const selectNode = (key: string) => {
    const reference = structure.references.get(key);
    setSelected(reference || key); if (reference) treeRef.current?.reveal(reference);
  };
  const treeKey = JSON.stringify([file.id, robot.links, robot.joints.map(j => [j.name, j.parent, j.child])]);
  if (viewState.tree.topology !== treeKey) viewState.tree = { topology: treeKey, scrollTop: 0 };
  const prepare = (action: RobotAction) => {
    try {
      const plan = planRobotChange(p, action);
      setPending({plan,revision:p.revision,epoch:useProject.getState().workspaceEpoch});
      return true;
    } catch (error) { message.error(()=>(errorText(error,true))); return false; }
  };
  const edit = (field: keyof RobotJointParameters, value: string) => {
    if (!joint) return;
    try { useProject.getState().change(next => changeJointParameter(next, joint.name, field, value)); }
    catch (error) { message.error(()=>(errorText(error,true))); }
  };
  const deleteNode = () => {
    if (!link && !joint) return;
    const epoch=useProject.getState().workspaceEpoch;
    const choose=(mode:'reattach'|'subtree')=>{
      const state=useProject.getState();
      if(state.workspaceEpoch!==epoch||state.project?.revision!==p.revision){message.error(()=>(t("工程已变化，请重新查看影响")));return;}
      prepare({kind:'delete',node:selectedKind,name:selectedName,mode});
    };
    const decision = modal.confirm(()=>({ title: t("选择删除方式"), content: t("级联删除会移除整个子树；保留后代会将子关节挂到上一级 Link，并保留其局部 origin。"), okText: t("级联删除子树"), cancelText: t("取消"),
      footer: (_, { OkBtn, CancelBtn }) => <Space wrap><CancelBtn /><Button onClick={() => { decision.destroy(); choose('reattach'); }}>{t("删除并保留后代")}</Button><OkBtn /></Space>,
      onOk: () => choose('subtree'),
    }));
  };
  const selectedParent = link || joint?.child || robot.roots[0] || '';
  return <>
    <Modal title={t("确认模型与引用变更")} open={!!pending} width={680} okText={t("应用模型变更")} cancelText={t("取消")} onCancel={()=>setPending(undefined)} onOk={()=>{
      if(!pending)return;
      const state=useProject.getState();
      if(state.workspaceEpoch!==pending.epoch||state.project?.id!==p.id||state.project.revision!==pending.revision){message.error(()=>(t("工程已变化，请重新查看影响")));return;}
      state.change(next=>Object.assign(next,pending.plan.project));
      if(pending.plan.selection)setSelected(pending.plan.selection);
      setPending(undefined);
    }}>
      <ul>{pending?.plan.impactMessages.map((issue,i)=><li key={i}>{diagnosticText(issue)}</li>)}</ul>
      {pending?.plan.warningMessages.map((issue,i)=><Alert key={i} type="warning" message={diagnosticText(issue)}/>)}
      <p>{t("整次操作可撤销。")}</p>
    </Modal>
    <div className="page-heading"><div><h1>{t("机器人模型")}</h1><p>{t("编辑结构与属性，预览模型；预览不会驱动真实设备。")}</p></div><Button onClick={onImport}>{t("导入 URDF / Mesh")}</Button></div>
    {(p.editor.notices || []).filter(n => n.fileId === file.id).map((n, i) => <Alert key={`notice-${i}`} message={diagnosticText(n)} type="warning" className="space-top" action={<Button size="small" onClick={() => useProject.getState().change(next => { next.editor.notices = next.editor.notices?.filter(item => item.fileId !== n.fileId || item.message !== n.message); })}>{t("已核对")}</Button>} />)}
    {robot.issues.map((e, i) => <Alert key={i} message={diagnosticText(e)} type="error" className="space-top" />)}
    <Space wrap className="section-tools space-top">
      <Button onClick={() => setForm({ kind: 'add', node: 'joint', name: '', value: '', link: '', parent: selectedParent })}>{t("新增关节与 Link")}</Button>
      <Button disabled={!joint && !link} onClick={() => setForm({ kind: 'rename', node: selectedKind, name: selectedName, value: selectedName, link: '', parent: '' })}>{t("重命名节点")}</Button>
      <Button danger disabled={(!joint && !link) || robot.roots.includes(link || '')} onClick={deleteNode}>{t("删除节点")}</Button>
    </Space>
    <ModelWorkspace state={layoutState} onShowTree={() => treeRef.current?.reveal(selected)}>{onExpandedChange => [
      <Card key="tree" title={t("Link / Joint 结构")}><Input.Search aria-label={t("搜索模型节点")} placeholder={t("搜索节点名称")} value={search} onChange={e => setSearch(e.target.value)} allowClear />
        <RobotStructureTree ref={treeRef} key={treeKey} viewState={viewState.tree}
          nodes={tree} selected={selected} search={search} onSearchChange={setSearch} onSelect={selectNode} />
      </Card>,
      <Card key="preview" title={robot.name || t("模型预览")} className="preview-card"><RobotPreview project={p} robot={robot} viewState={viewState.preview} dark={dark} selected={selected} onExpandedChange={onExpandedChange} onSelect={key => { setSelected(key); treeRef.current?.reveal(key); }} /><div className="preview-caption">{t("配置预览 · m / rad · 拖动旋转，滚轮缩放")}</div></Card>,
      <Card key="properties" title={target ? `${target.kind === 'link' ? 'Link' : 'Joint'} · ${target.name || t('未命名')}` : t("节点属性")}>
        {target && <Button className="section-tools" onClick={() => setSourceReveal({ ...target, source: textOf(file), request: (sourceReveal?.request || 0) + 1 })}>{t('定位到 URDF 源码')}</Button>}
        {target?.ambiguous ? <>
          <Alert type="warning" message={t('节点名称重复或为空，不能按名称安全编辑。请定位到源码修复。')} />
          <p>{t('文件中的第 {index} 个 {kind}', { index: target.index + 1, kind: target.kind === 'link' ? 'Link' : 'Joint' })}</p>
          {target.kind === 'joint' && <><p>{t('父 Link：{name}', { name: robot.joints[target.index].parent || t('未提供') })}</p><p>{t('子 Link：{name}', { name: robot.joints[target.index].child || t('未提供') })}</p></>}
        </> : joint ? <div className="fields single">
          <div className="field"><label htmlFor="joint-parent">{t("父 Link（重挂接）")}</label><Select id="joint-parent" value={joint.parent} options={robot.links.map(value => ({ value, label: value }))} onChange={parent => prepare({ kind: 'reparent', joint: joint.name, parent })} /></div>
          <div className="field"><label htmlFor="joint-child">{t("子 Link")}</label><Select id="joint-child" value={joint.child} options={robot.links.map(value => ({ value, label: value }))} onChange={child => prepare({ kind: 'rechild', joint: joint.name, child })} /></div><p className="muted">{t("调整子树位置通常使用父 Link；子 Link 变更也必须保持树结构完整。")}</p>
          {(['type', 'xyz', 'rpy', ...(['fixed', 'floating'].includes(joint.type) ? [] : ['axis']), ...(['revolute', 'prismatic'].includes(joint.type) ? ['lower', 'upper'] : []), ...(['revolute', 'continuous', 'prismatic'].includes(joint.type) ? ['velocity', 'effort'] : [])] as (keyof RobotJointParameters)[]).map(key => <div className="field" key={key}>
            <label htmlFor={`joint-${key}`}>{({ type: t("关节类型"), xyz: t("位置 xyz (m)"), rpy: t("旋转 rpy (rad)"), axis: t("轴向 xyz"), lower: t("位置下限"), upper: t("位置上限"), velocity: t("速度上限"), effort: t("力 / 力矩上限") } as Record<string, string>)[key]}</label>
            {key === 'type' ? <Select id={`joint-${key}`} value={joint[key]} options={['fixed', 'revolute', 'continuous', 'prismatic', 'floating', 'planar'].map(value => ({ value, label: value }))} onChange={v => edit(key, v)} />
              : <Input id={`joint-${key}`} key={joint.name + key + joint[key]} defaultValue={joint[key]} onBlur={e => { if (e.target.value !== joint[key]) edit(key, e.target.value); }} />}
          </div>)}
          {joint.mimic && <Alert type="info" message={t('Mimic：{joint}；当前 APP 不支持将 mimic 加入控制链。',{joint:joint.mimic})} />}
        </div> : link ? <><p>Link：{link}</p><p>{t("父关节：")}{robot.joints.find(j => j.child === link)?.name || t("根节点")}</p><p>{t("直接子关节：")}{robot.joints.filter(j => j.parent === link).length}</p><LinkProperties text={textOf(file)} name={link} /></> : <p className="muted">{t("选择 Link 或 Joint 编辑结构与属性。")}</p>}
      </Card>
    ]}</ModelWorkspace>
    <Card className="space-top" title={t("控制关节链")}><Space wrap><label htmlFor="base-link">Base Link</label><Select id="base-link" value={startup?.robot?.base_link} style={{ width: 200 }} options={robot.links.map(value => ({ value, label: value }))} onChange={base => prepare({ kind: 'chain', base, tip: robot.links.includes(startup?.robot?.tip_link) ? startup.robot.tip_link : base })} />
      <label htmlFor="tip-link">Tip Link</label><Select id="tip-link" value={startup?.robot?.tip_link} style={{ width: 200 }} options={robot.links.map(value => ({ value, label: value }))} onChange={tip => prepare({ kind: 'chain', base: robot.links.includes(startup?.robot?.base_link) ? startup.robot.base_link : robot.roots[0], tip })} /></Space>
    </Card>
    <Card className="space-top" title={t("URDF 源文件")}><SourceEditor file={file} reveal={sourceReveal} /></Card>
    <Modal title={form?.kind === 'add' ? t("新增固定关节与 Link") : t("重命名节点")} open={!!form} okText={t("查看变更")} cancelText={t("取消")} onCancel={() => setForm(null)} onOk={() => {
      if (!form) return;
      const action: RobotAction = form.kind === 'add' ? { kind: 'add', parent: form.parent, joint: form.value, link: form.link } : { kind: 'rename', node: form.node, name: form.name, value: form.value };
      if (prepare(action)) setForm(null);
    }}>
      {form && <Space direction="vertical" style={{ width: '100%' }}>
        {form.kind === 'add' && <Select aria-label={t("新增节点的父 Link")} style={{ width: '100%' }} value={form.parent} options={robot.links.map(value => ({ value, label: value }))} onChange={parent => setForm({ ...form, parent })} />}
        <Input aria-label={form.kind === 'add' ? t("新关节名称") : t("节点新名称")} value={form.value} onChange={e => setForm({ ...form, value: e.target.value })} />
        {form.kind === 'add' && <Input aria-label={t("新 Link 名称")} value={form.link} onChange={e => setForm({ ...form, link: e.target.value })} />}
      </Space>}
    </Modal>
  </>;
}

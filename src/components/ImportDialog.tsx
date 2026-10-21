import { errorText, t } from '../i18n';
import { useRef, useState } from 'react';
import { Alert, App, Modal, Select, Space, Table, Tag } from 'antd';
import { prepareImport } from '../adapters/files';
import { activeImportFile, applyImport, defaultImportSelection, importCandidates, type ImportPlan, type ImportSelection, type ImportSlot } from '../core/project/import';
import { buildBusCatalog } from '../core/bus/catalog';
import { compareBus } from '../core/bus/compare';
import { digest, type Project } from '../core/project/types';
import { collectReferences } from '../core/project/references';
import { flushBuffers, useProject } from '../store';
const labels: Record<ImportSlot, string> = { master: '主站', eni: 'ENI', app: 'APP', urdf: 'URDF', hardware: 'Hardware', binding: 'Binding' };
export function useImportDialog() {
  const { message } = App.useApp(), generation = useRef(0);
  const [session, setSession] = useState<{ base: Project; plan: ImportPlan; selection: ImportSelection; hashes: Record<string, string> }>();
  const selectFiles = async (files: File[]) => {
    const ticket = ++generation.current;
    try {
      await flushBuffers();
      const project = useProject.getState().project; if (!project || !files.length) return;
      const base = structuredClone(project), plan = await prepareImport(base, files);
      const eniFiles = [...base.files.filter(f => f.id === base.entrypoints.master.eniFileId), ...plan.files.filter(f => f.role === 'eni')];
      const hashes = Object.fromEntries(await Promise.all(eniFiles.map(async f => [f.id, await digest(f.bytes)])));
      if (generation.current === ticket) setSession({ base, plan, selection: defaultImportSelection(plan), hashes });
    } catch (error) { message.error(errorText(error,true)); }
  };
  let preview: Project | undefined, error = '';
  if (session) try { preview = applyImport(session.base, session.plan, session.selection); } catch (e) { error = (e as Error).message; }
  const changes = preview && session ? preview.files.filter(f => {
    const old = session.base.files.find(v => v.id === f.id);
    return !old || old.path !== f.path || old.bytes.length !== f.bytes.length || old.bytes.some((v, i) => v !== f.bytes[i]);
  }).map(f => ({ ...f, previous: session.base.files.find(v => v.id === f.id) })) : [];
  const drafts = changes.filter(f => session?.base.editor.buffers[f.id]);
  const missing = preview ? collectReferences(preview).filter(r => r.state === 'missing') : [];
  const busReview = preview && session && ['master', 'eni'].some(slot => session.selection[slot as ImportSlot] && session.selection[slot as ImportSlot] !== 'keep');
  const oldBus = busReview ? buildBusCatalog(session!.base) : undefined, newBus = busReview ? buildBusCatalog(preview!) : undefined;
  const busChanges = oldBus && newBus ? compareBus(oldBus, newBus) : [];
  const dialog = <Modal title={t("导入预览")} open={!!session} width={800} okText={t("确认导入")} cancelText={t("取消")} okButtonProps={{ disabled: !preview }}
    onCancel={() => { generation.current++; setSession(undefined); }} onOk={() => {
      if (!session || !preview) return;
      try {
        useProject.getState().change(current => Object.assign(current, applyImport(current, session.plan, session.selection)));
        setSession(undefined); message.success(t("文件已导入，请检查引用与绑定；可撤销本次操作"));
      } catch (e) { message.error(errorText(e,true)); }
    }}>
    {session && <Space direction="vertical" style={{ width: '100%' }}>
      <p>{t('本次包含 {count} 个文件。选择活动配置，其他候选仍保留在工程中。普通配置导入不代表已通过工程完整性或消费端验证。',{count:session.plan.files.length})}</p>
      {[...importCandidates(session.plan)].map(([slot, files]) => {
        const old = session.base.files.find(f => f.id === activeImportFile(session.base, slot));
        return <label key={slot} style={{ width: '100%' }}>{t('{kind} 活动配置',{kind:t(labels[slot])})}
          <Select aria-label={t('导入 {slot} 活动配置',{slot})} style={{ width: '100%' }} value={session.selection[slot]} placeholder={t("存在多个候选，请选择")}
            options={[...(old ? [{ value: 'keep', label: t('保留当前：{path}',{path:old.path}) }] : []), ...files.map(f => ({ value: f.id, label: `${f.path} · ${f.role}${f.role === 'eni' ? t("（只读）") : ''}` }))]}
            onChange={value => setSession({ ...session, selection: { ...session.selection, [slot]: value } })} />
        </label>;
      })}
      {error && <Alert type="warning" message={error} />}
      {preview && <>
        <p>{t('主站目标规则：{kind} / {version}。这是编辑器使用的规则基线，不代表输入文件来自该版本。配置替换后需重新确认驱动器绑定。',{kind:preview.entrypoints.master.kind.toUpperCase(),version:preview.targets.master.version})}</p>
        {busReview && <details open><summary>{t('主站 / ENI 变更：{count} 项从站或信号差异',{count:busChanges.length})}</summary>
          <p>{t("按运行时 ID 和信号名称比较，不表示已识别同一物理设备。原 Hardware 引用保留，必须复核；不会按序号自动重绑。")}</p>
          {session.selection.eni && session.selection.eni !== 'keep' && <p style={{ overflowWrap: 'anywhere' }}>ENI SHA-256<br />{t("原：")}{session.hashes[session.base.entrypoints.master.eniFileId || ''] || t("无")}<br />{t("新：")}{session.hashes[session.selection.eni]}</p>}
          <Table size="small" rowKey="key" dataSource={busChanges} pagination={{ pageSize: 5 }} scroll={{ x: 650 }} columns={[
            { title: t("对象"), dataIndex: 'object', width: 180 }, { title: t("变更"), dataIndex: 'change', width: 60 },
            { title: t("原配置"), dataIndex: 'before' }, { title: t("导入后"), dataIndex: 'after' },
          ]} />
          {!!newBus?.diagnostics.length && <Alert type="warning" message={t('新主站有 {count} 项静态诊断，导入后需继续修复或复核',{count:newBus.diagnostics.length})} description={<ul>{newBus.diagnostics.slice(0, 5).map((d, i) => <li key={i}>{d.message}</li>)}</ul>} />}
        </details>}
        <Table size="small" rowKey="id" dataSource={changes} pagination={{ pageSize: 5 }} columns={[
          { title: t("工程内路径"), dataIndex: 'path' }, { title: t("用途"), dataIndex: 'role', render: role => <>{role}{role === 'eni' && <Tag>{t("只读")}</Tag>}</> },
          { title: t("操作"), render: (_, f) => f.previous ? t('替换 {before} → {after} B',{before:f.previous.bytes.length,after:f.bytes.length}) : t('新增 {size} B',{size:f.bytes.length}) },
        ]} locale={{ emptyText: t("文件内容无变化；仍会应用所选活动配置") }} />
        {!!drafts.length && <Alert type="warning" message={t('以下文件有未应用源码草稿，替换后仍保留原草稿及基线，应用前会检查冲突：{paths}',{paths:drafts.map(f=>f.path).join('、')})} />}
        {!!missing.length && <Alert type="warning" message={t('{count} 项引用仍缺失，可导入后在 APP 配置中补充或映射',{count:missing.length})} description={<ul>{missing.slice(0, 8).map((r, i) => <li key={i}>{preview.files.find(f => f.id === r.sourceFileId)?.path} · {r.field}：{r.original}</li>)}</ul>} />}
      </>}
    </Space>}
  </Modal>;
  return { selectFiles, dialog };
}

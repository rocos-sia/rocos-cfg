import { useLocalizedMessage } from './useLocalizedMessage';
import { m as msg, MessageError } from '../core/project/messages';
import { errorText, diagnosticText, t } from '../i18n';
import { useState } from 'react';
import { Alert, Button, Card, Input, Modal, Select, Space, Table, Tag } from 'antd';
import type { Project } from '../core/project/types';
import { moduleUI } from '../modules/ui';
import { modules } from '../core/modules';
import { fileModule, moduleInstanceKey, moduleSnapshots, readonlyFile } from '../core/modules/project';
import { activeFileIds, collectReferences } from '../core/project/references';
import { checkPaths, safePath } from '../core/project/paths';
import { useProject } from '../store';
import { SourceEditor } from './SourceEditor';
const builtin = new Set(['igh', 'ecm', 'eni', 'urdf', 'hardware', 'binding', 'app', 'resource', 'attachment', 'editor-state', 'template', 'profile', 'model.dae', 'model.gltf']);
export function Modules({ p }: { p: Project }) {
  const message=useLocalizedMessage(), [selected, setSelected] = useState<string>(), [creating, setCreating] = useState(false);
  const [kind, setKind] = useState(moduleUI[0]?.id), [path, setPath] = useState('app/payload.yaml');
  const records = moduleSnapshots(p).filter(m => !builtin.has(m.id)), active = activeFileIds(p);
  const file = p.files.find(f => f.id === selected), adapter = file && fileModule(p, file);
  const ui = adapter && moduleUI.find(u => u.id === adapter.id && u.version === adapter.version), Editor = ui?.Editor;
  let issues: string[] = [];
  if (adapter && file) try { issues = adapter.validate(adapter.parse(file), { project: p, file }).map(d => diagnosticText(d)); } catch (e) { issues = [errorText(e,true)]; }
  return <>
    <Card title={t("附加配置模块")} className="space-top" extra={<Button onClick={() => setCreating(true)}>{t("新建附加配置")}</Button>}>
      <p>{t("附加配置按文件实例保存。未知可选模块原样保留；参与运行依赖时须安装支持该模块的应用版本后再导出。")}</p>
      <Table size="small" scroll={{x:550}} rowKey={moduleInstanceKey} dataSource={records} pagination={{ pageSize: 5 }} columns={[
        { title: t("模块"), render: (_, m) => <>{t(moduleUI.find(u => u.id === m.id && u.version === m.version)?.title || m.id)}<br /><small>{m.id} v{m.version}</small></> },
        { title: t("状态"), render: (_, m) => <Space>{modules.get(m.id, m.version) ? <Tag color="green">{t("已支持")}</Tag> : <Tag color="orange">{t("未知 · 只读保留")}</Tag>}<Tag>{m.fileIds.some(id => active.has(id)) ? t("运行依赖") : t("未关联")}</Tag></Space> },
        { title: t("文件"), render: (_, m) => [...m.fileIds, ...(m.stateFileIds || [])].map(id => { const f = p.files.find(f => f.id === id); return f && <div key={id}><Button type="link" onClick={() => setSelected(id)}>{f.path}</Button></div>; }) },
      ]} locale={{ emptyText: t("尚无附加配置模块，可创建或导入负载参数文件") }} />
    </Card>
    <Modal title={ui?.title?t(ui.title):t("模块文件")} open={!!file} width={880} footer={null} onCancel={() => setSelected(undefined)}>
      {file && <>{readonlyFile(p, file) ? <Alert type="info" message={t("此模块只读、版本不受支持或需要桌面能力；文件、元数据及原有草稿均保留")} /> : Editor && <Editor file={file} />}
        {!!issues.length && <Alert className="space-top" type="warning" message={t("配置需要检查")} description={<ul>{issues.map((issue, i) => <li key={i}>{issue}</li>)}</ul>} />}
        <SourceEditor file={file} /></>}
    </Modal>
    <Modal title={t("新建附加配置")} open={creating} okText={t("创建并关联")} onCancel={() => setCreating(false)} onOk={() => {
      try {
        const definition = moduleUI.find(u => u.id === kind), mod = definition && modules.get(definition.id, definition.version);
        if (!definition?.create || !mod?.capabilities.generate) throw new MessageError(msg("模块不支持创建"));
        safePath(path); if (path.startsWith('project-data/') || path === 'rocos-project.json') throw new MessageError(msg("不能使用工程保留路径"));
        let createdId = '';
        useProject.getState().change(next => {
          checkPaths([...next.files.map(f => f.path), path]);
          const created = definition.create!(path); created.owner = definition.id; createdId = created.id;
          next.files.push(created); definition.attach?.(next, created); next.references = collectReferences(next);
        });
        setCreating(false); setSelected(createdId);
      } catch (e) { message.error(()=>(errorText(e,true))); }
    }}>
      <label>{t("配置类型")}<Select aria-label={t("附加配置类型")} style={{ width: '100%' }} value={kind} options={moduleUI.filter(u => u.create).map(u => ({ value: u.id, label: t(u.title) }))} onChange={setKind} /></label>
      <label>{t("工程内路径")}<Input aria-label={t("附加配置路径")} value={path} onChange={e => setPath(e.target.value)} /></label>
      <p>{t("创建后关联 APP，并保留原有文件。已有同名文件时，请选择新路径或直接编辑原文件。")}</p>
    </Modal>
  </>;
}

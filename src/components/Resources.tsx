import { errorText, t } from '../i18n';
import { fileAccess } from '../adapters/file-access';
import { useRef, useState } from 'react';
import { Alert, App, Button, Card, Input, Modal, Select, Space, Table, Tag } from 'antd';
import { type Project, type FileReference } from '../core/project/types';
import { activeFileIds, collectReferences } from '../core/project/references';
import { mapReference, moveResource, setPackagePath } from '../core/project/resources';
import { useImportDialog } from './ImportDialog';
import { useProject } from '../store';
export function Resources({ p }: { p: Project }) {
  const { message, modal } = App.useApp();
  const { selectFiles, dialog } = useImportDialog();
  const [packageName, setPackageName] = useState(''), [packagePath, setPackageDirectory] = useState<string>();
  const [moving, setMoving] = useState<{ id: string; path: string } | null>(null);
  const fileInput = useRef<HTMLInputElement>(null), folderInput = useRef<HTMLInputElement>(null);
  const refs = collectReferences(p), active = activeFileIds(p, refs);
  const directories = [...new Set(p.files.flatMap(f => { const parts = f.path.split('/'); return parts.slice(0, -1).map((_, i) => parts.slice(0, i + 1).join('/')); }))].sort();
  const run = (fn: () => void) => { try { fn(); } catch (error) { message.error(errorText(error,true)); } };
  const pick=async(directory:boolean)=>{
    if(fileAccess().kind==='browser'){(directory?folderInput:fileInput).current?.click();return;}
    try{const files=await fileAccess().import(directory);if(files?.length)await selectFiles(files);}catch(e){message.error(errorText(e,true));}
  };
  const update = (ref: FileReference, target: Parameters<typeof mapReference>[2]) => run(() => useProject.getState().change(next => mapReference(next, ref, target)));
  return <>
    {dialog}
    <Card className="space-top" title={t("资源与路径映射")} extra={<Space><Button onClick={() => void pick(false)}>{t("导入资源 / ZIP")}</Button><Button onClick={() => void pick(true)}>{t("导入资源目录")}</Button></Space>}>
      <p className="muted">{t("映射仅记录在工程中。运行包会将已纳入的资源改写为相对路径；源配置保持原文。目录导入会保留目录内结构。")}</p>
      <Table rowKey={ref => `${ref.sourceFileId}:${ref.field}`} size="small" scroll={{ x: 1000 }} dataSource={refs} columns={[
        { title: t("来源 / 字段"), width: 220, render: (_, ref) => <>{p.files.find(f => f.id === ref.sourceFileId)?.path}<br /><small>{ref.field}</small>{!active.has(ref.sourceFileId) && <Tag>{t("非活动依赖")}</Tag>}</> },
        { title: t("原始路径"), dataIndex: 'original', width: 230 },
        { title: t("状态"), width: 100, render: (_, ref) => <Tag color={ref.state === 'internal' ? 'green' : ref.state === 'external' ? 'orange' : 'red'}>{ref.state === 'internal' ? t("已纳入") : ref.state === 'external' ? t("环境提供") : t("缺失")}</Tag> },
        { title: t("工程内目标"), width: 310, render: (_, ref) => <Select showSearch optionFilterProp="label" aria-label={t('映射 {field}',{field:ref.field})} style={{ width: '100%' }} placeholder={ref.kind === 'directory' ? t("选择目录") : t("选择文件")}
          value={ref.state === 'internal' ? ref.kind === 'directory' ? ref.targetPath : ref.targetFileId : undefined}
          options={ref.kind === 'directory' ? directories.map(value => ({ value, label: value })) : p.files.filter(f => !['editor-state', 'profile', 'template'].includes(f.role)).map(f => ({ value: f.id, label: f.path }))}
          onChange={value => update(ref, ref.kind === 'directory' ? { directory: value } : { fileId: value })} /> },
        { title: t("操作"), width: 180, render: (_, ref) => <Space><Button size="small" onClick={() => update(ref, null)}>{t("自动解析")}</Button><Button size="small" onClick={() => modal.confirm({ title: t("由目标环境提供此资源"), content: t('{path} 将保留原路径，运行包不会携带该资源。请确认目标电脑已准备好此文件或目录。',{path:ref.original}), okText: t("标记为外部依赖"), onOk: () => update(ref, { external: true }) })}>{t("外部")}</Button></Space> },
      ]} />
      <Alert type="info" message={t("DAE 图片及 glTF buffers/images 会纳入依赖检查。脚本、网页和其他附件的动态依赖只做原样保留，需在目标环境验证。")} />
    </Card>
    <Card className="space-top" title={t("package:// 包目录")}>
      <Space wrap><Input aria-label={t("Package 名称")} placeholder={t("例如 robot_description")} value={packageName} onChange={e => setPackageName(e.target.value)} />
        <Select aria-label={t("Package 目录")} placeholder={t("工程内目录")} value={packagePath} style={{ minWidth: 230 }} options={directories.map(value => ({ value, label: value }))} onChange={setPackageDirectory} />
        <Button onClick={() => run(() => { if (!packagePath) throw new Error(t("请选择包目录")); useProject.getState().change(next => setPackagePath(next, packageName, packagePath)); setPackageName(''); })}>{t("添加包映射")}</Button>
      </Space>
      <Table size="small" pagination={false} rowKey="name" dataSource={Object.entries(p.packageMap).map(([name, path]) => ({ name, path }))} columns={[{ title: t("包名"), dataIndex: 'name' }, { title: t("目录"), dataIndex: 'path' }, { title: t("操作"), render: (_, row) => <Button onClick={() => run(() => useProject.getState().change(next => setPackagePath(next, row.name, null)))}>{t("移除映射")}</Button> }]} />
    </Card>
    <Card className="space-top" title={t("工程文件位置")}><Table size="small" rowKey="id" dataSource={p.files} columns={[
      { title: t("路径"), dataIndex: 'path' }, { title: t("用途"), dataIndex: 'role' },
      { title: t("运行包"), render: (_, file) => active.has(file.id) ? t("已关联") : t("未关联") },
      { title: t("操作"), render: (_, file) => <Button size="small" onClick={() => setMoving({ id: file.id, path: file.path })}>{t("调整位置")}</Button> },
    ]} /></Card>
    <Modal title={t("调整工程内文件位置")} open={!!moving} okText={t("调整位置")} onCancel={() => setMoving(null)} onOk={() => run(() => { if (!moving) return; useProject.getState().change(next => moveResource(next, moving.id, moving.path)); setMoving(null); })}>
      <Input aria-label={t("工程内新路径")} value={moving?.path} onChange={e => moving && setMoving({ ...moving, path: e.target.value })} /><p>{t("已识别的文件引用按文件 ID 保留；目录映射需重新核对。操作可撤销。")}</p>
    </Modal>
    <input hidden data-testid="resource-files" type="file" multiple ref={fileInput} onChange={e => { const files = Array.from(e.target.files || []); e.target.value = ''; if (files.length) void selectFiles(files); }} />
    <input hidden type="file" multiple {...({ webkitdirectory: '', directory: '' } as any)} ref={folderInput} onChange={e => { const files = Array.from(e.target.files || []); e.target.value = ''; if (files.length) void selectFiles(files); }} />
  </>;
}

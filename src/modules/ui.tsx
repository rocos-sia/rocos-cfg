import { t } from '../i18n';
import type { ComponentType } from 'react';
import type { Project, ProjectFile } from '../core/project/types';
import { fileById, textOf, utf8 } from '../core/project/types';
import { makeFile } from '../core/project/create';
import { patchYaml } from '../core/documents/yaml';
import { relativePath } from '../core/project/paths';
import { Fields } from '../components/Fields';
export interface ModuleUI {
  id: string; version: number; title: string;
  Editor?: ComponentType<{ file: ProjectFile }>;
  create?: (path: string) => ProjectFile;
  attach?: (project: Project, file: ProjectFile) => void;
}
function PayloadEditor({ file }: { file: ProjectFile }) {
  return <><p>{t("末端负载参数，供 APP 零力拖动控制器使用。mass=0 表示无末端负载；未指定 com 时，消费端使用法兰原点。")}</p><Fields file={file} fields={[
    { path: 'mass', label: t("负载质量"), type: 'number', unit: 'kg', min: 0 },
    ...['X', 'Y', 'Z'].map((axis, i) => ({ path: `com.${i}`, label: t('质心 {axis}',{axis}), type: 'number' as const, unit: 'm', defaultValue: 0 })),
  ]} /></>;
}
// UI code is separately compiled; no archive metadata is evaluated as code.
export const moduleUI: ModuleUI[] = [{
  id: 'app.payload', version: 1, title: '末端负载', Editor: PayloadEditor,
  create: path => makeFile(path, 'app.payload', '# 末端负载：质量 kg，质心坐标 m\nmass: 0.0\ncom: [0, 0, 0]\n'),
  attach: (p, file) => {
    const app = fileById(p, p.entrypoints.app); if (!app) throw new Error(t("请先配置 APP 文件"));
    if (p.editor.buffers[app.id]) throw new Error(t("请先处理 APP 源码草稿"));
    app.bytes = utf8.encode(patchYaml(textOf(app), ['robot', 'payload'], relativePath(app.path, file.path))); app.encoding = 'utf-8';
    p.references = p.references.filter(r => !(r.sourceFileId === app.id && r.field === 'robot.payload'));
  },
}];

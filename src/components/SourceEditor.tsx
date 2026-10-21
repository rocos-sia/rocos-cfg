import { t, useLocale } from '../i18n';
import { editorPhrases } from '../i18n/editor';
import { closeSearchPanel, openSearchPanel, searchPanelOpen } from '@codemirror/search';
import { useEffect, useRef } from 'react';
import { EditorView } from '@codemirror/view';
import { Compartment, EditorState } from '@codemirror/state';
import { basicSetup } from 'codemirror';
import { yaml } from '@codemirror/lang-yaml';
import { xml } from '@codemirror/lang-xml';
import { Button, Alert, Space, Tag, App } from 'antd';
import { fileModule, readonlyFile } from '../core/modules/project';
import { useProject, flushBuffers } from '../store';
import { textOf, type ProjectFile } from '../core/project/types';

export function SourceEditor({ file }: { file: ProjectFile }) {
  let source: string;
  try { source = textOf(file); }
  catch { return <Alert type="warning" message={t('无法以声明编码显示 {path}，原始字节仍保留在工程中。',{path:file.path})} />; }
  return <DecodedSourceEditor file={file} source={source} />;
}
function DecodedSourceEditor({ file, source }: { file: ProjectFile; source: string }) {
  const locale=useLocale(),attributes=useRef(new Compartment()),phrases=useRef(new Compartment());
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const syncing = useRef(false);
  const { message } = App.useApp();
  const draft = useProject(s => s.project?.editor.buffers[file.id]);
  const project = useProject(s => s.project);
  const readonly = !project || readonlyFile(project, file);
  const syntax = project && fileModule(project, file)?.syntax || (/\.ya?ml$/i.test(file.path) ? 'yaml' : /\.(xml|urdf|dae)$/i.test(file.path) ? 'xml' : 'text');
  const visible = draft?.text ?? source;

  useEffect(() => {
    const editor = new EditorView({
      parent: host.current!,
      state: EditorState.create({
        doc: visible,
        extensions: [
          phrases.current.of(EditorState.phrases.of(editorPhrases(locale))),
          basicSetup, syntax === 'yaml' ? yaml() : syntax === 'xml' ? xml() : [],
          EditorState.readOnly.of(readonly), EditorView.editable.of(!readonly),
          attributes.current.of(EditorView.contentAttributes.of({ 'aria-label': readonly ? file.role === 'eni' ? t("ENI 只读源码") : t("模块只读源码") : t("配置源码") })),
          EditorView.theme({ '&': { height: '350px', fontSize: '14px' }, '.cm-scroller': { overflow: 'auto', fontFamily: 'inherit' } }),
          EditorView.updateListener.of(update => {
            if (update.docChanged && !readonly && !syncing.current) {
              void useProject.getState().buffer(file.id, update.state.doc.toString())
                .catch(error => message.error(String(error)));
            }
          }),
        ],
      }),
    });
    view.current = editor;
    return () => { editor.destroy(); view.current = null; };
  }, [file.id, file.path, readonly, syntax]);

  useEffect(()=>{
    const editor=view.current;if(!editor)return;
    const searchOpen=searchPanelOpen(editor.state),focused=document.activeElement;
    // CodeMirror's built-in search panel constructs labels only on mount.
    // Reopen just the panel, preserving its query and the editor's history.
    if(searchOpen)closeSearchPanel(editor);
    editor.dispatch({effects:[attributes.current.reconfigure(EditorView.contentAttributes.of({
      'aria-label':t(readonly?(file.role==='eni'?'ENI 只读源码':'模块只读源码'):'配置源码'),
    })),phrases.current.reconfigure(EditorState.phrases.of(editorPhrases(locale)))]});
    if(searchOpen){openSearchPanel(editor);if(focused instanceof HTMLElement&&focused.isConnected)focused.focus();}
  },[locale,readonly,file.role]);

  // Also handles undo, draft restoration and discard without resetting the
  // editor on unrelated project changes or moving the cursor on each keystroke.
  useEffect(() => {
    const editor = view.current;
    if (editor && editor.state.doc.toString() !== visible) {
      syncing.current = true;
      try { editor.dispatch({ changes: { from: 0, to: editor.state.doc.length, insert: visible } }); }
      finally { syncing.current = false; }
    }
  }, [file.id, visible]);

  return <div className="source-editor">
    <Space className="section-tools">
      <Tag>{file.path}</Tag>
      {readonly ? <Tag color="gold">{file.role === 'eni' ? t("ENI 原文 · 只读") : t("模块原文 · 只读")}</Tag> : <>
        <Button onClick={async () => {
          try { await flushBuffers(); message.success(t("源码草稿已保留，可随工程保存")); }
          catch (error) { message.error(String(error)); }
        }}>{t("保留源码草稿")}</Button>
        <Button type="primary" onClick={async () => {
          try { await useProject.getState().apply(file.id); message.success(t("修改已应用")); }
          catch (error) { message.error(String(error)); }
        }}>{t("应用修改")}</Button>
        {draft && <Button onClick={() => useProject.getState().discard(file.id)}>{t("放弃草稿")}</Button>}
      </>}
    </Space>
    {draft && <Alert type="warning" showIcon message={t("源码草稿尚未应用，运行配置导出将被阻止")} />}
    <div ref={host} />
  </div>;
}

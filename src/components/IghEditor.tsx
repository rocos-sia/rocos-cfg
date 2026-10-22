import { DiagnosticField, useDiagnosticRequest } from './DiagnosticNavigation';
import { useLocalizedMessage } from './useLocalizedMessage';
import { m as msg, MessageError } from '../core/project/messages';
import { diagnosticText, errorText, t } from '../i18n';
import { useEffect, useState } from 'react';
import { Alert, Button, Card, Input, Select, Space, Table, Tag, Modal } from 'antd';
import type { Document } from 'yaml';
import { fileById, textOf, type Project } from '../core/project/types';
import { readYaml } from '../core/documents/yaml';
import { exactInteger, SDO_TYPES } from '../core/bus/igh';
import { editProjectYaml, masterFileId, modifySequence, planSlaveChange, setInteger, type SlaveAction, type SlavePlan } from '../core/bus/igh-edit';
import { useProject } from '../store';
import { Fields } from './Fields';

function TextCell({ label, value, commit, fileId, field }: { label: string; value: unknown; fileId:string;field:string; commit: (value: string) => void }) {
  const saved = value == null ? '' : String(value);
  const [text, setText] = useState(saved);
  const message=useLocalizedMessage();
  useEffect(() => setText(saved), [saved]);
  return <DiagnosticField fileId={fileId} field={field}><Input aria-label={label} value={text} onChange={event => setText(event.target.value)}
    onBlur={() => { if (text !== saved) try { commit(text); } catch (error) { message.error(()=>(errorText(error,true))); } }}
    onPressEnter={event => event.currentTarget.blur()} /></DiagnosticField>;
}
const hex = (value: unknown) => typeof value === 'bigint' || typeof value === 'number' ? '0x' + value.toString(16).toUpperCase() : String(value ?? '');

export function IghEditor({ p }: { p: Project }) {
  const message=useLocalizedMessage();
  const [pending,setPending]=useState<{plan:SlavePlan;revision:number;epoch:number}>();
  const [selected, setSelected] = useState(0);
  const file = fileById(p, p.entrypoints.master.fileId)!;
  const diagnostic=useDiagnosticRequest();
  useEffect(()=>{if(diagnostic?.mode==='field'&&diagnostic.fileId===file.id&&diagnostic.index!==undefined)setSelected(diagnostic.index);},[diagnostic]);
  let config: any;
  try { config = readYaml(textOf(file)); } catch { return <Alert type="error" message={t("请先在源文件中修复 YAML 语法")} />; }
  const slaves = Array.isArray(config?.slaves) ? config.slaves : [];
  const index = Math.min(selected, Math.max(0, slaves.length - 1));
  const slave = slaves[index];
  const edit = (fn: (doc: Document) => void) => useProject.getState().change(next => editProjectYaml(next, masterFileId(next), fn));
  const run = (fn: () => void) => { try { fn(); } catch (error) { message.error(()=>(errorText(error,true))); } };
  const changeSlave = (action: SlaveAction) => run(() => {
    const preview = planSlaveChange(p, action);
    const apply = () => run(() => {
      if (useProject.getState().project?.revision !== p.revision) throw new MessageError(msg("工程已变化，请重新查看影响后操作"));
      useProject.getState().change(next => Object.assign(next, preview.project)); setSelected(preview.selected);
    });
    if (action.kind === 'add') apply();
    else setPending({plan:preview,revision:p.revision,epoch:useProject.getState().workspaceEpoch});
  });
  const rowActions = (path: (string | number)[], row: number, count: number, label: string) => <Space size={4}>
    <Button size="small" aria-label={t('{label}上移',{label})} disabled={!row} onClick={() => run(() => edit(doc => modifySequence(doc, path, 'up', row)))}>↑</Button>
    <Button size="small" aria-label={t('{label}下移',{label})} disabled={row === count - 1} onClick={() => run(() => edit(doc => modifySequence(doc, path, 'down', row)))}>↓</Button>
    <Button size="small" danger aria-label={t('{label}删除',{label})} onClick={() => run(() => edit(doc => modifySequence(doc, path, 'remove', row)))}>{t("删除")}</Button>
  </Space>;
  const integerCell = (label: string, value: unknown, path: (string | number)[], type: string, showHex = false) =>
    <TextCell fileId={file.id} field={path.join('.')} label={label} value={showHex ? hex(value) : value} commit={text => {
      let parsed: bigint;
      try { parsed = exactInteger(text, type); }
      catch (error) {
        // Keep unfinished values in the editable document as strings. The native
        // schema rejects them for runtime export, but an rcproj can retain them.
        edit(doc => doc.setIn(path, text));
        message.warning(()=>(t('输入已保留，尚未通过校验：{error}',{error:errorText(error,true)})));
        return;
      }
      edit(doc => setInteger(doc, path, parsed, showHex));
    }} />;
  return <div>
    <Modal title={t("确认从站及绑定变更")} open={!!pending} width={620} okText={t("应用变更")} cancelText={t("取消")} onCancel={()=>setPending(undefined)} onOk={()=>run(()=>{
      if(!pending)return;
      const state=useProject.getState();
      if(state.workspaceEpoch!==pending.epoch||state.project?.id!==p.id||state.project.revision!==pending.revision)throw new MessageError(msg("工程已变化，请重新查看影响后操作"));
      state.change(next=>Object.assign(next,pending.plan.project));setSelected(pending.plan.selected);setPending(undefined);
    })}>
      <ul>{pending?.plan.impactMessages.map((issue,i)=><li key={i}>{diagnosticText(issue)}</li>)}</ul>
    </Modal>
    <Space wrap className="section-tools">
      <Select aria-label={t("编辑从站")} style={{ minWidth: 230 }} value={slaves.length ? index : undefined} placeholder={t("请选择从站")}
        options={slaves.map((s: any, i: number) => ({ value: i, label: `${i} · ${s?.name ?? t("无名称")}` }))} onChange={setSelected} />
      <Button onClick={() => changeSlave({ kind: 'add' })}>{t("新增从站")}</Button>
      <Button disabled={!slave} onClick={() => changeSlave({ kind: 'copy', index })}>{t("复制从站")}</Button>
      <Button disabled={!slave || !index} onClick={() => changeSlave({ kind: 'up', index })}>{t("从站上移")}</Button>
      <Button disabled={!slave || index === slaves.length - 1} onClick={() => changeSlave({ kind: 'down', index })}>{t("从站下移")}</Button>
      <Button danger disabled={!slave} onClick={() => changeSlave({ kind: 'delete', index })}>{t("删除从站")}</Button>
    </Space>
    {slave && <>
      <Fields file={file} fields={[{ path: `slaves.${index}.name`, label: t("从站名称") }, { path: `slaves.${index}.dc_ref`, label: t("DC 参考从站"), type: 'boolean' }]} />
      {(['rx_pdos', 'tx_pdos'] as const).map(direction => {
        const pdos = Array.isArray(slave[direction]) ? slave[direction] : [];
        const title = direction === 'rx_pdos' ? 'RxPDO' : 'TxPDO';
        const path = ['slaves', index, direction];
        return <Card className="space-top" size="small" key={direction} title={`${title} · ${direction === 'rx_pdos' ? t("主站输出 → 从站") : t("从站 → 主站输入")}`}
          extra={<Button onClick={() => run(() => edit(doc => {
            const used = new Set(pdos.map((pdo: any) => Number(pdo?.index)));
            let next = direction === 'rx_pdos' ? 0x1600 : 0x1a00;
            while (used.has(next)) next++;
            modifySequence(doc, path, 'add', 0, { index: next, entries: [] });
          }))}>{t('新增 {title}',{title})}</Button>}>
          {pdos.map((pdo: any, pi: number) => {
            const pp = [...path, pi];
            const ep = [...pp, 'entries'];
            const entries = Array.isArray(pdo?.entries) ? pdo.entries : [];
            const prefix = `${title} ${pi + 1}`;
            return <div className="pdo-block" key={pi}>
              <Space wrap className="section-tools"><strong>{prefix}</strong><span>{t("PDO 索引")}</span>
                {integerCell(t('{prefix} PDO 索引',{prefix}), pdo?.index, [...pp, 'index'], 'uint16', true)}
                {rowActions(path, pi, pdos.length, `${prefix} `)}
                <Button onClick={() => run(() => edit(doc => modifySequence(doc, ep, 'add', 0, { name: '新信号', index: 0, sub_index: 0, bit_length: 8 })))}>{t('新增 {prefix} 条目',{prefix})}</Button>
              </Space>
              {!entries.length && <Alert type="info" message={t("运行时待发现：保留空 entries，启动时由主站发现并回写。")} />}
              {!!entries.length && <Table size="small" pagination={false} scroll={{ x: 880 }} rowKey={(_, i) => String(i)} dataSource={entries} columns={[
                { title: t("名称（区分大小写）"), width: 230, render: (_, entry, ei) => <TextCell fileId={file.id} field={[...ep,ei,'name'].join('.')} label={t('{prefix} 条目 {index} 名称',{prefix,index:ei+1})} value={entry?.name} commit={value => edit(doc => doc.setIn([...ep, ei, 'name'], value))} /> },
                { title: 'Index', width: 135, render: (_, entry, ei) => integerCell(t('{prefix} 条目 {index} Index',{prefix,index:ei+1}), entry?.index, [...ep, ei, 'index'], 'uint16', true) },
                { title: 'Sub-index', width: 115, render: (_, entry, ei) => integerCell(t('{prefix} 条目 {index} Sub-index',{prefix,index:ei+1}), entry?.sub_index, [...ep, ei, 'sub_index'], 'uint8', true) },
                { title: t("实际位宽"), width: 110, render: (_, entry, ei) => integerCell(t('{prefix} 条目 {index} 位宽',{prefix,index:ei+1}), entry?.bit_length, [...ep, ei, 'bit_length'], 'uint8') },
                { title: t("操作"), width: 190, render: (_, __, ei) => rowActions(ep, ei, entries.length, t('{prefix} 条目 {index} ',{prefix,index:ei+1})) },
              ]} />}
            </div>;
          })}
        </Card>;
      })}
      <Card className="space-top" size="small" title={t("PREOP SDO 初始化命令")} extra={<Button onClick={() => run(() => edit(doc => modifySequence(doc, ['slaves', index, 'init_commands'], 'add', 0, { index: 0x2000, sub_index: 0, Type: 'uint32', Value: 0n })))}>{t("新增 SDO 命令")}</Button>}>
        <p className="muted">{t("按列表顺序执行。64 位值支持精确十进制和非负十六进制；保留已有 Type/Value 或 type/value 字段形式。未通过校验的输入仍可保存工程，运行导出会被阻止。")}</p>
        <Table size="small" pagination={false} scroll={{ x: 1050 }} rowKey={(_, i) => String(i)} dataSource={Array.isArray(slave.init_commands) ? slave.init_commands : []} columns={[
          { title: '#', width: 50, render: (_, __, i) => i + 1 },
          { title: t("名称（可选）"), width: 170, render: (_, cmd, i) => <TextCell fileId={file.id} field={`slaves.${index}.init_commands.${i}.name`} label={t('SDO {index} 名称',{index:i+1})} value={cmd?.name} commit={value => edit(doc => { const path = ['slaves', index, 'init_commands', i, 'name']; if (value) doc.setIn(path, value); else doc.deleteIn(path); })} /> },
          { title: 'Index', width: 120, render: (_, cmd, i) => integerCell(`SDO ${i + 1} Index`, cmd?.index, ['slaves', index, 'init_commands', i, 'index'], 'uint16', true) },
          { title: 'Sub-index', width: 110, render: (_, cmd, i) => integerCell(`SDO ${i + 1} Sub-index`, cmd?.sub_index, ['slaves', index, 'init_commands', i, 'sub_index'], 'uint8', true) },
          { title: t("整数类型"), width: 120, render: (_, cmd, i) => <DiagnosticField fileId={file.id} field={`slaves.${index}.init_commands.${i}.${Object.hasOwn(cmd??{},'Type')?'Type':'type'}`}><Select style={{width:'100%'}} aria-label={t('SDO {index} 类型',{index:i+1})} value={cmd?.Type ?? cmd?.type} options={SDO_TYPES.map(value => ({ value, label: value }))} onChange={value => run(() => edit(doc => doc.setIn(['slaves', index, 'init_commands', i, Object.hasOwn(cmd, 'Type') ? 'Type' : 'type'], value)))} /></DiagnosticField> },
          { title: t("精确整数值"), width: 250, render: (_, cmd, i) => integerCell(t('SDO {index} 值',{index:i+1}), cmd?.Value ?? cmd?.value, ['slaves', index, 'init_commands', i, Object.hasOwn(cmd ?? {}, 'Value') ? 'Value' : 'value'], cmd?.Type ?? cmd?.type) },
          { title: t("操作"), width: 190, render: (_, __, i) => rowActions(['slaves', index, 'init_commands'], i, slave.init_commands.length, `SDO ${i + 1} `) },
        ]} />
        <Tag>{t("未执行 SDO 写入；请按设备字典核对索引与参数")}</Tag>
      </Card>
    </>}
  </div>;
}

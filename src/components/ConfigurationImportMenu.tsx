import { useState } from 'react';
import { Button, Dropdown, Space } from 'antd';
import { DownOutlined, ImportOutlined } from '@ant-design/icons';
import { fileAccess } from '../adapters/file-access';
import type { ImportTarget } from '../core/project/import';
import { errorText, t } from '../i18n';
import { useProject } from '../store';
import { useImportDialog } from './ImportDialog';
import { useLocalizedMessage } from './useLocalizedMessage';

const definitions: Record<ImportTarget, { label: string; directory?: boolean; accept?: string }> = {
  ecm: { label: '导入 ECM 配置', accept: '.yaml,.yml' },
  igh: { label: '导入 IGH 配置', accept: '.yaml,.yml' },
  urdf: { label: '导入 URDF 文件夹', directory: true },
  hardware: { label: '导入硬件配置', accept: '.yaml,.yml' },
  'app.payload': { label: '导入负载配置', accept: '.yaml,.yml' },
  mjcf: { label: '导入 MJCF 文件夹', directory: true },
  mujoco: { label: '导入仿真配置', accept: '.yaml,.yml' },
};

export function ConfigurationImportMenu({ targets }: { targets: ImportTarget[] }) {
  const [busy, setBusy] = useState(false);
  const { selectFiles, dialog } = useImportDialog();
  const message = useLocalizedMessage();
  const select = async (target: ImportTarget) => {
    const epoch = useProject.getState().workspaceEpoch, definition = definitions[target];
    setBusy(true);
    try {
      const files = await fileAccess().import(!!definition.directory, { accept: definition.accept, multiple: !!definition.directory });
      if (!files?.length) return;
      if (useProject.getState().workspaceEpoch !== epoch) throw new Error('导入期间工程已变化，请重新选择文件');
      if (!definition.directory && files.length !== 1) throw new Error('请只选择一个配置文件');
      await selectFiles(files, false, target);
    } catch (error) { message.error(() => errorText(error, true)); }
    finally { setBusy(false); }
  };
  return <>
    <Dropdown trigger={['click']} disabled={busy} menu={{
      items: targets.map(key => ({ key, label: t(definitions[key].label) })),
      onClick: ({ key }) => { void select(key as ImportTarget); },
    }}>
      <Button loading={busy} icon={<ImportOutlined aria-hidden />}><Space>{t('导入')}<DownOutlined aria-hidden /></Space></Button>
    </Dropdown>
    {dialog}
  </>;
}

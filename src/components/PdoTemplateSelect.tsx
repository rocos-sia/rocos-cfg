import { Select } from 'antd';
import { t } from '../i18n';
import { deviceTemplate, devicePresets, type DevicePreset } from '../core/project/templates';

export const pdoTemplateDescription = (preset: DevicePreset) => preset === 'blank'
  ? t('空白 PDO 配置，按需手动添加条目。') : t(deviceTemplate(preset).notice);
export function PdoTemplateSelect({ value, onChange, id }: { value: DevicePreset; onChange: (value: DevicePreset) => void; id?: string }) {
  return <Select id={id} aria-label={t('PDO 模板')} showSearch optionFilterProp="label" style={{ width: 250, maxWidth: '100%' }} value={value} onChange={onChange} options={[
    { value: 'blank', label: t('空白 PDO 配置') },
    ...(['drive', 'ft-sensor', 'io'] as const).map(type => ({ label: { drive: 'Drive', 'ft-sensor': 'FT-sensor', io: 'IO' }[type],
      options: Object.entries(devicePresets).filter(([, template]) => template.deviceType === type).map(([key, template]) => ({ value: key, label: `${template.brand || t('品牌未注明')} · ${template.model || t('型号未注明')} · ${template.variant}` })),
    })),
  ]} />;
}

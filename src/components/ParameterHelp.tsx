import { useEffect, useState, type ReactNode } from 'react';
import { Tooltip } from 'antd';
import { QuestionCircleOutlined } from '@ant-design/icons';
import { t } from '../i18n';
import { parameterHelp } from './parameterHelp';

export function ParameterHelp({ name, help }: { name: string; help: string }) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!open) return;
    const dismiss = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { setOpen(false); event.stopPropagation(); }
    };
    document.addEventListener('keydown', dismiss, true);
    return () => document.removeEventListener('keydown', dismiss, true);
  }, [open]);
  if (!help) return null;
  return <Tooltip title={t(help)} trigger={['hover', 'focus']} open={open} onOpenChange={setOpen}>
    <button type="button" className="parameter-help" aria-label={t('参数说明：{name}', { name })}
      onClick={() => setOpen(true)}>
      <QuestionCircleOutlined aria-hidden="true" />
    </button>
  </Tooltip>;
}

export function ParameterLabel({ htmlFor, children, role, path, help, unit }: {
  htmlFor?: string; children: ReactNode; role: string; path: string; help?: string; unit?: string;
}) {
  return <span className="field-heading"><label htmlFor={htmlFor}>{children}{unit && <span className="unit">{unit}</span>}</label>
    <ParameterHelp name={typeof children === 'string' ? children : path} help={parameterHelp(role, path) || help || ''} />
  </span>;
}

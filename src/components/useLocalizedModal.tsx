import { App, type ModalFuncProps } from 'antd';
import { Localized } from './Localized';

/** Factories must be pure: capture the operation once, regenerate only its display.
 * Locale changes preserve the modal instance, handlers, pending promise and focus.
 * React owns subscriptions, including cleanup on close or application unmount.
 */
export function useLocalizedModal() {
  const { modal } = App.useApp();
  const open = (kind: 'confirm' | 'success', factory: () => ModalFuncProps) => {
    const initial = factory();
    const config = { ...initial };
    for (const key of ['title', 'content', 'okText', 'cancelText'] as const) {
      if (initial[key] !== undefined) config[key] = <Localized render={() => factory()[key]} />;
    }
    if (initial.footer !== undefined) {
      config.footer = (node, buttons) => <Localized render={() => {
        const footer = factory().footer;
        return typeof footer === 'function' ? footer(node, buttons) : footer;
      }} />;
    }
    return modal[kind](config);
  };
  return {
    confirm: (factory: () => ModalFuncProps) => open('confirm', factory),
    success: (factory: () => ModalFuncProps) => open('success', factory),
  };
}

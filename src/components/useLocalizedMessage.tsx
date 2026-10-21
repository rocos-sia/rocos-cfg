import { App } from 'antd';
import { useMemo, type ReactNode } from 'react';
import { Localized } from './Localized';

/** A pure render function captures the notification's data, not its language.
 * Only content subscribes to locale updates: timeout, identity and onClose remain
 * owned by the original Ant Design notification and are never restarted.
 */
export function useLocalizedMessage() {
  const { message } = App.useApp();
  return useMemo(() => {
    const notify = (type: 'success' | 'error' | 'info' | 'warning') =>
      (render: () => ReactNode, duration?: number, onClose?: () => void) =>
        message.open({ type, content: <Localized render={render} />, duration, onClose });
    return { success: notify('success'), error: notify('error'), info: notify('info'), warning: notify('warning') };
  }, [message]);
}

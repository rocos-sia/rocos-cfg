import type { ReactNode } from 'react';
import { useLocale } from '../i18n';

/** Refresh display text without replacing its owner or repeating its operation. */
export function Localized({ render }: { render: () => ReactNode }) {
  useLocale();
  return render();
}

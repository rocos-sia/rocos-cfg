import { Button, Tooltip } from 'antd';
import type { ReactNode } from 'react';

export function PreviewButton({ label, icon, pressed, onClick }: { label: string; icon: ReactNode; pressed?: boolean; onClick: () => void }) {
  return <Tooltip classNames={{ root: 'preview-tool-tooltip' }} title={label} trigger={['hover', 'focus']}>
    <Button size="small" className="preview-icon-button" aria-label={label} aria-pressed={pressed} icon={icon} onClick={onClick} />
  </Tooltip>;
}

/** Face shading follows the view-preset affordance in rocos-viz v3. */
export function ViewIcon({ view }: { view: string }) {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" aria-hidden="true" focusable="false">
    {Object.entries({ top: '12,3 21,7.5 12,12 3,7.5', front: '3,7.5 12,12 12,21 3,16.5', side: '12,12 21,7.5 21,16.5 12,21' }).map(([face, points]) =>
      <polygon key={face} points={points} stroke="none" fill="currentColor" fillOpacity={view === face ? .45 : view === 'iso' ? .12 : 0} />)}
    <path d="M12 3 21 7.5v9L12 21 3 16.5v-9L12 3ZM3 7.5l9 4.5 9-4.5M12 12v9" />
  </svg>;
}

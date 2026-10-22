import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { t } from '../i18n';

const preferenceKey = 'rocos.hardware.sidebar-width';
const minimum = 240;
function initialWidth() {
  try { const value = Number(localStorage.getItem(preferenceKey)); return Number.isFinite(value) && value >= minimum ? value : 280; } catch { return 280; }
}

export function HardwareWorkspace({ children }: { children: [ReactNode, ReactNode] }) {
  const root = useRef<HTMLDivElement>(null);
  const drag = useRef<{ x: number; width: number } | undefined>(undefined);
  const [available, setAvailable] = useState(0), [preferred, setPreferred] = useState(initialWidth);
  const stacked = available < 900;
  const maximum = Math.max(minimum, Math.min(560, available - 600));
  const width = Math.max(minimum, Math.min(maximum, preferred));
  const clamp = (value: number) => Math.max(minimum, Math.min(maximum, value));
  const save = (value: number) => {
    value = clamp(value); setPreferred(value);
    try { localStorage.setItem(preferenceKey, String(value)); } catch { /* Keep the session preference. */ }
  };
  useLayoutEffect(() => {
    const element = root.current!;
    const observer = new ResizeObserver(([entry]) => setAvailable(entry.contentRect.width));
    observer.observe(element); return () => observer.disconnect();
  }, []);
  return <div ref={root} className="hardware-layout hardware-workspace" data-stacked={stacked}
    style={stacked ? undefined : { gridTemplateColumns: `${width}px 16px minmax(0, 1fr)` }}>
    {children[0]}
    {!stacked && <div className="hardware-resizer" role="separator" tabIndex={0} aria-label={t('调整硬件面板宽度')} aria-orientation="vertical"
        aria-valuemin={minimum} aria-valuemax={maximum} aria-valuenow={Math.round(width)}
        onKeyDown={event => {
          const value = event.key === 'ArrowLeft' ? width - 24 : event.key === 'ArrowRight' ? width + 24 : event.key === 'Home' ? minimum : event.key === 'End' ? maximum : undefined;
          if (value !== undefined) { event.preventDefault(); save(value); }
        }}
        onPointerDown={event => { if (event.button !== 0) return; event.currentTarget.focus(); drag.current = { x: event.clientX, width }; event.currentTarget.setPointerCapture(event.pointerId); }}
        onPointerMove={event => { if (drag.current) setPreferred(clamp(drag.current.width + event.clientX - drag.current.x)); }}
        onPointerUp={event => { if (!drag.current) return; save(drag.current.width + event.clientX - drag.current.x); drag.current = undefined; event.currentTarget.releasePointerCapture(event.pointerId); }}
        onPointerCancel={() => { if (drag.current) setPreferred(drag.current.width); drag.current = undefined; }}
        onLostPointerCapture={() => { drag.current = undefined; }} />
    }
    {children[1]}
  </div>;
}

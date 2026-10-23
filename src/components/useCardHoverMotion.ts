import { useCallback, useEffect, useRef, type PointerEvent } from 'react';

/** One rigid corner lift per mouse entry, returning to rest even after pointer exit. */
export function useCardHoverMotion() {
  const motions = useRef(new Map<HTMLElement, Animation>());
  useEffect(() => {
    const preference = matchMedia('(prefers-reduced-motion: reduce)');
    const cancel = () => { for (const motion of motions.current.values()) motion.cancel(); motions.current.clear(); };
    const update = () => { if (preference.matches) cancel(); };
    preference.addEventListener('change', update);
    return () => { preference.removeEventListener('change', update); cancel(); };
  }, []);
  return useCallback((event: PointerEvent<HTMLElement>) => {
    if (event.pointerType !== 'mouse' || matchMedia('(prefers-reduced-motion: reduce)').matches || !matchMedia('(hover: hover) and (pointer: fine)').matches) return;
    const card = event.target instanceof Element ? event.target.closest<HTMLElement>('.ant-card, .quick-navigation-card') : null;
    if (!card || !event.currentTarget.contains(card) || event.relatedTarget instanceof Node && card.contains(event.relatedTarget) || motions.current.has(card)) return;
    const motion = card.animate([
      { transform: 'perspective(1200px) rotate3d(-1, -1, 0, 0deg)', transformOrigin: 'left bottom', offset: 0, easing: 'cubic-bezier(.2,.7,.3,1)' },
      { transform: 'perspective(1200px) rotate3d(-1, -1, 0, .8deg)', transformOrigin: 'left bottom', offset: .38, easing: 'cubic-bezier(.25,.1,.25,1)' },
      { transform: 'perspective(1200px) rotate3d(-1, -1, 0, 0deg)', transformOrigin: 'left bottom', offset: 1 },
    ], { duration: 520 });
    motions.current.set(card, motion);
    const finish = () => { if (motions.current.get(card) === motion) motions.current.delete(card); };
    void motion.finished.then(finish, finish);
  }, []);
}

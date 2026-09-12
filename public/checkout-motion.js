const active = new WeakMap();

export function animateCheckout(element, mode = 'none') {
  active.get(element)?.();
  if (!element || !['fade', 'slide'].includes(mode) || !element.animate) return;
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  if (reduced.matches) return;
  const frames = mode === 'slide'
    ? [{ opacity: 0, transform: 'translateY(12px)' }, { opacity: 1, transform: 'translateY(0)' }]
    : [{ opacity: 0 }, { opacity: 1 }];
  const animation = element.animate(frames, { duration: 240, easing: 'ease-out' });
  const cleanup = () => {
    reduced.removeEventListener('change', cancel);
    if (active.get(element) === cancel) active.delete(element);
  };
  const cancel = () => { animation.cancel(); cleanup(); };
  active.set(element, cancel);
  animation.onfinish = cleanup;
  animation.oncancel = cleanup;
  reduced.addEventListener('change', cancel);
  return cancel;
}

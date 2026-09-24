import { ORDER_ANIMATIONS, normalizeOrderAnimation } from './order-animation-options.js';
import { animateOrderScene, drawOrderScene } from './order-animation-scene.js';

let activeClose;

export function showOrderAnimation(options = {}) {
  const config = normalizeOrderAnimation(options);
  if (config.style === 'none') return Promise.resolve();
  // An unavailable enhancement must never hold an already confirmed order hostage.
  if (!document.querySelector('link[href="/order-animation.css"]')?.sheet) return Promise.resolve();
  activeClose?.();
  return new Promise(resolve => {
    const previousFocus = document.activeElement;
    const reduced = matchMedia('(prefers-reduced-motion: reduce)');
    const choice = ORDER_ANIMATIONS.find(item => item.id === config.style);
    const accent = /^#[a-f\d]{6}$/i.test(options.accent || '') ? options.accent : choice.color;
    const dialog = document.createElement('dialog');
    dialog.className = 'order-animation-dialog';
    dialog.setAttribute('aria-labelledby', 'order-animation-heading');
    dialog.setAttribute('aria-describedby', 'order-animation-description');
    dialog.style.setProperty('--oa-accent', accent);
    dialog.innerHTML = `<div class="oa-confirmation"><span class="oa-eyebrow">${options.preview ? 'ANIMATION PREVIEW' : 'THANK YOU FOR YOUR ORDER'}</span><div class="oa-art"><canvas aria-hidden="true"></canvas></div><div class="oa-confirmation-copy"><h2 id="order-animation-heading">Order confirmed</h2><p id="order-animation-description">${options.preview ? 'Sample order. Nothing has been purchased.' : "We've received your order. We'll prepare it for delivery."}</p></div><div class="oa-timeline" aria-hidden="true"><span class="is-done">Received</span><span>Confirmed</span><span>Thank you</span></div><div class="oa-playback" aria-hidden="true"><i></i></div><div class="oa-confirmation-actions">${options.preview ? '<button class="oa-replay" type="button" aria-label="Replay order animation"><img src="/icons/rotate-ccw.svg" alt="" width="18" height="18"> Replay</button>' : ''}<button class="oa-continue" type="button">${options.preview ? 'Close preview' : 'Continue'}<img src="/icons/arrow-right.svg" alt="" width="18" height="18"></button></div></div>`;
    const canvas = dialog.querySelector('canvas');
    const progressBar = dialog.querySelector('.oa-playback i');
    const stages = [...dialog.querySelectorAll('.oa-timeline span')];
    let stop = () => {}, timer, closed = false, image;
    const close = () => {
      if (closed) return;
      closed = true; stop(); clearTimeout(timer);
      reduced.removeEventListener('change', motionChanged);
      window.removeEventListener('pagehide', close);
      dialog.close(); dialog.remove();
      if (activeClose === close) activeClose = null;
      if (previousFocus?.isConnected) previousFocus.focus({ preventScroll: true });
      resolve();
    };
    const motionChanged = () => {
      if (reduced.matches && !options.preview) { clearTimeout(timer); timer = setTimeout(close, 400); }
    };
    const play = () => {
      stop();
      stop = animateOrderScene(canvas, { ...config, accent, image }, progress => {
        progressBar.style.transform = `scaleX(${progress})`;
        stages.forEach((stage, i) => stage.classList.toggle('is-done', progress >= [0, .38, .84][i]));
      });
    };
    dialog.querySelector('.oa-continue').onclick = close;
    dialog.querySelector('.oa-replay')?.addEventListener('click', play);
    dialog.addEventListener('cancel', event => { event.preventDefault(); close(); });
    dialog.addEventListener('close', close);
    document.body.append(dialog);
    activeClose = close;
    try { dialog.showModal(); } catch { close(); return; }
    // Reuse the already visible product image; never block animation on media loading.
    if (options.productImage?.complete && options.productImage.naturalWidth) image = options.productImage;
    drawOrderScene(canvas, { ...config, accent, image, progress: reduced.matches ? 1 : 0 });
    play();
    dialog.querySelector('.oa-continue').focus({ preventScroll: true });
    reduced.addEventListener('change', motionChanged);
    window.addEventListener('pagehide', close, { once: true });
    if (!options.preview) timer = setTimeout(close, reduced.matches ? 400 : config.durationMs + 180);
  });
}

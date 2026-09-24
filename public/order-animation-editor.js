import { ORDER_ANIMATIONS, normalizeOrderAnimation } from './order-animation-options.js';
import { drawOrderScene } from './order-animation-scene.js';
import { showOrderAnimation } from './order-animation.js';

export function mountOrderAnimationEditor(form, config) {
  const initial = normalizeOrderAnimation(config.orderAnimation);
  const pane = document.createElement('section');
  pane.className = 'cod-settings-pane oa-editor';
  pane.dataset.codPane = 'animation';
  pane.innerHTML = `<div class="oa-editor-heading"><h2>Order animation</h2><span class="oa-count">10 styles</span></div><div class="oa-editor-layout"><div class="oa-picker"><label class="oa-off"><input type="radio" name="order-animation-style" value="none" ${initial.style === 'none' ? 'checked' : ''}><span>Off</span></label><div class="oa-catalogue" role="radiogroup" aria-label="Order confirmation style">${ORDER_ANIMATIONS.map(option => `<label class="oa-option"><input type="radio" name="order-animation-style" value="${option.id}" ${initial.style === option.id ? 'checked' : ''}><canvas data-style="${option.id}" aria-hidden="true"></canvas><span class="oa-option-name">${option.name}</span><small>${option.detail}</small></label>`).join('')}</div></div><aside class="oa-editor-preview"><div class="oa-preview-heading"><strong data-animation-title>Order confirmation</strong><span>Preview</span></div><div class="oa-art"><canvas id="order-animation-canvas" aria-hidden="true"></canvas></div><div class="oa-preview-copy"><strong>Order confirmed</strong><p>Thank you for shopping with us.</p></div><div class="oa-preview-controls"><label class="field">Duration <output for="order-animation-duration"></output><input id="order-animation-duration" name="order-animation-duration" type="range" min="2000" max="5000" step="500" value="${initial.durationMs}"></label><button class="secondary" type="button" data-preview-order-animation><img src="/icons/play.svg" width="18" height="18" alt=""> Play preview</button></div></aside></div>`;
  form.append(pane);
  const read = () => ({ style: form.elements['order-animation-style'].value, durationMs: Number(form.elements['order-animation-duration'].value) });
  function render() {
    const { style, durationMs } = read();
    const option = ORDER_ANIMATIONS.find(item => item.id === style);
    pane.querySelector('[data-animation-title]').textContent = option?.name || 'Animation off';
    pane.querySelector('output').value = `${(durationMs / 1000).toFixed(1)}s`;
    pane.querySelector('[data-preview-order-animation]').disabled = style === 'none';
    form.elements['order-animation-duration'].disabled = style === 'none';
    drawOrderScene(pane.querySelector('#order-animation-canvas'), { style, accent: option?.color, progress: .52 });
  }
  pane.addEventListener('input', render);
  pane.querySelector('[data-preview-order-animation]').onclick = () => showOrderAnimation({ ...read(), preview: true });
  for (const canvas of pane.querySelectorAll('[data-style]')) {
    const option = ORDER_ANIMATIONS.find(item => item.id === canvas.dataset.style);
    drawOrderScene(canvas, { style: option.id, accent: option.color, progress: .52 });
  }
  render();
  return { read };
}

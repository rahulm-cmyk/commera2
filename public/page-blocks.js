// Shared by the editor canvas and the customer storefront renderer.
const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const safeUrl = (value, image = false) => {
  const url = String(value || '').trim();
  if (/[\u0000-\u0020\\]/.test(url)) return '';
  if (/^https?:\/\//i.test(url) || /^\/(?!\/)/.test(url) || (!image && /^#/.test(url))) return url;
  if (image && /^data:image\/(png|jpeg|webp|gif);base64,[a-z0-9+/=]+$/i.test(url)) return url;
  return '';
};
export function normalizeBlocks(blocks = []) {
  if (!Array.isArray(blocks) || blocks.length > 40) throw Error('A section can contain up to 40 blocks');
  const ids = new Set();
  return blocks.map((block, index) => {
    if (!block || !['heading','text','image','button'].includes(block.type)) throw Error('Unsupported block type');
    const id = String(block.id || `block-${index}`).replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 100);
    if (!id || ids.has(id)) throw Error('Block IDs must be unique within a section');
    ids.add(id);
    return { id, type: block.type, visible: block.visible !== false,
      text: String(block.text || '').slice(0, 5000), alt: String(block.alt || '').slice(0, 300),
      url: safeUrl(String(block.url || '').slice(0, 2000000), block.type === 'image') };
  });
}
export function renderBlocks(blocks, { editor = false, selectedId = null } = {}) {
  return normalizeBlocks(blocks).filter(block => block.visible).map(block => {
    const text = escape(block.text);
    const content = block.type === 'heading' ? `<h2>${text || (editor ? 'Heading' : '')}</h2>`
      : block.type === 'text' ? `<p>${text || (editor ? 'Add your text' : '')}</p>`
      : block.type === 'image' ? block.url ? `<img src="${escape(block.url)}" alt="${escape(block.alt)}" loading="lazy">` : editor ? '<p class="page-block-placeholder">Add an image URL</p>' : ''
      : block.url ? `<a class="page-block-button" href="${escape(block.url)}">${text || 'Learn more'}</a>` : editor ? `<span class="page-block-button">${text || 'Button'}</span>` : '';
    return `<div class="page-block${editor && selectedId === block.id ? ' is-selected' : ''}"${editor ? ` data-builder-block="${escape(block.id)}" tabindex="0" role="button" aria-label="Edit ${escape(block.type)} block"` : ''}>${content}</div>`;
  }).join('');
}

// Restrict generated CSS to supported values; never interpolate arbitrary style text.
export function blockSectionStyle(settings = {}) {
  const px = (key, fallback = 0) => `${Math.max(0, Math.min(200, Number.isFinite(Number(settings[key])) ? Number(settings[key]) : fallback))}px`;
  const color = (value, fallback) => /^#[a-f0-9]{3,8}$/i.test(String(value)) ? value : fallback;
  return `text-align:${['left','center','right'].includes(settings.alignment) ? settings.alignment : 'left'};padding:${px('paddingTop',20)} ${px('paddingRight',20)} ${px('paddingBottom',20)} ${px('paddingLeft',20)};margin-top:${px('marginTop')};margin-bottom:${px('marginBottom')};background:${color(settings.backgroundColor,'transparent')};color:${color(settings.textColor,'inherit')};border-radius:${px('borderRadius')};width:100%;max-width:${settings.width === 'full' ? 'none' : 'var(--page-max-width, var(--builder-max, 1200px))'};margin-left:auto;margin-right:auto;`;
}

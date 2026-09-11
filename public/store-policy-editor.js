export const storePolicyEntries = policies => [
  ...(policies?.written || []),
  ...(policies?.contact ? [policies.contact] : []),
];

export function storePolicyConnectionsMarkup(policies, storeId, escape, icon) {
  return `<div class="store-policy-heading"><strong>Store policies</strong><button type="button" class="icon-button" data-store-policy-manage title="Manage policies" aria-label="Manage policies">${icon('arrow-up-right')}</button></div><div class="store-policy-list">${storePolicyEntries(policies).map(policy => {
    const label=escape(policy.label),type=escape(policy.type),published=policy.status==='published',configured=policy.status!=='no_policy';
    return `<article class="store-policy-connection" data-policy-type="${type}"><div><strong>${label}</strong><span class="store-policy-status" data-status="${escape(policy.status)}">${published?'Published':configured?'Draft':'Not set'}</span></div><div class="store-policy-actions"><button type="button" class="icon-button" data-store-policy-edit="${type}" title="Edit ${label}" aria-label="Edit ${label}">${icon('pencil')}</button>${configured?`<a class="icon-button" href="/api/stores/${Number(storeId)}/policies/written/${encodeURIComponent(policy.type)}/preview" target="_blank" rel="noopener" title="Preview ${label}" aria-label="Preview ${label}">${icon('eye')}</a>`:`<button type="button" class="icon-button" disabled title="Save this policy before previewing" aria-label="Preview ${label}">${icon('eye')}</button>`}${published?`<button type="button" class="icon-button" data-store-policy-unpublish="${type}" title="Unpublish ${label}" aria-label="Unpublish ${label}">${icon('eye-off')}</button>`:`<button type="button" class="secondary" data-store-policy-publish="${type}" aria-label="Publish ${label}" ${configured?'':'disabled'}>Publish</button>`}</div></article>`;
  }).join('')}</div>`;
}

export function syncStorePolicyPreview(doc, policies, slug, escape) {
  const footer=doc.querySelector('[data-store-editor-section="footer"]');
  if (!footer) return;
  const published=storePolicyEntries(policies).filter(policy=>policy.status==='published');
  let nav=footer.querySelector('nav[aria-label="Policies"]');
  if (!published.length) {nav?.remove();return;}
  if (!nav) {
    nav=doc.createElement('nav');nav.setAttribute('aria-label','Policies');
    footer.insertBefore(nav,footer.querySelector(':scope > small'));
  }
  const html='<strong>Policies</strong>'+published.map(policy=>`<a href="/s/${encodeURIComponent(slug)}/policies/${encodeURIComponent(policy.type)}">${escape(policy.label||policy.title||policy.type)}</a>`).join('');
  if(nav.innerHTML!==html)nav.innerHTML=html;
}

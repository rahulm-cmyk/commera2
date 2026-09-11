const money = (value, currency = 'INR') => new Intl.NumberFormat('en-IN', { style: 'currency', currency }).format(value / 100);

export function validateStorePackage(input) {
  if (input?.format !== 'commera-store-package' || input.version !== 1) throw Error('Choose a Commera2 store package.');
  if (!input.name?.trim() || !input.home || !input.branding) throw Error('The package is missing its store design.');
  if (!Array.isArray(input.products) || !input.products.length || input.products.length > 25) throw Error('A package needs between 1 and 25 products.');
  const slugs = new Set();
  for (const item of input.products) {
    if (!item.name?.trim() || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(item.slug) || slugs.has(item.slug)) throw Error('Product names and unique URLs are required.');
    slugs.add(item.slug);
    if (!Number.isInteger(item.pricePaise) || item.pricePaise < 0) throw Error('Product prices must be valid amounts.');
    if (item.stock !== null && (!Number.isInteger(item.stock) || item.stock < 0)) throw Error('Stock must be zero or a positive whole number.');
    if (!item.description?.trim() || !item.mainImage?.data) throw Error('Every product needs a description and image.');
  }
  for (const offer of input.bundles || []) if (!slugs.has(offer.productSlug) || !Number.isInteger(offer.quantity) || offer.quantity < 2 || !Number.isInteger(offer.pricePaise) || offer.pricePaise < 0) throw Error('A bundle is invalid.');
  for (const offer of [...(input.upsells || []), ...(input.downsells || [])]) {
    if (!slugs.has(offer.productSlug) || !slugs.has(offer.offerProductSlug)) throw Error('An offer refers to a missing product.');
  }
  return input;
}

export async function applyStorePackage(input, store, api, { backup, progress = () => {}, hideOtherProducts = false, checkContext = () => {} } = {}) {
  const pack = validateStorePackage(input), root = `/api/stores/${store.id}`;
  if ((store.currency || 'INR') !== (pack.currency || 'INR')) throw Error('The package currency must match this store.');
  const call = async (path, method = 'GET', body) => {
    checkContext();
    return api(root + path, { method, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  };
  progress('Backing up the existing store...');
  const before = { store, storefront: await call('/storefront'), products: await call('/products'), pages: await call('/pages'), bundles: await call('/bundles'), upsells: await call('/upsells'), downsells: await call('/downsells'), exitOffers: await call('/exit-offers') };
  if (!backup) throw Error('A backup destination is required before importing.');
  await backup(before);
  const products = new Map();
  for (const item of pack.products) {
    progress(`Connecting ${item.name}...`);
    const existing = before.products.find(product => product.slug === item.slug);
    const values = { name: item.name, slug: item.slug, pricePaise: item.pricePaise, comparePricePaise: item.comparePricePaise ?? null, description: item.description, ...(item.stock === null && existing ? {} : { stock: item.stock ?? 0 }), status: 'active' };
    const product = await call(existing ? `/products/${existing.id}` : '/products', existing ? 'PATCH' : 'POST', values);
    products.set(item.slug, product);
    const pageSlug = `${item.slug}-store`;
    let page = before.pages.find(page => page.productId === product.id && page.slug === pageSlug);
    if (!page) page = await call('/pages', 'POST', { productId: product.id, title: item.name, slug: pageSlug, body: item.description });
    await call(`/pages/${page.id}/publish`, 'POST', {});
    await call(`/storefront/products/${product.id}/page`, 'PATCH', { pageId: page.id });
    await call(`/storefront/products/${product.id}`, 'PATCH', { description: item.description, mainImage: item.mainImage, additionalImages: item.additionalImages || [], buttonText: 'Buy now', buttonAction: 'checkout', publish: true });
  }
  progress('Connecting offers...');
  for (const offer of pack.bundles || []) {
    const values = { ...offer, productId: products.get(offer.productSlug).id };
    const existing = before.bundles.find(item => item.productId === values.productId && item.name === values.name);
    if (existing && (existing.pricePaise !== values.pricePaise || existing.quantity !== values.quantity)) throw Error(`Bundle ${values.name} already exists with different pricing. Review it before importing again.`);
    if (!existing) await call('/bundles', 'POST', values);
  }
  for (const offer of pack.upsells || []) {
    const values = { ...offer, productId: products.get(offer.productSlug).id, upsellProductId: products.get(offer.offerProductSlug).id };
    const existing = before.upsells.find(item => item.name === values.name && item.productId === values.productId);
    await call(existing ? `/upsells/${existing.id}` : '/upsells', existing ? 'PATCH' : 'POST', values);
  }
  for (const offer of pack.downsells || []) {
    const values = { ...offer, productId: products.get(offer.productSlug).id, downsellProductId: products.get(offer.offerProductSlug).id };
    const existing = before.downsells.find(item => item.title === values.title && item.productId === values.productId && item.downsellProductId === values.downsellProductId);
    if (existing && existing.pricePaise !== values.pricePaise) throw Error(`Downsell ${values.title} has different pricing. Review it before importing again.`);
    if (!existing) await call('/downsells', 'POST', values);
  }
  for (const offer of pack.exitOffers || []) {
    const values = { ...offer, ...(offer.productSlug ? { targetType: 'specific_product', targetProductId: products.get(offer.productSlug)?.id } : {}) };
    const existing = before.exitOffers.find(item => item.name === values.name);
    await call(existing ? `/exit-offers/${existing.id}` : '/exit-offers', existing ? 'PATCH' : 'POST', values);
  }
  progress('Saving the homepage...');
  const remap = value => {
    if (typeof value === 'string') return value.replaceAll('{{store}}', `/s/${encodeURIComponent(store.slug)}`);
    if (Array.isArray(value)) return value.map(remap);
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, remap(item)]));
    return value;
  };
  await call('/storefront/branding', 'PATCH', { ...pack.branding, storeName: pack.name });
  await call('/storefront/home', 'PATCH', { ...remap(pack.home), featuredProductIds: [...products.values()].map(item => item.id), buttonTarget: { type: 'product', id: products.get(pack.primaryProductSlug)?.id || products.values().next().value.id } });
  // Hide old catalogue entries only after the replacement design is safely saved.
  if (hideOtherProducts) for (const product of before.products) {
    if (!products.has(product.slug) && product.active) await call(`/products/${product.id}`, 'PATCH', { status: 'draft' });
  }
  return { products: [...products.values()], draftSaved: true };
}

export function mountStorePackageImport({ host, store, api, escape, isDirty, isCurrent, onSaved }) {
  const trigger = document.createElement('button');
  trigger.type = 'button';
  trigger.textContent = 'Import store package';
  host.append(trigger);
  trigger.onclick = () => {
    if (isDirty()) { alert('Save or discard your current changes before importing a store.'); return; }
    host.closest('details')?.removeAttribute('open');
    const dialog = document.createElement('dialog');
    dialog.className = 'store-package-dialog';
    dialog.innerHTML = `<h2>Import store</h2><p>${escape(store.name)}</p><label class="field">Store package<input type="file" accept="application/json,.json"></label><div data-package-summary></div><label class="toggle-row"><span>Hide other products from the storefront</span><input type="checkbox" data-hide-others></label><p role="status" aria-live="polite"></p><div class="store-package-actions"><button type="button" class="secondary" data-cancel>Cancel</button><button type="button" class="primary" data-import disabled>Import and save</button></div>`;
    document.body.append(dialog);
    let pack, busy = false;
    const status = dialog.querySelector('[role=status]'), submit = dialog.querySelector('[data-import]');
    dialog.addEventListener('cancel', event => { if (busy) event.preventDefault(); });
    dialog.addEventListener('close', () => dialog.remove());
    dialog.querySelector('[data-cancel]').onclick = () => dialog.close();
    dialog.querySelector('[type=file]').onchange = async event => {
      submit.disabled = true; pack = null;
      try {
        const file = event.target.files[0];
        if (!file) return;
        if (file.size > 20 * 1024 * 1024) throw Error('Store packages must be 20 MB or smaller.');
        pack = validateStorePackage(JSON.parse(await file.text()));
        dialog.querySelector('[data-package-summary]').innerHTML = `<h3>${escape(pack.name)}</h3><table><thead><tr><th>Product</th><th>Price</th><th>Inventory</th></tr></thead><tbody>${pack.products.map(item => `<tr><td>${escape(item.name)}</td><td>${money(item.pricePaise,pack.currency||'INR')}</td><td>${item.stock === null ? 'Keep current stock' : item.stock ? item.stock : 'Sold out'}</td></tr>`).join('')}</tbody></table><p>Existing orders, customers and domains will not be changed. A backup will download before importing. Product pages become public during import; the homepage remains a draft until published.</p>`;
        status.textContent = ''; submit.disabled = false;
      } catch (error) { status.textContent = error.message; }
    };
    submit.onclick = async () => {
      if (!pack || busy) return;
      busy = true; dialog.querySelectorAll('button,input').forEach(item => item.disabled = true);
      try {
        await applyStorePackage(pack, store, api, {
          hideOtherProducts: dialog.querySelector('[data-hide-others]').checked,
          checkContext: () => { if (!isCurrent()) throw Error('The selected store changed. Import stopped.'); },
          progress: message => { status.textContent = message; },
          backup: async data => {
            const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
            const url = URL.createObjectURL(blob), link = document.createElement('a');
            link.href = url; link.download = `${store.slug}-before-import-${Date.now()}.json`; link.click();
            setTimeout(() => URL.revokeObjectURL(url), 60000);
          },
        });
        dialog.close(); await onSaved();
      } catch (error) {
        status.textContent = `${error.message} Import stopped. Any completed steps were saved; your backup contains the previous settings.`;
        dialog.querySelectorAll('button,input').forEach(item => item.disabled = false);
      } finally { busy = false; }
    };
    dialog.showModal();
  };
}

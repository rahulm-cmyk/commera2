export const workspaceDestinations = [
  { label: 'UTM Sheet', description: 'Google Sheets order export', path: '/campaigns', icon: 'file-spreadsheet' },
  { label: 'Home', description: 'Sales, orders and store setup', path: '/overview', icon: 'house' },
  { label: 'Orders', description: 'Find orders and manage deliveries', path: '/orders', icon: 'shopping-bag' },
  { label: 'Products', description: 'Prices, stock and product details', path: '/products', icon: 'package' },
  { label: 'Customers', description: 'Customer details and order history', path: '/customers', icon: 'users' },
  { label: 'Store design', description: 'Edit your homepage and preview your store', path: '/online-store/themes', icon: 'store' },
  { label: 'Product pages', description: 'Design the pages your customers buy from', path: '/product-pages', icon: 'panels-top-left' },
  { label: 'Reviews', description: 'Approve and manage customer reviews', path: '/reviews', icon: 'star' },
  { label: 'Live visitors', description: 'See who is browsing your store', path: '/live-visitors', icon: 'activity' },
  { label: 'Store pages', description: 'About, FAQs and other information', path: '/online-store/pages', icon: 'file-text' },
  { label: 'Domains', description: 'Connect your website address', path: '/settings/domain', icon: 'globe' },
  { label: 'Settings', description: 'Checkout, delivery and store preferences', path: '/settings', icon: 'settings-2' },
  { label: 'Store policies', description: 'Returns, shipping and privacy policies', path: '/policy', icon: 'shield-check' },
  { label: 'Account & security', description: 'Your profile, password and sign-in', path: '/account', icon: 'shield-check' },
];

export const workspaceIcon = name => `<img class="workspace-icon" src="/icons/${name}.svg" width="18" height="18" alt="" aria-hidden="true">`;

export function setupStoreSwitcher({ document, select }) {
  const root = document.querySelector('.store-switcher');
  const trigger = document.querySelector('#store-switcher-trigger');
  const current = document.querySelector('#store-switcher-current');
  const options = document.querySelector('#store-switcher-options');
  if (!root || !trigger || !current || !options) return { sync() {}, close() {} };
  const close = () => {
    options.hidden = true;
    trigger.setAttribute('aria-expanded', 'false');
  };
  const sync = () => {
    const selected = select.selectedOptions[0];
    const name = selected?.textContent || 'No store selected';
    trigger.querySelector('strong').textContent = name;
    trigger.setAttribute('aria-label', `Switch store, current store: ${name}`);
    current.querySelector('strong').textContent = name;
    trigger.hidden = select.options.length < 2;
    current.hidden = !trigger.hidden;
    trigger.disabled = select.disabled;
    select.closest('.store-label').hidden = true;
    options.replaceChildren(...[...select.options].map(option => {
      const button = document.createElement('button');
      button.type = 'button';
      button.dataset.storeValue = option.value;
      button.insertAdjacentHTML('afterbegin', workspaceIcon('store'));
      const label = document.createElement('span');
      label.textContent = option.textContent;
      button.append(label);
      if (option.selected) {
        button.setAttribute('aria-current', 'true');
        button.insertAdjacentHTML('beforeend', workspaceIcon('check'));
      }
      return button;
    }));
    close();
  };
  trigger.addEventListener('click', () => {
    if (!options.hidden) return close();
    options.hidden = false;
    trigger.setAttribute('aria-expanded', 'true');
    (options.querySelector('[aria-current="true"]') || options.querySelector('button'))?.focus();
  });
  options.addEventListener('click', async event => {
    const button = event.target.closest('[data-store-value]');
    if (!button || select.disabled) return;
    close();
    trigger.focus();
    trigger.disabled = true;
    select.value = button.dataset.storeValue;
    try { await select.onchange?.(); }
    finally { sync(); }
  });
  root.addEventListener('keydown', event => {
    if (options.hidden) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      close();
      trigger.focus();
      return;
    }
    const buttons = [...options.querySelectorAll('button')];
    const index = buttons.indexOf(document.activeElement);
    const targets = { ArrowDown: Math.min(index + 1, buttons.length - 1), ArrowUp: Math.max(index - 1, 0), Home: 0, End: buttons.length - 1 };
    if (event.key in targets) {
      event.preventDefault();
      buttons[targets[event.key]]?.focus();
    }
  });
  root.addEventListener('focusout', event => {
    if (!root.contains(event.relatedTarget)) close();
  });
  document.addEventListener('click', event => { if (!root.contains(event.target)) close(); });
  return { sync, close };
}

export function matchingDestinations(query) {
  const words = String(query || '').toLowerCase().trim().split(/\s+/).filter(Boolean);
  return workspaceDestinations.filter(item => words.every(word => `${item.label} ${item.description}`.toLowerCase().includes(word)));
}

export function setupWorkspaceSearch({ document, navigate, onError }) {
  const dialog = document.querySelector('#workspace-search'), input = document.querySelector('#workspace-search-input'),
    results = document.querySelector('#workspace-search-results');
  if (!dialog || !input || !results) return;
  let returnFocus = null;
  const renderResults = () => {
    const matches = matchingDestinations(input.value);
    results.innerHTML = matches.map(item => `<button type="button" class="workspace-search-result" data-destination="${item.path}"><span class="search-result-icon">${workspaceIcon(item.icon)}</span><span class="search-result-copy"><strong>${item.label}</strong><small>${item.description}</small></span>${workspaceIcon('chevron-right')}</button>`).join('') || '<p class="workspace-search-empty" role="status">No matching pages.</p>';
  };
  document.querySelectorAll('[data-workspace-search]').forEach(button => button.addEventListener('click', () => {
    returnFocus = button;
    input.value = '';
    renderResults();
    dialog.showModal();
    input.focus();
  }));
  document.querySelector('#workspace-search-close').onclick = () => dialog.close();
  input.addEventListener('input', renderResults);
  dialog.addEventListener('close', () => returnFocus?.focus());
  dialog.addEventListener('click', event => {
    const button = event.target.closest('[data-destination]');
    if (!button) return;
    dialog.close();
    Promise.resolve(navigate(button.dataset.destination)).catch(onError);
  });
  dialog.addEventListener('keydown', event => {
    const buttons = [...results.querySelectorAll('[data-destination]')];
    const index = buttons.indexOf(document.activeElement);
    if (event.key === 'ArrowDown' && buttons.length) {
      event.preventDefault(); buttons[Math.min(index + 1, buttons.length - 1)].focus();
    } else if (event.key === 'ArrowUp') {
      event.preventDefault(); if (index <= 0) input.focus(); else buttons[index - 1].focus();
    } else if (event.key === 'Enter' && document.activeElement === input && buttons.length) {
      event.preventDefault(); buttons[0].click();
    }
  });
}

export function overviewMarkup({ data, esc, money, storeUrl, ordersHtml }) {
  const funnel = data.pixels?.funnel || {}, products = data.products || [], pages = data.pages || [],
    live = Boolean(data.storefrontPublication?.live ?? data.storefront?.home?.status === 'published');
  const steps = [
    { label: 'Add your products', note: `${products.length} products in your catalogue`, done: products.length > 0, path: '/products', icon: 'package' },
    { label: 'Create your product pages', note: `${pages.filter(p => p.status === 'published').length} published pages`, done: pages.some(p => p.status === 'published'), path: '/product-pages', icon: 'panels-top-left' },
    { label: 'Publish your store', note: live ? 'Your storefront is open to customers' : 'Review your design before going live', done: live, path: '/online-store/themes', icon: 'store' },
  ];
  const journey = [['Product views',funnel.productPageViews],['Added to cart',funnel.addToCart],['Started checkout',funnel.checkoutStarted],['Phone verified',funnel.otpVerified],['Orders placed',funnel.orders]];
  const maximum = Math.max(1,...journey.map(([,n]) => Number(n) || 0));
  const stat = (label,value,note,icon,tone) => `<article class="summary-stat ${tone}"><div class="summary-stat-label">${workspaceIcon(icon)}<span>${label}</span></div><strong class="summary-stat-value">${value}</strong><small class="summary-stat-note">${note}</small></article>`;
  return `<div class="merchant-overview"><section class="overview-summary" aria-label="Store performance">${stat('Total sales',money(data.metrics.totalSalesPaise),'From completed orders','credit-card','teal')}${stat('Orders',data.metrics.orders,'Successfully submitted','shopping-bag','blue')}${stat('Conversion rate',esc(funnel.conversionRate || 0)+'%','Orders from product page views','mouse-pointer-2','amber')}${stat('Live visitors',data.liveVisitors?.count || 0,'Browsing right now','activity','teal')}</section>
    <section class="overview-shortcuts" aria-label="Quick actions">${[['Add a product','/products/new','plus'],['Manage orders','/orders','shopping-bag'],['Edit store design','/online-store/themes','paintbrush'],['Connect a domain','/settings/domain','globe']].map(([label,path,icon]) => `<button class="shortcut-action" type="button" data-workspace-go="${path}">${workspaceIcon(icon)}<span>${label}</span>${workspaceIcon('arrow-right')}</button>`).join('')}</section>
    <div class="overview-columns"><section class="journey-section"><div class="section-heading"><div><h2>Customer journey</h2><p>From browsing to buying</p></div><span class="period-label">All time</span></div><div class="journey-bars">${journey.map(([label,n],index)=>`<div class="journey-row"><span class="journey-label">${label}</span><div class="journey-track"><i style="width:${Math.min(100,Math.max(0,(Number(n)||0)/maximum*100))}%" class="journey-bar-${index}"></i></div><strong class="journey-count">${esc(n||0)}</strong></div>`).join('')}</div><div class="journey-footer"><span>${Number(data.abandoned?.length || 0)} unfinished checkouts</span><button type="button" class="text-action" data-workspace-go="/abandoned">View checkouts ${workspaceIcon('arrow-right')}</button></div></section>
    <aside class="store-readiness"><div class="section-heading"><h2>Your store</h2><span class="store-state ${live?'is-live':''}">${live?'Live':'Draft'}</span></div><strong class="readiness-title">${esc(data.store.name)}</strong><span class="readiness-address">${esc(storeUrl().replace(/^https?:\/\//,''))}</span><div class="readiness-list">${steps.map((step,index)=>`<button type="button" class="readiness-item ${step.done?'is-complete':''}" data-workspace-go="${step.path}"><span class="step-number">${step.done?workspaceIcon('check'):index+1}</span><span class="readiness-copy"><strong>${step.label}</strong><small>${step.note}</small></span>${workspaceIcon('chevron-right')}</button>`).join('')}</div><a class="secondary button-link" href="${esc(live?storeUrl():`/api/stores/${data.store.id}/storefront/preview/open`)}" target="_blank" rel="noopener">${workspaceIcon(live?'arrow-up-right':'eye')}${live?'View live store':'Preview saved draft'}</a></aside></div>
    <section class="overview-orders"><div class="section-heading"><div><h2>Recent orders</h2><p>Your latest completed customer orders</p></div><button class="text-action" type="button" data-workspace-go="/orders">All orders ${workspaceIcon('arrow-right')}</button></div><div class="table-scroll overview-desktop-orders">${ordersHtml}</div><div class="overview-mobile-orders">${(data.orders || []).slice(0,5).map(order => `<article class="recent-order-card"><div><button type="button" class="recent-order-link order-open-detail" data-order-id="${Number(order.id)}">${esc(order.orderNumber)} ${workspaceIcon('arrow-up-right')}</button><strong class="recent-order-total">${money(order.totalPaise)}</strong></div><p>${esc(order.customerName)}</p><small class="recent-order-meta">Payment: ${esc(order.paymentStatus)} · Delivery: ${esc(String(order.deliveryStatus || '').replaceAll('_',' '))}</small></article>`).join('') || '<p class="empty">No completed orders yet.</p>'}</div></section></div>`;
}

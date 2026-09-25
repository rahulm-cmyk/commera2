(() => {
  const configNode = document.querySelector('#jev-config');
  if (!configNode) return;
  const config = JSON.parse(configNode.textContent);
  const hero = document.querySelector('.product-purchase');
  if (!hero) return;
  const key = `commera2-jev-${config.storeId}-${config.pageId}`;
  const consent = () => window.commera2AnalyticsConsent?.() === true;
  let elapsed = 0, attempted = false, pending = null, applied = false, checkoutStarted = false;
  const signals = { activeSeconds: 0, scrollPercent: 0, viewedReviews: false, comparedBundles: false, returning: false };
  if (consent()) {
    try {
      signals.returning = sessionStorage.getItem(key) === 'visited';
      sessionStorage.setItem(key, 'visited');
    } catch {}
  }
  const originals = new Map();
  const replace = (node, value) => {
    if (!node || !value) return;
    if (!originals.has(node)) originals.set(node, node.textContent);
    node.textContent = value;
  };
  const apply = () => {
    if (!pending || applied || checkoutStarted || !consent() || document.visibilityState !== 'visible') return;
    // Update only after the purchase panel has left the viewport.
    const rect = hero.getBoundingClientRect();
    if (rect.bottom > -80 && rect.top < innerHeight + 80) return;
    if (hero.contains(document.activeElement) || document.querySelector('dialog[open]')) return;
    replace(hero.querySelector('h1'), pending.copy?.headline);
    replace(hero.querySelector('.product-short-description'), pending.copy?.description);
    replace(hero.querySelector('a.hero-cta'), pending.copy?.button);
    const bundle = [...hero.querySelectorAll('[name="heroBundleId"]')].find(node => Number(node.value) === pending.bundleId);
    if (bundle) {
      const note = document.createElement('small');
      note.dataset.jevRecommendation = '';
      note.textContent = 'Suggested bundle';
      bundle.closest('label')?.append(note);
    }
    applied = true;
    window.dispatchEvent(new CustomEvent('commera2:personalization', { detail: { variant: pending.variant, control: Boolean(pending.control) } }));
  };
  document.addEventListener('click', event => {
    if (event.target.closest('[data-direct-checkout], a[href="#checkout"], .cod-launcher')) checkoutStarted = true;
  }, true);
  document.addEventListener('change', event => {
    if (consent() && event.target.name === 'heroBundleId') signals.comparedBundles = true;
  });
  window.addEventListener('scroll', () => {
    if (!consent()) return;
    signals.scrollPercent = Math.max(signals.scrollPercent, Math.min(100, Math.round(100 * scrollY / Math.max(1, document.documentElement.scrollHeight - innerHeight))));
    const reviews = document.querySelector('.product-reviews')?.getBoundingClientRect();
    if (reviews && reviews.top < innerHeight && reviews.bottom > 0) signals.viewedReviews = true;
    apply();
  }, { passive: true });
  setInterval(async () => {
    if (!consent()) {
      pending = null;
      for (const [node, value] of originals) node.textContent = value;
      document.querySelectorAll('[data-jev-recommendation]').forEach(node => node.remove());
      return;
    }
    if (document.visibilityState !== 'visible' || checkoutStarted) return;
    elapsed++;
    signals.activeSeconds = elapsed;
    if (attempted) { apply(); return; }
    if (elapsed < 15) return;
    attempted = true;
    try {
      const response = await fetch(`/api/public/stores/${config.storeId}/personalization`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ pageSlug: config.pageSlug, visitorToken: config.token, sessionId: window.commera2VisitorSessionId, analyticsConsentGranted: true, signals }),
        signal: AbortSignal.timeout(4000),
      });
      if (!response.ok || !consent()) return;
      const result = await response.json();
      if (result.revision === config.revision) pending = result;
      apply();
    } catch { /* Keep the published page on network or provider failure. */ }
  }, 1000);
})();

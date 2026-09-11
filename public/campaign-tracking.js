(() => {
  const script = document.currentScript;
  const home = script?.dataset.storePath;
  const current = new URL(location.href);
  const keys = ['utm_source','utm_medium','utm_campaign','utm_content','utm_term','utm_id','adset_id','ad_id','affiliate_id','sub1','sub2','sub3'];
  const values = keys.filter(key => current.searchParams.has(key)).map(key => [key,current.searchParams.get(key)]);
  if (!home || !values.length) return;
  // Carry URL tags through same-store navigation without cookies or local storage.
  const decorate = link => {
    const target = new URL(link.href, location.href);
    if (target.origin !== current.origin || !['http:','https:'].includes(target.protocol)) return;
    if (target.pathname.startsWith('/s/') && !(target.pathname === home || target.pathname.startsWith(home + '/'))) return;
    if (!(target.pathname === home || target.pathname.startsWith(home + '/') || target.pathname === '/' || /^\/(products|pages|policies)\//.test(target.pathname))) return;
    if (keys.some(key => target.searchParams.has(key))) return;
    values.forEach(([key,value]) => { if(value.length <= 200) target.searchParams.set(key,value); });
    link.href = target.href;
  };
  document.querySelectorAll('a[href]').forEach(decorate);
  document.addEventListener('click', event => { const link = event.target.closest?.('a[href]'); if(link) decorate(link); },true);
})();

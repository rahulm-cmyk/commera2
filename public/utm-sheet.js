export async function renderUtmSheet({ root, storeId, api, esc, isActive }) {
  const endpoint = `/api/stores/${storeId}/utm-sheet`;
  let status, inspected = null, revision = 0, mode = 'existing';
  const call = (path, body, method = 'POST') => api(endpoint + path, { method, ...(body ? { body: JSON.stringify(body) } : {}) });
  const error = message => { if (isActive()) root.querySelector('[role="alert"]').textContent = message; };
  async function action(button, operation) {
    button.disabled = true; error('');
    try { await operation(); } catch (e) { error(e.message); }
    finally { if (button.isConnected) button.disabled = false; }
  }
  async function load() {
    try { status = await api(endpoint); if (isActive()) draw(); }
    catch (e) { if (isActive()) { root.innerHTML = '<p role="alert"></p><button type="button">Try again</button>'; error(e.message); root.querySelector('button').onclick = load; } }
  }
  function draw() {
    const params = new URLSearchParams(location.search), failed = params.get('sheetConnection') === 'failed';
    const failureReason = failed ? params.get('reason') : '';
    root.innerHTML = `<div class="utm-sheet-workspace">
      <section class="utm-sheet-account"><img src="/icons/file-spreadsheet.svg" width="32" height="32" alt=""><div><h2>Google Sheets</h2><p>${status.connected ? esc(status.email) : 'Not connected'}</p></div><span class="pill">${status.enabled ? 'Auto-sync on' : status.connected ? 'Connected' : 'Not connected'}</span></section>
      <p role="alert">${esc(status.error || (failed ? `Google connection was not completed${failureReason ? `: ${failureReason}` : '. Please try again.'}` : ''))}</p>
      ${!status.available ? '<p class="utm-sheet-notice">Google Sheets needs administrator setup before you can connect your account.</p>' : ''}
      ${!status.connected ? `<button class="primary" id="utm-connect" ${status.available ? '' : 'disabled'}>Connect Google account</button>` : `
        <div class="utm-sheet-modes" role="tablist" aria-label="Sheet setup"><button type="button" role="tab" data-sheet-mode="existing" aria-selected="${mode === 'existing'}">Use my sheet</button><button type="button" role="tab" data-sheet-mode="new" aria-selected="${mode === 'new'}">Create a new sheet</button></div>
        ${mode === 'existing' ? `<form id="utm-sheet-form"><label class="field">Google Sheet link<input type="url" name="url" placeholder="https://docs.google.com/spreadsheets/d/..." value="${esc(status.url)}" required></label><button class="secondary" type="submit">Choose worksheet</button></form>` : `<form id="utm-create-form"><label class="field">Sheet name<input name="title" value="Commera2 orders" maxlength="100" required></label><fieldset class="utm-export-fields"><legend>Columns to include</legend>${status.fields.map(f => `<label><input type="checkbox" name="exportField" value="${esc(f.key)}" ${['order_id','date','revenue','product','quantity','customer_name','customer_phone','address','city','state','pincode','utm_source','utm_medium','utm_campaign','utm_content','utm_term'].includes(f.key) ? 'checked' : ''} ${f.key === 'order_id' ? 'disabled' : ''}>${esc(f.label)}</label>`).join('')}</fieldset><label class="field">Multiple items<select name="rowMode"><option value="order">One row per order</option><option value="item">One row per item</option></select></label><label class="utm-sheet-check"><input name="includeAbandoned" type="checkbox">Also create an abandoned checkouts worksheet</label><button class="primary" type="submit">Create sheet &amp; start auto-sync</button></form>`}
        <div id="utm-sheet-columns"></div>
        ${status.url ? `<section class="utm-sheet-status"><h3>${esc(status.title)}</h3><p>${esc(status.tab)}</p><p>${status.lastSynced ? `Last export: ${esc(new Date(status.lastSynced).toLocaleString())}` : 'No orders exported yet.'}</p><a href="${esc(status.url)}" target="_blank" rel="noopener">Open sheet</a><div class="utm-sheet-actions">${status.enabled ? '<button class="secondary" id="utm-pause">Pause auto-sync</button><button class="secondary" id="utm-sync">Sync now</button>' : '<p>Auto-sync is paused. Choose your worksheet to resume.</p>'}</div></section>` : ''}
        <div class="utm-sheet-actions"><button class="secondary" id="utm-reconnect">Reconnect Google</button><button class="secondary" id="utm-disconnect">Disconnect</button></div>`}
    </div>`;
    const connect = button => action(button, async () => { const out = await call('/connect'); if (isActive()) location.assign(out.url); });
    root.querySelectorAll('[data-sheet-mode]').forEach(button => button.onclick = () => { mode = button.dataset.sheetMode; revision++; inspected = null; draw(); });
    const create = root.querySelector('#utm-create-form');
    if (create) create.onsubmit = event => { event.preventDefault(); action(create.querySelector('button'), async () => {
      const fields = [...create.querySelectorAll('[name="exportField"]:checked')].map(input => input.value);
      const rowMode = create.elements.rowMode.value;
      if (rowMode === 'item' && !fields.includes('item_id')) fields.push('item_id');
      status = await call('/create', { title: create.elements.title.value, fields, rowMode, includeAbandoned: create.elements.includeAbandoned.checked });
      if (isActive()) { mode = 'existing'; draw(); }
    }); };
    root.querySelector('#utm-connect')?.addEventListener('click', e => connect(e.currentTarget));
    root.querySelector('#utm-reconnect')?.addEventListener('click', e => connect(e.currentTarget));
    root.querySelector('#utm-disconnect')?.addEventListener('click', e => action(e.currentTarget, async () => { status = await call('', null, 'DELETE'); if (isActive()) draw(); }));
    root.querySelector('#utm-pause')?.addEventListener('click', e => action(e.currentTarget, async () => { status = await call('/pause'); if (isActive()) draw(); }));
    root.querySelector('#utm-sync')?.addEventListener('click', e => action(e.currentTarget, async () => { status = await call('/sync'); if (isActive()) draw(); }));
    const form = root.querySelector('#utm-sheet-form');
    if (form) {
      form.oninput = () => { revision++; inspected = null; root.querySelector('#utm-sheet-columns').replaceChildren(); };
      form.onsubmit = e => { e.preventDefault(); action(form.querySelector('button'), async () => {
        const url = form.elements.url.value, requestRevision = revision;
        const result = await call('/inspect', { url, tab: url === status.url ? status.tab : '' });
        if (isActive() && requestRevision === revision) { inspected = result; drawColumns(url); }
      }); };
    }
  }
  function drawColumns(url) {
    const host = root.querySelector('#utm-sheet-columns');
    const keepMapping = () => [...host.querySelectorAll('[data-column]')].map(select => select.value);
    host.innerHTML = `<label class="field">Worksheet<select id="utm-tab">${inspected.tabs.map(t => `<option ${t === inspected.tab ? 'selected' : ''}>${esc(t)}</option>`).join('')}</select></label><div class="table-wrap"><table><thead><tr><th>Your sheet column</th><th>Order information</th></tr></thead><tbody>${inspected.headers.map((h,i) => `<tr><td>${esc(h)}</td><td><select aria-label="Match ${esc(h)}" data-column="${i}"><option value="">Leave empty</option>${status.fields.map(field => `<option value="${field.key}" ${inspected.mapping[i] === field.key ? 'selected' : ''}>${esc(field.label)}</option>`).join('')}</select></td></tr>`).join('')}</tbody></table></div><div class="utm-sheet-add-column"><input id="utm-new-column" placeholder="New column name" maxlength="100"><button class="secondary" id="utm-add-column" type="button">Add column</button></div><p>All sheet columns are shown above. New orders will be added after auto-sync starts.</p><button class="primary" id="utm-start">Start auto-sync</button>`;
    host.querySelector('#utm-start').insertAdjacentHTML('beforebegin', `<label class="field">Multiple items<select id="utm-row-mode"><option value="order" ${status.rowMode === 'order' ? 'selected' : ''}>One row per order</option><option value="item" ${status.rowMode === 'item' ? 'selected' : ''}>One row per item (requires Item ID)</option></select></label><label class="field">Abandoned checkouts<select id="utm-abandoned-tab"><option value="">Do not export</option>${inspected.tabs.filter(t => t !== inspected.tab).map(t => `<option ${status.abandonedTab === t ? 'selected' : ''}>${esc(t)}</option>`).join('')}</select></label>`);
    host.querySelector('#utm-tab').onchange = e => action(e.currentTarget, async () => {
      host.querySelector('#utm-start').disabled = true;
      inspected = await call('/inspect', { url, tab: e.target.value });
      if (isActive()) drawColumns(url);
    });
    host.querySelector('#utm-add-column').onclick = e => action(e.currentTarget, async () => {
      const name = host.querySelector('#utm-new-column').value.trim();
      const mapping = keepMapping();
      inspected = await call('/add-column', { url, tab: inspected.tab, name });
      mapping.forEach((field,index) => inspected.mapping[index] = field);
      if (isActive()) drawColumns(url);
    });
    host.querySelector('#utm-start').onclick = e => action(e.currentTarget, async () => {
      const mapping = [...host.querySelectorAll('[data-column]')].map(s => s.value);
      status = await call('', { url, tab: inspected.tab, mapping, headers: inspected.headers, rowMode: host.querySelector('#utm-row-mode').value, abandonedTab: host.querySelector('#utm-abandoned-tab').value }, 'PUT');
      if (isActive()) draw();
    });
  }
  await load();
}

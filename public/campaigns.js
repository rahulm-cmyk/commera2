const parseCsvRows = (text) => {
  const rows = [],
    row = [];
  let cell = '',
    quoted = false,
    closed = false;
  text = String(text || '').replace(/^\uFEFF/, '');
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        cell += '"';
        i += 1;
      } else if (c === '"') {
        quoted = false;
        closed = true;
      } else {
        cell += c;
      }
    } else if (c === '"' && !cell && !closed) {
      quoted = true;
    } else if (c === ',' || c === '\n' || c === '\r') {
      row.push(cell);
      cell = '';
      closed = false;
      if (c !== ',') {
        if (row.some((value) => value !== '')) rows.push(row.splice(0));
        else row.length = 0;
        if (c === '\r' && text[i + 1] === '\n') i += 1;
      }
    } else {
      if (closed || c === '"') throw Error('Invalid CSV quoting');
      cell += c;
    }
  }
  if (quoted) throw Error('Unclosed CSV quote');
  row.push(cell);
  if (row.some((value) => value !== '')) rows.push(row);
  return rows;
};

const parseCsvObjects = (text) => {
  const rows = parseCsvRows(text);
  if (!rows.length) throw Error('CSV has no headers');
  const headers = rows.shift().map((value) => String(value || '').trim().toLowerCase());
  return {
    headers,
    rows: rows.map((values) =>
      Object.fromEntries(headers.map((header, index) => [header, values[index] ?? '']))
    ),
  };
};

export function parseCampaignCsv(text) {
  const rows = parseCsvRows(text);
  if (!rows.length) throw Error('CSV has no headers');
  const headers = rows.shift().map((value) => String(value || '').trim().toLowerCase());
  if (
    new Set(headers).size !== headers.length ||
    ['date', 'order_id', 'revenue', 'utm_id'].some(
      (key) => !headers.includes(key),
    )
  )
    throw Error('CSV requires date, order_id, revenue and utm_id columns');
  return rows.map((values, index) => {
    if (values.length !== headers.length)
      throw Error(`Row ${index + 2}: column count does not match the header`);
    return Object.fromEntries(headers.map((header, i) => [header, values[i]]));
  });
}

export function parseCampaignImportCsv(text) {
  return parseCsvObjects(text).rows;
}

const campaignHeader = (value) =>
  String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const pickValue = (row, keys) => {
  const map = {};
  for (const [rawKey, value] of Object.entries(row || {})) {
    map[campaignHeader(rawKey)] = String(value ?? '').trim();
  }
  for (const key of keys) {
    const value = map[campaignHeader(key)];
    if (value) return value;
  }
  return '';
};

const mapCampaignRowFromSheet = (row, lineNo) => {
  const platform = campaignHeader(pickValue(row, ['platform', 'channel', 'ad platform', 'network']));
  const normalizedPlatform = platform === 'fb' ? 'facebook' : platform === 'insta' ? 'instagram' : platform === 'youtube ads' ? 'youtube' : platform === 'google search' ? 'google' : platform;
  const status = campaignHeader(pickValue(row, ['status', 'state', 'state name']));
  const statusValue = ['live', 'running', 'published', 'active'].includes(status)
    ? 'Live'
    : ['paused', 'pause', 'stopped', 'inactive'].includes(status)
      ? 'Paused'
      : ['planning', 'draft'].includes(status)
        ? 'Planning'
        : status
          ? status[0]?.toUpperCase() + status.slice(1)
          : 'Planning';
  const campaignId = pickValue(row, ['campaign id', 'campaign_id', 'campaignid', 'utm_id', 'utm id', 'id']);
  const baseUrl = pickValue(row, ['base url', 'base_url', 'landing url', 'landing page', 'landing page url', 'destination url', 'url', 'link']);
  const name = pickValue(row, ['campaign', 'campaign name', 'campaign_name', 'name', 'utm campaign']);
  return {
    platform: normalizedPlatform,
    status: statusValue,
    name,
    campaignId,
    baseUrl,
    source: pickValue(row, ['source', 'utm_source']),
    medium: pickValue(row, ['medium', 'utm_medium']),
    content: pickValue(row, ['creative', 'utm_content', 'content']),
    term: pickValue(row, ['audience', 'keyword', 'utm_term', 'term']),
    adsetId: pickValue(row, ['ad set id', 'adset id', 'adset', 'adset_id', 'adsetid']),
    adId: pickValue(row, ['ad id', 'ad_id', 'adid', 'ad']),
    affiliateId: pickValue(row, ['affiliate id', 'affiliate_id', 'affiliate']),
    sub1: pickValue(row, ['sub1', 'sub 1', 'sub id 1', 'subid1']),
    sub2: pickValue(row, ['sub2', 'sub 2', 'sub id 2', 'subid2']),
    sub3: pickValue(row, ['sub3', 'sub 3', 'sub id 3', 'subid3']),
    product: pickValue(row, ['product', 'product offer', 'offer', 'product/offer']),
    country: pickValue(row, ['country', 'region']),
    owner: pickValue(row, ['owner', 'account owner', 'owner name']),
  };
};

const readCampaignRowsFromFile = async (file) => {
  if (!(file instanceof File)) throw Error('Please choose a file first.');
  if (file.size > 1024 * 1024) throw Error('Choose a file smaller than 1 MB.');
  const name = String(file.name || '').toLowerCase();
  if (name.endsWith('.xlsx') || name.endsWith('.xls')) {
    if (!window.XLSX) {
      const existing = document.querySelector('script[data-sheet-parser=\"1\"]');
      if (existing) {
        await new Promise((resolve, reject) => {
          existing.addEventListener('load', resolve);
          existing.addEventListener('error', () => reject(Error('Could not load XLSX parser.')));
        });
      } else {
        await new Promise((resolve, reject) => {
          const script = document.createElement('script');
          script.dataset.sheetParser = '1';
          script.src = 'https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js';
          script.onload = () => resolve();
          script.onerror = () =>
            reject(
              Error(
                'Could not load XLSX parser. Keep a local copy of your sheet as CSV and try again.',
              ),
            );
          document.head.append(script);
        });
      }
      if (!window.XLSX) throw Error('Could not load XLSX parser.');
    }
    const workbook = window.XLSX.read(await file.arrayBuffer(), { type: 'array' });
    if (!workbook?.SheetNames?.length) throw Error('XLSX has no sheets.');
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const rows = window.XLSX.utils.sheet_to_json(sheet, { raw: false, defval: '' });
    if (!rows.length) throw Error('This sheet is empty.');
    return rows;
  }
  return parseCampaignImportCsv(await file.text());
};
export function campaignCsv(rows, columns) {
  const cell = value => '"' + String(value ?? '').replace(/^[=+@\-\t\r]/, "'$&").replaceAll('"', '""') + '"';
  return [columns, ...rows.map(row => columns.map(key => row[key]))].map(row => row.map(cell).join(',')).join('\r\n');
}

export async function renderCampaigns({ root, storeId, api, esc, toast, baseUrl, currency, isActive }) {
  const endpoint = `/api/stores/${storeId}/campaigns`;
  root.innerHTML = '<p role="status">Loading campaigns...</p>';
  let campaigns, templates, orders, attributed;
  try {
    campaigns = await api(endpoint);
    templates = await api(`${endpoint}/templates`);
    orders = await api(`${endpoint}/orders`);
    attributed = await api(`${endpoint}/attribution`);
  } catch (error) { if (isActive()) root.innerHTML = `<p role="alert">${esc(error.message)}</p><button id="campaign-retry">Try again</button>`; root.querySelector('#campaign-retry')?.addEventListener('click', () => renderCampaigns({root,storeId,api,esc,toast,baseUrl,currency,isActive})); return; }
  if (!isActive()) return;
  let tab = 'builder', editing = null, draft = { platform: 'facebook', status: 'Planning', baseUrl }, generated = '', search = '';
  const icon = name => `<img class="workspace-icon" src="/icons/${name}.svg" alt="">`;
  const download = (text, name) => {
    const url = URL.createObjectURL(new Blob([text], {type:'text/csv;charset=utf-8'})), a = document.createElement('a');
    a.href = url; a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const copy = async value => { try { await navigator.clipboard.writeText(value); toast('Link copied'); } catch { toast('Copy unavailable. Select and copy the link.'); } };
  const field = (name, label, type = 'text', required = false) => `<label>${label}<input name="${name}" type="${type}" maxlength="${name === 'baseUrl' ? 2048 : 200}" value="${esc(draft[name] || '')}" ${required ? 'required' : ''}></label>`;
  function draw() {
    if (!isActive()) return;
    root.innerHTML = `<div class="campaign-workspace"><div class="campaign-tabs" role="tablist" aria-label="Campaign workspace">${[['builder','Link builder'],['import','Upload sheet'],['registry','Campaigns'],['orders','Imported orders'],['templates','Platform presets']].map(([id,label]) => `<button role="tab" aria-selected="${tab === id}" data-tab="${id}">${label}</button>`).join('')}</div><div id="campaign-body" role="tabpanel"></div><p id="campaign-error" role="alert"></p></div>`;
    const attributionTab = document.createElement('button');
    attributionTab.type = 'button'; attributionTab.dataset.tab = 'attribution';
    attributionTab.setAttribute('role','tab'); attributionTab.setAttribute('aria-selected',String(tab === 'attribution'));
    attributionTab.textContent = 'Store orders';
    root.querySelector('.campaign-tabs').append(attributionTab);
    root.querySelectorAll('[data-tab]').forEach(button => button.onclick = () => { tab = button.dataset.tab; draw(); });
    const body = root.querySelector('#campaign-body');
    if (tab === 'builder') {
      body.innerHTML = `<form id="campaign-form"><div class="campaign-heading"><h2>${editing ? 'Edit campaign' : 'Create campaign link'}</h2>${editing ? '<button type="button" id="campaign-new" class="secondary">New campaign</button>' : ''}</div><div class="campaign-grid"><label>Platform<select name="platform">${templates.map(t => `<option value="${t.id}" ${draft.platform === t.id ? 'selected' : ''}>${esc(t.name)}</option>`).join('')}</select></label><label>Status<select name="status">${['Planning','Live','Paused'].map(s => `<option ${draft.status === s ? 'selected' : ''}>${s}</option>`).join('')}</select></label>${field('name','Campaign name','text',true)}${field('campaignId','Campaign ID','text',true)}<div class="campaign-wide">${field('baseUrl','Landing page URL','url',true)}</div>${field('product','Product / offer')}${field('country','Country')}${field('content','Creative / ad (utm_content)')}${field('term','Audience / keyword (utm_term)')}${field('source','Source (optional override)')}${field('medium','Medium (optional override)')}</div><details><summary>Additional tracking fields</summary><div class="campaign-grid">${field('adsetId','Ad set ID')}${field('adId','Ad ID')}${field('affiliateId','Affiliate ID')}${field('sub1','Sub1')}${field('sub2','Sub2')}${field('sub3','Sub3')}${field('owner','Owner')}</div></details><div class="campaign-actions"><button type="submit">${icon('check')}Save campaign</button><button type="button" id="campaign-build" class="secondary">Generate link</button></div><label>Campaign link<textarea id="campaign-link" readonly rows="4">${esc(generated)}</textarea></label><button type="button" id="campaign-copy" class="secondary" ${generated ? '' : 'disabled'}>${icon('copy')}Copy link</button></form>`;
      const form = body.querySelector('form');
      form.oninput = () => { draft = Object.fromEntries(new FormData(form)); generated = ''; body.querySelector('#campaign-link').value = ''; body.querySelector('#campaign-copy').disabled = true; };
      form.onchange = form.oninput;
      body.querySelector('#campaign-new')?.addEventListener('click', () => { editing = null; draft = {platform:'facebook',status:'Planning',baseUrl}; generated = ''; draw(); });
      async function submit(save) {
        if (!form.reportValidity()) return;
        draft = Object.fromEntries(new FormData(form));
        const buttons = [...form.querySelectorAll('button')]; buttons.forEach(button => button.disabled = true);
        root.querySelector('#campaign-error').textContent = '';
        try {
          const value = await api(save ? (editing ? `${endpoint}/${editing}` : endpoint) : `${endpoint}/build`, { method: save && editing ? 'PUT' : 'POST', body: JSON.stringify(draft) });
          if (!isActive()) return;
          generated = value.finalUrl;
          if (save) { editing = value.id; campaigns = await api(endpoint); toast('Campaign saved'); }
          if (isActive()) draw();
        } catch (error) { if (isActive()) { root.querySelector('#campaign-error').textContent = error.message; buttons.forEach(button => button.disabled = false); } }
      }
      form.onsubmit = event => { event.preventDefault(); submit(true); };
      body.querySelector('#campaign-build').onclick = () => submit(false);
      body.querySelector('#campaign-copy').onclick = () => copy(generated);
    } else if (tab === 'import') {
      body.innerHTML = `<div class="campaign-heading"><h2>Upload campaign sheet</h2><button type="button" class="secondary" id="campaign-sheet-template">Download CSV template</button></div><p class="campaign-hint">Upload your sheet as CSV or XLSX. Required: Campaign name, Campaign ID, Platform, Landing URL.</p><form id="campaign-import"><label>Campaign sheet<input name="file" type="file" accept=".csv,.xlsx,.xls,text/csv,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" required></label><button type="submit">Import campaigns</button></form><div id="campaign-import-result" class="campaign-table"></div>`;
      const templateColumns = ['campaign', 'id', 'platform', 'status', 'base_url', 'source', 'medium', 'content', 'term', 'adset_id', 'ad_id', 'affiliate_id', 'sub1', 'sub2', 'sub3', 'product', 'country', 'owner'];
      body.querySelector('#campaign-sheet-template').onclick = () =>
        download(campaignCsv([{ campaign: 'Summer sale', id: 'c-001', platform: 'facebook', status: 'Live', base_url: 'https://example.com/landing-page', source: '', medium: '', content: 'creative', term: 'audience', adset_id: 'adset-01', ad_id: 'ad-01', affiliate_id: '', sub1: 's1', sub2: '', sub3: '', product: 'Product', country: 'IN', owner: 'Marketing' }], templateColumns), 'campaign-sheet-template.csv');
      const form = body.querySelector('#campaign-import');
      form.onsubmit = async (event) => {
        event.preventDefault();
        const button = form.querySelector('button');
        const file = form.querySelector('input')?.files?.[0];
        if (!file) {
          root.querySelector('#campaign-error').textContent = 'Please choose a file first.';
          return;
        }
        button.disabled = true;
        root.querySelector('#campaign-error').textContent = '';
        try {
          const rows = await readCampaignRowsFromFile(file);
          const mapped = rows.map((row, index) => {
            const mappedRow = mapCampaignRowFromSheet(row, index + 2);
            if (!mappedRow.platform) throw Error(`Row ${index + 2}: platform is required`);
            if (!mappedRow.campaignId) throw Error(`Row ${index + 2}: Campaign ID is required`);
            if (!mappedRow.baseUrl) throw Error(`Row ${index + 2}: landing URL is required`);
            if (!mappedRow.name) throw Error(`Row ${index + 2}: campaign name is required`);
            return mappedRow;
          });
          const result = await api(`${endpoint}/import`, {
            method: 'POST',
            body: JSON.stringify({ rows: mapped }),
          });
          campaigns = await api(endpoint);
          const resultNode = body.querySelector('#campaign-import-result');
          if (resultNode)
            resultNode.innerHTML = `<p>${result.imported} campaign${result.imported === 1 ? '' : 's'} imported/updated.</p>`;
          toast(`Imported ${result.imported} campaign${result.imported === 1 ? '' : 's'}`);
          tab = 'registry';
          draw();
        } catch (error) {
          root.querySelector('#campaign-error').textContent = error.message;
          button.disabled = false;
        }
      };
    } else if (tab === 'registry') {
      body.innerHTML = `<div class="campaign-heading"><h2>Campaigns <small>${campaigns.length}</small></h2><button class="secondary" id="campaign-export">Export CSV</button></div><input type="search" id="campaign-search" aria-label="Search campaigns" placeholder="Search campaigns" value="${esc(search)}"><div class="campaign-table" id="campaign-results"></div>`;
      function results() {
        const rows = campaigns.filter(row => [row.name,row.campaignId,row.platform,row.status].some(value => value.toLowerCase().includes(search.toLowerCase())));
        body.querySelector('#campaign-results').innerHTML = rows.length ? `<table><thead><tr><th>Campaign</th><th>Platform</th><th>Status</th><th>Campaign ID</th><th>Actions</th></tr></thead><tbody>${rows.map(row => `<tr><td>${esc(row.name)}</td><td>${esc(row.platform)}</td><td>${esc(row.status)}</td><td>${esc(row.campaignId)}</td><td><div class="campaign-actions"><button class="secondary" data-edit="${row.id}" title="Edit campaign" aria-label="Edit ${esc(row.name)}">${icon('pencil')}</button><button class="secondary" data-copy="${row.id}" title="Copy link" aria-label="Copy ${esc(row.name)} link">${icon('copy')}</button><button class="secondary" data-delete="${row.id}" title="Delete campaign" aria-label="Delete ${esc(row.name)}">${icon('trash-2')}</button></div></td></tr>`).join('')}</tbody></table>` : '<p>No campaigns found.</p>';
        body.querySelectorAll('[data-edit]').forEach(button => button.onclick = () => { const row = campaigns.find(item => item.id === button.dataset.edit); editing = row.id; draft = {...row}; generated = row.finalUrl; tab = 'builder'; draw(); });
        body.querySelectorAll('[data-copy]').forEach(button => button.onclick = () => copy(campaigns.find(row => row.id === button.dataset.copy).finalUrl));
        body.querySelectorAll('[data-delete]').forEach(button => button.onclick = async () => { if (!confirm('Delete this campaign? Imported orders will remain.')) return; button.disabled = true; try { await api(`${endpoint}/${button.dataset.delete}`,{method:'DELETE'}); campaigns = await api(endpoint); orders = await api(`${endpoint}/orders`); draw(); } catch(error) { if(isActive()) root.querySelector('#campaign-error').textContent = error.message; button.disabled = false; } });
      }
      results(); body.querySelector('#campaign-search').oninput = event => { search = event.target.value; results(); };
      body.querySelector('#campaign-export').onclick = () => download(campaignCsv(campaigns,['name','campaignId','platform','status','source','medium','content','term','adsetId','adId','product','country','owner','finalUrl']), 'campaigns.csv');
    } else if (tab === 'attribution') {
      body.innerHTML = `<h2>Store order attribution</h2><p>Campaign tags captured when checkout opens, subject to your analytics consent settings. Revenue includes all attributed orders, including unpaid or cancelled orders.</p><div class="campaign-table"><table><thead><tr><th>Date</th><th>Order ID</th><th>Campaign</th><th>Campaign ID</th><th>Source</th><th>Revenue (${esc(currency)})</th></tr></thead><tbody>${attributed.map(row => `<tr><td>${esc(row.date)}</td><td>${esc(row.orderId)}</td><td>${esc(row.campaign || row.tracking.utm_campaign || 'Unmatched')}</td><td>${esc(row.campaignId)}</td><td>${esc(row.tracking.utm_source || '')}</td><td>${Number(row.revenue).toFixed(2)}</td></tr>`).join('') || '<tr><td colspan="6">No attributed store orders yet.</td></tr>'}</tbody></table></div>`;
    } else if (tab === 'orders') {
      body.innerHTML = `<div class="campaign-heading"><h2>Imported orders</h2><button class="secondary" id="orders-template">Download CSV template</button></div><p>External report data only. Importing does not create or change store orders. Matching uses the exact Campaign ID.</p><form id="orders-import"><label>Order report CSV<input name="file" type="file" accept=".csv,text/csv" required></label><button type="submit">Import report</button></form><p>Amounts in ${esc(currency)}. Reimporting the same Order ID replaces its report entry.</p><div class="campaign-table"><table><thead><tr><th>Date</th><th>Order ID</th><th>Campaign ID</th><th>Campaign</th><th>Revenue (${esc(currency)})</th></tr></thead><tbody>${orders.map(row => `<tr><td>${esc(row.date)}</td><td>${esc(row.orderId)}</td><td>${esc(row.campaignId)}</td><td>${esc(row.campaign || 'Unmatched')}</td><td>${Number(row.revenue).toFixed(2)}</td></tr>`).join('') || '<tr><td colspan="5">No imported orders yet.</td></tr>'}</tbody></table></div>`;
      body.querySelector('#orders-template').onclick = () => download('date,order_id,revenue,utm_id\r\n','order-report-template.csv');
      body.querySelector('form').onsubmit = async event => {
        event.preventDefault(); const form = event.currentTarget, button = form.querySelector('button'); button.disabled = true;
        try {
          const file = form.querySelector('input').files[0];
          if (file.size > 1024 * 1024) throw Error('Choose a CSV smaller than 1 MB');
          const rows = parseCampaignCsv(await file.text());
          const result = await api(`${endpoint}/orders`,{method:'POST',body:JSON.stringify({rows})});
          orders = await api(`${endpoint}/orders`); toast(`${result.imported} report rows imported`); draw();
        } catch(error) { if(isActive()) root.querySelector('#campaign-error').textContent = error.message; button.disabled = false; }
      };
    } else {
      body.innerHTML = `<h2>Platform presets</h2><div class="campaign-table"><table><thead><tr><th>Platform</th><th>Source</th><th>Medium</th><th></th></tr></thead><tbody>${templates.map(item => `<tr><td>${esc(item.name)}</td><td>${esc(item.source || 'Partner name')}</td><td>${esc(item.medium)}</td><td><button class="secondary" data-preset="${item.id}">Use preset</button></td></tr>`).join('')}</tbody></table></div>`;
      body.querySelectorAll('[data-preset]').forEach(button => button.onclick = () => { editing = null; draft = {platform:button.dataset.preset,status:'Planning',baseUrl}; generated = ''; tab = 'builder'; draw(); });
    }
  }
  draw();
}

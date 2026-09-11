import { OAuth2Client, CodeChallengeMethod } from 'google-auth-library';
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { SettingsService } from './settings-service.js';
import { parseDatabaseTimestamp } from './database-time.js';
import { customCheckoutValues, checkoutAddons } from './cod-builder.js';
import { CommerceService } from './commerce-service.js';

export const sheetFieldDefinitions = [
  ['order_id', 'Order ID'], ['date', 'Order date'], ['revenue', 'Order total'], ['currency', 'Currency'],
  ['utm_id', 'UTM ID'], ['utm_source', 'UTM source'], ['utm_medium', 'UTM medium'], ['utm_campaign', 'UTM campaign'], ['utm_content', 'UTM content'], ['utm_term', 'UTM term'],
  ['platform', 'Platform'], ['campaign_name', 'Campaign name'], ['landing_url', 'Landing URL'], ['product', 'Product'], ['product_id', 'Product ID'], ['item_id', 'Item ID'], ['quantity', 'Quantity'],
  ['customer_email', 'Customer email'], ['alternate_phone', 'Alternate phone'], ['address_line2', 'Address line 2'], ['landmark', 'Landmark'], ['shipping', 'Shipping charge'], ['discount', 'Discount'], ['coupon', 'Coupon code'], ['unit_price', 'Unit price'], ['line_total', 'Item total'], ['phone_verified', 'Phone verification'], ['checkout_id', 'Checkout ID'], ['checkout_status', 'Checkout status'],
  ['customer_name', 'Customer name'], ['customer_phone', 'Customer phone'], ['address', 'Address'], ['city', 'City'], ['state', 'State'], ['country', 'Country'], ['pincode', 'Pincode'],
  ['payment_method', 'Payment method'], ['payment_status', 'Payment status'], ['fulfillment_status', 'Fulfillment status'], ['delivery_status', 'Delivery status'],
];
export const sheetFields = sheetFieldDefinitions.map(([key]) => key);
const fail = message => { throw Object.assign(new Error(message), { status: 400, statusCode: 400 }); };
const quoteTab = title => `'${title.replaceAll("'", "''")}'`;
function columnLetters(number) {
  let letters = '';
  for (let n=number;n;n=Math.floor((n-1)/26)) letters=String.fromCharCode(65+(n-1)%26)+letters;
  return letters;
}
export function sheetIdFromUrl(value) {
  let url;
  try { url = new URL(value); } catch { fail('Enter your Google Sheet link.'); }
  const id = url.pathname.match(/^\/spreadsheets\/d\/([\w-]+)/)?.[1];
  if (url.protocol !== 'https:' || url.hostname !== 'docs.google.com' || !id) fail('Enter a Google Sheets link.');
  return id;
}
export function mapSheetHeaders(headers) {
  const aliases = { order: 'order_id', order_number: 'order_id', order_no: 'order_id', order_date: 'date', total: 'revenue', order_total: 'revenue', amount: 'revenue', source: 'utm_source', medium: 'utm_medium', campaign: 'utm_campaign', campaign_id: 'utm_id', content: 'utm_content', term: 'utm_term', customer: 'customer_name', name: 'customer_name', phone: 'customer_phone', mobile: 'customer_phone', phone_number: 'customer_phone', zip: 'pincode', postal_code: 'pincode', product_name: 'product', item: 'product', item_name: 'product', order_status: 'delivery_status', status: 'delivery_status' };
  return headers.map(header => {
    const key = String(header).trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
    return sheetFields.includes(key) ? key : aliases[key] || '';
  });
}
export function migrateUtmSheets(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS utm_sheet_connections (
    store_id INTEGER PRIMARY KEY REFERENCES stores(id) ON DELETE CASCADE,
    credentials TEXT NOT NULL DEFAULT '', email TEXT NOT NULL DEFAULT '',
    spreadsheet_id TEXT NOT NULL DEFAULT '', title TEXT NOT NULL DEFAULT '', tab TEXT NOT NULL DEFAULT '',
    headers_json TEXT NOT NULL DEFAULT '[]', mapping_json TEXT NOT NULL DEFAULT '[]',
    enabled INTEGER NOT NULL DEFAULT 0, after_order_id INTEGER NOT NULL DEFAULT 0,
    last_synced TEXT NOT NULL DEFAULT '', error TEXT NOT NULL DEFAULT '', lock_until BIGINT NOT NULL DEFAULT 0
  );
  CREATE TABLE IF NOT EXISTS utm_sheet_exports (
    store_id INTEGER NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
    spreadsheet_id TEXT NOT NULL, tab TEXT NOT NULL, order_id INTEGER NOT NULL,
    PRIMARY KEY(store_id, spreadsheet_id, tab, order_id)
  );
  CREATE TABLE IF NOT EXISTS utm_sheet_options (
    store_id INTEGER PRIMARY KEY REFERENCES stores(id) ON DELETE CASCADE,
    row_mode TEXT NOT NULL DEFAULT 'order', abandoned_tab TEXT NOT NULL DEFAULT '',
    abandoned_after TEXT NOT NULL DEFAULT '', abandoned_headers TEXT NOT NULL DEFAULT '[]',
    abandoned_mapping TEXT NOT NULL DEFAULT '[]'
  );
  CREATE TABLE IF NOT EXISTS utm_sheet_export_state (
    store_id INTEGER NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
    spreadsheet_id TEXT NOT NULL, tab TEXT NOT NULL, order_id INTEGER NOT NULL, revision TEXT NOT NULL,
    PRIMARY KEY(store_id,spreadsheet_id,tab,order_id)
  );`);
}

export class UtmSheetService {
  constructor(db, { env = process.env, clientFactory, request } = {}) {
    this.db = db;
    this.config = { id: env.GOOGLE_CLIENT_ID, secret: env.GOOGLE_CLIENT_SECRET,
      redirect: env.GOOGLE_SHEETS_REDIRECT_URI || (env.APP_BASE_URL ? `${env.APP_BASE_URL.replace(/\/+$/, '')}/api/integrations/google-sheets/callback` : '') };
    this.key = env.GOOGLE_SHEETS_CREDENTIALS_SECRET ? createHash('sha256').update(env.GOOGLE_SHEETS_CREDENTIALS_SECRET).digest() : null;
    this.ready = Boolean(this.key && this.config.id && this.config.secret && this.config.redirect);
    this.clientFactory = clientFactory || (() => new OAuth2Client(this.config.id, this.config.secret, this.config.redirect));
    this.request = request || (async (client, options) => (await client.request({ ...options, timeout: 20000, retry: false })).data);
    this.running = null;
  }
  row(id) { return this.db.prepare('SELECT * FROM utm_sheet_connections WHERE store_id=?').get(id); }
  options(id) { return this.db.prepare('SELECT * FROM utm_sheet_options WHERE store_id=?').get(id) || { row_mode: 'order', abandoned_tab: '', abandoned_after: '', abandoned_headers: '[]', abandoned_mapping: '[]' }; }
  fields(id) { return [...sheetFieldDefinitions, ...(new SettingsService(this.db).get(id).codForm.customFields || []).map(f => [`custom_${f.id}`, f.label])]; }
  status(id) {
    const row = this.row(id);
    return { available: this.ready, connected: Boolean(row?.credentials), email: row?.email || '', enabled: Boolean(row?.enabled),
      url: row?.spreadsheet_id ? `https://docs.google.com/spreadsheets/d/${row.spreadsheet_id}/edit` : '',
      title: row?.title || '', tab: row?.tab || '', lastSynced: row?.last_synced || '', error: row?.error || '', rowMode: this.options(id).row_mode, abandonedTab: this.options(id).abandoned_tab, fields: this.fields(id).map(([key, label]) => ({ key, label })) };
  }
  seal(tokens) {
    const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', this.key, iv);
    const data = Buffer.concat([cipher.update(JSON.stringify(tokens)), cipher.final()]);
    return [iv, cipher.getAuthTag(), data].map(b => b.toString('base64url')).join('.');
  }
  client(row) {
    const [iv, tag, data] = row.credentials.split('.').map(v => Buffer.from(v, 'base64url'));
    const decipher = createDecipheriv('aes-256-gcm', this.key, iv); decipher.setAuthTag(tag);
    const tokens = JSON.parse(Buffer.concat([decipher.update(data), decipher.final()]).toString());
    const client = this.clientFactory(); client.setCredentials(tokens); return client;
  }
  async begin(state) {
    if (!this.ready) fail('Google Sheets connection needs administrator setup.');
    const client = this.clientFactory();
    const { codeVerifier, codeChallenge } = await client.generateCodeVerifierAsync();
    return { codeVerifier, url: client.generateAuthUrl({ state, access_type: 'offline', prompt: 'consent', scope: ['openid', 'email', 'https://www.googleapis.com/auth/spreadsheets'], code_challenge: codeChallenge, code_challenge_method: CodeChallengeMethod.S256 }) };
  }
  async complete(id, code, codeVerifier) {
    if (!this.ready) fail('Google Sheets connection needs administrator setup.');
    const client = this.clientFactory();
    const { tokens } = await client.getToken({ code, codeVerifier });
    if (!tokens.refresh_token || !tokens.id_token) fail('Allow Google Sheets access to connect.');
    const ticket = await client.verifyIdToken({ idToken: tokens.id_token, audience: this.config.id });
    const email = ticket.getPayload()?.email || '';
    this.db.prepare(`INSERT INTO utm_sheet_connections (store_id,credentials,email) VALUES (?,?,?)
      ON CONFLICT(store_id) DO UPDATE SET credentials=excluded.credentials,email=excluded.email,error=''`).run(id, this.seal({ refresh_token: tokens.refresh_token }), email);
  }
  async inspect(id, url, tab = '') {
    const row = this.row(id);
    if (!row?.credentials) fail('Connect your Google account first.');
    const spreadsheetId = sheetIdFromUrl(url), client = this.client(row);
    const base = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}`;
    const metadata = await this.request(client, { url: `${base}?fields=properties.title,sheets.properties` });
    const tabs = metadata.sheets.map(s => s.properties.title);
    const selected = tab || tabs[0];
    if (!tabs.includes(selected)) fail('Choose a worksheet from this spreadsheet.');
    const data = await this.request(client, { url: `${base}/values/${encodeURIComponent(`${quoteTab(selected)}!1:1`)}` });
    const headers = data.values?.[0] || [];
    if (!headers.length) fail('Add column names to the first row of your sheet, then try again.');
    if (headers.length > 100) fail('Choose a worksheet with no more than 100 columns.');
    const saved = row.spreadsheet_id === spreadsheetId && row.tab === selected && row.headers_json === JSON.stringify(headers);
    const mapping = mapSheetHeaders(headers).map((key,index) => key || this.fields(id).find(([,label]) => label.toLowerCase() === String(headers[index]).trim().toLowerCase())?.[0] || '');
    return { spreadsheetId, title: metadata.properties.title, tabs, tab: selected, headers, mapping: saved ? JSON.parse(row.mapping_json) : mapping };
  }
  async createSheet(id, input) {
    const row = this.row(id);
    if (!row?.credentials) fail('Connect your Google account first.');
    const title = String(input.title || 'Commera2 orders').trim();
    const fields = input.fields;
    if (!title || title.length > 100) fail('Enter a sheet name of up to 100 characters.');
    if (!['order','item'].includes(input.rowMode || 'order')) fail('Choose one row per order or per item.');
    if (row.lock_until > Date.now()) fail('An export is running. Try again shortly.');
    if (!Array.isArray(fields) || !fields.length || fields.length > 100 || fields.some(f => !this.fields(id).some(([key])=>key===f)) || new Set(fields).size !== fields.length || !fields.includes('order_id')) fail('Select export columns including Order ID.');
    if (input.rowMode === 'item' && !fields.includes('item_id')) fail('Include Item ID for one row per item.');
    const client = this.client(row), tabs = ['Orders', ...(input.includeAbandoned === true ? ['Abandoned checkouts'] : [])];
    const headers = fields.map(key => this.fields(id).find(([f]) => f === key)[1]);
    // Create headers with the spreadsheet so a failed second call cannot leave an empty sheet.
    const out = await this.request(client, { method: 'POST', url: 'https://sheets.googleapis.com/v4/spreadsheets', data: {
      properties: { title }, sheets: tabs.map(tab => ({ properties: { title: tab, gridProperties: { frozenRowCount: 1 } }, data: [{ rowData: [{ values: headers.map(stringValue => ({ userEnteredValue: { stringValue } })) }] }] }))
    } });
    if (!out.spreadsheetId) fail('Google did not return a spreadsheet. Check your Google Drive before trying again.');
    const url = `https://docs.google.com/spreadsheets/d/${out.spreadsheetId}/edit`;
    try {
      return await this.save(id, { url, tab: 'Orders', mapping: fields, headers, rowMode: input.rowMode || 'order', abandonedTab: tabs[1] || '' });
    } catch {
      fail(`Your sheet was created, but export setup did not finish. Choose Existing sheet and use ${url}`);
    }
  }
  async save(id, input) {
    if (this.row(id)?.lock_until > Date.now()) fail('An export is running. Try again shortly.');
    const info = await this.inspect(id, input.url, input.tab);
    if (input.headers && JSON.stringify(input.headers) !== JSON.stringify(info.headers)) fail('Your sheet columns changed. Choose the worksheet again.');
    const mapping = input.mapping || info.mapping;
    if (!Array.isArray(mapping) || mapping.length !== info.headers.length || mapping.some(f => f && !this.fields(id).some(([key])=>key===f)) || mapping.filter(f => f === 'order_id').length !== 1) fail('Map exactly one column to Order ID.');
    const previous = this.row(id);
    const sameTarget = previous.spreadsheet_id === info.spreadsheetId && previous.tab === info.tab;
    const previousOptions = this.options(id), rowMode = input.rowMode || previousOptions.row_mode;
    if (!['order', 'item'].includes(rowMode)) fail('Choose one row per order or per item.');
    if (rowMode === 'item' && mapping.filter(f => f === 'item_id').length !== 1) fail('Map exactly one column to Item ID for one row per item.');
    const exported = this.db.prepare('SELECT 1 FROM utm_sheet_exports WHERE store_id=? AND spreadsheet_id=? AND tab=? LIMIT 1').get(id, info.spreadsheetId, info.tab);
    if (sameTarget && exported && rowMode !== previousOptions.row_mode) fail('Choose a new worksheet to change the row layout after exporting orders.');
    const abandonedTab = String(input.abandonedTab ?? (sameTarget ? previousOptions.abandoned_tab : '')).trim();
    if (abandonedTab === info.tab) fail('Choose a different worksheet for abandoned checkouts.');
    const abandoned = abandonedTab ? await this.inspect(id, input.url, abandonedTab) : null;
    if (abandoned && !abandoned.mapping.includes('checkout_id') && !abandoned.mapping.includes('order_id')) fail('The abandoned worksheet needs a Checkout ID or Order ID column.');
    const after = sameTarget ? previous.after_order_id : this.db.prepare('SELECT COALESCE(MAX(id),0) AS id FROM orders WHERE store_id=?').get(id).id;
    const updated = this.db.prepare(`UPDATE utm_sheet_connections SET spreadsheet_id=?,title=?,tab=?,headers_json=?,mapping_json=?,enabled=1,after_order_id=?,error='' WHERE store_id=? AND lock_until<?`).run(info.spreadsheetId, info.title, info.tab, JSON.stringify(info.headers), JSON.stringify(mapping), after, id, Date.now());
    if (!updated.changes) fail('An export is running. Try again shortly.');
    this.db.prepare(`INSERT INTO utm_sheet_options (store_id,row_mode,abandoned_tab,abandoned_after,abandoned_headers,abandoned_mapping) VALUES (?,?,?,?,?,?)
      ON CONFLICT(store_id) DO UPDATE SET row_mode=excluded.row_mode,abandoned_tab=excluded.abandoned_tab,abandoned_after=excluded.abandoned_after,abandoned_headers=excluded.abandoned_headers,abandoned_mapping=excluded.abandoned_mapping`).run(id,rowMode,abandonedTab,sameTarget && previousOptions.abandoned_after ? previousOptions.abandoned_after : new Date().toISOString(),JSON.stringify(abandoned?.headers || []),JSON.stringify(abandoned?.mapping || []));
    return this.status(id);
  }
  async addColumn(id, input) {
    const name = String(input?.name || '').trim();
    if (!name || name.length > 100 || /[\r\n]/.test(name)) fail('Enter a short column name.');
    const info = await this.inspect(id, input.url, input.tab);
    if (info.headers.length >= 100) fail('This worksheet already has 100 columns.');
    if (info.headers.some(header => String(header).trim().toLowerCase() === name.toLowerCase())) fail('That column already exists.');
    const columnNumber = info.headers.length + 1;
    let letters = '';
    for (let n = columnNumber; n; n = Math.floor((n - 1) / 26)) letters = String.fromCharCode(65 + ((n - 1) % 26)) + letters;
    const client = this.client(this.row(id)), base = `https://sheets.googleapis.com/v4/spreadsheets/${info.spreadsheetId}`;
    await this.request(client, { method: 'PUT', url: `${base}/values/${encodeURIComponent(`${quoteTab(info.tab)}!${letters}1`)}?valueInputOption=RAW`, data: { range: `${quoteTab(info.tab)}!${letters}1`, majorDimension: 'ROWS', values: [[name]] } });
    return this.inspect(id, input.url, info.tab);
  }
  pause(id) { this.db.prepare('UPDATE utm_sheet_connections SET enabled=0 WHERE store_id=?').run(id); return this.status(id); }
  disconnect(id) {
    if (this.row(id)?.lock_until > Date.now()) fail('An export is running. Try again shortly.');
    this.db.prepare("UPDATE utm_sheet_connections SET enabled=0,credentials='',email='',error='' WHERE store_id=?").run(id);
    return this.status(id);
  }
  async syncStore(id) {
    const now = Date.now();
    const lock = this.db.prepare('UPDATE utm_sheet_connections SET lock_until=? WHERE store_id=? AND enabled=1 AND lock_until<?').run(now + 600000, id, now);
    if (!lock.changes) return;
    try {
      const row = this.row(id), client = this.client(row), mapping = JSON.parse(row.mapping_json), options = this.options(id);
      const base = `https://sheets.googleapis.com/v4/spreadsheets/${row.spreadsheet_id}`;
      const range = quoteTab(row.tab);
      const revision = `CAST(o.total_paise AS TEXT)||':'||CAST((SELECT COUNT(*) FROM order_items oi WHERE oi.order_id=o.id) AS TEXT)||':'||o.payment_status||':'||o.fulfillment_status||':'||o.delivery_status`;
      const pending = this.db.prepare(`SELECT o.*,s.currency,${revision} AS export_revision,
        c.name AS customer_name,c.phone AS customer_phone,c.email AS customer_email,c.alternate_phone,c.address,c.address_line2,c.landmark,c.city,c.state,c.country,c.pincode,
        a.data_json FROM orders o JOIN stores s ON s.id=o.store_id JOIN customers c ON c.id=o.customer_id
        LEFT JOIN checkout_attribution a ON a.checkout_id=o.checkout_session_id AND a.store_id=o.store_id
        WHERE o.store_id=? AND o.id>? AND NOT EXISTS (SELECT 1 FROM utm_sheet_export_state e WHERE e.store_id=o.store_id AND e.order_id=o.id AND e.spreadsheet_id=? AND e.tab=? AND e.revision=(${revision})) ORDER BY o.id LIMIT 20`).all(id, row.after_order_id, row.spreadsheet_id, row.tab);
      if (!pending.length) {
        await this.syncAbandoned(id, row, options, client);
        this.db.prepare("UPDATE utm_sheet_connections SET last_synced=?,error='' WHERE store_id=?").run(new Date().toISOString(),id);
        return;
      }
      const data = await this.request(client, { url: `${base}/values/${encodeURIComponent(range)}` });
      const values = data.values || [];
      if (JSON.stringify(values[0] || []) !== row.headers_json) fail('Your sheet columns changed. Choose the sheet again to update the column matching.');
      const keyColumn = mapping.indexOf(options.row_mode === 'item' ? 'item_id' : 'order_id');
      const seen = new Set(values.slice(1).map(v => String(v[keyColumn] || '')));
      for (const order of pending) {
        if (!this.row(id)?.enabled) break;
        const orderId = String(order.order_number || order.id);
        const items = this.db.prepare('SELECT * FROM order_items WHERE order_id=? ORDER BY id').all(order.id);
        const record = { ...JSON.parse(order.data_json || '{}'), ...order, order_id: orderId, date: order.created_at, revenue: order.total_paise / 100, shipping: order.shipping_paise / 100, discount: order.discount_paise / 100, coupon: order.coupon_code || '', phone_verified: order.phone_verification_status, checkout_id: order.checkout_session_id, checkout_status: 'completed' };
        for (const [key,value] of Object.entries(customCheckoutValues(this.db,id,order.checkout_session_id))) record[`custom_${key}`] = value;
        const records = options.row_mode === 'item'
          ? items.map(item => ({ ...record, item_id: `${orderId}:${item.id}`, product: item.name, product_id: String(item.product_id), quantity: item.quantity, unit_price: item.unit_price_paise / 100, line_total: item.line_total_paise / 100 }))
          : [{ ...record, product: items.map(item => item.name).join(' | '), product_id: items.map(item => item.product_id).join(' | '), quantity: items.reduce((sum, item) => sum + item.quantity, 0), unit_price: items.map(item => item.unit_price_paise / 100).join(' | '), line_total: items.reduce((sum,item) => sum + item.line_total_paise,0) / 100 }];
        const missing = records.filter(record => !seen.has(String(record[options.row_mode === 'item' ? 'item_id' : 'order_id'])));
        // Update only mapped cells. Merchant notes and formula columns remain untouched.
        const changes = [];
        for (const record of records) {
          const existing = values.findIndex((cells,index)=>index>0 && String(cells[keyColumn])===String(record[options.row_mode==='item'?'item_id':'order_id']));
          if(existing<1)continue;
          mapping.forEach((key,column)=>{
            if(key && String(values[existing][column]??'')!==String(record[key]??'')) changes.push({range:`${range}!${columnLetters(column+1)}${existing+1}`,values:[[record[key]??'']]});
          });
        }
        if(changes.length) await this.request(client,{method:'POST',url:`${base}/values:batchUpdate`,data:{valueInputOption:'RAW',data:changes}});
        if (missing.length) {
          await this.request(client, { method: 'POST', url: `${base}/values/${encodeURIComponent(range)}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`, data: { values: missing.map(record => mapping.map(key => record[key] ?? '')) } });
          for (const record of missing) seen.add(String(record[options.row_mode === 'item' ? 'item_id' : 'order_id']));
        }
        this.db.prepare('INSERT INTO utm_sheet_exports (store_id,spreadsheet_id,tab,order_id) VALUES (?,?,?,?) ON CONFLICT DO NOTHING').run(id, row.spreadsheet_id, row.tab, order.id);
        this.db.prepare('INSERT INTO utm_sheet_export_state(store_id,spreadsheet_id,tab,order_id,revision) VALUES(?,?,?,?,?) ON CONFLICT(store_id,spreadsheet_id,tab,order_id) DO UPDATE SET revision=excluded.revision').run(id,row.spreadsheet_id,row.tab,order.id,order.export_revision);
      }
      await this.syncAbandoned(id, row, options, client);
      this.db.prepare("UPDATE utm_sheet_connections SET last_synced=?,error='' WHERE store_id=?").run(new Date().toISOString(), id);
    } catch (error) {
      const message = error.statusCode === 400 ? error.message : 'Export failed. Check sheet access or reconnect Google. Pending orders will be retried.';
      this.db.prepare('UPDATE utm_sheet_connections SET error=? WHERE store_id=?').run(message, id);
    } finally { this.db.prepare('UPDATE utm_sheet_connections SET lock_until=0 WHERE store_id=?').run(id); }
  }
  async syncAbandoned(id, row, options, client) {
    if (!options.abandoned_tab || !this.row(id)?.enabled) return;
    const settings = new SettingsService(this.db).get(id);
    if (!settings.codForm.saveIncompleteCheckout || !settings.checkout.captureAbandonedCheckout || !settings.privacy.allowAbandonedCheckoutData || !settings.privacy.allowCustomerDataCollection) return;
    const cutoff = Date.now() - settings.checkout.abandonedCheckoutTimeoutMinutes * 60000;
    const pending = this.db.prepare(`SELECT cs.*,p.name AS product,s.currency,a.data_json,
      COALESCE(pb.price_paise,p.price_paise*cs.quantity) AS value_paise
      FROM checkout_sessions cs JOIN products p ON p.id=cs.product_id JOIN stores s ON s.id=cs.store_id
      LEFT JOIN product_bundles pb ON pb.id=cs.bundle_id LEFT JOIN checkout_attribution a ON a.checkout_id=cs.id AND a.store_id=cs.store_id
      WHERE cs.store_id=? AND cs.status='draft' AND (cs.phone<>'' OR cs.email<>'') AND COALESCE(cs.bot_action,'allow')<>'block'
      ORDER BY cs.updated_at DESC`).all(id).filter(cs => parseDatabaseTimestamp(cs.updated_at) <= cutoff && parseDatabaseTimestamp(cs.created_at) >= Date.parse(options.abandoned_after));
    if (!pending.length) return;
    const base = `https://sheets.googleapis.com/v4/spreadsheets/${row.spreadsheet_id}/values/${encodeURIComponent(quoteTab(options.abandoned_tab))}`;
    const data = await this.request(client, { url: base });
    if (JSON.stringify(data.values?.[0] || []) !== options.abandoned_headers) fail('Your abandoned checkout columns changed. Choose the worksheet again.');
    const mapping = JSON.parse(options.abandoned_mapping), index = mapping.includes('checkout_id') ? mapping.indexOf('checkout_id') : mapping.indexOf('order_id');
    const seen = new Set((data.values || []).slice(1).map(v => String(v[index] || '')));
    const missing = pending.filter(cs => !seen.has(String(cs.id))).slice(0,20);
    if (missing.length) await this.request(client, { method: 'POST', url: `${base}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`, data: { values: missing.map(cs => {
      let checkout;
      try { checkout = new CommerceService(this.db).getCheckout(id,cs.id); }
      catch (error) {
        // A stale promotion must not prevent exporting the customer's contact and UTM data.
        if (!/^Coupon (code|usage limit|minimum order)/.test(error.message)) throw error;
      }
      const addons=checkout?.addons||checkoutAddons(this.db,id,cs.id,settings.codForm.addons||[]),money=value=>value==null?'':value/100;
      const record = { ...JSON.parse(cs.data_json || '{}'), ...cs, order_id: cs.id, checkout_id: cs.id, date: cs.created_at, customer_name: cs.name, customer_phone: cs.phone, customer_email: cs.email, product:[cs.product,...addons.map(a=>a.name)].join(' | '), quantity:cs.quantity+addons.length, revenue: money(checkout?.totalPaise), shipping: money(checkout?.shippingPaise), discount:money(checkout?.discountPaise), coupon:cs.coupon_code || '', checkout_status: 'abandoned', phone_verified: cs.phone_verification_status };
      for (const [key,value] of Object.entries(customCheckoutValues(this.db,id,cs.id))) record[`custom_${key}`] = value;
      return mapping.map(key => record[key] ?? '');
    }) } });
  }
  sync() {
    if (this.running) return this.running;
    this.running = (async () => {
      if (!this.ready) return;
      for (const row of this.db.prepare('SELECT store_id FROM utm_sheet_connections WHERE enabled=1').all()) await this.syncStore(row.store_id);
    })().finally(() => { this.running = null; });
    return this.running;
  }
}

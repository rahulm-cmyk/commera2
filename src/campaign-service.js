import { randomUUID } from 'node:crypto';
import { analyticsAllowed } from './tracking-consent.js';

export const platformTemplates = [
  { id: 'facebook', name: 'Facebook', source: 'facebook', medium: 'paid_social' },
  { id: 'instagram', name: 'Instagram', source: 'instagram', medium: 'paid_social' },
  { id: 'google', name: 'Google Search', source: 'google', medium: 'cpc' },
  { id: 'youtube', name: 'YouTube', source: 'youtube', medium: 'paid_video' },
  { id: 'affiliate', name: 'Affiliate', source: '', medium: 'affiliate' },
];
const fields = ['name', 'baseUrl', 'platform', 'status', 'source', 'medium', 'content', 'term', 'campaignId', 'adsetId', 'adId', 'affiliateId', 'sub1', 'sub2', 'sub3', 'product', 'country', 'owner'];
const parameterFields = { utm_source: 'source', utm_medium: 'medium', utm_campaign: 'name', utm_content: 'content', utm_term: 'term', utm_id: 'campaignId', adset_id: 'adsetId', ad_id: 'adId', affiliate_id: 'affiliateId', sub1: 'sub1', sub2: 'sub2', sub3: 'sub3' };
const invalid = (message) => { const error = Error(message); error.statusCode = 400; throw error; };

const cleanValue = (value) => {
  if (value == null) return '';
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return String(value).trim();
};

const canonicalHeader = (value) =>
  String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const normalizePlatformFromSheet = (value) => {
  const platform = canonicalHeader(value);
  if (!platform) return platform;
  const aliases = {
    facebook: ['facebook', 'meta', 'meta ads', 'facebook ads', 'fb', 'fb ads'],
    instagram: ['instagram', 'insta', 'instagram ads', 'insta ads'],
    google: ['google', 'google ads', 'googlead', 'google search', 'gads', 'search'],
    youtube: ['youtube', 'yt', 'youtube ads'],
    affiliate: ['affiliate', 'partners', 'partner', 'cpa'],
  };
  const normalized = platform.replace(/\s+/g, '');
  for (const key of Object.keys(aliases)) {
    const values = aliases[key];
    if (values.includes(platform) || values.includes(normalized)) return key;
  }
  return (
    platformTemplates.find(
      (item) =>
        item.id === platform || item.name.toLowerCase() === platform,
    )?.id || ''
  );
};

const normalizeStatusFromSheet = (value) => {
  const normalized = canonicalHeader(value);
  if (!normalized) return 'Planning';
  if (['live', 'running', 'published', 'active'].includes(normalized))
    return 'Live';
  if (['paused', 'pause', 'stopped', 'inactive'].includes(normalized))
    return 'Paused';
  if (['planning', 'draft'].includes(normalized)) return 'Planning';
  return normalized[0]?.toUpperCase() + normalized.slice(1);
};

const campaignImportAliases = {
  platform: ['platform', 'channel', 'ad platform', 'network'],
  status: ['status', 'state', 'state_name'],
  name: ['campaign', 'campaign name', 'campaign_name', 'name', 'utm_campaign'],
  campaignId: ['campaign id', 'campaign_id', 'campaignid', 'utm_id', 'utm-id', 'id'],
  baseUrl: ['base url', 'base_url', 'landing url', 'landing page', 'landing page url', 'url', 'link'],
  source: ['source', 'utm_source'],
  medium: ['medium', 'utm_medium'],
  content: ['content', 'creative', 'utm_content'],
  term: ['term', 'audience', 'keyword', 'utm_term'],
  adsetId: ['ad set id', 'adset id', 'adset', 'adset_id', 'adsetid'],
  adId: ['ad id', 'ad_id', 'adid', 'ad'],
  affiliateId: ['affiliate id', 'affiliate_id', 'affiliate'],
  sub1: ['sub1', 'sub 1', 'sub_id1', 'sub id1'],
  sub2: ['sub2', 'sub 2', 'sub_id2', 'sub id2'],
  sub3: ['sub3', 'sub 3', 'sub_id3', 'sub id3'],
  product: ['product', 'product offer', 'offer', 'product/offer'],
  country: ['country', 'region'],
  owner: ['owner', 'account owner', 'owner name'],
};

const normalizeCampaignRowFromSheet = (row, lineNo) => {
  if (!row || typeof row !== 'object' || Array.isArray(row))
    invalid(`Row ${lineNo}: invalid campaign row`);
  const values = {};
  for (const [key, value] of Object.entries(row)) {
    values[canonicalHeader(key)] = cleanValue(value);
  }
  const valueFor = (aliases) => {
    for (const alias of aliases) {
      const value = values[canonicalHeader(alias)];
      if (value) return value;
    }
    return '';
  };
  const platform = normalizePlatformFromSheet(valueFor(campaignImportAliases.platform));
  return {
    platform: platform || valueFor(campaignImportAliases.platform),
    status: normalizeStatusFromSheet(valueFor(campaignImportAliases.status)),
    name: valueFor(campaignImportAliases.name),
    campaignId: valueFor(campaignImportAliases.campaignId),
    baseUrl: valueFor(campaignImportAliases.baseUrl),
    source: valueFor(campaignImportAliases.source),
    medium: valueFor(campaignImportAliases.medium),
    content: valueFor(campaignImportAliases.content),
    term: valueFor(campaignImportAliases.term),
    adsetId: valueFor(campaignImportAliases.adsetId),
    adId: valueFor(campaignImportAliases.adId),
    affiliateId: valueFor(campaignImportAliases.affiliateId),
    sub1: valueFor(campaignImportAliases.sub1),
    sub2: valueFor(campaignImportAliases.sub2),
    sub3: valueFor(campaignImportAliases.sub3),
    product: valueFor(campaignImportAliases.product),
    country: valueFor(campaignImportAliases.country),
    owner: valueFor(campaignImportAliases.owner),
  };
};

export function migrateCampaigns(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS marketing_campaigns (
    id TEXT PRIMARY KEY, store_id INTEGER NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
    campaign_key TEXT NOT NULL, data_json TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(store_id,campaign_key)
  );
  CREATE TABLE IF NOT EXISTS marketing_order_imports (
    id TEXT PRIMARY KEY, store_id INTEGER NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
    order_key TEXT NOT NULL, campaign_key TEXT NOT NULL, revenue_paise BIGINT NOT NULL,
    order_date TEXT NOT NULL, UNIQUE(store_id,order_key)
  );
  CREATE TABLE IF NOT EXISTS checkout_attribution (
    checkout_id TEXT PRIMARY KEY REFERENCES checkout_sessions(id) ON DELETE CASCADE,
    store_id INTEGER NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
    campaign_key TEXT NOT NULL, data_json TEXT NOT NULL
  );`);
}

export function buildCampaign(input = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) invalid('Enter campaign details');
  const value = {};
  for (const field of fields) {
    if (input[field] != null && typeof input[field] !== 'string') invalid(`${field} must be text`);
    value[field] = (input[field] || '').trim();
    if (value[field].length > (field === 'baseUrl' ? 2048 : 200)) invalid(`${field} is too long`);
  }
  const template = platformTemplates.find(item => item.id === value.platform);
  if (!template) invalid('Choose a platform');
  value.status ||= 'Planning';
  if (!['Planning', 'Live', 'Paused'].includes(value.status)) invalid('Choose a valid campaign status');
  value.source ||= template.source;
  value.medium ||= template.medium;
  if (!value.name || !value.source || !value.medium) invalid('Campaign name, source and medium are required');
  if (!value.campaignId) invalid('Campaign ID is required');
  let url;
  try { url = new URL(value.baseUrl); } catch { invalid('Enter a complete landing page URL'); }
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) invalid('Use an HTTP or HTTPS URL without credentials');
  // Replace managed parameters without losing unrelated queries or the anchor.
  for (const [parameter, field] of Object.entries(parameterFields)) {
    url.searchParams.delete(parameter);
    if (value[field]) url.searchParams.set(parameter, value[field]);
  }
  return { ...value, finalUrl: url.href };
}

export class CampaignService {
  constructor(db) { this.db = db; }
  capture(storeId, checkoutId, referer, privacy, input = {}) {
    if (!analyticsAllowed(privacy, input)) return;
    let url;
    try { url = new URL(referer); } catch { return; }
    const tracking = {};
    for (const parameter of Object.keys(parameterFields)) {
      const value = url.searchParams.get(parameter);
      if (value && value.length <= 200) tracking[parameter] = value;
    }
    if (!tracking.utm_id && !tracking.utm_source) return;
    this.db.prepare('INSERT INTO checkout_attribution (checkout_id,store_id,campaign_key,data_json) VALUES (?,?,?,?) ON CONFLICT(checkout_id) DO NOTHING').run(checkoutId, storeId, tracking.utm_id || '', JSON.stringify(tracking));
  }
  attributedOrders(storeId) {
    const campaigns = new Map(this.list(storeId).map(item => [item.campaignId, item]));
    return this.db.prepare(`SELECT o.id,o.total_paise,o.created_at,a.campaign_key,a.data_json FROM orders o JOIN checkout_attribution a ON a.checkout_id=o.checkout_session_id AND a.store_id=o.store_id WHERE o.store_id=? ORDER BY o.id DESC`).all(storeId)
      .map(row => ({orderId:String(row.id),date:String(row.created_at).slice(0,10),revenue:row.total_paise/100,campaignId:row.campaign_key,campaign:campaigns.get(row.campaign_key)?.name || '',tracking:JSON.parse(row.data_json)}));
  }
  list(storeId) {
    return this.db.prepare('SELECT * FROM marketing_campaigns WHERE store_id=? ORDER BY created_at DESC,id').all(storeId)
      .map(row => ({ ...JSON.parse(row.data_json), id: row.id, createdAt: row.created_at }));
  }
  save(storeId, input, id = randomUUID()) {
    const value = buildCampaign(input);
    const existing = this.db.prepare('SELECT id FROM marketing_campaigns WHERE store_id=? AND campaign_key=?').get(storeId, value.campaignId);
    if (existing && existing.id !== id) invalid('This campaign ID already exists in this store');
    this.db.prepare(`INSERT INTO marketing_campaigns (id,store_id,campaign_key,data_json) VALUES (?,?,?,?)
      ON CONFLICT(id) DO UPDATE SET campaign_key=excluded.campaign_key,data_json=excluded.data_json WHERE marketing_campaigns.store_id=excluded.store_id`).run(id, storeId, value.campaignId, JSON.stringify(value));
    return { ...value, id };
  }
  update(storeId, id, input) {
    if (!this.list(storeId).some(row => row.id === id)) invalid('Campaign not found');
    return this.save(storeId, input, id);
  }
  remove(storeId, id) { this.db.prepare('DELETE FROM marketing_campaigns WHERE store_id=? AND id=?').run(storeId, id); }
  importOrders(storeId, rows) {
    if (!Array.isArray(rows) || !rows.length || rows.length > 1000) invalid('Import between 1 and 1,000 rows');
    const seen = new Set();
    const validated = rows.map((row, index) => {
      const fail = message => invalid(`Row ${index + 2}: ${message}`);
      if (!row || typeof row !== 'object' || Array.isArray(row)) fail('invalid report row');
      if (typeof row.order_id !== 'string' || !row.order_id.trim() || row.order_id.length > 200) fail('order_id is required as text');
      if (typeof row.utm_id !== 'string' || !row.utm_id.trim() || row.utm_id.length > 200) fail('utm_id is required as text');
      if (seen.has(row.order_id.trim())) fail('duplicate order_id');
      seen.add(row.order_id.trim());
      if (!/^\d{4}-\d{2}-\d{2}$/.test(row.date || '') || !Number.isFinite(Date.parse(row.date)) || new Date(row.date).toISOString().slice(0, 10) !== row.date) fail('date must be YYYY-MM-DD');
      if (!/^\d{1,9}(\.\d{1,2})?$/.test(String(row.revenue))) fail('revenue must be a non-negative amount with up to two decimals');
      return [randomUUID(), storeId, row.order_id.trim(), row.utm_id.trim(), Math.round(Number(row.revenue) * 100), row.date];
    });
    this.db.exec('BEGIN');
    try {
      const statement = this.db.prepare(`INSERT INTO marketing_order_imports (id,store_id,order_key,campaign_key,revenue_paise,order_date) VALUES (?,?,?,?,?,?) ON CONFLICT(store_id,order_key) DO UPDATE SET campaign_key=excluded.campaign_key,revenue_paise=excluded.revenue_paise,order_date=excluded.order_date`);
      validated.forEach(row => statement.run(...row));
    this.db.exec('COMMIT');
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
    return { imported: validated.length };
  }
  importCampaigns(storeId, rows) {
    if (!Array.isArray(rows) || !rows.length || rows.length > 1000)
      invalid('Import between 1 and 1,000 rows');
    const seen = new Set();
    const prepared = rows.map((row, index) => {
      const lineNo = index + 2;
      const candidate = normalizeCampaignRowFromSheet(row, lineNo);
      if (!candidate.platform) invalid(`Row ${lineNo}: Platform is required`);
      if (!candidate.name) invalid(`Row ${lineNo}: Campaign name is required`);
      if (!candidate.campaignId) invalid(`Row ${lineNo}: Campaign ID is required`);
      if (!candidate.baseUrl) invalid(`Row ${lineNo}: Landing URL is required`);
      if (seen.has(candidate.campaignId)) invalid(`Row ${lineNo}: Duplicate campaign ID`);
      seen.add(candidate.campaignId);
      return buildCampaign(candidate);
    });
    this.db.exec('BEGIN');
    try {
      const statement = this.db.prepare(`INSERT INTO marketing_campaigns (id,store_id,campaign_key,data_json)
        VALUES (?,?,?,?)
        ON CONFLICT(store_id,campaign_key) DO UPDATE SET data_json=excluded.data_json`);
      for (const row of prepared)
        statement.run(randomUUID(), storeId, row.campaignId, JSON.stringify(row));
      this.db.exec('COMMIT');
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
    return { imported: prepared.length };
  }
  report(storeId) {
    const campaigns = new Map(this.list(storeId).map(item => [item.campaignId, item]));
    return this.db.prepare('SELECT * FROM marketing_order_imports WHERE store_id=? ORDER BY order_date DESC,order_key').all(storeId).map(row => ({ orderId: row.order_key, campaignId: row.campaign_key, revenue: row.revenue_paise / 100, date: row.order_date, campaign: campaigns.get(row.campaign_key)?.name || '', platform: campaigns.get(row.campaign_key)?.platform || '', origin: 'Imported' }));
  }
}

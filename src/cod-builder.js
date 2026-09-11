export function migrateCodBuilder(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS cod_checkout_fields (
    checkout_id TEXT PRIMARY KEY REFERENCES checkout_sessions(id) ON DELETE CASCADE,
    store_id INTEGER NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
    values_json TEXT NOT NULL DEFAULT '{}'
  )`);
  db.exec(`CREATE TABLE IF NOT EXISTS cod_checkout_addons (checkout_id TEXT PRIMARY KEY REFERENCES checkout_sessions(id) ON DELETE CASCADE, store_id INTEGER NOT NULL REFERENCES stores(id) ON DELETE CASCADE, product_ids TEXT NOT NULL DEFAULT '[]')`);
}

export function validateCodBuilder(value) {
  value.displayMode ||= 'page';
  if (!['page','popup','embedded'].includes(value.displayMode)) throw Error('Choose a valid form display mode.');
  value.postPurchaseLimit = Number(value.postPurchaseLimit ?? 1);
  if (!Number.isInteger(value.postPurchaseLimit) || value.postPurchaseLimit<1 || value.postPurchaseLimit>5) throw Error('Choose between one and five post-purchase offers.');
  value.addons ||= [];
  if (!Array.isArray(value.addons) || value.addons.length > 10 || new Set(value.addons.map(a=>a.productId)).size !== value.addons.length) throw Error('Use up to 10 different add-on products.');
  value.addons=value.addons.map(a=>{
    if(!Number.isInteger(a.productId)||a.productId<1||!Number.isInteger(a.pricePaise)||a.pricePaise<0)throw Error('Add-on product and price are required.');
    const title=String(a.title||'').trim();if(!title||title.length>100)throw Error('Enter an add-on label of up to 100 characters.');
    return {productId:a.productId,pricePaise:a.pricePaise,title};
  });
  const keys = Object.keys(value.fields);
  value.fieldOrder ||= keys;
  if (!Array.isArray(value.fieldOrder) || value.fieldOrder.length !== keys.length || new Set(value.fieldOrder).size !== keys.length || value.fieldOrder.some(key => !keys.includes(key))) throw Error('Each customer field must appear exactly once.');
  value.customFields ||= [];
  if (!Array.isArray(value.customFields) || value.customFields.length > 30) throw Error('Use up to 30 custom fields.');
  const ids = new Set();
  value.customFields = value.customFields.map(field => {
    const id = String(field.id || ''), label = String(field.label || '').trim();
    if (!/^[a-z][a-z0-9_]{0,39}$/.test(id) || ids.has(id)) throw Error('Custom field IDs must be unique.');
    ids.add(id);
    if (!label || label.length > 100) throw Error('Enter a custom field label of up to 100 characters.');
    if (!['text','textarea','select','checkbox'].includes(field.type)) throw Error('Choose a valid custom field type.');
    const options = field.type === 'select' ? (field.options || []).map(v => String(v).trim()).filter(Boolean) : [];
    if (field.type === 'select' && (!options.length || options.length > 30 || options.some(v => v.length > 100))) throw Error('Add between 1 and 30 choices.');
    return { id, label, type: field.type, required: field.required === true, placeholder: String(field.placeholder || '').slice(0,150), options };
  });
  const style = value.style || {};
  for (const key of ['background','text','button','buttonText']) if (style[key] && !/^#[a-f0-9]{6}$/i.test(style[key])) throw Error('Choose a valid form color.');
  const radius = Number(style.radius ?? 6);
  if (!Number.isInteger(radius) || radius < 0 || radius > 24) throw Error('Corner radius must be between 0 and 24 pixels.');
  value.style = { background: style.background || '#ffffff', text: style.text || '#17252a', button: style.button || '#00838b', buttonText: style.buttonText || '#ffffff', radius };
  return value;
}

export function customCheckoutValues(db, storeId, checkoutId) {
  const row = db.prepare('SELECT values_json FROM cod_checkout_fields WHERE store_id=? AND checkout_id=?').get(storeId,checkoutId);
  return JSON.parse(row?.values_json || '{}');
}

export function validateCustomCheckout(fields, input, current = {}, required = false) {
  const values = {};
  for (const field of fields || []) {
    const raw = input[`custom_${field.id}`] ?? input.customFields?.[field.id] ?? current[field.id] ?? '';
    const value = field.type === 'checkbox' ? (raw === true || raw === 'on' || raw === 'true') : String(raw).trim();
    if (typeof value === 'string' && value.length > 1000) throw Error(`${field.label} must be under 1,000 characters.`);
    if (required && field.required && !value) throw Error(`${field.label} is required.`);
    if (field.type === 'select' && value && !field.options.includes(value)) throw Error(`Choose a valid ${field.label}.`);
    values[field.id] = value;
  }
  return values;
}

export function saveCustomCheckout(db, storeId, checkoutId, values) {
  db.prepare(`INSERT INTO cod_checkout_fields (checkout_id,store_id,values_json) VALUES (?,?,?)
    ON CONFLICT(checkout_id) DO UPDATE SET values_json=excluded.values_json`).run(checkoutId,storeId,JSON.stringify(values));
}

export function renderCodBuilder(cod, checkout, currency = 'INR') {
  const json = JSON.stringify({ currency, shippingMethods:checkout.shippingMethods||[], shippingMethodId:checkout.shippingMethodId, shippingUnavailable:checkout.shippingUnavailable, fields: cod.fields, fieldOrder: cod.fieldOrder, customFields: cod.customFields || [], values: checkout.customFields || {}, style: cod.style, addons:cod.addons||[], selectedAddons:checkout.addons?.map(a=>a.productId)||[] }).replace(/</g,'\\u003c');
  return `<script type="application/json" id="cod-builder-settings">${json}</script><script src="/cod-checkout-builder.js"></script>`;
}

export function checkoutAddons(db, storeId, checkoutId, config, input, strict = false) {
  const saved=JSON.parse(db.prepare('SELECT product_ids FROM cod_checkout_addons WHERE store_id=? AND checkout_id=?').get(storeId,checkoutId)?.product_ids||'[]');
  const ids=input?.addonsSubmitted ? Object.keys(input).filter(key=>key.startsWith('addon_')&&['on',true,'true'].includes(input[key])).map(key=>Number(key.slice(6))) : saved;
  return ids.map(productId=>{
    const offer=config.find(a=>a.productId===productId);
    const product=db.prepare('SELECT name,stock,active FROM products WHERE store_id=? AND id=?').get(storeId,productId);
    if(!offer||!product?.active||product.stock<1) {
      if (strict) throw Error('An add-on is unavailable. Remove it to continue.');
      return null;
    }
    return {...offer,name:product.name};
  }).filter(Boolean);
}

export function saveCheckoutAddons(db,storeId,checkoutId,addons) {
  db.prepare('INSERT INTO cod_checkout_addons(checkout_id,store_id,product_ids) VALUES(?,?,?) ON CONFLICT(checkout_id) DO UPDATE SET product_ids=excluded.product_ids').run(checkoutId,storeId,JSON.stringify(addons.map(a=>a.productId)));
}

export function placeCheckoutAddons(db,storeId,orderId,addons) {
  for(const item of addons){
    const stock=db.prepare('UPDATE products SET stock=stock-1 WHERE store_id=? AND id=? AND stock>=1 AND active=1').run(storeId,item.productId);
    if(stock.changes!==1)throw Error('An add-on is out of stock.');
    db.prepare('INSERT INTO order_items(order_id,product_id,name,quantity,unit_price_paise,line_total_paise) VALUES(?,?,?,1,?,?)').run(orderId,item.productId,item.name,item.pricePaise,item.pricePaise);
    const location=db.prepare('SELECT il.location_id FROM inventory_levels il JOIN locations l ON l.id=il.location_id WHERE il.store_id=? AND il.product_id=? AND l.is_default=1').get(storeId,item.productId);
    if(location){
      const updated=db.prepare('UPDATE inventory_levels SET quantity=quantity-1 WHERE store_id=? AND product_id=? AND location_id=? AND quantity>=1').run(storeId,item.productId,location.location_id);
      if(updated.changes!==1)throw Error('Insufficient add-on stock at the primary location.');
      db.prepare("INSERT INTO inventory_movements(store_id,product_id,location_id,delta,reason,reference_type,reference_id) VALUES(?,?,?,-1,'order_placed','order',?)").run(storeId,item.productId,location.location_id,orderId);
    }
  }
}

export function renderCodLauncher(cod, page, enabled) {
  if (!enabled || !['popup','embedded'].includes(cod.displayMode)) return '';
  const json = JSON.stringify({ mode:cod.displayMode, store:page.storeSlug, page:page.slug }).replace(/</g,'\\u003c');
  return `<script id="cod-launch-settings" type="application/json">${json}</script><script src="/cod-form-launcher.js" defer></script>`;
}

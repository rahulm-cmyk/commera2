import { SettingsService } from './settings-service.js';

export function migrateShippingRules(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS shipping_rate_rules (
    method_id INTEGER PRIMARY KEY REFERENCES shipping_methods(id) ON DELETE CASCADE,
    store_id INTEGER NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
    rules_json TEXT NOT NULL DEFAULT '{}'
  ); CREATE TABLE IF NOT EXISTS shipping_product_weights (
    product_id INTEGER PRIMARY KEY REFERENCES products(id) ON DELETE CASCADE,
    store_id INTEGER NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
    grams INTEGER NOT NULL CHECK(grams>=0)
  );`);
}

export function validateShippingRules(db,storeId,input={}) {
  const out={description:String(input.description||'').trim()};
  if(out.description.length>180)throw Error('Shipping description must be at most 180 characters.');
  for(const key of ['minOrderPaise','maxOrderPaise','minWeightGrams','maxWeightGrams']) {
    out[key]=input[key]===null||input[key]===undefined||input[key]===''?null:Number(input[key]);
    if(out[key]!==null&&(!Number.isSafeInteger(out[key])||out[key]<0||out[key]>2147483647))throw Error('Shipping limits must be non-negative whole numbers.');
  }
  for(const [min,max] of [['minOrderPaise','maxOrderPaise'],['minWeightGrams','maxWeightGrams']])if(out[min]!==null&&out[max]!==null&&out[min]>out[max])throw Error('The minimum shipping limit cannot exceed the maximum.');
  for(const key of ['countries','states','includeProducts','excludeProducts']) {
    if(input[key]!==undefined&&!Array.isArray(input[key]))throw Error('Shipping restrictions must be lists.');
    const values=input[key]||[];
    if(values.length>250)throw Error('Use at most 250 entries per shipping restriction.');
    out[key]=[...new Set(values.map(v=>key.endsWith('Products')?Number(v):String(v).trim()).filter(v=>v!==''))];
    if(key.endsWith('Products'))for(const id of out[key]) {
      if(!Number.isSafeInteger(id)||!db.prepare('SELECT 1 FROM products WHERE store_id=? AND id=?').get(storeId,id))throw Error('Choose products from this store.');
    }
    else if(out[key].some(v=>v.length>100))throw Error('Country and state names must be at most 100 characters.');
  }
  if(out.includeProducts.some(id=>out.excludeProducts.includes(id)))throw Error('A product cannot be both included and excluded.');
  return out;
}

export function listShippingRates(db,storeId) {
  const methods=db.prepare('SELECT sm.*,r.rules_json FROM shipping_methods sm LEFT JOIN shipping_rate_rules r ON r.method_id=sm.id AND r.store_id=sm.store_id WHERE sm.store_id=? ORDER BY sm.id').all(storeId);
  return {rates:methods.map(m=>({id:m.id,name:m.name,chargePaise:m.charge_paise,enabled:Boolean(m.enabled),rules:JSON.parse(m.rules_json||'{}')})),weights:db.prepare('SELECT product_id AS "productId",grams FROM shipping_product_weights WHERE store_id=?').all(storeId)};
}

export function saveShippingRate(db,storeId,id,input) {
  const current=id?db.prepare('SELECT * FROM shipping_methods WHERE store_id=? AND id=?').get(storeId,id):null;
  if(id&&!current)throw Error('Shipping method not found.');
  const name=String(input.name??current?.name??'').trim(),charge=Number(input.chargePaise??current?.charge_paise),enabled=input.enabled??Boolean(current?.enabled??true);
  if(!name||name.length>100||!Number.isSafeInteger(charge)||charge<0||charge>2147483647||typeof enabled!=='boolean')throw Error('Enter a valid shipping name, price and enabled setting.');
  const existingRules=current?JSON.parse(db.prepare('SELECT rules_json FROM shipping_rate_rules WHERE store_id=? AND method_id=?').get(storeId,id)?.rules_json||'{}'):{};
  const rules=validateShippingRules(db,storeId,input.rules===undefined?existingRules:input.rules);
  db.exec('BEGIN IMMEDIATE');
  try {
    if(id)db.prepare('UPDATE shipping_methods SET name=?,charge_paise=?,enabled=?,updated_at=CURRENT_TIMESTAMP WHERE store_id=? AND id=?').run(name,charge,enabled?1:0,storeId,id);
    else id=Number(db.prepare('INSERT INTO shipping_methods(store_id,name,charge_paise,enabled) VALUES(?,?,?,?)').run(storeId,name,charge,enabled?1:0).lastInsertRowid);
    db.prepare('INSERT INTO shipping_rate_rules(method_id,store_id,rules_json) VALUES(?,?,?) ON CONFLICT(method_id) DO UPDATE SET rules_json=excluded.rules_json').run(id,storeId,JSON.stringify(rules));
    db.exec('COMMIT');return listShippingRates(db,storeId).rates.find(m=>m.id===id);
  }catch(error){db.exec('ROLLBACK');throw error;}
}

export function saveShippingWeights(db,storeId,weights) {
  if(!Array.isArray(weights)||weights.length>1000)throw Error('Invalid product weights.');
  for(const item of weights)if(!Number.isSafeInteger(item.productId)||!db.prepare('SELECT 1 FROM products WHERE store_id=? AND id=?').get(storeId,item.productId)||item.grams!==null&&(!Number.isSafeInteger(item.grams)||item.grams<0||item.grams>2147483647))throw Error('Enter product weights in whole grams, or leave them blank.');
  db.exec('BEGIN IMMEDIATE');
  try {
    for(const item of weights) {
      if(item.grams===null)db.prepare('DELETE FROM shipping_product_weights WHERE store_id=? AND product_id=?').run(storeId,item.productId);
      else db.prepare('INSERT INTO shipping_product_weights(store_id,product_id,grams) VALUES(?,?,?) ON CONFLICT(product_id) DO UPDATE SET grams=excluded.grams').run(storeId,item.productId,item.grams);
    }
    db.exec('COMMIT');return listShippingRates(db,storeId).weights;
  }catch(error){db.exec('ROLLBACK');throw error;}
}

export function shippingItems(productId,quantity,downsell,addons=[]) {
  return [{productId:downsell?.downsellProductId||productId,quantity:downsell?1:quantity},...addons.map(a=>({productId:a.productId,quantity:1}))];
}

export function quoteShipping(db,storeId,subtotal,state,methodId,country='India',items=[]) {
  const config=new SettingsService(db).get(storeId).shipping,{rates,weights}=listShippingRates(db,storeId);
  const estimate=`${config.minimumDeliveryDays}\u2013${config.maximumDeliveryDays} Days`,fold=v=>String(v||'').trim().toLowerCase();
  const knownWeight=items.length>0&&items.every(i=>weights.some(w=>w.productId===i.productId));
  const grams=items.reduce((sum,i)=>sum+(weights.find(w=>w.productId===i.productId)?.grams||0)*i.quantity,0);
  const available=rates.filter(m=>{
    if(!m.enabled)return false;
    const r=m.rules;
    if(r.minOrderPaise!=null&&subtotal<r.minOrderPaise||r.maxOrderPaise!=null&&subtotal>r.maxOrderPaise)return false;
    if((r.minWeightGrams!=null||r.maxWeightGrams!=null)&&(!knownWeight||r.minWeightGrams!=null&&grams<r.minWeightGrams||r.maxWeightGrams!=null&&grams>r.maxWeightGrams))return false;
    if(r.countries?.length&&!r.countries.some(v=>fold(v)===fold(country)))return false;
    if(r.states?.length&&!r.states.some(v=>fold(v)===fold(state)))return false;
    if(r.includeProducts?.length&&(!items.length||!items.every(i=>r.includeProducts.includes(i.productId))))return false;
    if(r.excludeProducts?.some(id=>items.some(i=>i.productId===id)))return false;
    return true;
  }).map(m=>{
    const zone=db.prepare('SELECT price_paise FROM shipping_zones WHERE store_id=? AND shipping_method_id=? AND lower(trim(state))=? AND enabled=1').get(storeId,m.id,fold(state));
    const price=config.freeShippingEnabled&&subtotal>=config.freeShippingMinimumPaise?0:Number(zone?.price_paise??m.chargePaise);
    return {id:m.id,name:m.name,description:m.rules.description||'',shippingPaise:price};
  });
  const selected=available.find(m=>m.id===Number(methodId))||available[0];
  return {shippingPaise:selected?.shippingPaise||0,shippingMethodId:selected?.id||null,shippingMethod:selected?.name||'',shippingMethods:available,shippingUnavailable:rates.length>0&&!available.length,deliveryEstimate:estimate};
}

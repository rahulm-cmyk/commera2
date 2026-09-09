const row=value=>value?Object.fromEntries(Object.entries(value).map(([key,item])=>[key.replace(/_([a-z])/g,(_,letter)=>letter.toUpperCase()),item])):null;
const clean=value=>String(value??'').trim();
const shipmentStatuses=new Set(['ready_to_ship','shipped','in_transit','out_for_delivery','delivered','failed','rto']);

function status(value,fallback='shipped'){
  const normalized=clean(value||fallback).toLowerCase();
  if(!shipmentStatuses.has(normalized))throw new Error('Unsupported shipment status');
  return normalized;
}

export class DeliveryService {
  constructor(db,{adapters={}}={}){this.db=db;this.adapters=adapters||{};}

  createPartner(storeId,input){
    this.#store(storeId);
    const name=clean(input.name),code=clean(input.code).toLowerCase(),trackingUrlTemplate=clean(input.trackingUrlTemplate),accountIdentifier=clean(input.accountIdentifier);
    if(!name)throw new Error('Delivery partner name is required');
    if(!/^[a-z0-9][a-z0-9_-]{1,39}$/.test(code))throw new Error('Delivery partner code must use 2-40 lowercase letters, numbers, hyphens, or underscores');
    if(trackingUrlTemplate){try{const url=new URL(trackingUrlTemplate.replace('{trackingNumber}','TEST'));if(!['http:','https:'].includes(url.protocol))throw new Error();}catch{throw new Error('Tracking URL template must be a valid HTTP or HTTPS URL');}}
    try{const result=this.db.prepare('INSERT INTO delivery_partners (store_id,name,code,tracking_url_template,account_identifier) VALUES (?,?,?,?,?)').run(storeId,name,code,trackingUrlTemplate,accountIdentifier);return this.getPartner(storeId,Number(result.lastInsertRowid));}catch(error){if(String(error.message).includes('UNIQUE constraint'))throw new Error('Delivery partner code already exists in this store');throw error;}
  }

  getPartner(storeId,id){const value=row(this.db.prepare('SELECT * FROM delivery_partners WHERE store_id=? AND id=?').get(storeId,id));if(!value)throw new Error('Delivery partner not found');return{...value,active:Boolean(value.active)};}
  listPartners(storeId){this.#store(storeId);return this.db.prepare('SELECT * FROM delivery_partners WHERE store_id=? ORDER BY id DESC').all(storeId).map(value=>{const item=row(value);return{...item,active:Boolean(item.active)}});}

  updatePartner(storeId,id,input){const current=this.getPartner(storeId,id),name=clean(input.name??current.name),tracking=clean(input.trackingUrlTemplate??current.trackingUrlTemplate),account=clean(input.accountIdentifier??current.accountIdentifier);if(!name)throw Error('Delivery partner name is required');if(tracking){try{const url=new URL(tracking.replace('{trackingNumber}','TEST'));if(!['http:','https:'].includes(url.protocol))throw Error();}catch{throw Error('Tracking URL template must be a valid HTTP or HTTPS URL');}}this.db.prepare('UPDATE delivery_partners SET name=?,tracking_url_template=?,account_identifier=? WHERE store_id=? AND id=?').run(name,tracking,account,storeId,id);return this.getPartner(storeId,id);}
  async testConnection(storeId,id,input){const partner=this.getPartner(storeId,id),adapter=this.adapters[partner.code];if(!adapter?.testConnection)throw new Error('A real delivery partner adapter is not configured');try{const result=await adapter.testConnection({partner,credential:input.credential,accountIdentifier:clean(input.accountIdentifier||partner.accountIdentifier)});if(!result?.connected)throw new Error(result?.error||'Delivery partner authentication failed');this.db.prepare("UPDATE delivery_partners SET connection_status='connected',account_identifier=?,active=1,last_sync_at=CURRENT_TIMESTAMP,last_error='' WHERE store_id=? AND id=?").run(clean(result.accountIdentifier||input.accountIdentifier||partner.accountIdentifier),storeId,id);return this.getPartner(storeId,id);}catch(error){this.db.prepare("UPDATE delivery_partners SET connection_status=?,last_error=? WHERE store_id=? AND id=?").run(/auth|credential|token|key/i.test(error.message)?'authentication_error':'api_error',clean(error.message),storeId,id);throw error;}}
  setPartnerEnabled(storeId,id,on){const partner=this.getPartner(storeId,id);if(on&&partner.connectionStatus!=='connected'&&!this.adapters[partner.code]?.createShipment)throw new Error('Connect or configure the delivery partner before enabling');this.db.prepare("UPDATE delivery_partners SET active=?,connection_status=CASE WHEN ?=0 THEN 'disabled' WHEN connection_status='disabled' THEN 'not_connected' ELSE connection_status END WHERE store_id=? AND id=?").run(on?1:0,on?1:0,storeId,id);return this.getPartner(storeId,id);}
  disconnectPartner(storeId,id){this.getPartner(storeId,id);this.db.prepare("UPDATE delivery_partners SET connection_status='not_connected',active=0,last_error='' WHERE store_id=? AND id=?").run(storeId,id);return this.getPartner(storeId,id);}

  async dispatchOrder(storeId,orderId,input){
    const store=this.#store(storeId),order=this.#order(storeId,orderId),partner=this.getPartner(storeId,Number(input.partnerId));
    if(order.fulfillmentStatus==='cancelled'||order.deliveryStatus==='cancelled')throw new Error('Cancelled orders cannot be dispatched');
    if(!partner.active)throw new Error('Delivery partner is inactive');
    if(this.db.prepare('SELECT 1 FROM shipments WHERE store_id=? AND order_id=?').get(storeId,order.id))throw new Error('Order already has a shipment');
    const customer=row(this.db.prepare('SELECT * FROM customers WHERE store_id=? AND id=?').get(storeId,order.customerId));
    const items=this.db.prepare('SELECT * FROM order_items WHERE order_id=? ORDER BY id').all(order.id).map(row);
    const adapter=this.adapters[partner.code];
    let carrier={};
    if(adapter?.createShipment)carrier=await adapter.createShipment({store,partner,order,customer,items});
    const trackingNumber=clean(carrier.trackingNumber||input.trackingNumber);
    if(!trackingNumber)throw new Error(adapter?'Delivery adapter did not return a tracking number':'Tracking number is required for a manual delivery partner');
    const shipmentStatus=status(carrier.status||input.status,'shipped');
    const trackingUrl=clean(carrier.trackingUrl||input.trackingUrl)||(partner.trackingUrlTemplate?partner.trackingUrlTemplate.replaceAll('{trackingNumber}',encodeURIComponent(trackingNumber)):'');
    if(trackingUrl){try{const parsed=new URL(trackingUrl);if(!['http:','https:'].includes(parsed.protocol))throw new Error();}catch{throw new Error('Tracking URL must be a valid HTTP or HTTPS URL');}}
    const externalId=clean(carrier.externalId||input.externalId);
    const shippedAt=['shipped','in_transit','out_for_delivery','delivered'].includes(shipmentStatus)?new Date().toISOString():null;
    const deliveredAt=shipmentStatus==='delivered'?new Date().toISOString():null;
    this.db.exec('BEGIN IMMEDIATE');
    try{
      const result=this.db.prepare('INSERT INTO shipments (store_id,order_id,partner_id,tracking_number,tracking_url,external_id,status,shipped_at,delivered_at) VALUES (?,?,?,?,?,?,?,?,?)').run(storeId,order.id,partner.id,trackingNumber,trackingUrl,externalId,shipmentStatus,shippedAt,deliveredAt);
      this.#syncOrder(storeId,order.id,partner.name,shipmentStatus);
      this.db.exec('COMMIT');
      return this.getShipment(storeId,Number(result.lastInsertRowid));
    }catch(error){this.db.exec('ROLLBACK');if(String(error.message).includes('UNIQUE constraint'))throw new Error('Order already has a shipment');throw error;}
  }

  updateShipmentStatus(storeId,id,input){
    const shipment=this.getShipment(storeId,id),next=status(input.status),partner=this.getPartner(storeId,shipment.partnerId);
    const shippedAt=['shipped','in_transit','out_for_delivery','delivered'].includes(next)?(shipment.shippedAt||new Date().toISOString()):shipment.shippedAt;
    const deliveredAt=next==='delivered'?(shipment.deliveredAt||new Date().toISOString()):null;
    this.db.prepare('UPDATE shipments SET status=?,shipped_at=?,delivered_at=?,updated_at=CURRENT_TIMESTAMP WHERE store_id=? AND id=?').run(next,shippedAt,deliveredAt,storeId,id);
    this.#syncOrder(storeId,shipment.orderId,partner.name,next);
    return this.getShipment(storeId,id);
  }

  getShipment(storeId,id){const value=row(this.db.prepare(`SELECT sh.*,dp.name partner_name,dp.code partner_code,o.order_number FROM shipments sh JOIN delivery_partners dp ON dp.id=sh.partner_id JOIN orders o ON o.id=sh.order_id WHERE sh.store_id=? AND sh.id=?`).get(storeId,id));if(!value)throw new Error('Shipment not found');return value;}
  listShipments(storeId){this.#store(storeId);return this.db.prepare(`SELECT sh.*,dp.name partner_name,dp.code partner_code,o.order_number FROM shipments sh JOIN delivery_partners dp ON dp.id=sh.partner_id JOIN orders o ON o.id=sh.order_id WHERE sh.store_id=? ORDER BY sh.updated_at DESC,sh.id DESC`).all(storeId).map(row);}

  #syncOrder(storeId,orderId,partnerName,shipmentStatus){const current=this.#order(storeId,orderId),fulfillment=shipmentStatus==='ready_to_ship'?'unfulfilled':'fulfilled';this.db.prepare("UPDATE orders SET fulfillment_status=?,fulfilled_at=CASE WHEN ?='fulfilled' THEN COALESCE(fulfilled_at,CURRENT_TIMESTAMP) ELSE fulfilled_at END,delivery_status=?,delivery_method=? WHERE store_id=? AND id=?").run(fulfillment,fulfillment,shipmentStatus,partnerName,storeId,orderId);this.db.prepare("INSERT INTO order_events (store_id,order_id,event_type,old_status,new_status,note,source) VALUES (?,?,'shipment_status',?,?,?,'delivery_partner')").run(storeId,orderId,current.deliveryStatus,shipmentStatus,`Shipment updated with ${partnerName}`);}
  #store(id){const value=row(this.db.prepare('SELECT * FROM stores WHERE id=?').get(id));if(!value)throw new Error('Store not found');return value;}
  #order(storeId,id){const value=row(this.db.prepare('SELECT * FROM orders WHERE store_id=? AND id=?').get(storeId,id));if(!value)throw new Error('Order not found');return value;}
}

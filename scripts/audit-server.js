// Disposable audit services: isolated databases, loopback only, no provider calls.
import {createDatabase} from '../src/database.js';
import {createApp} from '../src/server.js';
import {StorefrontService} from '../src/storefront-service.js';
import {OnlineStoreService} from '../src/online-store-service.js';
const noExternal = async () => { throw Error('External provider calls are disabled in audit mode'); };
const auditPincodes = {
  '560001': {city:'Bengaluru',state:'Karnataka',country:'India'},
  '110001': {city:'New Delhi',state:'Delhi',country:'India'},
};
const options = {otpProviders:{},otpFetch:noExternal,pixelFetch:noExternal,domainSyncIntervalMs:0,pincodeOptions:{lookup:async code=>auditPincodes[code]??null}};
const secured = createApp({...options,db:createDatabase(':memory:'),port:4209,merchantAuth:true});
const db=createDatabase(':memory:'), app=createApp({...options,db,port:4188,merchantAuth:false});
const store=app.service.createStore({name:'Audit Store',slug:'audit-store'});
app.service.createStore({name:'Empty Audit Store',slug:'empty-audit-store'});
const image={name:'audit.png',type:'image/png',data:'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII='};
const storefront=new StorefrontService(db);
storefront.saveBranding(store.id,{logo:image});
const products=[];
for(const [name,slug,price] of [['Audit Main Product','audit-main',79900],['Audit Add-on','audit-addon',29900],['Audit Starter','audit-starter',39900]]) {
  const product=app.service.createProduct(store.id,{name,slug,pricePaise:price,stock:30,description:'Isolated audit product.'});
  const page=app.service.createProductPage(store.id,{productId:product.id,title:name,slug:slug+'-page',body:'Isolated audit page.'});
  app.service.publishPage(store.id,page.id);
  storefront.saveProduct(store.id,product.id,{mainImage:image,description:'<p>Isolated audit product.</p>',buttonText:'Buy now',buttonAction:'checkout',publish:true},page.id);
  products.push({product,page});
}
storefront.saveHome(store.id,{bannerImage:image,bannerHeading:'Audit storefront',buttonText:'Shop',buttonTarget:{type:'product',id:products[0].product.id},featuredProductIds:products.map(p=>p.product.id)});
storefront.publishHome(store.id);
app.service.createUpsell(store.id,{productId:products[0].product.id,upsellProductId:products[1].product.id,name:'Audit add-on offer',headline:'Add an extra',quantity:1,pricePaise:19900,status:'active'});
const checkout=app.service.saveCheckoutDraft(store.id,{pageId:products[0].page.id,productId:products[0].product.id,quantity:1,name:'Audit Customer',phone:'9876543210',address:'12 Audit Road',city:'Bengaluru',state:'Karnataka',country:'India',pincode:'560001',termsAccepted:true});
app.service.placeCodOrder(store.id,{sessionId:checkout.id});
const online=new OnlineStoreService(db);
const about=online.save(store.id,null,{title:'About our store',slug:'about',content:'<p>Isolated content for audit.</p>'});online.publish(store.id,about.id);
await secured.start('127.0.0.1');await app.start('127.0.0.1');
console.log('Audit API: http://127.0.0.1:4209 | Audit UI: http://127.0.0.1:4188');
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,async()=>{await app.stop();await secured.stop();process.exit(0);});

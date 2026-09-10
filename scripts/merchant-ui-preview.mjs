import { createDatabase } from '../src/database.js';
import { createApp } from '../src/server.js';
import { fileURLToPath } from 'node:url';

// Separate, persistent sample data. Never connects to the hosted database.
process.env.DATABASE_MODE = 'sqlite';
const db = createDatabase(fileURLToPath(new URL('../data/merchant-ui-preview.sqlite', import.meta.url)));
const app = createApp({ db, port: 4188, merchantAuth: false,
  domainSyncIntervalMs: 0, otpProviders: {}, googleAuthProvider: null,
  accountEmailProvider: null, domainOptions: { cnameTarget: 'edge.example.com' } });
if (!app.service.listStores().length) {
  const store = app.service.createStore({ name: 'Northline - UI Preview', slug: 'northline-preview' });
  const samples = [['Everyday Tote',129900,24],['Travel Organiser',89900,42],['Ceramic Cup',64900,8]];
  for (const [index,[name,pricePaise,stock]] of samples.entries()) {
    const product = app.service.createProduct(store.id,{name,slug:name.toLowerCase().replaceAll(' ','-'),pricePaise,stock,description:'Sample product for testing the new merchant interface.'});
    const page = app.service.createProductPage(store.id,{productId:product.id,title:name,slug:product.slug,body:product.description});
    app.service.publishPage(store.id,page.id);
    const checkout = app.service.saveCheckoutDraft(store.id,{pageId:page.id,productId:product.id,quantity:1,name:['Asha Patel','Priya Shah','Arjun Mehta'][index],phone:`987654321${index}`,address:'12 Sample Road, Bengaluru',city:'Bengaluru',state:'Karnataka',country:'India',pincode:'560001',termsAccepted:true});
    app.service.placeCodOrder(store.id,{sessionId:checkout.id});
  }
}
await app.start('127.0.0.1');
console.log(`Merchant UI preview with sample data: http://127.0.0.1:${app.port}/overview`);
process.on('SIGINT', async () => { await app.stop(); process.exit(0); });

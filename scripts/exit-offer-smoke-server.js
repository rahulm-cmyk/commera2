// Isolated browser fixture: no live database, payment provider or external pixels.
import { createDatabase } from '../src/database.js';
import { createApp } from '../src/server.js';
const app=createApp({db:createDatabase(':memory:'),port:4189,merchantAuth:false});
const store=app.service.createStore({name:'Exit Offer Test',slug:'exit-test'});
const product=app.service.createProduct(store.id,{name:'Test Oil',slug:'test-oil',pricePaise:79900,stock:20});
const page=app.service.createProductPage(store.id,{productId:product.id,title:'Test Oil',slug:'test-oil',body:'Isolated Back-button regression fixture.'});
app.service.publishPage(store.id,page.id);
app.service.createExitOffer(store.id,{name:'Back test',status:'active',discountType:'percent',discountValue:10,headline:'Before you go, save 10%',buttonText:'Claim offer',rejectText:'No thanks, leave',targetType:'all_products',showProductPage:true,showCheckout:true});
await app.start('127.0.0.1');
console.log('Exit offer fixture: http://127.0.0.1:4189/s/exit-test');

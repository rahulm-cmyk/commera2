// Isolated local UI fixture; never uses merchant data, payments or pixel adapters.
import {createDatabase} from '../src/database.js';
import {createApp} from '../src/server.js';
import {StorefrontService} from '../src/storefront-service.js';
const db=createDatabase(':memory:'),app=createApp({db,port:4188,merchantAuth:false});
const store=app.service.createStore({name:'Online Store QA',slug:'online-store-qa'});
const product=app.service.createProduct(store.id,{name:'Preview Product',slug:'preview-product',pricePaise:50000,stock:10});
const page=app.service.createProductPage(store.id,{productId:product.id,title:'Preview Product',slug:'preview-page',body:'Isolated test product.'});
app.service.publishPage(store.id,page.id);
const storefront=new StorefrontService(db),image={name:'test.png',type:'image/png',data:'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII='};
storefront.saveBranding(store.id,{logo:image});
storefront.saveProduct(store.id,product.id,{mainImage:image,description:'<p>Preview Product</p>',buttonText:'Buy now',buttonAction:'checkout',publish:true},page.id);
storefront.saveHome(store.id,{bannerImage:image,bannerHeading:'Your next chapter starts here',buttonText:'Shop',buttonTarget:{type:'product',id:product.id},featuredProductIds:[product.id]});
storefront.publishHome(store.id);
await app.start();console.log('Isolated Online Store QA: http://127.0.0.1:4188/online-store/themes');

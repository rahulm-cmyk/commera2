// Isolated browser fixture: no persisted merchant data, tracking integrations or orders.
import { createDatabase } from '../src/database.js';
import { createApp } from '../src/server.js';
import { ProjectService } from '../src/project-service.js';
const db = createDatabase(':memory:');
const app = createApp({ db, port: 4188, merchantAuth: false });
const projects = new ProjectService(db);
const store = app.service.createStore({ name: 'Builder Draft Test', slug: 'builder-draft-test' });
const product = app.service.createProduct(store.id, { name: 'Builder Test Product', slug: 'builder-product', pricePaise: 99900, stock: 10 });
const project = projects.createProject(store.id, { productId: product.id, name: 'Builder Project', slug: 'builder-project' });
const page = projects.createBlankPage(store.id, { projectId: project.id, productId: product.id, title: 'Builder Test Page', slug: 'builder-page' });
projects.publishPage(store.id, page.id);
await app.start();
console.log(`Isolated builder fixture: http://127.0.0.1:${app.port}/product-pages/${page.id}/edit`);

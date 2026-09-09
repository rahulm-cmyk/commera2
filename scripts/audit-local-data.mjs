// Read-only integrity checks; never repairs or prints customer/provider records.
import {DatabaseSync} from 'node:sqlite';
import {resolve} from 'node:path';
const db=new DatabaseSync(resolve('data/commera2.sqlite'),{readOnly:true});
const count=sql=>Number(db.prepare(sql).get().count);
try {
  console.log(JSON.stringify({
    quickCheck:db.prepare('PRAGMA quick_check').all().map(row=>Object.values(row)[0]),
    foreignKeyViolations:db.prepare('PRAGMA foreign_key_check').all().length,
    negativeProductStock:count('SELECT COUNT(*) count FROM products WHERE stock<0'),
    negativeLocationStock:count('SELECT COUNT(*) count FROM inventory_levels WHERE quantity<0'),
    invalidOrderTotals:count('SELECT COUNT(*) count FROM orders WHERE total_paise<>MAX(0,subtotal_paise-discount_paise+shipping_paise)'),
    crossStoreOrderItems:count('SELECT COUNT(*) count FROM order_items oi JOIN orders o ON o.id=oi.order_id JOIN products p ON p.id=oi.product_id WHERE p.store_id<>o.store_id'),
    crossStorePages:count('SELECT COUNT(*) count FROM product_pages pp JOIN products p ON p.id=pp.product_id WHERE pp.store_id<>p.store_id')
  },null,2));
} finally {db.close();}

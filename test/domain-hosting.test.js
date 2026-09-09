import test from 'node:test';
import assert from 'node:assert/strict';
import { createDatabase } from '../src/database.js';
import { CommerceService } from '../src/commerce-service.js';
import { DomainService } from '../src/domain-service.js';

test('missing hosting blocks setup and hides legacy DNS instructions', async () => {
  const db = createDatabase(':memory:');
  try {
    const store = new CommerceService(db).createStore({ name: 'Hosting Test', slug: 'hosting-test' });
    const configured = new DomainService(db, { cnameTarget: 'edge.example.com' });
    const domain = configured.addDomain(store.id, { domainName: 'shop.example.org' });
    const service = new DomainService(db);
    assert.equal(service.overview(store.id).hostingConfigured, false);
    assert.deepEqual(service.getDomain(store.id, domain.id).dnsRecords, []);
    assert.throws(() => service.addDomain(store.id, { domainName: 'new.example.org' }), /Platform hosting is not configured/);
    assert.throws(() => service.getDomainInstructions(store.id, domain.id), /Platform hosting is not configured/);
    await assert.rejects(service.checkDns(store.id, domain.id), /Platform hosting is not configured/);
    assert.equal(service.listDomains(store.id).length, 1);
  } finally { db.close(); }
});

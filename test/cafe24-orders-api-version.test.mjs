import assert from 'node:assert/strict';
import test from 'node:test';
import {readFile} from 'node:fs/promises';
import {runInNewContext} from 'node:vm';

const source=await readFile(new URL('../server.mjs',import.meta.url),'utf8');
const start=source.indexOf('function cafe24ApiVersion()');
const end=source.indexOf('function safeCafe24OrdersUrl(',start);
function resolvers(env={}) {
 return runInNewContext(`${source.slice(start,end)};({cafe24ApiVersion,cafe24OrdersApiVersion,cafe24OrdersHeaders})`,{env,URL});
}
test('Orders version floors earlier configured API versions at 2025-07-01',()=>{
 for(const env of [{CAFE24_API_VERSION:'2025-06-01'},{CAFE24_ADMIN_API_VERSION:'2025-06-01'},{}])assert.equal(resolvers(env).cafe24OrdersApiVersion(),'2025-07-01');
});
test('Orders retains minimum and newer versions and existing general priority',()=>{
 for(const version of ['2025-07-01','2025-12-01','2026-06-01'])assert.equal(resolvers({CAFE24_API_VERSION:version}).cafe24OrdersApiVersion(),version);
 assert.equal(resolvers({CAFE24_API_VERSION:'2025-06-01',CAFE24_ADMIN_API_VERSION:'2025-12-01'}).cafe24OrdersApiVersion(),'2025-07-01');
});
test('dedicated Orders configuration takes priority without altering the general resolver',()=>{
 const r=resolvers({CAFE24_ORDERS_API_VERSION:'2025-12-01',CAFE24_API_VERSION:'2026-06-01'});
 assert.equal(r.cafe24OrdersApiVersion(),'2025-12-01');assert.equal(r.cafe24ApiVersion(),'2026-06-01');
});
test('shared HTTP headers isolate orders list/items from products/customers/diagnostics',()=>{
 const r=resolvers({CAFE24_ACCESS_TOKEN:'fake',CAFE24_API_VERSION:'2025-06-01',CAFE24_ORDERS_API_VERSION:'2025-12-01'});
 for(const path of ['/orders','/orders/123/items','/orders/count'])assert.equal(r.cafe24OrdersHeaders(new URL('https://test.cafe24api.com/api/v2/admin'+path))['X-Cafe24-Api-Version'],'2025-12-01');
 for(const path of ['/products','/customers','/orders-other'])assert.equal(r.cafe24OrdersHeaders(new URL('https://test.cafe24api.com/api/v2/admin'+path))['X-Cafe24-Api-Version'],'2025-06-01');
 assert.equal(r.cafe24OrdersHeaders().Authorization,'Bearer fake');assert.equal(r.cafe24OrdersHeaders()['Content-Type'],'application/json');
});
test('general version fallback is unchanged by the Orders-only setting',()=>{
 assert.equal(resolvers({CAFE24_ORDERS_API_VERSION:'2025-12-01'}).cafe24ApiVersion(),'2025-06-01');
 assert.equal(resolvers({CAFE24_ADMIN_API_VERSION:'2024-12-01'}).cafe24ApiVersion(),'2024-12-01');
});
test('all shared header call sites pass the request URL',()=>{
 assert(!/cafe24OrdersHeaders\(\)/.test(source));
 assert.match(source,/function cafe24OrdersHeaders\(url\)/);
});

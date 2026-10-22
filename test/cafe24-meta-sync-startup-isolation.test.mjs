import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir, mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { once } from 'node:events';

const serverFile = fileURLToPath(new URL('../server.mjs', import.meta.url));
const source = await readFile(process.env.CAFE24_SECURITY_SOURCE_FILE || serverFile, 'utf8');

test('NEW COLLECTION probe is retained with zero callers and no startup/timer connection', () => {
  assert.match(source, /async function runCafe24NewCollectionSinceProbe\(\)/);
  assert.equal((source.match(/runCafe24NewCollectionSinceProbe\s*\(/g) || []).length, 1, 'only the function definition may remain');
  const startup = source.slice(source.indexOf('}).listen(port, host, () => {'), source.indexOf('\n}) : null;'));
  for (const name of ['runCafe24NewCollectionSinceProbe', 'runCafe24MetaSyncStartupProbe', 'runCafe24MetaSyncGuard', 'runCafe24MetaSyncGuardScheduledCheck']) {
    assert(!startup.includes(`${name}(`), `${name} must not run at boot or from a startup timer`);
  }
});

// This preload runs before server imports. It blocks fetch AND lower-level outbound sockets;
// only reduced counters reach the test, never URLs, headers, credentials or response bodies.
const networkBlocker = `
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import tls from 'node:tls';
import { syncBuiltinESMExports } from 'node:module';
const attempts = [];
function block(transport, target, options = {}) {
  let host = '', path = '';
  while (Array.isArray(target)) target = target[0];
  try {
    if (typeof target === 'string' || target instanceof URL) { const u = new URL(target); host = u.hostname; path = u.pathname; }
    else { host = target?.hostname || target?.host || ''; path = target?.path || ''; }
  } catch {}
  attempts.push({ transport, method: options?.method || target?.method || 'GET', cafe24: /cafe24api\\.com$/i.test(host), oauth: /\\/oauth\\/token/.test(path) });
  throw Object.assign(new Error('TEST_OUTBOUND_NETWORK_BLOCKED'), { code: 'TEST_OUTBOUND_NETWORK_BLOCKED' });
}
globalThis.fetch = async (target, options) => block('fetch', target, options);
for (const [transport, mod] of [['http', http], ['https', https]]) {
  mod.request = (...args) => block(transport, ...args);
  mod.get = (...args) => block(transport, ...args);
}
net.Socket.prototype.connect = function (...args) { return block('socket', args[0]); };
tls.connect = (...args) => block('tls', args[0]);
syncBuiltinESMExports();
process.on('message', message => { if (message === 'network-snapshot') process.send({ kind: 'network-snapshot', attempts }); });
`;

function snapshot(child) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { child.off('message', onMessage); reject(Error('network snapshot timeout')); }, 3000);
    function onMessage(message) {
      if (message?.kind !== 'network-snapshot') return;
      clearTimeout(timer); child.off('message', onMessage); resolve(message.attempts);
    }
    child.on('message', onMessage); child.send('network-snapshot');
  });
}
async function stop(child) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const exited = once(child, 'exit'); child.kill('SIGTERM'); await exited;
}
async function fixture(t) {
  const dir = await mkdtemp(join(tmpdir(), 'cafe24-startup-isolation-'));
  t.after(async () => { t.diagnostic(`Removing test fixture: ${dir}`); await rm(dir, { recursive: true, force: true }); });
  const preload = join(dir, 'block-network.mjs'); await writeFile(preload, networkBlocker);
  return { dir, preload };
}

test('network blocker rejects fake fetch/http/https/socket attempts before any external IO', { timeout: 10000 }, async t => {
  const { dir, preload } = await fixture(t);
  const code = `
    import http from 'node:http'; import https from 'node:https'; import net from 'node:net';
    await fetch('https://fake.cafe24api.com/api/v2/oauth/token', { method: 'POST' }).catch(() => {});
    for (const invoke of [() => http.get('http://fake.cafe24api.com/products'), () => https.request('https://fake.cafe24api.com/products'), () => net.connect({host:'fake.cafe24api.com',port:443})]) { try { invoke(); } catch {} }
    process.send({ kind: 'ready' });`;
  const child = spawn(process.execPath, ['--import', preload, '--input-type=module', '-e', code], { cwd: dir, env: {}, stdio: ['ignore', 'ignore', 'pipe', 'ipc'] });
  t.after(() => stop(child));
  await new Promise((resolve, reject) => { child.on('message', x => { if (x.kind === 'ready') resolve(); }); child.once('exit', () => reject(Error('blocker control exited early'))); });
  const attempts = await snapshot(child);
  assert.equal(attempts.length, 4); assert(attempts.every(x => x.cafe24));
  assert.equal(attempts.filter(x => x.oauth && x.method === 'POST').length, 1);
});

test('real server boot/restart with enabled flags and near-expiry fake token makes zero Cafe24/OAuth requests and leaves token unchanged', { timeout: 20000 }, async t => {
  const { dir, preload } = await fixture(t);
  const workDir = join(dir, 'work'); await mkdir(workDir);
  for (const name of ['brand-master.json', 'product-registry.json', 'product-registry-review-queue.json', 'brand-commercial-policy.json', 'brand-sourcing-master.json']) {
    await writeFile(join(workDir, name), JSON.stringify({ entries: [], brands: [], policies: [] }));
  }
  const tokenDir = join(dir, 'fake-meta-sync-secrets'); await mkdir(tokenDir);
  const tokenFile = join(tokenDir, 'cafe24-meta-sync-token.json');
  const tokenBytes = JSON.stringify({ schema: 1, status: 'active', accessToken: 'FAKE_ACCESS', refreshToken: 'FAKE_REFRESH', expiresAt: new Date(Date.now() + 30000).toISOString(), scopes: ['mall.read_product', 'mall.write_product'] });
  await writeFile(tokenFile, tokenBytes, { mode: 0o600 }); const before = await stat(tokenFile);
  for (let boot = 0; boot < 2; boot++) {
    const child = spawn(process.execPath, ['--import', preload, serverFile], { cwd: dir, stdio: ['ignore', 'pipe', 'pipe', 'ipc'], env: {
      PATH: process.env.PATH, TZ: 'Asia/Seoul', HOST: '127.0.0.1', PORT: '0', WORK_DIR: workDir,
      CAFE24_TOKEN_STORE_DIR: join(dir, 'fake-reporting-secrets'), CAFE24_META_SYNC_TOKEN_STORE_DIR: tokenDir,
      CAFE24_META_SYNC_GUARD_ENABLED: 'on', CAFE24_META_SYNC_TEST_PRODUCT_NO: '123', CAFE24_META_SYNC_NEW_COLLECTION_SINCE: '2026-08-01',
      CAFE24_MALL_ID: 'FAKE_MALL', CAFE24_META_SYNC_CLIENT_ID: 'FAKE_CLIENT', CAFE24_META_SYNC_CLIENT_SECRET: 'FAKE_SECRET',
      CAFE24_PROXY_BASIC_AUTH: 'FAKE:FAKE', SAMPLAS_OPERATOR_BASIC_AUTH: 'FAKE_OPERATOR:FAKE',
      ECOUNT_AUTO_SYNC: 'off', SEEDING_CANDIDATES_ENABLED: 'false', VEIL_FOUND_ONCE_ENABLED: 'false'
    } });
    let stderr = ''; child.stderr.on('data', data => { stderr += String(data); });
    try {
      await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(Error('server startup timeout')), 7000);
        child.stdout.on('data', data => { if (String(data).includes('SAMPLAS Marketing OS running at')) { clearTimeout(timer); resolve(); } });
        child.once('exit', code => { clearTimeout(timer); reject(Error(`server exited before boot confirmation (${code}): ${stderr.slice(-800)}`)); });
      });
      await new Promise(resolve => setTimeout(resolve, 500));
      const attempts = await snapshot(child);
      assert.equal(attempts.filter(x => x.cafe24).length, 0, 'Cafe24 request attempts');
      assert.equal(attempts.filter(x => x.oauth && x.method === 'POST').length, 0, 'OAuth token POST attempts');
      assert.equal(attempts.length, 0, 'all outbound IO attempts');
    } finally { await stop(child); }
    assert.equal(await readFile(tokenFile, 'utf8'), tokenBytes);
    const after = await stat(tokenFile); assert.equal(after.mtimeMs, before.mtimeMs); assert.equal(after.ino, before.ino);
  }
});

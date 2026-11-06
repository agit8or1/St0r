// node tests/http-redirects.test.mjs
// axios (Node adapter, via follow-redirects) between two local servers on 127.0.0.1.
// The backend does not call axios itself today; this guards the resolved dependency
// tree so a future caller cannot leak credentials across a redirect.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';
import axios from 'axios';

// The follow-redirects copy axios itself loads, wherever npm placed it.
const { http: redirectingHttp } = createRequire(createRequire(import.meta.url).resolve('axios'))('follow-redirects');

async function listen(t, handler) {
  const server = createServer(handler);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise(resolve => server.close(resolve)));
  return `http://127.0.0.1:${server.address().port}`;
}

async function redirectPair(t, status = 302) {
  const seen = [];
  const target = await listen(t, (req, res) => { seen.push(req.headers); res.end('landed'); });
  const origin = await listen(t, (req, res) => {
    seen.push(req.headers);
    if (req.url === '/same') { res.writeHead(status, { Location: '/landing' }); res.end(); return; }
    if (req.url === '/landing') { res.end('landed'); return; }
    res.writeHead(status, { Location: `${target}/landing` }); res.end();
  });
  return { origin, seen };
}

const secrets = { Authorization: 'Bearer synthetic-secret', Cookie: 'auth_token=synthetic-secret',
                  'Proxy-Authorization': 'Basic synthetic-secret' };

for (const status of [301, 302, 307, 308]) {
  test(`credentials are stripped on a cross-origin ${status} redirect`, async t => {
    const { origin, seen } = await redirectPair(t, status);
    const res = await axios.get(`${origin}/start`, { headers: secrets });
    assert.equal(res.data, 'landed');
    assert.equal(seen.length, 2);
    assert.equal(seen[0].authorization, secrets.Authorization);
    for (const name of ['authorization', 'cookie', 'proxy-authorization']) assert.equal(seen[1][name], undefined, name);
  });
}

// The three follow-redirects advisories need options axios never passes (array-form
// headers, sensitiveHeaders), so they are exercised on the library directly.
function followGet(url, options) {
  return new Promise((resolve, reject) => {
    const req = redirectingHttp.get(url, options, res => { res.resume(); res.on('end', resolve); });
    req.on('error', reject);
  });
}

// GHSA-q3jh-wrc6-jgq8: Node's alternating name/value header array skipped the stripping.
test('array-form headers are stripped on a cross-origin redirect', async t => {
  const { origin, seen } = await redirectPair(t);
  await followGet(`${origin}/start`, { headers: ['Authorization', 'Bearer synthetic-secret', 'Cookie', 'a=b', 'X-Harmless', '1'] });
  assert.equal(seen[0].authorization, 'Bearer synthetic-secret');
  assert.equal(seen[1].authorization, undefined);
  assert.equal(seen[1].cookie, undefined);
  assert.equal(seen[1]['x-harmless'], '1');
});

// GHSA-8r9p-f939-6h3c (regex metacharacters) and GHSA-mrwp-f3q8-3g9p (cross-realm array).
test('declared sensitiveHeaders are stripped whatever their spelling or realm', async t => {
  for (const [name, sensitiveHeaders] of [['X-Api^Key', ['X-Api^Key']], ['X-Token|Secret', ['X-Token|Secret']],
                                          ['X-Stor-Agent-Key', runInNewContext("['X-Stor-Agent-Key']")]]) {
    const { origin, seen } = await redirectPair(t);
    await followGet(`${origin}/start`, { headers: { [name]: 'synthetic-secret', 'X-Harmless': '1' }, sensitiveHeaders });
    assert.equal(seen[0][name.toLowerCase()], 'synthetic-secret');
    assert.equal(seen[1][name.toLowerCase()], undefined, name);
    assert.equal(seen[1]['x-harmless'], '1');
  }
});

test('same-origin redirects keep credentials and the redirect limit holds', async t => {
  const { origin, seen } = await redirectPair(t);
  await axios.get(`${origin}/same`, { headers: secrets });
  assert.equal(seen[1].authorization, secrets.Authorization);
  await assert.rejects(axios.get(`${origin}/start`, { maxRedirects: 0 }), err => err.response?.status === 302);
});

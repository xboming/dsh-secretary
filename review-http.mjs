/**
 * HTTP 接口端到端测试：直接调用注册的 handler，验证 #3/#4/#14。
 *   node review-http.mjs
 */
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { createStore } from './lib/store.js';
import { createSecretary } from './lib/secretary.js';
import { registerRoutes } from './lib/http.js';

const root = await mkdtemp(path.join(os.tmpdir(), `review-http-${process.pid}-`));
const store = createStore(root);
const secretary = createSecretary(store);

let handler = null;
const fakeCtx = {
  webServer: {
    register(route) {
      handler = route.handler;
      return () => undefined;
    },
  },
};
registerRoutes(fakeCtx, secretary);

function makeReq({ method = 'GET', url = '/', headers = {}, body, remote = '127.0.0.1' }) {
  const chunks = [];
  if (body !== undefined) chunks.push(Buffer.from(typeof body === 'string' ? body : JSON.stringify(body), 'utf8'));
  const stream = {
    async *[Symbol.asyncIterator]() {
      for (const chunk of chunks) yield chunk;
    },
  };
  return {
    method,
    url,
    headers: Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v])),
    socket: { remoteAddress: remote },
    [Symbol.asyncIterator]: stream[Symbol.asyncIterator].bind(stream),
  };
}

function makeRes() {
  const out = { status: 0, body: null, headers: null };
  return {
    out,
    headersSent: false,
    writeHead(status, headers) {
      out.status = status;
      out.headers = headers;
      this.headersSent = true;
    },
    end(body) {
      out.body = body ? JSON.parse(body) : null;
    },
  };
}

async function call(opts) {
  const res = makeRes();
  await handler(makeReq(opts), res);
  return res.out;
}

const passed = [];
const failed = [];
async function test(name, fn) {
  try {
    await fn();
    passed.push(name);
    console.log(`  ok  ${name}`);
  } catch (error) {
    failed.push({ name, error });
    console.log(`  FAIL ${name}\n       ${error?.message ?? error}`);
  }
}

const JSON_HEADERS = { 'content-type': 'application/json' };

/* #3 改期：HTTP 层必须透传 deadline */
await test('#3 POST /update 真的改变 deadline', async () => {
  const created = await secretary.addRecord({
    domain: 'work',
    text: 'HTTP 改期测试',
    title: 'HTTP 改期',
    fields: { deadline: '2030-11-15' },
  });
  const res = await call({
    method: 'POST',
    url: '/dsh-secretary/api/update',
    headers: JSON_HEADERS,
    body: { id: created.id, deadline: '2030-12-20', note: '改期' },
  });
  assert.equal(res.status, 200);
  const after = await secretary.find(created.id);
  assert.equal(after.entry.deadline, '2030-12-20', 'deadline 必须被真正写入');
});

/* #4 link 路由存在 */
await test('#4 POST /link 可用（不再 404）', async () => {
  const idea = await secretary.addRecord({ domain: 'idea', text: 'HTTP 转化测试灵感' });
  const res = await call({
    method: 'POST',
    url: '/dsh-secretary/api/link',
    headers: JSON_HEADERS,
    body: { id: idea.id, action: 'promote', title: 'HTTP 转化项目', deadline: '2026-12-31' },
  });
  assert.equal(res.status, 200, `期望 200，实际 ${res.status} ${JSON.stringify(res.body)}`);
  assert.match(res.body.result.id, /^C-\d{4}-\d{3}$/);
  // 无期限时必须返回 need_deadline，而不是静默建一个没有期限的项目
  const idea2 = await secretary.addRecord({ domain: 'idea', text: 'HTTP 无期限转化灵感' });
  const res2 = await call({
    method: 'POST',
    url: '/dsh-secretary/api/link',
    headers: JSON_HEADERS,
    body: { id: idea2.id, action: 'promote', title: '无期限项目' },
  });
  assert.equal(res2.status, 200);
  assert.equal(res2.body.result.action, 'need_deadline', '无期限转化必须被拦下');
});

/* #14 写接口防护 */
await test('#14 text/plain 写请求被拒（415）', async () => {
  const res = await call({
    method: 'POST',
    url: '/dsh-secretary/api/update',
    headers: { 'content-type': 'text/plain' },
    body: '{"id":"X"}',
  });
  assert.equal(res.status, 415, `期望 415，实际 ${res.status}`);
  assert.equal(res.body.error.code, 'UNSUPPORTED_MEDIA_TYPE');
});

await test('#14 外部 Origin 写请求被拒（403）', async () => {
  const res = await call({
    method: 'POST',
    url: '/dsh-secretary/api/update',
    headers: { ...JSON_HEADERS, origin: 'https://evil.example.com' },
    body: { id: 'X' },
  });
  assert.equal(res.status, 403, `期望 403，实际 ${res.status}`);
  assert.equal(res.body.error.code, 'BAD_ORIGIN');
});

await test('#14 跨站 Sec-Fetch-Site 被拒（403）', async () => {
  const res = await call({
    method: 'POST',
    url: '/dsh-secretary/api/update',
    headers: { ...JSON_HEADERS, 'sec-fetch-site': 'cross-site' },
    body: { id: 'X' },
  });
  assert.equal(res.status, 403);
  assert.equal(res.body.error.code, 'BAD_FETCH_SITE');
});

await test('#14 本机同源 JSON 写请求仍放行', async () => {
  const created = await secretary.addRecord({
    domain: 'work',
    text: '正常请求测试',
    title: '正常请求',
    fields: { deadline: '2030-12-31' },
  });
  const res = await call({
    method: 'POST',
    url: '/dsh-secretary/api/update',
    headers: { ...JSON_HEADERS, origin: 'http://127.0.0.1:1234', 'sec-fetch-site': 'same-origin' },
    body: { id: created.id, status: 'doing' },
  });
  assert.equal(res.status, 200, `期望 200，实际 ${res.status} ${JSON.stringify(res.body)}`);
});

/* GET 不受写防护影响 */
await test('#14 GET /snapshot 不受写防护影响', async () => {
  const res = await call({ method: 'GET', url: '/dsh-secretary/api/snapshot' });
  assert.equal(res.status, 200);
  assert.ok(Array.isArray(res.body.domains));
});

/* 非回环仍拒绝 */
await test('非回环请求一律 403', async () => {
  const res = await call({ method: 'GET', url: '/dsh-secretary/api/snapshot', remote: '192.168.1.9' });
  assert.equal(res.status, 403);
});

await rm(root, { recursive: true, force: true });
console.log(`\n通过 ${passed.length}　失败 ${failed.length}`);
if (failed.length) {
  for (const item of failed) console.error(`\n${item.name}\n${item.error?.stack ?? item.error}`);
  process.exit(1);
}

/**
 * 新增 UI 能力对应的后端接口测试：/search、doneLimit 分页。
 *   node review-ui-api.mjs
 */
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { createStore } from './lib/store.js';
import { createSecretary } from './lib/secretary.js';
import { registerRoutes } from './lib/http.js';

const root = await mkdtemp(path.join(os.tmpdir(), `ui-api-${process.pid}-`));
const store = createStore(root);
const secretary = createSecretary(store);

let handler = null;
registerRoutes({ webServer: { register: (r) => { handler = r.handler; return () => undefined; } } }, secretary);

function makeReq({ method = 'GET', url = '/', headers = {}, body }) {
  const chunks = body === undefined ? [] : [Buffer.from(JSON.stringify(body), 'utf8')];
  const stream = { async *[Symbol.asyncIterator]() { for (const c of chunks) yield c; } };
  return {
    method,
    url,
    headers: Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v])),
    socket: { remoteAddress: '127.0.0.1' },
    [Symbol.asyncIterator]: stream[Symbol.asyncIterator].bind(stream),
  };
}
function makeRes() {
  const out = { status: 0, body: null };
  return { out, headersSent: false, writeHead(s) { out.status = s; this.headersSent = true; }, end(b) { out.body = b ? JSON.parse(b) : null; } };
}
async function get(url) {
  const res = makeRes();
  await handler(makeReq({ method: 'GET', url }), res);
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

// 预置：1 条在办 + 12 条已完成（超过默认 8 条）
await test('准备数据', async () => {
  await secretary.addRecord({ domain: 'work', text: '独一无二的关键词在办事项', title: '在办事项', fields: { deadline: '2026-12-31' } });
  for (let i = 1; i <= 12; i += 1) {
    const r = await secretary.addRecord({ domain: 'work', text: `历史完成 ${i}`, title: `完成记录${i}`, fields: { deadline: '2026-12-31' } });
    await secretary.updateRecord({ id: r.id, status: 'done' });
  }
});

await test('快照默认每域最多 8 条已完成，但 doneCount 是真实总数', async () => {
  const res = await get('/dsh-secretary/api/snapshot');
  assert.equal(res.status, 200);
  const work = res.body.domains.find((d) => d.id === 'work');
  assert.equal(work.recentDone.length, 8, `默认应返回 8 条，实际 ${work.recentDone.length}`);
  assert.equal(work.doneCount, 12, `doneCount 应为 12，实际 ${work.doneCount}`);
  assert.equal(work.doneReturned, 8, 'doneReturned 应为 8');
});

await test('doneLimit=all 返回全部已完成记录（不再被截断）', async () => {
  const res = await get('/dsh-secretary/api/snapshot?doneLimit=all');
  const work = res.body.domains.find((d) => d.id === 'work');
  assert.equal(work.recentDone.length, 12, `应为 12 条，实际 ${work.recentDone.length}`);
});

await test('/search 按标题命中', async () => {
  const res = await get('/dsh-secretary/api/search?q=' + encodeURIComponent('独一无二'));
  assert.equal(res.status, 200);
  assert.equal(res.body.count, 1, `应命中 1 条，实际 ${res.body.count}`);
  assert.ok(res.body.items[0].title.includes('在办事项'));
});

await test('/search 能搜时间轴原话', async () => {
  const res = await get('/dsh-secretary/api/search?q=' + encodeURIComponent('历史完成'));
  assert.ok(res.body.count >= 1, '应能搜到时间轴里的原话');
});

await test('/search 无命中返回空数组而非报错', async () => {
  const res = await get('/dsh-secretary/api/search?q=' + encodeURIComponent('绝对不存在的词xyz'));
  assert.equal(res.status, 200);
  assert.equal(res.body.count, 0);
  assert.deepEqual(res.body.items, []);
});

await test('/search 支持按域过滤', async () => {
  const res = await get('/dsh-secretary/api/search?q=' + encodeURIComponent('历史完成') + '&domain=creation');
  assert.equal(res.body.count, 0, '创作域没有这些记录，应为 0');
});

await test('/search 关键词含特殊字符不崩', async () => {
  const res = await get('/dsh-secretary/api/search?q=' + encodeURIComponent('100% & <tag> "quote"'));
  assert.equal(res.status, 200, `应正常返回，实际 ${res.status}`);
});

await rm(root, { recursive: true, force: true });
console.log(`\n通过 ${passed.length}　失败 ${failed.length}`);
if (failed.length) {
  for (const item of failed) console.error(`\n${item.name}\n${item.error?.stack ?? item.error}`);
  process.exit(1);
}

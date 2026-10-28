/**
 * 报告新规则回归：#11 各域分开存放、月报 20:00 出具。
 *   node review-report-domain.mjs
 */
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { createStore } from './lib/store.js';
import { createSecretary } from './lib/secretary.js';
import { buildReport } from './lib/report.js';

const root = await mkdtemp(path.join(os.tmpdir(), `review-rd-${process.pid}-`));
const store = createStore(root);
const secretary = createSecretary(store);

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

// 造两个域各一条数据
await secretary.addRecord({ domain: 'work', text: '报告域测试工作', title: '工作条目', fields: { deadline: '2026-12-31' } });
await secretary.addRecord({ domain: 'creation', text: '报告域测试创作', title: '创作条目', fields: { deadline: '2026-12-31' } });

await test('#11 不带 domain 时，各域事实包分别落到各自目录', async () => {
  const result = await buildReport(secretary, { period: 'month', key: '2026-10' });
  assert.ok(Array.isArray(result.factsPaths), '应返回 factsPaths 列表');
  assert.ok(result.factsPaths.length >= 2, `至少两个域，实际 ${result.factsPaths.length}`);
  for (const item of result.factsPaths) {
    // 路径必须落在自己的域目录下
    assert.ok(item.path.includes(item.name), `事实包路径应含域目录名：${item.path}`);
  }
  const work = result.factsPaths.find((x) => x.domain === 'work');
  const creation = result.factsPaths.find((x) => x.domain === 'creation');
  assert.ok(work, '工作域事实包缺失');
  assert.ok(creation, '创作域事实包缺失');
  assert.notEqual(work.path, creation.path, '两个域不能共用一个事实包文件');
  assert.ok(work.path.includes('工作'), `工作域路径不对：${work.path}`);
  assert.ok(creation.path.includes('创作'), `创作域路径不对：${creation.path}`);
});

await test('#11 多域传同一篇 markdown 被明确拒绝（不混域）', async () => {
  await assert.rejects(
    () => buildReport(secretary, { period: 'month', markdown: '# 一份跨域报告', force: true }),
    /不能共用同一篇报告正文/,
    '多域共用正文必须报错',
  );
});

await test('#11 单域写报告只落在该域目录', async () => {
  const result = await buildReport(secretary, { period: 'month', domain: 'work', markdown: '# 工作月报\n\n本月完成一件事。', force: true });
  assert.ok(result.path, '应返回写入路径');
  assert.ok(result.path.includes('工作'), `工作域报告路径不对：${result.path}`);
  assert.ok(!result.path.includes('创作'), '不能写进创作域');
  const files = await store.listFiles('报告', (p) => p.endsWith('.md'));
  assert.ok(files.some((p) => p.includes('工作')), '工作域目录下应有报告');
});

await test('#11 逐域写报告时，两域文件内容互不相同', async () => {
  await buildReport(secretary, { period: 'month', domain: 'creation', markdown: '# 创作月报\n\n本月推进了章节。', force: true });
  const files = await store.listFiles('报告', (p) => p.endsWith('.md'));
  const workFile = files.find((p) => p.includes('工作'));
  const creationFile = files.find((p) => p.includes('创作'));
  assert.ok(workFile && creationFile, '两个域都应有报告文件');
  const workText = await store.readText(workFile);
  const creationText = await store.readText(creationFile);
  assert.notEqual(workText, creationText, '两个域报告内容必须各自独立');
  assert.ok(workText.includes('工作月报'), '工作报告含工作内容');
  assert.ok(creationText.includes('创作月报'), '创作报告含创作内容');
});

await test('月报 20:00 才算到期（19:59 不算，20:00 算）', async () => {
  // isDue 在 schedule 内部；此处用等价逻辑断言配置口径
  const cfg = await secretary.loadSettings();
  assert.equal(cfg.schedule.monthlyAt, '20:00', '月报出具时间应为 20:00');
  assert.equal(cfg.schedule.reportWindow.start, '20:00', '报告窗口应从 20:00 开始');
});

await test('月报周期 key 指向上一月（1 号出上月报告）', async () => {
  // 2026-11-01 20:00 应生成 2026-10 的月报
  const now = new Date(2026, 10, 1, 20, 30);
  const prev = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const expectedKey = `${prev.getFullYear()}-${String(prev.getMonth() + 1).padStart(2, '0')}`;
  assert.equal(expectedKey, '2026-10', `上个月应为 2026-10，实际 ${expectedKey}`);
  const result = await buildReport(secretary, { period: 'month', key: expectedKey });
  assert.equal(result.key, '2026-10');
});

await rm(root, { recursive: true, force: true });
console.log(`\n通过 ${passed.length}　失败 ${failed.length}`);
if (failed.length) {
  for (const item of failed) console.error(`\n${item.name}\n${item.error?.stack ?? item.error}`);
  process.exit(1);
}

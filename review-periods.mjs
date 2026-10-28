/**
 * 四类报告周期回归：月度 / 季度 / 半年度 / 年度。
 *   node review-periods.mjs
 */
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { createStore, FILES } from './lib/store.js';
import { createSecretary } from './lib/secretary.js';
import { buildReport, buildFacts, periodWindow, windowFor, keyFor } from './lib/report.js';

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

let root = null;
async function fresh() {
  if (root) await rm(root, { recursive: true, force: true, maxRetries: 3 }).catch(() => undefined);
  root = await mkdtemp(path.join(os.tmpdir(), `periods-${process.pid}-`));
  const store = createStore(root);
  return { store, secretary: createSecretary(store) };
}

/* ---------- 周期窗口边界 ---------- */

await test('四类周期窗口覆盖正确区间', async () => {
  const d = new Date(2026, 9, 31); // 2026-10-31
  const cases = [
    // [period, key, fromMonth, fromDay, toMonth, toDay]
    ['month', '2026-10', 10, 1, 10, 31],
    ['quarter', '2026-Q4', 10, 1, 12, 31],
    ['half', '2026-H2', 7, 1, 12, 31],
    ['year', '2026', 1, 1, 12, 31],
  ];
  for (const [p, key, fromM, fromD, toM, toD] of cases) {
    const w = periodWindow(p, d);
    assert.equal(w.key, key, `${p} key`);
    assert.equal(w.from.getMonth() + 1, fromM, `${p} from 月`);
    assert.equal(w.from.getDate(), fromD, `${p} from 日`);
    assert.equal(w.to.getMonth() + 1, toM, `${p} to 月`);
    assert.equal(w.to.getDate(), toD, `${p} to 日`);
  }
});

await test('周期边界月份归属正确', async () => {
  // 季度边界
  assert.equal(keyFor('quarter', new Date(2026, 2, 31)), '2026-Q1');
  assert.equal(keyFor('quarter', new Date(2026, 3, 1)), '2026-Q2');
  assert.equal(keyFor('quarter', new Date(2026, 8, 30)), '2026-Q3');
  assert.equal(keyFor('quarter', new Date(2026, 9, 1)), '2026-Q4');
  // 半年度边界
  assert.equal(keyFor('half', new Date(2026, 5, 30)), '2026-H1');
  assert.equal(keyFor('half', new Date(2026, 6, 1)), '2026-H2');
  // 年度边界
  assert.equal(keyFor('year', new Date(2026, 0, 1)), '2026');
  assert.equal(keyFor('year', new Date(2026, 11, 31)), '2026');
});

await test('上一期计算正确（跨年也正确）', async () => {
  assert.equal(periodWindow('month', new Date(2026, 0, 15), 1).key, '2025-12');
  assert.equal(periodWindow('quarter', new Date(2026, 0, 15), 1).key, '2025-Q4');
  assert.equal(periodWindow('half', new Date(2026, 1, 15), 1).key, '2025-H2');
  assert.equal(periodWindow('year', new Date(2026, 5, 15), 1).key, '2025');
  // 月份减法的短月问题仍然正确
  assert.equal(periodWindow('month', new Date(2026, 2, 31), 1).key, '2026-02');
});

await test('key 解析：合法通过、非法返回 null', async () => {
  assert.equal(windowFor('month', '2026-10').key, '2026-10');
  assert.equal(windowFor('quarter', '2026-Q4').key, '2026-Q4');
  assert.equal(windowFor('half', '2026-H2').key, '2026-H2');
  assert.equal(windowFor('year', '2026').key, '2026');
  for (const [p, k] of [
    ['month', '2026-13'],
    ['month', '2026-1'],
    ['quarter', '2026-Q5'],
    ['quarter', '2026-Q0'],
    ['half', '2026-H3'],
    ['year', '26'],
    ['year', '2026-01'],
    ['month', ''],
  ]) {
    assert.equal(windowFor(p, k), null, `${p} / ${k} 应被判为非法`);
  }
});

await test('buildReport 拒绝非法 period 与非法 key', async () => {
  const { secretary: sec } = await fresh();
  await assert.rejects(() => buildReport(sec, { period: 'week2' }), /period 只能是/, '非法 period 必须报错');
  await assert.rejects(() => buildReport(sec, { period: 'quarter', key: '2026-Q9' }), /key 格式不对/, '非法 key 必须报错');
  await assert.rejects(() => buildReport(sec, { period: 'half', key: '2026-10' }), /key 格式不对/);
});

/* ---------- 生成与存放 ---------- */

await test('四类报告都能生成，且各自落在对应目录', async () => {
  const { store: s, secretary: sec } = await fresh();
  await sec.addRecord({ domain: 'work', text: '周期报告测试', title: '周期测试', fields: { deadline: '2026-12-31' } });
  const dirs = { month: '月报', quarter: '季报', half: '半年报', year: '年报' };
  const keys = { month: '2026-10', quarter: '2026-Q4', half: '2026-H2', year: '2026' };
  for (const p of ['month', 'quarter', 'half', 'year']) {
    const r = await buildReport(sec, { period: p, key: keys[p], domain: 'work' });
    assert.equal(r.key, keys[p], `${p} key 应回显`);
    assert.ok(r.facts.domains.work[p], `${p} 事实应存在`);
    const files = await s.listFiles(`报告/工作/${dirs[p]}`, (x) => x.endsWith('.facts.json'));
    assert.ok(files.length >= 1, `${p} 事实包应落在 报告/工作/${dirs[p]}/`);
  }
});

await test('写作：四类报告的正文文件命名互不冲突', async () => {
  const { store: s, secretary: sec } = await fresh();
  await sec.addRecord({ domain: 'work', text: '写作测试', title: '写作测试', fields: { deadline: '2026-12-31' } });
  await buildReport(sec, { period: 'month', key: '2026-10', domain: 'work', markdown: '# 十月', force: true });
  await buildReport(sec, { period: 'quarter', key: '2026-Q4', domain: 'work', markdown: '# 四季度', force: true });
  await buildReport(sec, { period: 'half', key: '2026-H2', domain: 'work', markdown: '# 下半年', force: true });
  await buildReport(sec, { period: 'year', key: '2026', domain: 'work', markdown: '# 年度', force: true });
  const all = await s.listFiles('报告/工作', (x) => x.endsWith('.md'));
  assert.equal(all.length, 4, `应有 4 份报告，实际 ${all.length}`);
  const texts = await Promise.all(all.map((f) => s.readText(f)));
  for (const [i, label] of ['# 十月', '# 四季度', '# 下半年', '# 年度'].entries()) {
    assert.ok(texts.some((t) => t.includes(label)), `缺少「${label}」`);
    void i;
  }
});

await test('上期承诺按各自的上一期取（季报取上季、年报取上一年）', async () => {
  const { store: s, secretary: sec } = await fresh();
  await sec.addRecord({ domain: 'work', text: '承诺测试', title: '承诺测试', fields: { deadline: '2026-12-31' } });
  // 写入 2026-Q3 的季报，带"下季度一件最重要的事"
  await s.write('报告/工作/季报/work-2026-Q3-工作季报.md', '# 工作季报 2026Q3\n\n## 下季度一件最重要的事\n\n三季度承诺内容\n');
  const q = await buildReport(sec, { period: 'quarter', key: '2026-Q4', domain: 'work' });
  const qData = q.facts.domains.work.quarter;
  assert.equal(qData.previous.period, '2026-Q3', '季报上期应为 Q3');
  assert.equal(qData.commitments?.period, '2026-Q3', `季报承诺应来自 Q3，实际 ${qData.commitments?.period}`);
  assert.ok(String(qData.commitments?.text).includes('三季度承诺'), '承诺内容应来自 Q3 季报');

  // 年报：上一年的年报
  await s.write('报告/工作/年报/work-2025-工作年报.md', '# 工作年报 2025\n\n## 明年一件最重要的事\n\n2025 承诺\n');
  const y = await buildReport(sec, { period: 'year', key: '2026', domain: 'work' });
  const yData = y.facts.domains.work.year;
  assert.equal(yData.previous.period, '2025');
  assert.equal(yData.commitments?.period, '2025', `年报承诺应来自 2025，实际 ${yData.commitments?.period}`);
});

await test('逐域时四类报告都不混域存放', async () => {
  const { store: s, secretary: sec } = await fresh();
  await sec.addRecord({ domain: 'work', text: '工作', fields: { deadline: '2026-12-31' } });
  await sec.addRecord({ domain: 'creation', text: '创作', fields: { deadline: '2026-12-31' } });
  for (const p of ['month', 'quarter', 'half', 'year']) {
    const r = await buildReport(sec, { period: p });
    assert.ok(Array.isArray(r.factsPaths), `${p} 不带 domain 应返回 factsPaths`);
    for (const item of r.factsPaths) {
      assert.ok(item.path.includes(item.name), `${p} 事实包应落在自己的域目录：${item.path}`);
    }
    // 多域共用正文必须被拒
    await assert.rejects(
      () => buildReport(sec, { period: p, markdown: '# 混域', force: true }),
      /不能共用同一篇报告正文/,
      `${p} 多域共用正文必须报错`,
    );
  }
});

await rm(root, { recursive: true, force: true, maxRetries: 3 }).catch(() => undefined);
console.log(`\n通过 ${passed.length}　失败 ${failed.length}`);
if (failed.length) {
  for (const item of failed) console.error(`\n${item.name}\n${item.error?.stack ?? item.error}`);
  process.exit(1);
}

/**
 * 趋势与重点回顾回归。
 *   node review-trend.mjs
 */
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { createStore } from './lib/store.js';
import { createSecretary } from './lib/secretary.js';
import { buildReport } from './lib/report.js';

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
  root = await mkdtemp(path.join(os.tmpdir(), `trend-${process.pid}-`));
  const store = createStore(root);
  return { store, secretary: createSecretary(store) };
}

await test('趋势按月拆分：季度 3 段、半年 6 段、年度 12 段、月度 1 段', async () => {
  const { secretary: sec } = await fresh();
  await sec.addRecord({ domain: 'work', text: '数据', fields: { deadline: '2026-12-31' } });
  const cases = [
    ['month', '2026-10', 1],
    ['quarter', '2026-Q4', 3],
    ['half', '2026-H2', 6],
    ['year', '2026', 12],
  ];
  for (const [p, key, expected] of cases) {
    const r = await buildReport(sec, { period: p, key, domain: 'work' });
    const trend = r.facts.domains.work[p].trend;
    assert.equal(trend.points.length, expected, `${p} 应有 ${expected} 段趋势，实际 ${trend.points.length}`);
    assert.equal(trend.unit, 'month', '趋势单位应为月');
    for (const point of trend.points) {
      assert.ok(typeof point.created === 'number' && typeof point.completed === 'number' && typeof point.activeDays === 'number');
      assert.ok(point.label && point.key, '每段应有 label 与 key');
    }
  }
});

await test('趋势能识别高峰月与整月无动静', async () => {
  const { secretary: sec } = await fresh();
  // 本月建 3 条并完成 2 条
  const ids = [];
  for (let i = 1; i <= 3; i += 1) {
    const r = await sec.addRecord({ domain: 'work', text: `本月事项${i}`, fields: { deadline: '2026-12-31' } });
    ids.push(r.id);
  }
  await sec.updateRecord({ id: ids[0], status: 'done' });
  await sec.updateRecord({ id: ids[1], status: 'done' });
  const r = await buildReport(sec, { period: 'year', key: '2026', domain: 'work' });
  const trend = r.facts.domains.work.year.trend;
  assert.ok(trend.peakMonth, '应识别出高峰月');
  assert.ok(trend.peakMonth.completed >= 2, `高峰月完成数应 >= 2，实际 ${trend.peakMonth.completed}`);
  assert.ok(trend.quietMonths.length >= 1, '应有整月无动静的月份');
  // 总账应与分段之和一致
  const sumCreated = trend.points.reduce((a, p) => a + p.created, 0);
  assert.equal(trend.total.created, sumCreated, '总新增应等于各月之和');
});

await test('重点回顾：列出完成的、仍逾期的、长期停滞的', async () => {
  const { secretary: sec } = await fresh();
  const done = await sec.addRecord({ domain: 'work', text: '这件完成了', fields: { deadline: '2026-12-31' } });
  await sec.updateRecord({ id: done.id, status: 'done' });
  // 逾期：截止日设到过去
  const over = await sec.addRecord({ domain: 'work', text: '这件逾期了', fields: { deadline: '2020-01-01' } });
  void over;
  const r = await buildReport(sec, { period: 'month', domain: 'work' });
  const hl = r.facts.domains.work.month.highlights;
  assert.ok(hl.completedCount >= 1, '应列出完成事项');
  assert.ok(hl.completed.some((x) => x.title.includes('完成了')), '完成列表应含对应标题');
  // 逾期判定基于当前日期：2020 年的截止日必然逾期
  assert.ok(hl.overdueCount >= 1, `应识别逾期，实际 ${hl.overdueCount}`);
  assert.ok(hl.overdue.some((x) => x.title.includes('逾期了')), '逾期列表应含对应标题');
  assert.ok(Array.isArray(hl.stalled), 'stalled 应是数组');
  assert.ok(Array.isArray(hl.converted), 'converted 应是数组');
});

await test('重点回顾里的事项都带 id 与标题，可直接引用', async () => {
  const { secretary: sec } = await fresh();
  const r1 = await sec.addRecord({ domain: 'work', text: '引用测试', fields: { deadline: '2026-12-31' } });
  await sec.updateRecord({ id: r1.id, status: 'done' });
  const r = await buildReport(sec, { period: 'month', domain: 'work' });
  const hl = r.facts.domains.work.month.highlights;
  for (const item of hl.completed) {
    assert.match(item.id, /^W-\d{4}-\d{3}$/, `完成项应有合法 id：${JSON.stringify(item)}`);
    assert.ok(item.title, '完成项应有标题');
    assert.match(item.at, /^\d{4}-\d{2}-\d{2}$/, '完成项应有完成日期');
  }
});

await test('输出里趋势与重点回顾都已呈现，且无重复行', async () => {
  const { secretary: sec } = await fresh();
  const r1 = await sec.addRecord({ domain: 'work', text: '输出测试', fields: { deadline: '2026-12-31' } });
  await sec.updateRecord({ id: r1.id, status: 'done' });
  const r = await buildReport(sec, { period: 'quarter', key: '2026-Q4', domain: 'work' });
  const text = r.lines.join('\n');
  assert.ok(text.includes('趋势：'), '输出应含趋势行');
  assert.ok(text.includes('本期完成'), '输出应含重点回顾的完成项');
  // 旧式重复行不应再出现
  assert.ok(!/^\s*完成：/m.test(text), '不应再有独立的"完成："行（已并入重点回顾）');
  assert.ok(!/^\s*逾期：/m.test(text), '不应再有独立的"逾期："行');
});

await test('事实包 JSON 里包含 trend 与 highlights，可无损序列化', async () => {
  const { store: s, secretary: sec } = await fresh();
  await sec.addRecord({ domain: 'work', text: 'JSON 测试', fields: { deadline: '2026-12-31' } });
  const r = await buildReport(sec, { period: 'month', key: '2026-10', domain: 'work' });
  const path0 = r.factsPaths?.[0]?.path ?? `报告/工作/月报/work-2026-10.facts.json`;
  const raw = await s.readText(path0);
  const parsed = JSON.parse(raw);
  assert.ok(parsed.trend, '事实包应含 trend');
  assert.ok(parsed.highlights, '事实包应含 highlights');
  const roundTrip = JSON.parse(JSON.stringify(parsed));
  assert.deepEqual(roundTrip, parsed, '事实包应可无损往返');
  // 不允许 undefined 泄漏（JSON.stringify 会丢键，这里检查关键字段存在）
  for (const field of ['trend', 'highlights', 'previous', 'deltas', 'commitments']) {
    assert.ok(field in parsed, `事实包应含 ${field}`);
  }
});

await rm(root, { recursive: true, force: true, maxRetries: 3 }).catch(() => undefined);
console.log(`\n通过 ${passed.length}　失败 ${failed.length}`);
if (failed.length) {
  for (const item of failed) console.error(`\n${item.name}\n${item.error?.stack ?? item.error}`);
  process.exit(1);
}

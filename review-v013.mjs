/**
 * v0.13.0 审查报告 B01–B07 / T03–T07 回归。
 *
 *   node review-v013.mjs
 *
 * 全部使用临时目录里的真实 Store + 真实业务模块，不碰任何生产记录。
 * 每个用例断言的是**业务结果**（数字、标题、持久状态），不是"字段存在"。
 */

import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile, mkdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { createStore } from './lib/store.js';
import { createSecretary } from './lib/secretary.js';
import { buildReport, buildFacts } from './lib/report.js';
import { lastActivityAt, stallDaysOf } from './lib/judge.js';
import { parseStreamFile } from './lib/stream.js';
import { renderers } from './lib/tools.js';

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
  root = await mkdtemp(path.join(os.tmpdir(), `v013-${process.pid}-`));
  const store = createStore(root);
  return { store, secretary: createSecretary(store) };
}

/** 直接写一份条目文件，模拟"历史记录早已存在"（含任意顺序的时间轴） */
async function seedEntry(store, domain, id, fields, body) {
  const dir = domain === 'work' ? '工作' : '创作';
  const created = String(fields.created ?? '2026-09-01');
  const month = created.slice(0, 7);
  const relative =
    domain === 'work'
      ? `${dir}/${month.slice(0, 4)}/${month.slice(5, 7)}/${id}-${fields.title}.md`
      : `${dir}/${month.slice(0, 4)}/${month.slice(5, 7)}/${id}-${fields.title}/项目.md`;
  await mkdir(path.dirname(path.join(store.root, relative)), { recursive: true });
  const front = Object.entries(fields)
    .map(([key, value]) => `${key}: ${JSON.stringify(value)}`)
    .join('\n');
  await writeFile(path.join(store.root, relative), `---\n${front}\n---\n${body}`, 'utf8');
  return relative;
}

/* =============================== B01 =============================== */

await test('B01 停滞天数取最新活动：倒序 / 正序 / 乱序时间轴结果一致', async () => {
  const now = new Date('2026-10-28T21:00:00+08:00');
  const mk = (items) => ({ timeline: items, updated: '2026-10-01', created: '2026-10-01' });
  const older = { at: '2026-10-01 09:00', text: '创建' };
  const newer = { at: '2026-10-28 09:00', text: '进展' };
  const cases = {
    倒序: mk([newer, older]),
    正序: mk([older, newer]),
    乱序: mk([older, { at: '2026-10-10 12:00', text: '中间' }, newer]),
  };
  for (const [label, entry] of Object.entries(cases)) {
    const days = stallDaysOf(entry, now);
    assert.equal(days, 0, `${label}时间轴：今天刚更新的事项停滞天数必须是 0，实际 ${days}`);
  }
  // 旧实现报告侧取 items[len-1]，在倒序时间轴上会把今天更新算成 27 天
  const reversed = cases['倒序'];
  assert.notEqual(
    Math.floor((now - new Date('2026-10-01T09:00:00+08:00')) / 86400000),
    stallDaysOf(reversed, now),
    '倒序时间轴不得再取末条（旧缺陷的复现条件）',
  );
  assert.equal(lastActivityAt(reversed), new Date('2026-10-28T09:00:00+08:00').getTime(), '最新活动应取最大值');
});

await test('B01 报告里的停滞阈值跟随域声明，与快照口径一致', async () => {
  const { secretary: sec } = await fresh();
  await sec.addRecord({ domain: 'creation', text: '创作项目长标题测试', fields: { deadline: '2026-12-31' } });
  // 创作域 stallDays = 10：刚建的条目停滞 0 天，不应进报告停滞列表
  const r = await buildReport(sec, { period: 'month', key: '2026-10', domain: 'creation' });
  const hl = r.facts.domains.creation.month.highlights;
  assert.equal(hl.stalled.length, 0, `刚建的项目不该出现在停滞列表，实际 ${JSON.stringify(hl.stalled)}`);
  assert.equal(hl.periodScope.stallThresholdDays, 10, '报告必须复用创作域声明的 10 天阈值');
});

/* =============================== B02 =============================== */

await test('B02 9 月报告不纳入 10 月才创建的事项', async () => {
  const { store, secretary: sec } = await fresh();
  // 9 月存在的条目：9 月 20 日创建、9 月 25 日截止，至今没完成 → 9 月时确实逾期
  await seedEntry(
    store,
    'work',
    'W-2026-001',
    { id: 'W-2026-001', title: '九月的旧事项', created: '2026-09-20', updated: '2026-09-20', status: 'todo', deadline: '2026-09-25' },
    '\n# 九月的旧事项\n\n## 时间轴\n\n- [2026-09-20 10:00] 创建\n',
  );
  // 10 月才创建、10 月 15 日截止的条目 → 绝不能出现在 9 月报告里
  await seedEntry(
    store,
    'work',
    'W-2026-002',
    { id: 'W-2026-002', title: '十月才出现的事项', created: '2026-10-10', updated: '2026-10-10', status: 'todo', deadline: '2026-10-15' },
    '\n# 十月才出现的事项\n\n## 时间轴\n\n- [2026-10-10 10:00] 创建\n',
  );
  const r = await buildReport(sec, { period: 'month', key: '2026-09', domain: 'work' });
  const data = r.facts.domains.work.month;
  // 本期新增只算 9 月创建的那条；10 月那条不能算进来（旧缺陷会把两条都算成 0，
  // 因为它拿当前全量在办事项反推历史）
  assert.equal(data.created, 1, `9 月新增应只有 9 月创建的那条，实际 ${data.created}`);
  // 本期口径（不含 asOfNow 附录）
  const periodScope = JSON.stringify({
    completed: data.highlights.completed,
    overdue: data.highlights.overdue,
    stalled: data.highlights.stalled,
    converted: data.highlights.converted,
  });
  assert.ok(!periodScope.includes('十月才出现的事项'), `9 月报告不得引用 10 月才创建的事项：${periodScope}`);
  assert.ok(periodScope.includes('九月的旧事项'), '9 月报告应包含当时已存在且逾期的事项');
  // 当前风险附录里可以出现，但必须独立命名并带快照时间
  assert.ok(data.highlights.asOfNow, '应提供独立的当前风险附录');
  assert.ok(data.highlights.asOfNow.snapshotAt, '附录必须标注快照时间');
  assert.ok(
    data.highlights.asOfNow.overdue.some((x) => x.title === '十月才出现的事项'),
    '当前风险附录里出现 10 月事项是正确的——它标了快照时间，不是本期事实',
  );
  assert.ok(data.highlights.asOfNow.note.includes('不计入本期'), '附录必须写清它不计入本期统计');
});

await test('B02 月/季/半年/年四类报告都执行同一时间范围规则', async () => {
  const { store, secretary: sec } = await fresh();
  await seedEntry(
    store,
    'work',
    'W-2026-001',
    { id: 'W-2026-001', title: '三季度内的事项', created: '2026-09-10', updated: '2026-09-10', status: 'todo', deadline: '2026-09-15' },
    '\n# 三季度内的事项\n\n## 时间轴\n\n- [2026-09-10 10:00] 创建\n',
  );
  await seedEntry(
    store,
    'work',
    'W-2026-002',
    { id: 'W-2026-002', title: '四季度才建的事项', created: '2026-10-12', updated: '2026-10-12', status: 'todo', deadline: '2026-10-20' },
    '\n# 四季度才建的事项\n\n## 时间轴\n\n- [2026-10-12 10:00] 创建\n',
  );
  for (const [period, key] of [
    ['quarter', '2026-Q3'],
    ['half', '2026-H1'],
    ['year', '2025'],
  ]) {
    const r = await buildReport(sec, { period, key, domain: 'work' });
    const data = r.facts.domains.work[period];
    const periodScope = JSON.stringify({
      completed: data.highlights.completed,
      overdue: data.highlights.overdue,
      stalled: data.highlights.stalled,
      converted: data.highlights.converted,
    });
    assert.ok(!periodScope.includes('四季度才建的事项'), `${period} ${key} 报告不得混入之后创建的事项：${periodScope}`);
    // asOfNow 附录是独立口径，允许出现且必须带快照时间
    assert.ok(data.highlights.asOfNow.snapshotAt, `${period} 的当前风险附录必须带快照时间`);
  }
});

await test('B02 历史周期的在办/逾期数标为不可还原，而不是拿当前值充数', async () => {
  const { secretary: sec } = await fresh();
  await sec.addRecord({ domain: 'work', text: '现状未完成的事项', fields: { deadline: '2026-12-31' } });
  const r = await buildReport(sec, { period: 'month', key: '2026-08', domain: 'work' });
  const data = r.facts.domains.work.month;
  assert.equal(data.open, null, '历史周期无法还原"当时在办数"，必须是 null');
  assert.equal(data.overdue, null, '历史周期无法还原"当时逾期数"，必须是 null');
  assert.equal(data.historyAvailable, false, '必须显式标为历史不可还原');
});

/* =============================== B03 =============================== */

await test('B03 当月转化计入当月：真实转化时间可解析且被统计', async () => {
  const { store, secretary: sec } = await fresh();
  const idea = await sec.addRecord({ domain: 'idea', text: '一个可以做成项目的灵感' });
  const result = await sec.addRecord({
    domain: 'creation',
    text: '把灵感做成项目',
    fields: { deadline: '2026-12-31' },
  });
  const { linkEntries } = await import('./lib/link.js');
  const promoted = await linkEntries(sec, { id: idea.id, action: 'promote', deadline: '2026-12-31' });
  assert.equal(promoted.action, 'promoted', `转化应成功：${JSON.stringify(promoted)}`);
  void result;

  // 直接看落盘的灵感文件里有没有"转化时间"
  const entries = await sec.loadAll(true);
  const ideaEntry = entries.entries.find((entry) => entry.id === idea.id);
  assert.ok(ideaEntry.promotedTo, '灵感应标上转化目标');
  assert.ok(ideaEntry.promotedAt, `灵感必须同时记录转化时间，实际 ${ideaEntry.promotedAt}`);

  const nowMonth = new Date().toISOString().slice(0, 7);
  const r = await buildReport(sec, { period: 'month', domain: 'creation' });
  void r;
  const facts = await buildReport(sec, { period: 'month', domain: 'idea' });
  const hl = facts.facts.domains.idea.month.highlights;
  assert.equal(hl.convertedCount, 1, `当月转化应计入，实际 ${hl.convertedCount}`);
  assert.ok(hl.converted[0].at, '转化条目必须带转化日期');
  assert.equal(hl.convertedUnknownCount, 0, '有时间的不该被算成"时间未知"');
  void nowMonth;
  void store;
});

await test('B03 跨月转化归到实际转化月；历史无时间的标为未知不伪造', async () => {
  const { store } = await fresh();
  // 一条 8 月的灵感，有转化目标但**没有转化时间**（老数据）
  await mkdir(path.join(store.root, '灵感', '2026'), { recursive: true });
  await writeFile(
    path.join(store.root, '灵感', '2026', '2026-08.md'),
    [
      '# 2026-08 灵感',
      '',
      '### I-202608-01 八月的老灵感',
      '- 记录：2026-08-05 09:00',
      '- 转化：C-2026-001',
      '',
      '> 这个想法后来做成了项目',
      '',
    ].join('\n'),
    'utf8',
  );
  const parsed = parseStreamFile(
    await readFile(path.join(store.root, '灵感', '2026', '2026-08.md'), 'utf8'),
    '灵感/2026/2026-08.md',
    { id: 'idea', name: '灵感', shape: 'stream', dir: '灵感' },
    0,
  );
  assert.equal(parsed.length, 1, '应解析出一条灵感');
  assert.equal(parsed[0].promotedTo, 'C-2026-001', '应解析出转化目标');
  assert.equal(parsed[0].promotedAt, null, '老数据没有转化时间，必须是 null 而不是编一个');

  const sec = createSecretary(store);
  const facts = await buildReport(sec, { period: 'month', key: '2026-08', domain: 'idea' });
  const hl = facts.facts.domains.idea.month.highlights;
  assert.equal(hl.convertedCount, 0, '没有转化时间就不能计入任何月份');
  assert.equal(hl.convertedUnknownCount, 1, '必须列入"转化时间未知"');
  const line = facts.lines.find((item) => item.includes('转化时间未知'));
  assert.ok(line, `输出里要明确说明转化时间未知，实际：${facts.lines.join('\n')}`);
});

await test('B03 重复转化不重复计数', async () => {
  const { secretary: sec } = await fresh();
  const idea = await sec.addRecord({ domain: 'idea', text: '只想转一次的灵感' });
  const { linkEntries } = await import('./lib/link.js');
  const first = await linkEntries(sec, { id: idea.id, action: 'promote', deadline: '2026-12-31' });
  assert.equal(first.action, 'promoted');
  const second = await linkEntries(sec, { id: idea.id, action: 'promote', deadline: '2026-12-31' });
  assert.equal(second.action, 'already', '第二次转化应返回 already');
  const facts = await buildReport(sec, { period: 'month', domain: 'idea' });
  assert.equal(facts.facts.domains.idea.month.highlights.convertedCount, 1, '重复转化不得重复计数');
});

/* =============================== B04 =============================== */

await test('B04 10 月生成年报时，11、12 月不得列为"整月无动静"', async () => {
  const { secretary: sec } = await fresh();
  await sec.addRecord({ domain: 'work', text: '年会安排', fields: { deadline: '2026-12-31' } });
  const facts = await buildFacts(sec, { domains: [{ id: 'work', name: '工作', shape: 'task' }], key: '2026', period: 'year', now: new Date('2026-10-28T21:00:00+08:00') });
  const trend = facts.domains.work.year.trend;
  for (const label of ['11月', '12月']) {
    assert.ok(!trend.quietMonths.includes(label), `${label} 尚未开始，不得列入"整月无动静"`);
    assert.ok(trend.notStartedMonths.includes(label), `${label} 应列入"尚未开始"`);
  }
  const october = trend.points.find((point) => point.label === '10月');
  assert.equal(october.phase, 'inProgress', '10 月进行中');
  assert.ok(!trend.quietMonths.includes('10月'), '进行中的月份不能下"整月"结论');
  // 已结束且确实无记录的月份仍要识别出来
  assert.ok(trend.quietMonths.includes('1月'), `已结束且无记录的 1 月应被识别，实际 ${JSON.stringify(trend.quietMonths)}`);
  assert.ok(trend.comparisonNote.includes('未结束'), '必须说明比较口径包含未结束月份');
});

await test('B04 高峰月若含不完整月份要标明结论暂定', async () => {
  const { secretary: sec } = await fresh();
  for (let i = 1; i <= 3; i += 1) {
    const item = await sec.addRecord({ domain: 'work', text: `十月完成的第${i}件事`, fields: { deadline: '2026-12-31' } });
    await sec.updateRecord({ id: item.id, status: 'done' });
  }
  const facts = await buildFacts(sec, { domains: [{ id: 'work', name: '工作', shape: 'task' }], key: '2026', period: 'year', now: new Date('2026-10-28T21:00:00+08:00') });
  const trend = facts.domains.work.year.trend;
  assert.ok(trend.peakMonth, '应识别高峰月');
  assert.equal(trend.peakMonth.label, '10月');
  assert.equal(trend.peakMonth.partial, true, '10 月未结束，高峰结论必须标为暂定');
  const report = await buildReport(sec, { period: 'year', key: '2026', domain: 'work' });
  assert.ok(
    report.lines.join('\n').includes('该月未结束'),
    `输出必须标注"该月未结束，此结论为暂定"：\n${report.lines.join('\n')}`,
  );
});

await test('B04 已全部结束的历史年份不受影响', async () => {
  const { secretary: sec } = await fresh();
  await sec.addRecord({ domain: 'work', text: '去年的年度总结', fields: { deadline: '2026-12-31' } });
  const facts = await buildFacts(sec, { domains: [{ id: 'work', name: '工作', shape: 'task' }], key: '2025', period: 'year', now: new Date('2026-10-28T21:00:00+08:00') });
  const trend = facts.domains.work.year.trend;
  assert.equal(trend.notStartedMonths.length, 0, '历史年份没有"尚未开始"的月份');
  assert.ok(trend.quietMonths.length >= 6, `2025 年基本无记录，应识别出大量空窗月，实际 ${trend.quietMonths.length}`);
  assert.equal(trend.comparisonNote, '周期内各月均已结束，比较口径一致');
});

/* =============================== B05 =============================== */

await test('B05 并发改绑提醒与报告：两项都保留', async () => {
  const { secretary: sec } = await fresh();
  await sec.bindSession('session-AAAA', 'both');
  // 并发：提醒改 B、报告改 B
  const [a, b] = await Promise.all([
    sec.bindSession('session-BBBB', 'reminder'),
    sec.bindSession('session-CCCC', 'report'),
  ]);
  assert.ok(a.changed.includes('reminder') || b.changed.includes('reminder'), '应记录提醒改绑');
  const state = await sec.currentState();
  assert.equal(state.reminderSession, 'session-BBBB', '提醒会话必须是并发中的改绑结果');
  assert.equal(state.reportSession, 'session-CCCC', '报告会话必须是并发中的改绑结果（旧实现会丢一个）');
});

await test('B05 绑定与调度状态交叉执行时不丢字段', async () => {
  const { secretary: sec } = await fresh();
  await sec.bindSession('session-AAAA', 'both');
  // 模拟调度器同时写任务 ID 与 pendingReports
  const scheduling = (async () => {
    await sec.mutateState((draft) => {
      draft.reminderTaskId = 'schedule-task-1';
      draft.reminderTaskSignature = 'sig-1';
      draft.pendingReports = [{ period: 'month', key: '2026-10', status: 'pending' }];
      return true;
    });
  })();
  const binding = sec.bindSession('session-DDDD', 'report');
  await Promise.all([scheduling, binding]);
  const state = await sec.currentState();
  assert.equal(state.reminderTaskId, 'schedule-task-1', '任务 ID 不能被绑定覆盖');
  assert.equal(state.reminderTaskSignature, 'sig-1', '任务签名不能被绑定覆盖');
  assert.ok(Array.isArray(state.pendingReports) && state.pendingReports.length === 1, 'pendingReports 不能丢');
  assert.equal(state.reportSession, 'session-DDDD', '绑定结果必须保留');
  assert.equal(state.reminderSession, 'session-AAAA', '只改报告时提醒会话不变');
});

await test('B05 返回值与最终持久状态一致', async () => {
  const { secretary: sec } = await fresh();
  const result = await sec.bindSession('session-EEEE', 'both');
  const state = await sec.currentState();
  assert.equal(result.reminderSession, state.reminderSession, '返回的提醒会话必须与磁盘一致');
  assert.equal(result.reportSession, state.reportSession, '返回的报告会话必须与磁盘一致');
  assert.deepEqual(result.changed.sort(), ['reminder', 'report'], '首次绑定应报告两处变更');
});

await test('B05 未变化时不重复落盘', async () => {
  const { store, secretary: sec } = await fresh();
  await sec.bindSession('session-FFFF', 'both');
  const before = await store.read('系统/状态.json');
  await sec.bindSession('session-FFFF', 'both');
  const after = await store.read('系统/状态.json');
  assert.equal(after.mtimeMs, before.mtimeMs, '状态没变就不该重写文件');
});

/* =============================== U03 / B07 =============================== */

await test('U03 createSeparate 让相似记录独立创建，且不改期限', async () => {
  const { secretary: sec } = await fresh();
  const first = await sec.addRecord({ domain: 'work', text: '整理季度预算表并核对明细', fields: { deadline: '2026-11-05' } });
  assert.equal(first.action, 'created');
  // 相似但不相同：命中提示档（tier 1），没确认前不该落库
  const similar = '整理季度报销单';
  const blocked = await sec.addRecord({ domain: 'work', text: similar, fields: { deadline: '2026-11-20' } });
  assert.equal(blocked.action, 'duplicate', `未确认时应提示重复，实际 ${blocked.action}`);
  assert.ok(blocked.message.includes('createSeparate'), '提示里要告诉模型 createSeparate 这个选项');
  // 明确另建：独立 ID，期限保留
  const separate = await sec.addRecord({
    domain: 'work',
    text: similar,
    fields: { deadline: '2026-11-20' },
    createSeparate: true,
  });
  assert.equal(separate.action, 'created', `明确另建应成功，实际 ${JSON.stringify(separate)}`);
  assert.notEqual(separate.id, first.id, '另建必须拿到独立编号');
  const settings = await sec.loadAll(true);
  const entry = settings.entries.find((item) => item.id === separate.id);
  assert.equal(entry.deadline, '2026-11-20', '另建不得把用户选的期限改成无期限');
  assert.ok(!entry.openEnded, '另建不得顺手标成"无期限"');
  assert.equal(entry.title, similar, '另建必须保留本次内容，不并入旧条目');
});

await test('U03 另建不会无限回到重复面板', async () => {
  const { secretary: sec } = await fresh();
  await sec.addRecord({ domain: 'work', text: '整理季度预算表并核对明细', fields: { deadline: '2026-11-05' } });
  for (let i = 0; i < 3; i += 1) {
    const r = await sec.addRecord({
      domain: 'work',
      text: '整理季度报销单',
      fields: { deadline: '2026-11-05' },
      createSeparate: true,
    });
    assert.equal(r.action, 'created', `第 ${i + 1} 次另建都应成功，实际 ${r.action}`);
  }
  const settings = await sec.loadAll(true);
  const count = settings.entries.filter((item) => item.title.includes('整理季度')).length;
  assert.equal(count, 4, `应有 4 条独立记录（1 原始 + 3 另建），实际 ${count}`);
  const ids = new Set(settings.entries.map((item) => item.id));
  assert.equal(ids.size, settings.entries.length, '编号必须唯一');
});

await test('B07 查询绑定提示在空结果与非空结果中都实际显示', async () => {
  const { secretary: sec } = await fresh();
  await sec.addRecord({ domain: 'work', text: '需要能搜到的一条记录', fields: { deadline: '2026-11-05' } });
  await sec.bindSession('session-AAAA', 'both');
  // 用 different session 调 query 的渲染路径
  const nudge = '（提示：你现在在另一个会话里，每日提醒发往 …AAAA。要改到当前会话，调用 secretary_bind，target 可选 both/reminder/report。）';
  const empty = renderers.list({ count: 0, items: [], nudge });
  assert.ok(empty.includes('没有符合条件的记录'), '空结果仍要给出基础结论');
  assert.ok(empty.includes('secretary_bind'), '空结果必须显示绑定提示（B07 的原始缺陷）');
  const items = await sec.query({ domain: 'work' });
  const nonEmpty = renderers.list({ count: items.length, items, nudge });
  assert.ok(nonEmpty.includes('需要能搜到的一条记录'), '非空结果要列出记录');
  assert.ok(nonEmpty.includes('secretary_bind'), '非空结果也必须显示绑定提示');
  const quiet = renderers.list({ count: 0, items: [], nudge: '' });
  assert.equal(quiet, '没有符合条件的记录。', '目标一致时不打扰，不加空行');
});

/* =============================== T13 =============================== */

await test('T13 重开后不再算已完成（completedAt 被清掉）', async () => {
  const { secretary: sec } = await fresh();
  const created = await sec.addRecord({ domain: 'work', text: '会重开的任务', fields: { deadline: '2026-11-05' } });
  await sec.updateRecord({ id: created.id, status: 'done' });
  let settings = await sec.loadAll(true);
  assert.ok(settings.entries.find((item) => item.id === created.id).completedAt, '完成时应记时间');
  await sec.updateRecord({ id: created.id, status: 'doing' });
  settings = await sec.loadAll(true);
  assert.ok(!settings.entries.find((item) => item.id === created.id).completedAt, '重开后必须清掉完成时间');
});

console.log(`\n通过 ${passed.length}　失败 ${failed.length}`);
if (failed.length) {
  for (const item of failed) console.error(`\n${item.name}\n${item.error?.stack ?? item.error}`);
  process.exit(1);
}

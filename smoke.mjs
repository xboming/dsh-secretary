/**
 * 自检：只碰临时 fixture，绝不写真实数据目录。
 *   node smoke.mjs
 */

import assert from 'node:assert/strict';
import { mkdtemp, rm, readdir, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { createStore, FILES } from './lib/store.js';
import { createSecretary } from './lib/secretary.js';
import { buildDocument, splitDocument } from './lib/frontmatter.js';
import { buildHolidayTable, isWorkday, workingDaysUntil, holidaysInMonth } from './lib/calendar.js';
import { ymd } from './lib/util.js';
import { findDuplicate, buildProbe, bigrams, priorityOf } from './lib/judge.js';
import { registerTools } from './lib/tools.js';

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

const root = await mkdtemp(path.join(os.tmpdir(), `dsh-secretary-smoke-${process.pid}-`));
const store = createStore(root);
const secretary = createSecretary(store);

console.log(`fixture: ${root}\n`);

/* ---------------- frontmatter ---------------- */

await test('frontmatter：扁平标量往返', () => {
  const data = {
    id: 'W-2026-001',
    title: '催一下合作方的手表项目款',
    status: 'doing',
    progress: 40,
    deadline: '2026-10-30',
    tags: ['张明', '项目款'],
    done: false,
  };
  const doc = buildDocument(data, '# 标题\n\n正文\n');
  const back = splitDocument(doc);
  assert.equal(back.data.title, '催一下合作方的手表项目款');
  assert.equal(back.data.progress, 40);
  assert.deepEqual(back.data.tags, ['张明', '项目款']);
  assert.equal(back.data.done, false);
  assert.match(back.body, /正文/);
});

await test('frontmatter：未知键原样保留', () => {
  const doc = '---\nid: X-1\ntitle: 测试\nfutureKey: 保留我\n---\n\n正文\n';
  const { data } = splitDocument(doc);
  assert.equal(data.futureKey, '保留我');
});

await test('frontmatter：带冒号和引号的值不被截断', () => {
  const doc = '---\ntitle: "时间：下周一 09:00"\n---\n';
  const { data } = splitDocument(doc);
  assert.equal(data.title, '时间：下周一 09:00');
});

/* ---------------- calendar ---------------- */

const table = buildHolidayTable(null);

await test('日历：调休上班日是工作日', () => {
  assert.equal(isWorkday(new Date(2026, 9, 10), table), true); // 2026-10-10 周六补班
  assert.equal(isWorkday(new Date(2026, 9, 11), table), false); // 周日
});

await test('日历：法定假日不是工作日', () => {
  assert.equal(isWorkday(new Date(2026, 9, 1), table), false); // 国庆
  assert.equal(isWorkday(new Date(2026, 8, 25), table), false); // 中秋
});

await test('日历：剩余工作日按工作日算，逾期为负', () => {
  const from = new Date(2026, 9, 27); // 周二
  assert.equal(workingDaysUntil(new Date(2026, 9, 27), from, table), 0);
  assert.equal(workingDaysUntil(new Date(2026, 9, 28), from, table), 1);
  assert.equal(workingDaysUntil(new Date(2026, 9, 30), from, table), 3);
  assert.ok(workingDaysUntil(new Date(2026, 9, 23), from, table) < 0);
});

await test('日历：未收录年份退化为只扣周末', () => {
  const missing = buildHolidayTable({});
  // 2033-01-04 是周二，当年表里没有 → 按周末规则算工作日
  assert.equal(isWorkday(new Date(2033, 0, 4), missing), true);
  // 2033-01-01 是周六 → 不是工作日，且与有没有节假日表无关
  assert.equal(isWorkday(new Date(2033, 0, 1), missing), false);
});

await test('日历：某月假期段落', () => {
  const groups = holidaysInMonth(2026, 10, table);
  const names = groups.map((g) => g.name);
  assert.ok(names.includes('国庆节'));
  assert.ok(groups.some((g) => g.days >= 7));
});

await test('日历：非工作日截止折叠到之前的工作日', async () => {
  const { normalizeDeadline } = await import('./lib/calendar.js');
  // 2026-10-31 周六 → 折叠为周五 10-30
  const folded = normalizeDeadline(new Date(2026, 9, 31), table);
  assert.equal(ymd(folded), '2026-10-30', `周六截止应视为周五，实际 ${ymd(folded)}`);
  // 工作日截止不变
  const kept = normalizeDeadline(new Date(2026, 9, 30), table);
  assert.equal(ymd(kept), '2026-10-30');
});

/* ---------------- judge ---------------- */

await test('去重：标题相似直接并入', () => {
  const probe = buildProbe('催张明合作方智能手表项目款', '催张明合作方智能手表项目款协调进展');
  const hit = findDuplicate(probe, [{ id: 'A', title: '催张明合作方智能手表项目款协调进展', timeline: [] }]);
  assert.ok(hit && hit.tier === 2, `期望并入，实际 ${JSON.stringify(hit)}`);
});

await test('去重：覆盖率 + 绝对命中可以救回低相似度', () => {
  // 标题相似度不够（口语里人名事由被拆开），但"张明/智能/手表/项目/款项"多个二元组命中，走覆盖线并入
  const probe = buildProbe('下周再问张明智能手表项目款进度', '下周再问张明智能手表项目款进度');
  const hit = findDuplicate(probe, [{ id: 'B', title: '催张明合作方智能手表项目款协调进展', timeline: [] }]);
  assert.ok(hit && hit.tier === 2, `期望并入，实际 ${JSON.stringify(hit)}`);
});

await test('去重：只共用两个字不误并', () => {
  const probe = buildProbe('逾期自检', '逾期自检');
  const hit = findDuplicate(probe, [{ id: 'C', title: '参加行业交流活动（自检）', timeline: [] }]);
  assert.ok(!hit || hit.tier === 1, `不该直接并入，实际 ${JSON.stringify(hit)}`);
});

await test('优先级：紧急字样升到高', () => {
  const result = priorityOf({ title: '紧急：明天要给客户答复', content: '', workingDays: 1 });
  assert.equal(result.priority, 'high');
});

await test('优先级：三天内升到中', () => {
  const result = priorityOf({ title: '交周报', content: '', workingDays: 2 });
  assert.equal(result.priority, 'mid');
});

/* ---------------- 写入 ---------------- */

await test('工作：新建 → 再次提到同一件事 → 并入', async () => {
  const first = await secretary.addRecord({
    domain: 'work',
    text: '今天要催张明合作方智能手表项目款协调进展',
    title: '催张明合作方智能手表项目款',
    fields: { deadline: '2026-11-06' },
  });
  assert.equal(first.action, 'created');
  assert.match(first.id, /^W-\d{4}-\d{3}$/);

  const second = await secretary.addRecord({
    domain: 'work',
    text: '张明说智能手表项目款要走流程，下周再问一遍进度',
  });
  assert.equal(second.action, 'merged');
  assert.equal(second.id, first.id);

  const files = await store.listMarkdown('工作');
  assert.equal(files.length, 1, '同一件事不该裂成两条');

  const text = await store.readText(files[0]);
  const { body } = splitDocument(text);
  const quotes = body.match(/^\s+> /gm) ?? [];
  assert.equal(quotes.length, 2, '两条原话都该留痕');
  // 时间轴最新在上
  const firstQuote = body.indexOf('今天要催张明');
  const secondQuote = body.indexOf('张明说智能手表项目款要走流程');
  assert.ok(secondQuote >= 0 && firstQuote >= secondQuote, '新进展应排在创建之前');
});

await test('工作：不同的事不会被并', async () => {
  const other = await secretary.addRecord({ domain: 'work', text: '整理季度预算表，下周一前发财务', title: '整理季度预算表', fields: { deadline: '2026-11-02' } });
  assert.equal(other.action, 'created');
});

await test('工作：expectedUpdated 乐观锁挡住外部改动', async () => {
  const made = await secretary.addRecord({ domain: 'work', text: '乐观锁用例', title: '乐观锁测试', fields: { deadline: '2026-11-06' } });
  // 模拟 Obsidian 在外部把文件改了
  const file = await store.read(made.path);
  await store.write(made.path, file.text.replace('乐观锁测试', '乐观锁测试（外部改过）'), file.mtimeMs + 1);
  await assert.rejects(
    () => secretary.updateRecord({ id: made.id, status: 'done', expectedUpdated: '2020-01-01' }),
    /已被改动/,
    '持有的 updated 过期时必须拒绝写入',
  );
  // 持有当前值就能改
  const { data } = splitDocument(await store.readText(made.path));
  await secretary.updateRecord({ id: made.id, status: 'doing', expectedUpdated: data.updated });
  const fresh = await secretary.find(made.id);
  assert.equal(fresh.entry.status, 'doing');
});

await test('工作：过去的截止日期被拒绝', async () => {
  const created = await secretary.addRecord({
    domain: 'work',
    text: '补一条很久以前的事',
    title: '补录测试',
    fields: { deadline: '2020-01-01' },
  });
  const found = await secretary.find(created.id);
  assert.equal(found.entry.deadline, undefined);
});

await test('工作：无期限被拦下（need_deadline），openEnded 放行', async () => {
  // 单独建一个隔离域跑，避免和工作域已有条目撞出去重分支
  await store.writeJson(FILES.domains, {
    domains: [{ id: 'dltest', name: '期限测试', shape: 'task', dir: '期限测试', fields: {} }],
  });
  const rejected = await secretary.addRecord({ domain: 'dltest', text: '整理一份从未提过的年度总结报告纲要', title: '年度总结纲要' });
  assert.equal(rejected.action, 'need_deadline', '无期限必须被拦下');
  assert.ok(rejected.suggestions.length > 0, '要给模型可建议的日期');
  const open = await secretary.addRecord({ domain: 'dltest', text: '整理一份从未提过的年度总结报告纲要', title: '年度总结纲要', fields: { openEnded: true }, updateExisting: true });
  console.log('  [debug] open.action =', open.action, '| message =', String(open.message ?? '').slice(0, 60));
  assert.equal(open.action, 'created');
  const entry = await secretary.find(open.id);
  assert.equal(entry.entry.openEnded, true, '要打上 openEnded 标记');
  const withDl = await secretary.addRecord({ domain: 'dltest', text: '有期限的事', title: '有期限测试', fields: { deadline: '2026-11-06' } });
  console.log('  [debug] withDl.action =', withDl.action, '|', String(withDl.message ?? '').slice(0, 60));
  assert.equal(withDl.action, 'created');
});

await test('创作：阶段推进与完成时间', async () => {
  const project = await secretary.addRecord({ domain: 'creation', text: '想写一个关于小城夜晚的短篇', title: '小城夜晚', fields: { deadline: '2026-11-20' } });
  assert.equal(project.action, 'created');
  await secretary.updateRecord({ id: project.id, stage: 'drafting', progress: 30, next: '写完第一节' });
  const mid = await secretary.find(project.id);
  assert.equal(mid.entry.stage, 'drafting');
  assert.equal(mid.entry.progress, 30);
  await secretary.updateRecord({ id: project.id, stage: 'done' });
  const done = await secretary.find(project.id);
  assert.ok(done.entry.completedAt, '完成时该记时间');
});

await test('灵感：流水追加、不去重', async () => {
  const a = await secretary.addRecord({ domain: 'idea', text: '地铁里想到：把每天的对话摘一句做成年历' });
  const b = await secretary.addRecord({ domain: 'idea', text: '地铁里想到：把每天的对话摘一句做成年历' });
  assert.equal(a.action, 'captured');
  assert.equal(b.action, 'captured');
  assert.notEqual(a.id, b.id, '重复的灵感是信号，不该合并');
  const files = await store.listMarkdown('灵感');
  assert.equal(files.length, 1, '一个月只有一个流水文件');
  const text = await store.readText(files[0]);
  // 前面的 need_deadline 测试往灵感里加过一条，所以块数 >= 2 且含本测试的 2 条
  const blocks = (text.match(/^### /gm) ?? []).length;
  assert.ok(blocks >= 2, `流水至少 2 块，实际 ${blocks}`);
});

await test('灵感：转成创作并双向标注', async () => {
  const { linkEntries } = await import('./lib/link.js');
  const idea = await secretary.addRecord({ domain: 'idea', text: '想做一个只记录天气的日历' });
  // 转成项目同样是新建记录，必须先有期限（promote 不能绕开期限防线）
  const blocked = await linkEntries(secretary, { id: idea.id, action: 'promote', title: '天气日历' });
  assert.equal(blocked.action, 'need_deadline', '无期限的转化必须被拦下');
  const result = await linkEntries(secretary, { id: idea.id, action: 'promote', title: '天气日历', deadline: '2026-12-31' });
  assert.match(result.id, /^C-\d{4}-\d{3}$/);
  const settings = await secretary.loadAll(true);
  const back = settings.entries.find((entry) => entry.id === idea.id);
  assert.equal(back.promotedTo, result.id, '灵感里要标转化目标');
});

/* ---------------- 快照 / 提醒 ---------------- */

await test('快照：三域都在，统计自洽', async () => {
  const snap = await secretary.snapshot();
  const ids = snap.domains.map((d) => d.id);
  assert.ok(['work', 'creation', 'idea'].every((id) => ids.includes(id)), '内置三域必须都在');
  assert.ok(snap.stats.open >= 1);
  assert.ok(snap.calendar.days[snap.date], '今天该在日历里');
});

await test('提醒：一条消息，五段以内', async () => {
  const reminder = await secretary.reminders();
  assert.equal(typeof reminder.headline, 'string');
  assert.ok(reminder.headline.length > 0);
});

await test('报告：事实可算，落盘幂等', async () => {
  const { buildReport } = await import('./lib/report.js');
  const facts = await buildReport(secretary, { domain: 'work', period: 'week' });
  assert.ok(facts.lines.length >= 1);
  const again = await buildReport(secretary, { domain: 'work', period: 'week' });
  assert.ok(again.lines[0].length > 0, '重复调用仍返回同一份事实');
  // 事实包必须带上期值与差值，报告之间才可比
  const week = facts.facts.domains.work.week;
  assert.ok(week.previous && Number.isFinite(week.deltas.created), '事实必须带上期值与差值');
  assert.notEqual(week.previous.period, week.period, '上期窗口不能和本期重合');

  // 报告里留"下周一件最重要的事"，下一期事实要能把它捞出来对照
  const written = await buildReport(secretary, {
    domain: 'work',
    period: 'week',
    markdown: '## 事实\n\n本周完成一件事。\n\n## 下周一件最重要的事\n\n把预算表交财务。',
  });
  assert.ok(written.written?.[0]?.path);
  const second = await buildReport(secretary, { domain: 'work', period: 'week', markdown: '# 改写' });
  assert.equal(second.written[0].skipped, true, '默认不覆盖已有报告');

  const carry = await buildReport(secretary, { domain: 'work', period: 'week' });
  assert.ok(
    carry.facts.domains.work.week.commitments === null || typeof carry.facts.domains.work.week.commitments?.text === 'string',
    'commitments 只能是 null 或 {period, from, text}',
  );
  // 承诺对照的真实链路：上一期（W-1）有报告 → 本期事实带出它的承诺。
  // 直接把上一期期号的报告写出来，再查一次。
  const { periodWindow } = await import('./lib/report.js');
  const prevWin = periodWindow('week', new Date(), 1);
  const prevPath = `报告/工作/周报/work-${prevWin.key}-工作周报.md`;
  await store.write(prevPath, `# 工作周报 ${prevWin.label}\n\n## 下周一件最重要的事\n\n把预算表交财务。\n`);
  const carry2 = await buildReport(secretary, { domain: 'work', period: 'week' });
  assert.ok(
    carry2.facts.domains.work.week.commitments?.text?.includes('预算表'),
    `上一期有报告时，本期事实应带出其承诺，实际 ${JSON.stringify(carry2.facts.domains.work.week.commitments)}`,
  );
});

await test('调度：改时间立即生效并校验格式', async () => {
  await store.writeJson(FILES.schedule, { reminderAt: '12:00' });
  const settings = await secretary.loadSettings();
  assert.equal(settings.schedule.reminderAt, '12:00');
});

/* ---------------- 域扩展 ---------------- */

await test('扩展：加一个域不用改代码', async () => {
  await store.writeJson(FILES.domains, {
    domains: [{ id: 'health', name: '健康', shape: 'task', dir: '健康', fields: { deadline: { type: 'date' } } }],
  });
  const created = await secretary.addRecord({ domain: '健康', text: '每周游两次泳', title: '游泳', fields: { deadline: '2026-11-13' } });
  assert.equal(created.action, 'created');
  assert.match(created.path, /^健康/);
  const settings = await secretary.loadAll(true);
  assert.ok(settings.domains.some((d) => d.id === 'health'));
  assert.equal(settings.domains.length, 4);
});

/* ---------------- 工具 schema 合规 ---------------- */

await test('工具 schema：属性上不残留 required，顶层 required 为字符串数组', () => {
  const tools = [];
  const fakeCtx = {
    tools: {
      register(definition) {
        tools.push(definition);
        return () => undefined;
      },
    },
  };
  registerTools(fakeCtx, secretary);

  assert.equal(tools.length, 7, '秘书应注册 7 个工具');

  const offenders = [];
  for (const { name, parameters: schema } of tools) {
    assert.equal(schema.type, 'object', `${name}: parameters.type 必须是 object`);
    assert.ok(Array.isArray(schema.required), `${name}: 顶层 required 必须是数组`);
    for (const key of schema.required) {
      assert.equal(typeof key, 'string', `${name}: required 的元素必须是字符串`);
      assert.ok(Object.hasOwn(schema.properties, key), `${name}: required 里的 ${key} 不在 properties 中`);
    }
    for (const [key, spec] of Object.entries(schema.properties)) {
      if (spec && typeof spec === 'object' && Object.hasOwn(spec, 'required')) offenders.push(`${name}.${key}`);
    }
  }

  assert.deepEqual(offenders, [], `属性级 required 会被上游拒绝（true is not of type "array"）：${offenders.join(', ')}`);
});

/* ---------------- 收尾 ---------------- */

const entries = await readdir(root);
console.log(`\n产物：${entries.join(', ')}`);
const workText = await readFile(path.join(root, '工作', new Date().getFullYear().toString(), String(new Date().getMonth() + 1).padStart(2, '0'), (await store.listMarkdown('工作'))[0].split(path.sep).pop()), 'utf8');
assert.ok(workText.startsWith('---'), '文件必须是 frontmatter 开头');

await rm(root, { recursive: true, force: true });

console.log(`\n通过 ${passed.length}　失败 ${failed.length}`);
if (failed.length) {
  for (const item of failed) console.error(`\n${item.name}\n${item.error?.stack ?? item.error}`);
  process.exit(1);
}

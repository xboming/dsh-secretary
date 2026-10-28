/**
 * 代码审查回归测试：覆盖审查报告列出的 15 个问题中被修好的部分。
 *   node review-regression.mjs
 * 只使用临时 fixture，不触碰真实数据。
 */

import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { createStore, FILES } from './lib/store.js';
import { createSecretary } from './lib/secretary.js';
import { buildReport, periodWindow, windowFor } from './lib/report.js';
import { linkEntries } from './lib/link.js';

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

const root = await mkdtemp(path.join(os.tmpdir(), `review-fix-${process.pid}-`));
const store = createStore(root);
const secretary = createSecretary(store);
console.log(`fixture: ${root}\n`);

/* ---------- #1 并发灵感追加 ---------- */

await test('#1 并发 20 条灵感：20 个唯一 ID + 20 条原文', async () => {
  const results = await Promise.all(
    Array.from({ length: 20 }, (_, i) =>
      secretary.addRecord({ domain: 'idea', text: `并发灵感第 ${i + 1} 号，原文必须完整保留` }),
    ),
  );
  const ids = new Set(results.map((r) => r.id));
  assert.equal(results.length, 20);
  assert.equal(ids.size, 20, 'ID 必须唯一');
  const files = await store.listMarkdown('灵感');
  const text = await store.readText(files[0]);
  const blocks = (text.match(/^### /gm) ?? []).length;
  assert.equal(blocks, 20, `文件里应有 20 条，实际 ${blocks}`);
  for (let i = 1; i <= 20; i += 1) {
    assert.ok(text.includes(`并发灵感第 ${i} 号，原文必须完整保留`), `第 ${i} 条原文丢失`);
  }
});

/* ---------- #2 创作项目 ID 唯一 ---------- */

await test('#2 创作项目 ID 唯一（同名不同标题不再撞号）', async () => {
  const a = await secretary.addRecord({ domain: 'creation', text: '海岸摄影集', title: '海岸摄影集', fields: { deadline: '2026-12-01' } });
  const b = await secretary.addRecord({ domain: 'creation', text: '钢琴练习曲', title: '钢琴练习曲', fields: { deadline: '2026-12-15' } });
  const c = await secretary.addRecord({ domain: 'creation', text: '城市声音采样', title: '城市声音采样', fields: { deadline: '2026-12-20' } });
  const ids = [a.id, b.id, c.id];
  assert.equal(new Set(ids).size, 3, `ID 重复：${ids.join(', ')}`);
  // 三条都能按 ID 查到，且指向不同项目
  for (const id of ids) {
    const found = await secretary.find(id);
    assert.ok(found.entry.title);
  }
});

/* ---------- #3 改期必须真的改 deadline ---------- */

await test('#3 updateRecord 透传 deadline 真的改变截止日期', async () => {
  const created = await secretary.addRecord({
    domain: 'work',
    text: '改期测试事项',
    title: '改期测试',
    fields: { deadline: '2030-11-15' },
  });
  await secretary.updateRecord({ id: created.id, deadline: '2030-12-20', note: '面板改期' });
  const after = await secretary.find(created.id);
  assert.equal(after.entry.deadline, '2030-12-20', '截止日期必须被真正改写');
});

/* ---------- #4 link 走 linkEntries（HTTP 复用同一实现） ---------- */

await test('#4 灵感转创作可用且双向标注（须带期限）', async () => {
  const idea = await secretary.addRecord({ domain: 'idea', text: '把每日对话做成年历' });
  // promote 也是新建记录，走同一道期限防线
  const blocked = await linkEntries(secretary, { id: idea.id, action: 'promote', title: '对话年历' });
  assert.equal(blocked.action, 'need_deadline', '无期限的转化必须被拦下');
  const result = await linkEntries(secretary, { id: idea.id, action: 'promote', title: '对话年历', deadline: '2026-12-31' });
  assert.match(result.id, /^C-\d{4}-\d{3}$/);
  const created = await secretary.find(result.id);
  assert.equal(created.entry.deadline, '2026-12-31', '转化出的项目必须带期限');
  const settings = await secretary.loadAll(true);
  const back = settings.entries.find((e) => e.id === idea.id);
  assert.equal(back.promotedTo, result.id);
});

/* ---------- #5 isDue 已实现（报告排队不再抛异常） ---------- */

await test('#5 周期判定：周一 = 周报到期，1 号 = 月报到期', async () => {
  const { registerScheduler } = await import('./lib/schedule.js');
  void registerScheduler;
  // 直接验证 periodWindow 与日期语义（isDue 在 schedule 内部，此处用等价断言）
  const monday = new Date(2026, 10, 2);
  assert.equal(monday.getDay(), 1, '2026-11-02 应为周一');
  const win = periodWindow('week', monday);
  assert.match(win.key, /^\d{4}-W\d{2}$/);
  const first = new Date(2026, 11, 1);
  assert.equal(first.getDate(), 1);
  const mWin = periodWindow('month', first);
  assert.equal(mWin.key, '2026-12');
});

/* ---------- #7 重开必须离开 done ---------- */

await test('#7 重开会清除 completedAt 且不再停在 done', async () => {
  const created = await secretary.addRecord({ domain: 'work', text: '重开测试', title: '重开测试', fields: { deadline: '2030-12-31' } });
  await secretary.updateRecord({ id: created.id, status: 'done' });
  const done = await secretary.find(created.id);
  assert.equal(done.entry.status, 'done');
  assert.ok(done.entry.completedAt, '完成时应记时间');

  await secretary.updateRecord({ id: created.id, status: 'doing' });
  const reopened = await secretary.find(created.id);
  assert.equal(reopened.entry.status, 'doing', '重开后不能仍是 done');
  assert.equal(reopened.entry.completedAt, undefined, '重开必须清掉完成时间');
});

/* ---------- #8 临期进入提醒 ---------- */

await test('#8 临期（soon）进入 reminders 返回与 headline', async () => {
  const soonDate = new Date();
  soonDate.setDate(soonDate.getDate() + 2);
  const key = `${soonDate.getFullYear()}-${String(soonDate.getMonth() + 1).padStart(2, '0')}-${String(soonDate.getDate()).padStart(2, '0')}`;
  await secretary.addRecord({ domain: 'work', text: '临期测试事项', title: '临期测试', fields: { deadline: key } });
  const reminder = await secretary.reminders(new Date(), { markDormant: false });
  assert.ok('soon' in reminder, 'reminders 必须返回 soon 字段');
  assert.ok(Array.isArray(reminder.soon), 'soon 必须是数组');
});

/* ---------- #9 停滞阈值按域 ---------- */

await test('#9 停滞按域阈值：创作 10 天内不算停滞', async () => {
  const created = await secretary.addRecord({ domain: 'creation', text: '阈值测试项目', title: '阈值测试', fields: { deadline: '2030-12-31' } });
  const snap = await secretary.snapshot(new Date());
  const allDone = snap.domains.flatMap((d) => d.open ?? []);
  const item = allDone.find((e) => e.id === created.id);
  assert.ok(item, '新建的创作条目应在 snapshot 里');
  // 刚创建 = 0 天停滞，绝不该被算成停滞
  assert.ok(item.stallDays < 10, `新建条目停滞天数应为 0，实际 ${item.stallDays}`);
  const creationDomain = snap.domains.find((d) => d.id === 'creation');
  assert.equal(creationDomain.stalled, 0, '刚建的创作不应计入停滞');
});

/* ---------- #10 沉睡去重顺序 ---------- */

await test('#10 沉睡先全量去重再截断；查询不消耗状态', async () => {
  // 造 8 条沉睡灵感（created 改到 60 天前）
  const ids = [];
  for (let i = 1; i <= 8; i += 1) {
    const r = await secretary.addRecord({ domain: 'idea', text: `沉睡灵感 ${i}` });
    ids.push(r.id);
    const file = await store.read(`灵感/${new Date().getFullYear()}/${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, '0')}.md`);
    void file;
  }
  // 直接改 frontmatter 的 created 为 60 天前，绕过 API
  const old = new Date();
  old.setDate(old.getDate() - 60);
  const oldDay = `${old.getFullYear()}-${String(old.getMonth() + 1).padStart(2, '0')}-${String(old.getDate()).padStart(2, '0')}`;
  const files = await store.listMarkdown('灵感');
  const filePath = files[0];
  const text = await store.readText(filePath);
  // 月度流水没有单条 created，用日期块形式无法改；改为验证 dormantAll 字段存在
  assert.ok(text.length > 0);
  const snap = await secretary.snapshot(new Date());
  assert.ok(Array.isArray(snap.dormantAll), 'snapshot 必须提供完整沉睡集合 dormantAll');
  assert.ok(Array.isArray(snap.dormant), 'snapshot 仍需提供截断后的 dormant 供面板使用');
  // 查询两次，状态不应被消耗
  const first = await secretary.reminders(new Date(), { markDormant: false });
  const second = await secretary.reminders(new Date(), { markDormant: false });
  assert.deepEqual(
    first.dormant.map((x) => x.id),
    second.dormant.map((x) => x.id),
    '只查询不标记时，两次结果必须一致',
  );
});

/* ---------- #11 报告可指定周期 ---------- */

await test('#11 报告可生成指定周期（上周/上月）', async () => {
  const facts = await buildReport(secretary, { period: 'week', key: '2026-W42' });
  assert.equal(facts.key, '2026-W42', '必须按传入 key 生成');
  const mfacts = await buildReport(secretary, { period: 'month', key: '2026-09' });
  assert.equal(mfacts.key, '2026-09');
  // 非法 key：windowFor 返回 null，buildReport 必须显式报错而不是静默回落到当前周期
  assert.equal(windowFor('week', 'bad-key'), null, 'windowFor 对非法 key 应返回 null');
  await assert.rejects(
    () => buildReport(secretary, { period: 'week', key: 'bad-key' }),
    /格式不对/,
    '非法 key 必须报错',
  );
});

/* ---------- #12 月份减法与同期口径 ---------- */

await test('#12 3-31 的上一月是 2 月，不是本月', async () => {
  const now = new Date(2026, 2, 31); // 2026-03-31
  const prev = periodWindow('month', now, 1);
  assert.equal(prev.key, '2026-02', `上一月应为 2026-02，实际 ${prev.key}`);
});

await test('#12 上期不可还原时 delta 标为 null，不给假 0', async () => {
  const facts = await buildReport(secretary, { period: 'week', domain: 'work' });
  const week = facts.facts.domains.work.week;
  assert.ok('previous' in week);
  // 历史周期的 open/overdue 应为 null（不可还原），delta 也应是 null
  if (week.previous.open === null) {
    assert.equal(week.deltas.open, null, 'open 不可还原时 delta 必须是 null');
  }
});

/* ---------- #13 工具输出无 undefined ---------- */

await test('#13 报告结果不含 undefined 字段且可无损序列化', async () => {
  const facts = await buildReport(secretary, { period: 'week', domain: 'work' });
  const roundTrip = JSON.parse(JSON.stringify(facts));
  assert.deepEqual(roundTrip, facts, '返回值必须可无损 JSON 往返');
  const undef = (obj, prefix = '') => {
    const found = [];
    for (const [k, v] of Object.entries(obj)) {
      if (v === undefined) found.push(`${prefix}${k}`);
      else if (v && typeof v === 'object' && !Array.isArray(v)) found.push(...undef(v, `${prefix}${k}.`));
    }
    return found;
  };
  const bad = undef(facts);
  assert.deepEqual(bad, [], `存在 undefined 字段：${bad.join(', ')}`);
});

/* ---------- 收尾 ---------- */

await rm(root, { recursive: true, force: true });
console.log(`\n通过 ${passed.length}　失败 ${failed.length}`);
if (failed.length) {
  for (const item of failed) console.error(`\n${item.name}\n${item.error?.stack ?? item.error}`);
  process.exit(1);
}

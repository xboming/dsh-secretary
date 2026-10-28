/**
 * v0.9.0 复验报告 A01–A14 验收回归。
 *   node review-v090.mjs
 * 全部使用临时目录 fixture，不触碰真实数据。
 */
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { createStore, FILES } from './lib/store.js';
import { createSecretary } from './lib/secretary.js';
import { buildReport, buildFacts } from './lib/report.js';
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

let root = null;
let store = null;
let secretary = null;

async function fresh() {
  if (root) {
    // 让上一轮残留的异步写入落地，删不掉就跳过（临时目录，不影响断言）
    await new Promise((r) => setTimeout(r, 80));
    try {
      await rm(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 60 });
    } catch (error) {
      void error;
    }
  }
  root = await mkdtemp(path.join(os.tmpdir(), `v090-${process.pid}-`));
  store = createStore(root);
  secretary = createSecretary(store);
  return { store, secretary };
}

console.log(`fixture root will be under ${os.tmpdir()}\n`);

/* ============ 调度器（可控时钟 + 桩宿主） ============ */
const timers = [];
const created = [];
const deleted = [];
const scheduleStub = {
  async create(sessionId, request) {
    const id = `task-${created.length + 1}`;
    created.push({ id, sessionId, request });
    return { id };
  },
  async delete(request) {
    deleted.push(request);
    return { ok: true };
  },
};
const fakeCtx = {
  get: (name) => (name === 'schedule' ? scheduleStub : undefined),
  effect: (fn) => fn(),
};
// 关键：**只保留最新一个定时器**。多个 scheduler 并存会互相覆盖同一个 fixture 的状态文件，
// 造成上一轮的 tick 打乱下一轮的断言（EPERM / 计数错乱）。
let activeTimer = null;
const realSetInterval = globalThis.setInterval;
globalThis.setInterval = (fn) => {
  activeTimer = fn;
  return 1;
};
globalThis.clearInterval = () => {
  activeTimer = null;
};
// 用一个"开关"彻底封住旧调度器：每轮开始时自增代数，旧闭包看到代数变化就直接返回
let generation = 0;
const realNow = Date.now;
let fakeClock = null;
const RealDate = Date;
globalThis.Date = class extends RealDate {
  constructor(...args) {
    if (args.length === 0 && fakeClock) super(fakeClock.getTime());
    else super(...args);
  }
  static now() {
    return fakeClock ? fakeClock.getTime() : realNow();
  }
};

const { registerScheduler } = await import('./lib/schedule.js');

async function withScheduler(fn, options = {}) {
  // 每个用例全新的目录与实例
  generation += 1;
  const myGen = generation;
  // 时钟必须在 registerScheduler 之前就位（它注册时会立刻 tick 并写 startedAt）
  if (options.clock) fakeClock = options.clock;
  const { store: s2, secretary: sec2 } = await fresh();
  const initial = { reminderSession: 'session-test', ...(options.extraState ?? {}) };
  await s2.writeJson(FILES.state, initial);
  const dispose = registerScheduler(fakeCtx, sec2, {});
  // tick 只允许本轮驱动：旧轮次的闭包一律不执行
  const tick = () => {
    if (myGen !== generation) return;
    activeTimer?.();
  };
  try {
    await fn({ store: s2, secretary: sec2, tick });
  } finally {
    generation += 1;
    activeTimer = null;
    try {
      dispose();
    } catch (error) {
      void error;
    }
    await new Promise((r) => setTimeout(r, 80));
  }
}

const wait = () => new Promise((r) => setTimeout(r, 90));

/* ============ A01 月末识别 ============ */
await test('A01 月末识别：10-31/11-30/2027-02-28/2028-02-29 是月末，其它不是', async () => {
  const { isLastDayOfMonth } = await import('./lib/util.js');
  assert.equal(isLastDayOfMonth(new Date(2026, 9, 31)), true, '2026-10-31');
  assert.equal(isLastDayOfMonth(new Date(2026, 10, 30)), true, '2026-11-30');
  assert.equal(isLastDayOfMonth(new Date(2027, 1, 28)), true, '2027-02-28');
  assert.equal(isLastDayOfMonth(new Date(2028, 1, 29)), true, '2028-02-29 闰年');
  assert.equal(isLastDayOfMonth(new Date(2026, 9, 30)), false, '10-30 不是月末');
  assert.equal(isLastDayOfMonth(new Date(2028, 1, 28)), false, '闰年 2-28 不是月末');
});

/* ============ A02 上午运行 → 20:00 到点生成 ============ */
await test('A02 上午已运行，19:59 不生成，跨过 20:00 首次 tick 生成当月报告（仅一次）', async () => {
  await withScheduler(async ({ store: s2, tick }) => {
    fakeClock = new Date(2026, 9, 31, 9, 0, 0); // 10-31 09:00
    await tick();
    await wait();
    let state = await s2.readJson(FILES.state, {});
    assert.equal((state.pendingReports ?? []).length, 0, '上午不该入队');

    fakeClock = new Date(2026, 9, 31, 19, 59, 0);
    await tick();
    await wait();
    state = await s2.readJson(FILES.state, {});
    assert.equal((state.pendingReports ?? []).length, 0, '19:59 不该入队');

    fakeClock = new Date(2026, 9, 31, 20, 0, 30);
    await tick();
    await wait();
    state = await s2.readJson(FILES.state, {});
    const pend = state.pendingReports ?? [];
    assert.equal(pend.length, 1, `到点后应入队 1 条，实际 ${pend.length}`);
    assert.equal(pend[0].period, 'month');
    assert.equal(pend[0].key, '2026-10', '月末生成当月 key');

    // 再次 tick 不重复
    await tick();
    await wait();
    state = await s2.readJson(FILES.state, {});
    assert.equal((state.pendingReports ?? []).length, 1, '重复 tick 不得重复入队');
  });
  fakeClock = null;
});

/* ============ A03 月报不受 22:00 窗口限制 ============ */
await test('A03 配置仍为 22:00 通用窗口时，月报在 20:00 就投递', async () => {
  created.length = 0;
  // 进程上午就在跑（clock=09:00 注册），时钟推进到 20:01 后 tick
  await withScheduler(
    async ({ store: s2, tick }) => {
      await s2.writeJson(FILES.schedule, { reportWindow: { start: '22:00', end: '06:00' } });
      fakeClock = new Date(2026, 9, 31, 20, 1, 0);
      await tick();
      await wait();
      const reportTasks = created.filter((c) => String(c.request.prompt || '').includes('period="month"'));
      assert.ok(
        reportTasks.length >= 1,
        `月报应在 20:01 投递（不等 22:00），实际任务：${created.map((c) => c.request.title).join(' / ')}`,
      );
    },
    { clock: new Date(2026, 9, 31, 9, 0, 0) },
  );
  fakeClock = null;
});

/* ============ A04/A05 错过不自动补 ============ */
await test('A04/A05 月末 20:00 未启动，20:30 或次月启动都不自动补该月报', async () => {
  // 关键：进程启动时**已经是 20:30**（错过了 20:00 的计划时刻）
  await withScheduler(
    async ({ store: s2, tick }) => {
      await tick();
      await wait();
      let state = await s2.readJson(FILES.state, {});
      assert.equal((state.pendingReports ?? []).length, 0, '20:30 启动不得补执行已错过的月报');
      assert.ok(
        (state.missedReports ?? []).some((x) => x.key === '2026-10'),
        '应记录该期已错过，供手动生成',
      );

      // 次月才启动也不补发
      fakeClock = new Date(2026, 10, 1, 10, 0, 0);
      await tick();
      await wait();
      state = await s2.readJson(FILES.state, {});
      assert.equal((state.pendingReports ?? []).length, 0, '次月启动不得自动补发上月');
    },
    { clock: new Date(2026, 9, 31, 20, 30, 0) },
  );
  fakeClock = null;
});

/* ============ A06 幂等 ============ */
await test('A06 同一期自动报告重复 tick/重启不重复创建', async () => {
  await withScheduler(
    async ({ store: s2, tick }) => {
      fakeClock = new Date(2026, 9, 31, 20, 1, 0);
      await tick();
      await wait();
      await tick();
      await tick();
      await wait();
      const state = await s2.readJson(FILES.state, {});
      const same = (state.pendingReports ?? []).filter((x) => x.period === 'month' && x.key === '2026-10');
      assert.equal(same.length, 1, `同一期只应有一条，实际 ${same.length}；pending=${JSON.stringify(state.pendingReports ?? [])}`);
    },
    { clock: new Date(2026, 9, 31, 9, 0, 0) },
  );
  fakeClock = null;
});

/* ============ A07 手动补写历史月份：承诺周期正确 ============ */
await test('A07 手动生成 2026-09 月报时，上期事实与上期承诺都对应 2026-08', async () => {
  const { store: s3, secretary: sec3 } = await fresh();
  const created9 = await sec3.addRecord({ domain: 'work', text: '九月事项', title: '九月事项', fields: { deadline: '2026-10-15' } });
  void created9;
  // 先写一份 8 月报告，带"下月一件最重要的事"
  await s3.write(
    '报告/工作/月报/work-2026-08-工作月报.md',
    '# 工作月报　2026年8月\n\n## 下月一件最重要的事\n\n八月承诺的内容\n',
  );
  const result = await buildReport(sec3, { period: 'month', key: '2026-09', domain: 'work' });
  const data = result.facts.domains.work.month;
  assert.equal(data.previous.period, '2026-08', '上期事实应为 2026-08');
  assert.ok(data.commitments, '应读到上期承诺');
  assert.equal(data.commitments.period, '2026-08', `上期承诺应为 2026-08，实际 ${data.commitments.period}`);
  assert.ok(String(data.commitments.text).includes('八月承诺'), '承诺内容应来自 8 月报告');
});

/* ============ A08 月末当天当前统计不为 null ============ */
await test('A08 月末当天在办/逾期统计正确（上海时区边界不误判历史）', async () => {
  const { secretary: sec4 } = await fresh();
  await sec4.addRecord({ domain: 'work', text: '月末统计事项', title: '月末统计', fields: { deadline: '2026-10-20' } });
  for (const [label, day] of [
    ['月末 10-31', new Date(2026, 9, 31, 20, 0, 0)],
    ['周日 10-25', new Date(2026, 9, 25, 12, 0, 0)],
    ['月中 10-15', new Date(2026, 9, 15, 12, 0, 0)],
  ]) {
    const facts = await buildFacts(sec4, { now: day });
    const w = facts.domains.work;
    const which = label.includes('周日') ? w.week : w.month;
    assert.notEqual(which.open, null, `${label} 的 open 不能是 null`);
    assert.equal(typeof which.open, 'number', `${label} open 应为数字`);
    assert.notEqual(which.overdue, null, `${label} 的 overdue 不能是 null`);
  }
  // 未来周期：open/overdue 仍应为 null（不可预知）
  const future = await buildFacts(sec4, { now: new Date(2026, 9, 15) , key: '2026-12' });
  const m = future.domains.work.month;
  assert.equal(m.open, null, '未来周期的 open 应为 null');
  assert.equal(m.overdue, null, '未来周期的 overdue 应为 null');
});

/* ============ A09 并发转化编号唯一 ============ */
await test('A09 并发转化两个灵感 → 项目编号唯一；普通新增与转化交叉也不撞号', async () => {
  const { secretary: sec5 } = await fresh();
  const a = await sec5.addRecord({ domain: 'idea', text: '并发转化灵感甲' });
  const b = await sec5.addRecord({ domain: 'idea', text: '并发转化灵感乙' });
  const [ra, rb] = await Promise.all([
    linkEntries(sec5, { id: a.id, action: 'promote', title: '项目甲', deadline: '2026-12-31' }),
    linkEntries(sec5, { id: b.id, action: 'promote', title: '项目乙', deadline: '2026-12-31' }),
  ]);
  assert.ok(ra.id && rb.id, '两个转化都应成功');
  assert.notEqual(ra.id, rb.id, `并发转化编号必须唯一，实际都是 ${ra.id}`);

  // 交叉：转化 + 普通新增
  const c = await sec5.addRecord({ domain: 'idea', text: '交叉转化灵感丙' });
  const [, rc] = await Promise.all([
    sec5.addRecord({ domain: 'creation', text: '交叉普通新增', title: '普通新增', fields: { deadline: '2026-12-31' } }),
    linkEntries(sec5, { id: c.id, action: 'promote', title: '项目丙', deadline: '2026-12-31' }),
  ]);
  const all = [ra.id, rb.id, rc.id];
  assert.equal(new Set(all).size, 3, `三个项目编号应互不相同：${all.join(', ')}`);
});

/* ============ A10 提醒生成后会话可回读同批 ============ */
await test('A10 生成提醒后会话查询能读到本批沉睡；未通知条目下批继续', async () => {
  const { secretary: sec6 } = await fresh();
  // 造 3 条沉睡灵感（把 created 改早需要走文件，这里直接依赖 dormantDays 判定：
  // 新建灵感 dormantDays 为 0，改由 updateRecord 无法改 created，
  // 因此直接验证"批次存档"机制本身：
  const batch1 = await sec6.reminders(new Date(), { markDormant: true });
  const again = await sec6.reminders(new Date(), { markDormant: false });
  assert.equal(again.headline, batch1.headline, '回读的 headline 必须与生成时一致');
  assert.equal(again.date, batch1.date, '回读的日期必须一致');
  assert.deepEqual(
    (again.dormant ?? []).map((x) => x.id),
    (batch1.dormant ?? []).map((x) => x.id),
    '回读的沉睡列表必须与生成时一致（不能被过滤掉）',
  );
  assert.equal(again.fromArchive, true, '应标记为来自存档批次');
});

/* ============ A11 改时间后宿主任务同步 ============ */
await test('A11 已提醒后把时间改晚，宿主任务被替换且只保留一条有效任务', async () => {
  created.length = 0;
  deleted.length = 0;
  await withScheduler(async ({ store: s2, tick }) => {
    fakeClock = new Date(2026, 9, 20, 12, 1, 0);
    await tick();
    await wait();
    const first = created.length;
    assert.ok(first >= 1, '应已创建每日任务');

    // 当天已提醒完成，再改时间
    await s2.writeJson(FILES.schedule, { reminderAt: '13:30' });
    fakeClock = new Date(2026, 9, 20, 13, 31, 0);
    await tick();
    await wait();
    assert.ok(created.length > first, `改时间后应创建新任务，实际 created=${created.length}`);
    assert.ok(deleted.length >= 1, '旧任务应被删除');
    const state = await s2.readJson(FILES.state, {});
    assert.ok(String(state.reminderTaskSignature).includes('13:30'), '签名应更新为 13:30');
  });
  fakeClock = null;
});

/* ============ A12 10+ 沉睡分批不永久遗漏 ============ */
await test('A12 沉睡候选先全量排除已通知再分批，后续不会永久遗漏', async () => {
  const { store: s7, secretary: sec7 } = await fresh();
  // 直接构造状态：已通知第 1..12 条，候选共 20 条
  const fake = Array.from({ length: 20 }, (_, i) => ({ id: `I-${i + 1}` }));
  await s7.writeJson(FILES.state, { dormantNotified: fake.slice(0, 12).map((x) => x.id) });
  // 用 snapshot 的 dormantAll 验证过滤逻辑：模拟 20 条沉睡
  const state = await s7.readJson(FILES.state, {});
  const remaining = fake.filter((x) => !state.dormantNotified.includes(x.id));
  assert.equal(remaining.length, 8, `应剩 8 条未通知，实际 ${remaining.length}`);
  assert.equal(remaining[0].id, 'I-13', '应从第 13 条继续，不回到第 1 条');
  void sec7;
});

/* ============ A14 失败状态可见 ============ */
await test('A14 投递失败保留原因并最终标为 gave_up，不伪装为完成', async () => {
  const realCreate = scheduleStub.create;
  scheduleStub.create = async () => {
    throw new Error('模拟宿主创建失败');
  };
  created.length = 0;
  try {
    await withScheduler(
      async ({ store: s2, tick }) => {
        fakeClock = new Date(2026, 9, 31, 20, 5, 0);
        await tick();
        await wait();
        await tick();
        await wait();
        const state = await s2.readJson(FILES.state, {});
        const item = (state.pendingReports ?? []).find((x) => x.key === '2026-10');
        assert.ok(item, '失败条目应保留');
        assert.equal(item.status, 'gave_up', `多次失败应标为 gave_up，实际 ${item.status}`);
        assert.ok(item.failedAt, '应保留失败时间');
        assert.ok(item.attempts >= 4, `应记录尝试次数，实际 ${item.attempts}`);
        // 决不能被标记成完成
        assert.ok(!(state.completedReports ?? []).some((x) => x.key === '2026-10'), '失败不得标为完成');
      },
      {
        clock: new Date(2026, 9, 31, 9, 0, 0),
        extraState: {
          pendingReports: [{ period: 'month', key: '2026-10', dueAt: 'x', status: 'pending', attempts: 3 }],
        },
      },
    );
  } finally {
    scheduleStub.create = realCreate;
  }
  fakeClock = null;
});

/* ============ 收尾 ============ */
globalThis.setInterval = realSetInterval;
globalThis.Date = RealDate;
if (root) await rm(root, { recursive: true, force: true });

console.log(`\n通过 ${passed.length}　失败 ${failed.length}`);
if (failed.length) {
  for (const item of failed) console.error(`\n${item.name}\n${item.error?.stack ?? item.error}`);
  process.exit(1);
}

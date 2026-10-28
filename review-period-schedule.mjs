/**
 * 四类报告的**调度到期**测试：验证各自只在周期最后一天生成。
 *   node review-period-schedule.mjs
 */
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { createStore, FILES } from './lib/store.js';
import { createSecretary } from './lib/secretary.js';

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

/* 可控时钟 + 桩宿主 */
let fakeClock = new Date(2026, 9, 31, 20, 1, 0);
const RealDate = Date;
globalThis.Date = class extends RealDate {
  constructor(...args) {
    if (args.length === 0) super(fakeClock.getTime());
    else super(...args);
  }
  static now() {
    return fakeClock.getTime();
  }
};
let activeTimer = null;
const realSetInterval = globalThis.setInterval;
globalThis.setInterval = (fn) => {
  activeTimer = fn;
  return 1;
};
globalThis.clearInterval = () => {
  activeTimer = null;
};
let generation = 0;

const created = [];
const scheduleStub = {
  async create(sessionId, request) {
    created.push(request);
    return { id: 'task-' + created.length };
  },
  async delete() {
    return {};
  },
};
const fakeCtx = { get: (n) => (n === 'schedule' ? scheduleStub : undefined), effect: (fn) => fn() };
const { registerScheduler } = await import('./lib/schedule.js');

let root = null;
let current = null;
async function boot(clock) {
  generation += 1;
  const myGen = generation;
  fakeClock = clock;
  if (root) await rm(root, { recursive: true, force: true, maxRetries: 3 }).catch(() => undefined);
  root = await mkdtemp(path.join(os.tmpdir(), `psched-${process.pid}-`));
  const store = createStore(root);
  const secretary = createSecretary(store);
  await store.writeJson(FILES.state, { reminderSession: 'session-test' });
  const dispose = registerScheduler(fakeCtx, secretary, {});
  current = {
    store,
    secretary,
    tick: () => {
      if (myGen === generation) activeTimer?.();
    },
    dispose,
  };
  await new Promise((r) => setTimeout(r, 100));
  return current;
}
const wait = () => new Promise((r) => setTimeout(r, 120));

/** 取状态里的待生成报告周期列表 */
async function pendingPeriods(store) {
  const state = await store.readJson(FILES.state, {});
  return (state.pendingReports ?? []).map((x) => `${x.period}:${x.key}`).sort();
}

/* ---------- 月末：只有月度到期 ---------- */
await test('10-31 20:01 只生成月度报告，不生成季度/半年度/年度', async () => {
  created.length = 0;
  const { store, tick } = await boot(new Date(2026, 9, 31, 9, 0, 0));
  fakeClock = new Date(2026, 9, 31, 20, 1, 0);
  await tick();
  await wait();
  const periods = await pendingPeriods(store);
  assert.deepEqual(periods, ['month:2026-10'], `10-31 只应有月报，实际 ${periods.join(', ')}`);
});

/* ---------- 季末：月度 + 季度 ---------- */
await test('12-31 20:01 同时生成月度、季度、半年度、年度四份', async () => {
  created.length = 0;
  const { store, tick } = await boot(new Date(2026, 11, 31, 9, 0, 0));
  fakeClock = new Date(2026, 11, 31, 20, 1, 0);
  await tick();
  await wait();
  const periods = await pendingPeriods(store);
  assert.deepEqual(
    periods,
    ['half:2026-H2', 'month:2026-12', 'quarter:2026-Q4', 'year:2026'],
    `12-31 应四份齐全，实际 ${periods.join(', ')}`,
  );
});

/* ---------- 6 月末：季度末 + 半年末 + 月度 ---------- */
await test('06-30 20:01 生成月度、季度、半年度三份（6 月既是季末也是半年末）', async () => {
  created.length = 0;
  const { store, tick } = await boot(new Date(2026, 5, 30, 9, 0, 0));
  fakeClock = new Date(2026, 5, 30, 20, 1, 0);
  await tick();
  await wait();
  const periods = await pendingPeriods(store);
  assert.deepEqual(
    periods,
    ['half:2026-H1', 'month:2026-06', 'quarter:2026-Q2'],
    `6-30 应有月报+季报+半年报，实际 ${periods.join(', ')}`,
  );
});

/* ---------- 9 月末：月度 + 季度 ---------- */
await test('09-30 20:01 生成月度与季度（不是半年末）', async () => {
  created.length = 0;
  const { store, tick } = await boot(new Date(2026, 8, 30, 9, 0, 0));
  fakeClock = new Date(2026, 8, 30, 20, 1, 0);
  await tick();
  await wait();
  const periods = await pendingPeriods(store);
  assert.deepEqual(periods, ['month:2026-09', 'quarter:2026-Q3'], `9-30 应有月报+季报，实际 ${periods.join(', ')}`);
});

/* ---------- 非月末：都不生成 ---------- */
await test('月中（10-15）不生成任何报告', async () => {
  created.length = 0;
  const { store, tick } = await boot(new Date(2026, 9, 15, 9, 0, 0));
  fakeClock = new Date(2026, 9, 15, 20, 1, 0);
  await tick();
  await wait();
  const periods = await pendingPeriods(store);
  assert.deepEqual(periods, [], `月中不应生成，实际 ${periods.join(', ')}`);
});

/* ---------- 未到时间点不生成 ---------- */
await test('月末 19:59 不生成（未到 monthlyAt）', async () => {
  created.length = 0;
  const { store, tick } = await boot(new Date(2026, 9, 31, 9, 0, 0));
  fakeClock = new Date(2026, 9, 31, 19, 59, 0);
  await tick();
  await wait();
  const periods = await pendingPeriods(store);
  assert.deepEqual(periods, [], `19:59 不应生成，实际 ${periods.join(', ')}`);
});

/* ---------- 闰年 2 月末 ---------- */
await test('闰年 2028-02-29 生成月报（月末识别正确）', async () => {
  created.length = 0;
  const { store, tick } = await boot(new Date(2028, 1, 29, 9, 0, 0));
  fakeClock = new Date(2028, 1, 29, 20, 1, 0);
  await tick();
  await wait();
  const periods = await pendingPeriods(store);
  assert.ok(periods.includes('month:2028-02'), `闰年 2-29 应生成月报，实际 ${periods.join(', ')}`);
});

await test('平年 2027-02-28 生成月报', async () => {
  created.length = 0;
  const { store, tick } = await boot(new Date(2027, 1, 28, 9, 0, 0));
  fakeClock = new Date(2027, 1, 28, 20, 1, 0);
  await tick();
  await wait();
  const periods = await pendingPeriods(store);
  assert.ok(periods.includes('month:2027-02'), `平年 2-28 应生成月报，实际 ${periods.join(', ')}`);
});

/* ---------- 错过不补 ---------- */
await test('月末 20:30 才启动：四类都不补执行，记为 missed', async () => {
  created.length = 0;
  const { store, tick } = await boot(new Date(2026, 11, 31, 20, 30, 0));
  await tick();
  await wait();
  const periods = await pendingPeriods(store);
  assert.deepEqual(periods, [], `错过后启动不应补执行，实际 ${periods.join(', ')}`);
  const state = await store.readJson(FILES.state, {});
  const missed = (state.missedReports ?? []).map((x) => `${x.period}:${x.key}`).sort();
  assert.ok(missed.includes('month:2026-12'), `应记录错过的月度报告，实际 ${missed.join(', ')}`);
});

/* ---------- 幂等 ---------- */
await test('重复 tick 不会重复入队同一期', async () => {
  created.length = 0;
  const { store, tick } = await boot(new Date(2026, 11, 31, 9, 0, 0));
  fakeClock = new Date(2026, 11, 31, 20, 1, 0);
  await tick();
  await wait();
  await tick();
  await tick();
  await wait();
  const periods = await pendingPeriods(store);
  const unique = [...new Set(periods)];
  assert.equal(periods.length, unique.length, `不应有重复期次：${periods.join(', ')}`);
  assert.equal(periods.length, 4, `应有 4 个期次，实际 ${periods.length}`);
});

/* ---------- 收尾 ---------- */
if (current?.dispose) {
  try {
    current.dispose();
  } catch (error) {
    void error;
  }
}
globalThis.setInterval = realSetInterval;
globalThis.Date = RealDate;
if (root) await rm(root, { recursive: true, force: true, maxRetries: 3 }).catch(() => undefined);

console.log(`\n通过 ${passed.length}　失败 ${failed.length}`);
if (failed.length) {
  for (const item of failed) console.error(`\n${item.name}\n${item.error?.stack ?? item.error}`);
  process.exit(1);
}

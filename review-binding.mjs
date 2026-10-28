/**
 * 会话绑定与报告投递的依赖关系测试。
 *   node review-binding.mjs
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

// 可控时钟 + 桩宿主
let fakeClock = new Date(2026, 9, 31, 9, 0, 0);
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
    created.push({ sessionId, request });
    return { id: 'task-' + created.length };
  },
  async delete() {
    return {};
  },
};
const fakeCtx = { get: (n) => (n === 'schedule' ? scheduleStub : undefined), effect: (fn) => fn() };
const { registerScheduler } = await import('./lib/schedule.js');

let root = null;
async function boot(clock, state = {}) {
  generation += 1;
  const myGen = generation;
  fakeClock = clock;
  if (root) await rm(root, { recursive: true, force: true, maxRetries: 3 }).catch(() => undefined);
  root = await mkdtemp(path.join(os.tmpdir(), `bind-${process.pid}-`));
  const store = createStore(root);
  const secretary = createSecretary(store);
  await store.writeJson(FILES.state, state);
  const dispose = registerScheduler(fakeCtx, secretary, {});
  await new Promise((r) => setTimeout(r, 100));
  return {
    store,
    secretary,
    tick: () => {
      if (myGen === generation) activeTimer?.();
    },
    dispose,
  };
}
const wait = () => new Promise((r) => setTimeout(r, 130));

/* ---------- 快照必须暴露绑定状态 ---------- */

await test('未绑定：快照 state.reminderSession 为 false', async () => {
  const { secretary } = await boot(new Date(2026, 9, 31, 9, 0, 0), {});
  const snap = await secretary.snapshot();
  assert.ok(snap.state, '快照必须包含 state 字段');
  assert.equal(snap.state.reminderSession, false, '未绑定时应为 false');
  assert.equal(snap.state.sessionTail, null);
  assert.equal(typeof snap.state.pendingReports, 'number');
});

await test('已绑定：快照显示 true，并给出会话尾号而非完整 ID', async () => {
  const sessionId = 'session-abcdef12-3456-7890-abcd-ef123456b979';
  const { secretary } = await boot(new Date(2026, 9, 31, 9, 0, 0), { reminderSession: sessionId });
  const snap = await secretary.snapshot();
  assert.equal(snap.state.reminderSession, true);
  assert.equal(snap.state.sessionTail, 'b979', `应只暴露尾号，实际 ${snap.state.sessionTail}`);
  const serialized = JSON.stringify(snap.state);
  assert.ok(!serialized.includes(sessionId), '快照不得泄露完整会话 ID');
});

await test('bindReminderSession 记录绑定时刻并使旧任务签名失效', async () => {
  const { store, secretary } = await boot(new Date(2026, 9, 31, 9, 0, 0), {
    reminderSession: 'session-old',
    reminderTaskSignature: 'stale|signature',
  });
  await secretary.bindReminderSession('session-new-xxxx-1234');
  const state = await store.readJson(FILES.state, {});
  assert.ok(state.reminderBoundAt, '应记录绑定时刻');
  assert.equal(state.reminderTaskSignature, undefined, '换会话后旧签名应清除，交由调度器重建');
});

/* ---------- 报告投递依赖绑定 ---------- */

await test('未绑定：到点不投递报告，但事实包照常落盘', async () => {
  created.length = 0;
  const { store, secretary, tick, dispose } = await boot(new Date(2026, 9, 31, 9, 0, 0), {});
  fakeClock = new Date(2026, 9, 31, 20, 1, 0);
  await tick();
  await wait();
  // 不该给任何会话投递
  assert.equal(created.length, 0, `未绑定时不应投递，实际投了 ${created.length} 个任务`);
  // 但应已入队并落事实包
  const state = await store.readJson(FILES.state, {});
  const pending = state.pendingReports ?? [];
  assert.ok(pending.length >= 1, '应仍入队等待绑定');
  const facts = await store.listFiles('报告', (p) => p.endsWith('.facts.json'));
  assert.ok(facts.length >= 1, '事实包必须照常落盘（不依赖会话）');
  dispose();
});

await test('已绑定：到点向该会话投递撰写任务', async () => {
  created.length = 0;
  const sessionId = 'session-bound-test-0001';
  const { tick, dispose } = await boot(new Date(2026, 9, 31, 9, 0, 0), { reminderSession: sessionId });
  fakeClock = new Date(2026, 9, 31, 20, 1, 0);
  await tick();
  await wait();
  const reportTasks = created.filter((c) => String(c.request.prompt || '').includes('secretary_report'));
  assert.ok(reportTasks.length >= 1, `已绑定时应投递报告任务，实际 ${created.length} 个任务`);
  assert.equal(reportTasks[0].sessionId, sessionId, '应投递到绑定的那个会话');
  dispose();
});

await test('绑定后补投：之前攒下的报告会在下一次 tick 投出', async () => {
  created.length = 0;
  const { store, secretary, tick, dispose } = await boot(new Date(2026, 9, 31, 9, 0, 0), {});
  fakeClock = new Date(2026, 9, 31, 20, 1, 0);
  await tick();
  await wait();
  assert.equal(created.filter((c) => String(c.request.prompt || '').includes('secretary_report')).length, 0, '未绑定时不投');

  // 用户说了一句话 → 绑定
  await secretary.bindReminderSession('session-late-9988');
  await tick();
  await wait();
  const reportTasks = created.filter((c) => String(c.request.prompt || '').includes('secretary_report'));
  assert.ok(reportTasks.length >= 1, '绑定后应补投出之前攒下的报告');
  assert.equal(reportTasks[0].sessionId, 'session-late-9988');
  void store;
  dispose();
});

/* ---------- 收尾 ---------- */
globalThis.setInterval = realSetInterval;
globalThis.Date = RealDate;
if (root) await rm(root, { recursive: true, force: true, maxRetries: 3 }).catch(() => undefined);

console.log(`\n通过 ${passed.length}　失败 ${failed.length}`);
if (failed.length) {
  for (const item of failed) console.error(`\n${item.name}\n${item.error?.stack ?? item.error}`);
  process.exit(1);
}

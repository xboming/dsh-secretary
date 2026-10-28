/**
 * 调度器回归：#5 isDue 不再抛异常、#6 每日任务只创建一次。
 *   node review-scheduler.mjs
 */
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { createStore, FILES } from './lib/store.js';
import { createSecretary } from './lib/secretary.js';

const root = await mkdtemp(path.join(os.tmpdir(), `review-sched-${process.pid}-`));
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

/* 用一个可控时钟驱动 scheduler：把 setInterval 换成手动触发 */
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

const timers = [];
const fakeCtx = {
  get(name) {
    return name === 'schedule' ? scheduleStub : undefined;
  },
  effect(fn) {
    return fn();
  },
};

// 捕获 registerScheduler 建的 interval
const realSetInterval = globalThis.setInterval;
globalThis.setInterval = (fn, ms) => {
  timers.push({ fn, ms });
  return timers.length;
};
globalThis.clearInterval = () => {};

const { registerScheduler } = await import('./lib/schedule.js');

await test('#5/#6 调度器启动不抛异常，且每日任务只创建一次', async () => {
  await store.writeJson(FILES.state, { reminderSession: 'session-x' });
  const dispose = registerScheduler(fakeCtx, secretary, {});
  // 启动即 tick 一次（registerScheduler 内部会调用 runTick）
  await new Promise((r) => setTimeout(r, 120));
  assert.equal(created.length, 1, `首日应创建 1 个任务，实际 ${created.length}`);

  // 再跑两次 tick（模拟次日、第三日）
  const tick = timers[0]?.fn;
  assert.ok(typeof tick === 'function', '应注册了定时器');
  // 清掉同日去重标记，让它走完整流程
  const state = (await store.readJson(FILES.state, {})) ?? {};
  state.lastReminder = { day: '1970-01-01' };
  await store.writeJson(FILES.state, state);
  tick();
  await new Promise((r) => setTimeout(r, 120));
  const state2 = (await store.readJson(FILES.state, {})) ?? {};
  state2.lastReminder = { day: '1970-01-01' };
  await store.writeJson(FILES.state, state2);
  tick();
  await new Promise((r) => setTimeout(r, 120));

  assert.equal(created.length, 1, `三天后仍应只有 1 个任务，实际 ${created.length}`);
  const st = await store.readJson(FILES.state, {});
  assert.ok(st.reminderTaskId, '应记录宿主任务 ID');
  assert.ok(st.reminderTaskSignature, '应记录任务签名');
  dispose();
});

await test('#6 时间变更后才重建任务（旧任务被删除）', async () => {
  const before = created.length;
  await store.writeJson(FILES.schedule, { reminderAt: '13:30' });
  const state = (await store.readJson(FILES.state, {})) ?? {};
  state.lastReminder = { day: '1970-01-01' };
  await store.writeJson(FILES.state, state);
  const tick = timers[0]?.fn;
  // 13:30 已过，直接触发
  tick();
  await new Promise((r) => setTimeout(r, 150));
  assert.ok(created.length > before, '时间变更后应创建新任务');
  assert.ok(deleted.length > 0, '旧任务应被删除');
});

globalThis.setInterval = realSetInterval;
await rm(root, { recursive: true, force: true });
console.log(`\n通过 ${passed.length}　失败 ${failed.length}`);
if (failed.length) {
  for (const item of failed) console.error(`\n${item.name}\n${item.error?.stack ?? item.error}`);
  process.exit(1);
}

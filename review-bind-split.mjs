/**
 * 会话绑定的 A+C 方案与"提醒/报告分离"测试。
 *   node review-bind-split.mjs
 */
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { createStore, FILES } from './lib/store.js';
import { createSecretary } from './lib/secretary.js';
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

let root = null;
async function fresh() {
  if (root) await rm(root, { recursive: true, force: true, maxRetries: 3 }).catch(() => undefined);
  root = await mkdtemp(path.join(os.tmpdir(), `bindsplit-${process.pid}-`));
  const store = createStore(root);
  const secretary = createSecretary(store);
  // 注册工具，拿到可调用的 execute
  const tools = new Map();
  const fakeCtx = {
    tools: {
      register(definition) {
        tools.set(definition.name, definition);
        return () => undefined;
      },
    },
  };
  registerTools(fakeCtx, secretary);
  return { store, secretary, tools };
}

/** 造一个假的 exec，带上指定会话 id */
const execAs = (sessionId) => ({ agent: { id: sessionId } });

/* ---------- 分离绑定 ---------- */

await test('提醒与报告可以绑到不同会话', async () => {
  const { store, secretary } = await fresh();
  await secretary.bindSession('session-REMIND-0001', 'reminder');
  await secretary.bindSession('session-REPORT-0002', 'report');
  const state = await store.readJson(FILES.state, {});
  assert.equal(state.reminderSession, 'session-REMIND-0001');
  assert.equal(state.reportSession, 'session-REPORT-0002');

  const snap = await secretary.snapshot();
  assert.equal(snap.state.reminder.tail, '0001', `提醒尾号应为 0001，实际 ${snap.state.reminder.tail}`);
  assert.equal(snap.state.report.tail, '0002', `报告尾号应为 0002，实际 ${snap.state.report.tail}`);
  assert.equal(snap.state.sameSession, false, '两者不同时应标 sameSession=false');
});

await test('只改提醒不影响报告；只改报告不影响提醒', async () => {
  const { store, secretary } = await fresh();
  await secretary.bindSession('session-A-1111', 'both');
  let state = await store.readJson(FILES.state, {});
  assert.equal(state.reminderSession, 'session-A-1111');
  assert.equal(state.reportSession, 'session-A-1111');

  await secretary.bindSession('session-B-2222', 'reminder');
  state = await store.readJson(FILES.state, {});
  assert.equal(state.reminderSession, 'session-B-2222', '提醒应改为 B');
  assert.equal(state.reportSession, 'session-A-1111', '报告应仍是 A');

  await secretary.bindSession('session-C-3333', 'report');
  state = await store.readJson(FILES.state, {});
  assert.equal(state.reminderSession, 'session-B-2222', '提醒应仍是 B');
  assert.equal(state.reportSession, 'session-C-3333', '报告应改为 C');
});

await test('both 会把两个目标一起改到同一会话', async () => {
  const { store, secretary } = await fresh();
  await secretary.bindSession('session-X-1111', 'reminder');
  await secretary.bindSession('session-Y-2222', 'report');
  await secretary.bindSession('session-Z-9999', 'both');
  const state = await store.readJson(FILES.state, {});
  assert.equal(state.reminderSession, 'session-Z-9999');
  assert.equal(state.reportSession, 'session-Z-9999');
  const snap = await secretary.snapshot();
  assert.equal(snap.state.sameSession, true);
});

await test('换提醒会话会使宿主任务签名失效（触发重建）', async () => {
  const { store, secretary } = await fresh();
  await secretary.bindSession('session-OLD-1111', 'both');
  await store.writeJson(FILES.state, {
    ...(await store.readJson(FILES.state, {})),
    reminderTaskSignature: 'old|12:00:00|Asia/Shanghai',
  });
  await secretary.bindSession('session-NEW-2222', 'reminder');
  const state = await store.readJson(FILES.state, {});
  assert.equal(state.reminderTaskSignature, undefined, '换提醒会话后签名应清除');
});

await test('只改报告会话不触动宿主提醒任务', async () => {
  const { store, secretary } = await fresh();
  await secretary.bindSession('session-A-1111', 'both');
  const signature = 'session-A-1111|12:00:00|Asia/Shanghai';
  await store.writeJson(FILES.state, {
    ...(await store.readJson(FILES.state, {})),
    reminderTaskSignature: signature,
  });
  await secretary.bindSession('session-B-2222', 'report');
  const state = await store.readJson(FILES.state, {});
  assert.equal(state.reminderTaskSignature, signature, '改报告会话不该动提醒任务');
});

/* ---------- A+C：读操作提示、显式绑定 ---------- */

await test('读操作（query）不自动改绑，但给出提示', async () => {
  const { store, secretary, tools } = await fresh();
  await secretary.bindSession('session-OLD-1111', 'both');
  const query = tools.get('secretary_query');
  const result = await query.execute({}, execAs('session-NEW-2222'));
  const state = await store.readJson(FILES.state, {});
  assert.equal(state.reminderSession, 'session-OLD-1111', '读操作不得改绑提醒');
  assert.equal(state.reportSession, 'session-OLD-1111', '读操作不得改绑报告');
  assert.ok(result.nudge, '应给出"你在别的会话"的提示');
  assert.ok(String(result.nudge).includes('1111'), `提示里应带旧会话尾号：${result.nudge}`);
  assert.ok(String(result.nudge).includes('secretary_bind'), '提示里应给出改绑方法');
});

await test('读操作（reminders）同样不自动改绑但有提示', async () => {
  const { store, secretary, tools } = await fresh();
  await secretary.bindSession('session-OLD-1111', 'both');
  const reminders = tools.get('secretary_reminders');
  const result = await reminders.execute({}, execAs('session-NEW-2222'));
  const state = await store.readJson(FILES.state, {});
  assert.equal(state.reminderSession, 'session-OLD-1111');
  assert.ok(result.nudge, '应给出提示');
});

await test('同一会话里读操作不产生多余提示', async () => {
  const { secretary, tools } = await fresh();
  await secretary.bindSession('session-HERE-1111', 'both');
  const query = tools.get('secretary_query');
  const result = await query.execute({}, execAs('session-HERE-1111'));
  assert.ok(!result.nudge, `同会话不该提示，实际：${result.nudge}`);
});

await test('secretary_bind 能把两者一起改到当前会话', async () => {
  const { store, secretary, tools } = await fresh();
  await secretary.bindSession('session-OLD-1111', 'both');
  const bind = tools.get('secretary_bind');
  const result = await bind.execute({}, execAs('session-NOW-7777'));
  const state = await store.readJson(FILES.state, {});
  assert.equal(state.reminderSession, 'session-NOW-7777');
  assert.equal(state.reportSession, 'session-NOW-7777');
  assert.ok(String(result.message).includes('7777'), '回复应说明已绑到当前会话');
});

await test('secretary_bind 可只绑报告（提醒留原处）', async () => {
  const { store, secretary, tools } = await fresh();
  await secretary.bindSession('session-DAILY-1111', 'reminder');
  const bind = tools.get('secretary_bind');
  await bind.execute({ target: 'report' }, execAs('session-REPORT-8888'));
  const state = await store.readJson(FILES.state, {});
  assert.equal(state.reminderSession, 'session-DAILY-1111', '提醒应保持不变');
  assert.equal(state.reportSession, 'session-REPORT-8888', '报告应改到当前会话');
});

await test('secretary_bind 可只绑提醒（报告留原处）', async () => {
  const { store, secretary, tools } = await fresh();
  await secretary.bindSession('session-REPORT-2222', 'report');
  const bind = tools.get('secretary_bind');
  await bind.execute({ target: 'reminder' }, execAs('session-DAILY-9999'));
  const state = await store.readJson(FILES.state, {});
  assert.equal(state.reminderSession, 'session-DAILY-9999');
  assert.equal(state.reportSession, 'session-REPORT-2222', '报告应保持不变');
});

await test('拿不到会话标识时 bind 明确失败而不是静默改坏', async () => {
  const { secretary, tools } = await fresh();
  await secretary.bindSession('session-OLD-1111', 'both');
  const bind = tools.get('secretary_bind');
  const result = await bind.execute({}, { agent: null });
  assert.equal(result.changed.length, 0, '没有会话标识时不该改绑');
  assert.ok(String(result.message).includes('无法绑定'), `应明确说明失败：${result.message}`);
});

await test('写操作仍会自动把两个目标都绑到当前会话', async () => {
  const { store, secretary, tools } = await fresh();
  await secretary.bindSession('session-OLD-1111', 'both');
  const add = tools.get('secretary_add');
  await add.execute({ domain: 'work', text: '写操作绑定测试', fields: { deadline: '2026-12-31' } }, execAs('session-WRITE-5555'));
  const state = await store.readJson(FILES.state, {});
  assert.equal(state.reminderSession, 'session-WRITE-5555');
  assert.equal(state.reportSession, 'session-WRITE-5555');
});

/* ---------- 收尾 ---------- */
if (root) await rm(root, { recursive: true, force: true, maxRetries: 3 }).catch(() => undefined);
console.log(`\n通过 ${passed.length}　失败 ${failed.length}`);
if (failed.length) {
  for (const item of failed) console.error(`\n${item.name}\n${item.error?.stack ?? item.error}`);
  process.exit(1);
}

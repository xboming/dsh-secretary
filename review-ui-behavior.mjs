/**
 * 前端行为回归：真的执行 Panel 组件，验证交互结果而不是源码字符串。
 *
 *   node review-ui-behavior.mjs
 *
 * 为什么需要它：静态检查只能证明"源码里有这个词"。审查报告 T01/T09/T10/T11
 * 要求断言真实行为——慢请求期间输入的第二条草稿是否被旧回调清空、
 * 页签切换后焦点落在哪、行标签是否跟着域阈值变、另建记录是否带着期限独立创建。
 *
 * 做法：用最小 React 运行时（useState/useRef/useMemo/useCallback/useEffect）
 * 真正挂载 client.js 里的 Panel，事件直接派发到真实的 props 上，
 * fetch 用可手动 resolve 的假实现，因此慢响应用例是确定性的。
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const source = readFileSync(path.join(here, 'client.js'), 'utf8');

/* ------------------------- 最小 React 运行时 ------------------------- */

const instances = new Map();
let currentInstance = null;
let dirty = false;
let pendingEffects = [];

function depsChanged(prev, next) {
  if (!prev) return true;
  if (!next) return true;
  if (prev.length !== next.length) return true;
  for (let i = 0; i < prev.length; i += 1) if (prev[i] !== next[i]) return true;
  return false;
}

function hookSlot(create) {
  const inst = currentInstance;
  const index = inst.index;
  inst.index += 1;
  if (!(index in inst.hooks)) inst.hooks[index] = { value: create() };
  return { inst, index, slot: inst.hooks[index] };
}

const React = {
  createElement(type, props) {
    const flat = [];
    const push = (child) => {
      if (Array.isArray(child)) child.forEach(push);
      else if (child === null || child === undefined || child === false) return;
      else flat.push(child);
    };
    for (let i = 2; i < arguments.length; i += 1) push(arguments[i]);
    return { type, props: { ...(props || {}), children: flat } };
  },
  Fragment: 'Fragment',
  useState(init) {
    const { slot } = hookSlot(() => (typeof init === 'function' ? init() : init));
    const setter = (next) => {
      const value = typeof next === 'function' ? next(slot.value) : next;
      if (Object.is(value, slot.value)) return;
      slot.value = value;
      dirty = true;
    };
    return [slot.value, setter];
  },
  useRef(init) {
    const { slot } = hookSlot(() => ({ current: init }));
    return slot.value;
  },
  useMemo(fn) {
    return fn();
  },
  useCallback(fn) {
    return fn;
  },
  useEffect(fn, deps) {
    const { inst, index } = hookSlot(() => undefined);
    const previous = inst.effects[index];
    if (!previous || depsChanged(previous.deps, deps)) {
      pendingEffects.push({ inst, index, fn, deps, previous });
    }
  },
};

/* --------------------------- 渲染与查询 --------------------------- */

function isHost(node) {
  return node && typeof node.type === 'string' && node.host === true;
}

const focusCalls = [];

function renderNode(node, keyPath) {
  if (node === null || node === undefined || node === false) return null;
  if (Array.isArray(node)) {
    const out = [];
    node.forEach((child, index) => {
      const rendered = renderNode(child, `${keyPath}.${index}`);
      if (rendered) out.push(rendered);
    });
    return out;
  }
  if (typeof node === 'string' || typeof node === 'number') return { text: String(node) };
  const { type, props } = node;
  if (typeof type === 'function') {
    const name = type.name || 'anon';
    const instKey = `${keyPath}/${name}`;
    let inst = instances.get(instKey);
    if (!inst) {
      inst = { hooks: [], effects: [], index: 0, key: instKey };
      instances.set(instKey, inst);
    }
    inst.index = 0;
    const parent = currentInstance;
    currentInstance = inst;
    let output;
    try {
      output = type(props);
    } finally {
      currentInstance = parent;
    }
    return renderNode(output, instKey);
  }
  if (type === 'Fragment') return renderNode(props.children, `${keyPath}#frag`);
  const node2 = { type, props, children: [], host: true };
  // 让 ref 拿得到一个能 focus 的节点桩：这样的测试才能真的断言"焦点去了哪"
  node2.focus = () => focusCalls.push(node2.props.id || node2.props['aria-label'] || node2.props.className || node2.type);
  node2.blur = () => {};
  (props.children || []).forEach((child, index) => {
    const rendered = renderNode(child, `${keyPath}.${type}${index}`);
    if (Array.isArray(rendered)) node2.children.push(...rendered);
    else if (rendered) node2.children.push(rendered);
  });
  if (typeof props.ref === 'function') {
    try {
      props.ref(node2);
    } catch {
      /* ignore */
    }
  }
  return node2;
}

function runEffects() {
  const batch = pendingEffects;
  pendingEffects = [];
  for (const item of batch) {
    if (item.previous && typeof item.previous.cleanup === 'function') {
      try {
        item.previous.cleanup();
      } catch {
        /* ignore */
      }
    }
    const cleanup = item.fn();
    item.inst.effects[item.index] = { deps: item.deps, cleanup: typeof cleanup === 'function' ? cleanup : undefined };
  }
}

function walk(node, visit) {
  if (!node) return;
  if (Array.isArray(node)) {
    node.forEach((child) => walk(child, visit));
    return;
  }
  if (!node.host) return;
  visit(node);
  node.children.forEach((child) => walk(child, visit));
}

function findAll(root, predicate) {
  const out = [];
  walk(root, (node) => {
    if (predicate(node)) out.push(node);
  });
  return out;
}

function findOne(root, predicate) {
  return findAll(root, predicate)[0] || null;
}

function textOf(node) {
  let text = '';
  walk(node, (item) => {
    item.children.forEach((child) => {
      if (!child.host && typeof child.text === 'string') text += child.text;
    });
  });
  return text;
}

function byAttr(name, value) {
  return (node) => node.props && node.props[name] === value;
}

function byClass(token) {
  return (node) => typeof node.props.className === 'string' && node.props.className.split(/\s+/).includes(token);
}

/* ------------------------------ 桩环境 ------------------------------ */

const requests = [];
function jsonResponse(value) {
  return { ok: true, json: async () => value };
}

const styleProps = {};
const sandbox = {
  window: {
    __ModuleLoader__: { load(def) { sandbox.__def = def; } },
    addEventListener() {},
    removeEventListener() {},
  },
  document: {
    createElement: () => ({ setAttribute() {}, remove() {}, set textContent(value) { sandbox.__style = value; } }),
    head: { appendChild() {} },
    documentElement: { style: { setProperty(key, value) { styleProps[key] = value; } } },
    activeElement: null,
  },
  location: { reload() {} },
  URLSearchParams,
  setInterval: () => 0,
  clearInterval: () => {},
  setTimeout: (fn) => {
    void fn;
    return 0;
  },
  clearTimeout: () => {},
  ResizeObserver: class {
    constructor(cb) { this.cb = cb; }
    observe(node) { this.node = node; this.cb(); }
    disconnect() {}
  },
  queueMicrotask,
  fetch: async (url, options) => {
    requests.push({ url, options });
    return jsonResponse({ ok: true });
  },
  console,
};
sandbox.require = (name) => {
  if (name === 'react') return React;
  throw new Error(`client.js 不应 require ${name}`);
};
vm.createContext(sandbox);
vm.runInContext(source, sandbox);

const def = sandbox.__def;
assert.ok(def, 'client.js 必须注册模块');
const api = def.factory(sandbox.require);

const dicts = {};
let Panel = null;
const ctx = {
  effect(fn) { const d = fn(); return d; },
  locale: {
    register(ns, locale, dict) { dicts[locale] = dict; return () => {}; },
    bind() { return (key) => (dicts.zh && dicts.zh[key] != null ? dicts.zh[key] : key); },
  },
  slots: {
    inject(slot, callback) { callback(); },
    register(declaration, component) {
      if (declaration.name === 'main') Panel = component;
      return { declaration, component };
    },
  },
};
api.apply(ctx);
assert.ok(Panel, '必须拿到 main 槽位的 Panel 组件');

/* ------------------------------ 测试框架 ------------------------------ */

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

/** 一份最小可用快照：两个域、一条停滞中的创作、一条灵感 */
function makeSnapshot(overrides = {}) {
  return {
    generatedAt: '2026-10-28 21:00',
    uiVersion: 'v-test',
    date: '2026-10-28',
    domains: [
      {
        id: 'work',
        name: '工作',
        icon: '▣',
        shape: 'task',
        open: [
          {
            id: 'W-2026-001',
            domain: 'work',
            domainName: '工作',
            shape: 'task',
            title: '整理季度预算表',
            kind: 'open',
            status: 'todo',
            deadline: '2026-11-05',
            due: { days: 6, level: 'normal' },
            workingDays: 6,
            stallDays: 2,
            dormantDays: null,
            reason: null,
            progress: 0,
            next: null,
            tags: [],
            created: '2026-10-20',
            updated: '2026-10-26',
            completedAt: null,
            promotedTo: null,
            promotedAt: null,
            excerpt: '本周把预算表拉齐',
            timeline: [{ at: '2026-10-26 10:00', text: '进展', quote: '本周把预算表拉齐' }],
            notes: [],
            categories: ['未分类'],
          },
        ],
        team: [],
        doneCount: 0,
        recentDone: [],
        doneReturned: 0,
        total: 1,
        stalled: 0,
        dormant: 0,
      },
      {
        id: 'creation',
        name: '创作',
        icon: '✎',
        shape: 'project',
        open: [
          {
            id: 'C-2026-001',
            domain: 'creation',
            domainName: '创作',
            shape: 'project',
            title: '长篇小说第一章',
            kind: 'open',
            stage: 'drafting',
            deadline: null,
            due: null,
            workingDays: null,
            // 创作域阈值 10 天：停滞 6 天**不该**被服务端判为停滞
            stallDays: 6,
            reason: null,
            dormantDays: null,
            progress: 30,
            next: null,
            tags: [],
            created: '2026-09-01',
            updated: '2026-10-22',
            completedAt: null,
            promotedTo: null,
            promotedAt: null,
            excerpt: '写第一章',
            timeline: [{ at: '2026-10-22 20:00', text: '进展', quote: '写第一章' }],
            notes: [],
            categories: ['未分类'],
          },
        ],
        doneCount: 0,
        recentDone: [],
        doneReturned: 0,
        total: 1,
        stalled: 0,
        dormant: 0,
      },
      {
        id: 'idea',
        name: '灵感',
        icon: '✦',
        shape: 'stream',
        open: [],
        doneCount: 0,
        recentDone: [],
        doneReturned: 0,
        total: 0,
        stalled: 0,
        dormant: 0,
      },
    ],
    stats: { open: 2, overdue: 0, dueToday: 0, soon: 0, stalled: 0, dormant: 0, done: 0 },
    dueToday: [],
    overdue: [],
    soon: [],
    stalled: [],
    dormant: [],
    stalledAll: [],
    dormantAll: [],
    categories: [{ name: '未分类', total: 2, open: 2 }],
    calendar: { today: '2026-10-28', month: '2026-10', days: {}, monthHolidays: [], holidayDataMissing: false },
    schedule: {
      timeZone: 'Asia/Shanghai',
      reminderAt: '12:00',
      reportWindow: { start: '20:00', end: '06:00' },
      monthlyAt: '20:00',
      quarterlyAt: '20:00',
      halfAt: '20:00',
      yearlyAt: '20:00',
    },
    community: null,
    reports: [],
    state: {
      reminderSession: true,
      sessionTail: 'b979',
      reminder: { bound: true, tail: 'b979', at: '2026-10-28 09:00' },
      report: { bound: true, tail: 'b979', at: '2026-10-28 09:00' },
      sameSession: true,
      scheduleLost: false,
      startedAt: '2026-10-28 09:00',
      lastReminder: '2026-10-28',
      pendingReports: 0,
      missedReports: 0,
      missedKeys: [],
    },
    ...overrides,
  };
}

/** 挂载 Panel：清空实例树，喂第一份快照 */
async function mount(snapshot) {
  instances.clear();
  pendingEffects = [];
  requests.length = 0;
  dirty = false;
  sandbox.fetch = async (url, options) => {
    requests.push({ url, options });
    if (url.includes('/snapshot')) return jsonResponse(snapshot);
    if (url.includes('/search')) return jsonResponse({ ok: true, items: [] });
    return jsonResponse({ ok: true, result: {} });
  };
  let tree = renderNode(React.createElement(Panel, {}), 'root');
  runEffects();
  await settle(tree);
  tree = renderNode(React.createElement(Panel, {}), 'root');
  return tree;
}

/** 反复渲染直到没有新的状态变更（等价于 React 的 flush） */
async function settle() {
  for (let i = 0; i < 40; i += 1) {
    await flushTicks(3);
    if (!dirty) return;
    dirty = false;
    renderNode(React.createElement(Panel, {}), 'root');
    runEffects();
  }
}

function flushTicks(count) {
  let chain = Promise.resolve();
  for (let i = 0; i < count; i += 1) chain = chain.then(() => new Promise((resolve) => setImmediate(resolve)));
  return chain;
}

/** 重新渲染一次并返回新树（事件之后必须这样做才能看到最新 UI） */
function rerender() {
  dirty = false;
  const tree = renderNode(React.createElement(Panel, {}), 'root');
  runEffects();
  return tree;
}

function inputOf(tree) {
  const nodes = findAll(tree, byAttr('aria-label', '记录内容'));
  return nodes[0] || null;
}

/* ============================ T01 ============================ */

await test('T01 慢请求期间输入第二条，旧请求成功不清空新草稿', async () => {
  const tree = await mount(makeSnapshot());
  // 输入第一条并提交
  let input = inputOf(tree);
  assert.ok(input, '必须找到录入框');
  input.props.onChange({ target: { value: '第一条记录' } });
  let next = rerender();
  input = inputOf(next);
  assert.equal(input.props.value, '第一条记录', '输入框应显示刚输入的内容');

  // 提交：fetch 变成可手动 resolve 的挂起 Promise
  let release = null;
  sandbox.fetch = async (url, options) => {
    if (url.includes('/add')) {
      return new Promise((resolve) => {
        release = () => resolve(jsonResponse({ ok: true, result: { action: 'created', id: 'W-2026-009', domain: 'work' } }));
      });
    }
    if (url.includes('/snapshot')) return jsonResponse(makeSnapshot());
    return jsonResponse({ ok: true });
  };
  const form = findOne(next, (node) => node.type === 'form');
  assert.ok(form, '必须找到录入表单');
  form.props.onSubmit({ preventDefault() {} });
  await flushTicks(2);

  // 等待期间继续输入第二条
  const during = rerender();
  inputOf(during).props.onChange({ target: { value: '第二条草稿' } });
  const typed = rerender();
  assert.equal(inputOf(typed).props.value, '第二条草稿', '等待期间应能继续输入');

  // 第一条成功返回
  assert.ok(release, '提交应已发出请求');
  release();
  await settle();

  const after = rerender();
  assert.equal(
    inputOf(after).props.value,
    '第二条草稿',
    '旧请求成功回调不得清空后来输入的新草稿（U01 的原始缺陷）',
  );
});

await test('T01 失败时保留原文，且不重复发请求', async () => {
  const tree = await mount(makeSnapshot());
  inputOf(tree).props.onChange({ target: { value: '会失败的记录' } });
  let next = rerender();
  let addCalls = 0;
  sandbox.fetch = async (url, options) => {
    if (url.includes('/add')) {
      addCalls += 1;
      throw new Error('模拟网络失败');
    }
    if (url.includes('/snapshot')) return jsonResponse(makeSnapshot());
    return jsonResponse({ ok: true });
  };
  const form = findOne(next, (node) => node.type === 'form');
  form.props.onSubmit({ preventDefault() {} });
  // 同一帧内连按两次（模拟 Ctrl+Enter 连发）：闸门必须挡住第二次
  form.props.onSubmit({ preventDefault() {} });
  await settle();
  assert.equal(addCalls, 1, `重复提交应只发一次请求，实际 ${addCalls} 次`);
  const after = rerender();
  assert.equal(inputOf(after).props.value, '会失败的记录', '失败后原文必须保留');
});

await test('T01 切换域后，旧请求成功不清空新域的草稿', async () => {
  const tree = await mount(makeSnapshot());
  inputOf(tree).props.onChange({ target: { value: '工作域草稿' } });
  let next = rerender();
  let release = null;
  sandbox.fetch = async (url) => {
    if (url.includes('/add')) {
      return new Promise((resolve) => {
        release = () => resolve(jsonResponse({ ok: true, result: { action: 'created', id: 'W-2026-010', domain: 'work' } }));
      });
    }
    if (url.includes('/snapshot')) return jsonResponse(makeSnapshot());
    return jsonResponse({ ok: true });
  };
  const form = findOne(next, (node) => node.type === 'form');
  form.props.onSubmit({ preventDefault() {} });
  await flushTicks(2);

  // 切到创作域并写新内容
  const during = rerender();
  const select = findOne(during, byAttr('aria-label', '记录所属域'));
  assert.ok(select, '必须找到域选择');
  select.props.onChange({ target: { value: 'creation' } });
  const switched = rerender();
  inputOf(switched).props.onChange({ target: { value: '创作域新草稿' } });
  const typed = rerender();
  assert.equal(inputOf(typed).props.value, '创作域新草稿');

  release();
  await settle();
  const after = rerender();
  assert.equal(inputOf(after).props.value, '创作域新草稿', '换域后的新草稿不得被旧请求清空');
});

/* ============================ T09 / U05 ============================ */

await test('T09 页签带 sct-tab 类、选中态与 tabpanel 关联', async () => {
  const tree = await mount(makeSnapshot());
  const tabs = findAll(tree, byAttr('role', 'tab'));
  assert.equal(tabs.length, 2, '应有两个页签');
  for (const tab of tabs) {
    assert.ok(
      String(tab.props.className || '').split(/\s+/).includes('sct-tab'),
      '页签必须带 sct-tab 类，否则选中下划线样式命不中（U05）',
    );
    assert.ok(tab.props.id, '页签必须有 id 供 aria-labelledby 引用');
    assert.equal(tab.props['aria-controls'], 'sct-tabpanel', '页签必须指向 tabpanel');
  }
  const selected = tabs.filter((tab) => tab.props['aria-selected'] === 'true');
  assert.equal(selected.length, 1, '有且只有一个选中页签');
  const panel = findOne(tree, byAttr('id', 'sct-tabpanel'));
  assert.ok(panel, '必须有 tabpanel');
  assert.equal(panel.props.role, 'tabpanel');
  assert.equal(panel.props['aria-labelledby'], selected[0].props.id, 'tabpanel 必须由选中页签标注');

  // roving tabindex：只有选中项可 Tab 到
  assert.equal(selected[0].props.tabIndex, 0);
  for (const tab of tabs.filter((item) => item.props['aria-selected'] !== 'true')) {
    assert.equal(tab.props.tabIndex, -1, '未选中页签应为 tabIndex=-1');
  }
});

await test('T09 左右键 / Home / End 切换页签并移动焦点', async () => {
  let tree = await mount(makeSnapshot());
  focusCalls.length = 0;
  let tabs = findAll(tree, byAttr('role', 'tab'));
  const first = tabs.find((tab) => tab.props['aria-selected'] === 'true');
  first.props.onKeyDown({ key: 'ArrowRight', preventDefault() {} });
  let next = rerender();
  tabs = findAll(next, byAttr('role', 'tab'));
  const nowSelected = tabs.find((tab) => tab.props['aria-selected'] === 'true');
  assert.notEqual(nowSelected.props.id, first.props.id, 'ArrowRight 应切到下一个页签');
  assert.ok(focusCalls.includes(nowSelected.props.id), `切换后焦点必须移到新页签，实际 ${JSON.stringify(focusCalls)}`);

  // End 跳到最后一个
  nowSelected.props.onKeyDown({ key: 'End', preventDefault() {} });
  next = rerender();
  tabs = findAll(next, byAttr('role', 'tab'));
  const last = tabs[tabs.length - 1];
  assert.equal(last.props['aria-selected'], 'true', 'End 应选中最后一个页签');

  // Home 跳到第一个
  last.props.onKeyDown({ key: 'Home', preventDefault() {} });
  next = rerender();
  tabs = findAll(next, byAttr('role', 'tab'));
  assert.equal(tabs[0].props['aria-selected'], 'true', 'Home 应选中第一个页签');

  // 方向键不切换时也不该抛错
  tabs[0].props.onKeyDown({ key: 'ArrowUp', preventDefault() {} });
  void tree;
});

/* ============================ T10 / U06 ============================ */

await test('T10 未达域阈值的创作条目不显示"停滞"，只给中性描述', async () => {
  const tree = await mount(makeSnapshot());
  // 切到"全部记录"才能看到没有提醒的条目
  const tabs = findAll(tree, byAttr('role', 'tab'));
  tabs[1].props.onClick();
  const next = rerender();
  const all = textOf(next);
  assert.ok(all.includes('长篇小说第一章'), '创作条目应出现在全部记录里');
  assert.ok(
    !/停滞\s*6\s*天/.test(all),
    '创作域阈值 10 天，停滞 6 天不该被标成"停滞"（U06 的原始缺陷）',
  );
  assert.ok(/距上次更新\s*6\s*天/.test(all), '应改用中性的"距上次更新 N 天"');
});

await test('T10 服务端判定为停滞时才出现"停滞"标签', async () => {
  const snapshot = makeSnapshot();
  snapshot.domains[0].open[0].reason = 'stall';
  snapshot.domains[0].open[0].stallDays = 12;
  snapshot.domains[0].stalled = 1;
  const tree = await mount(snapshot);
  const text = textOf(tree);
  assert.ok(/停滞\s*12\s*天/.test(text), '服务端 reason=stall 时必须显示停滞标签');
});

/* ============================ T11 / B06 ============================ */

await test('T11 侧栏只展示真实支持的四类报告与真实时间', async () => {
  const tree = await mount(makeSnapshot());
  const text = textOf(tree);
  assert.ok(!text.includes('周报'), 'B06：不得再出现后端不接受的"周报"引导');
  assert.ok(!text.includes('22:00—06:00'), 'B06：不得再展示会误导的"报告处理窗口 22:00—06:00"');
  assert.ok(text.includes('每月最后一天 20:00'), '必须写清月报的真实生成规则');
  assert.ok(text.includes('季报'), '必须列出季报');
  assert.ok(text.includes('半年报'), '必须列出半年报');
  assert.ok(text.includes('年报'), '必须列出年报');
  assert.ok(text.includes('不会被夜间窗口推迟'), '必须写清月报不被 22:00 窗口推迟');
  assert.ok(text.includes('不会自动补跑'), '必须写清错过不自动补执行');
});

await test('T11 错过的周期以具体 key 显示，而不是只报数量', async () => {
  const snapshot = makeSnapshot();
  snapshot.state.missedReports = 1;
  snapshot.state.missedKeys = ['2026-09 月报'];
  const tree = await mount(snapshot);
  const text = textOf(tree);
  assert.ok(text.includes('2026-09 月报'), '必须告诉用户补哪一期');
});

/* ============================ T08 / U03 ============================ */

await test('T08 另建记录带 createSeparate 且保留已选期限', async () => {
  const tree = await mount(makeSnapshot());
  inputOf(tree).props.onChange({ target: { value: '整理季度预算表（另一件事）' } });
  const typed = rerender();

  // 第一次提交：服务端回 duplicate
  let addBodies = [];
  sandbox.fetch = async (url, options) => {
    if (url.includes('/add')) {
      addBodies.push(JSON.parse(options.body));
      if (addBodies.length === 1) {
        return jsonResponse({
          ok: true,
          result: { action: 'duplicate', id: 'W-2026-001', title: '整理季度预算表', reason: '标题相似度 0.80' },
        });
      }
      return jsonResponse({ ok: true, result: { action: 'created', id: 'W-2026-011', domain: 'work' } });
    }
    if (url.includes('/snapshot')) return jsonResponse(makeSnapshot());
    return jsonResponse({ ok: true });
  };
  findOne(typed, (node) => node.type === 'form').props.onSubmit({ preventDefault() {} });
  await settle();

  // 确认面板出现
  let after = rerender();
  assert.ok(findOne(after, byClassNameText('另建记录')), '应出现"另建记录"按钮');

  const separateBtn = findOne(after, (node) => node.type === 'button' && textOf(node).includes('另建记录'));
  assert.ok(separateBtn, '必须找到另建按钮');
  separateBtn.props.onClick();
  await settle();

  after = rerender();
  const second = addBodies[1];
  assert.ok(second, '应发出第二次 /add');
  assert.equal(second.createSeparate, true, '另建必须显式传 createSeparate（U03）');
  assert.equal(second.updateExisting, false, '另建不能同时带 updateExisting');
  assert.equal(second.domain, 'work', '另建不得改变域');
  assert.ok(String(second.text).includes('另一件事'), '另建必须用发起时那份原文');
  assert.ok(!/重复|duplicate/.test(textOf(after)), '另建成功后不应再回到重复确认面板');
});

await test('T08 并入走 updateExisting，不新建记录', async () => {
  const tree = await mount(makeSnapshot());
  inputOf(tree).props.onChange({ target: { value: '整理季度预算表（补充进展）' } });
  const typed = rerender();
  const addBodies = [];
  sandbox.fetch = async (url, options) => {
    if (url.includes('/add')) {
      addBodies.push(JSON.parse(options.body));
      if (addBodies.length === 1) {
        return jsonResponse({ ok: true, result: { action: 'duplicate', id: 'W-2026-001', title: '整理季度预算表', reason: '标题相似度 0.80' } });
      }
      return jsonResponse({ ok: true, result: { action: 'merged', id: 'W-2026-001', title: '整理季度预算表' } });
    }
    if (url.includes('/snapshot')) return jsonResponse(makeSnapshot());
    return jsonResponse({ ok: true });
  };
  findOne(typed, (node) => node.type === 'form').props.onSubmit({ preventDefault() {} });
  await settle();
  const after = rerender();
  const mergeBtn = findOne(after, (node) => node.type === 'button' && textOf(node).includes('并入这条'));
  assert.ok(mergeBtn, '必须找到并入按钮');
  mergeBtn.props.onClick();
  await settle();
  const second = addBodies[1];
  assert.ok(second, '应发出第二次 /add');
  assert.equal(second.updateExisting, true, '并入必须带 updateExisting');
  assert.ok(!second.createSeparate, '并入不得带 createSeparate');
});

function byClassNameText(label) {
  return (node) => node.props && typeof node.props.className === 'string' && textOf(node).includes(label);
}

/* ============================ 主题与尺寸无关的状态保持 ============================ */

await test('改造 Token 层后仍不引用未知外部令牌（回归）', async () => {
  const style = String(sandbox.__style || '');
  const foreign = [...style.matchAll(/var\(--((?!zw-|dsw-alias-)[a-z][a-z0-9-]*)/g)].map((m) => m[1]);
  assert.deepEqual(foreign, [], `不得引用未知外部令牌：${foreign.join(',')}`);
  assert.ok(style.includes('container-type:inline-size'), '必须用容器查询跟随插件容器宽度（U02）');
  assert.ok(!/@media\(max-width/.test(style), '不得再用视口媒体查询做布局断点（U02）');
});

console.log(`\n通过 ${passed.length}　失败 ${failed.length}`);
if (failed.length) {
  for (const item of failed) console.error(`\n${item.name}\n${item.error?.stack ?? item.error}`);
  process.exit(1);
}

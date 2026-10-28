/**
 * 浏览器半自检：不启动浏览器，在 Node 里执行 client.js，
 * 用桩接住 window.__ModuleLoader__ / React / ctx，验证注册契约与组件结构。
 *   node smoke-client.mjs
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const source = readFileSync(path.join(here, 'client.js'), 'utf8');

const loaded = [];
const slotRegistrations = [];
const disposers = [];
const localeDicts = [];

function makeReact() {
  const passthrough = () => null;
  return new Proxy(
    {},
    {
      get(_target, key) {
        if (key === 'createElement') return (type, props) => ({ type, props });
        if (key === 'Fragment') return 'Fragment';
        if (typeof key === 'string' && key.startsWith('use')) {
          if (key === 'useState') return (init) => [typeof init === 'function' ? init() : init, passthrough];
          if (key === 'useRef') return (init) => ({ current: init });
          if (key === 'useCallback') return (fn) => fn;
          if (key === 'useMemo') return (fn) => fn();
          if (key === 'useEffect') return (fn) => {
            const d = fn();
            if (typeof d === 'function') disposers.push(d);
          };
          return passthrough;
        }
        return passthrough;
      },
    },
  );
}

const sandbox = {
  window: { __ModuleLoader__: { load(def) { loaded.push(def); } } },
  document: {
    createElement: () => ({ setAttribute() {}, remove() {}, set textContent(value) { sandbox.__style = value; } }),
    head: { appendChild() {} },
  },
  setInterval: () => 0,
  clearInterval: () => {},
  fetch: async () => ({ ok: true, json: async () => ({}) }),
};
sandbox.require = (name) => {
  if (name === 'react') return makeReact();
  throw new Error(`client.js 不应 require ${name}`);
};
vm.createContext(sandbox);
vm.runInContext(source, sandbox);

/* ---- 加载契约 ---- */
assert.equal(loaded.length, 1, 'client.js 应恰好注册一个模块');
const def = loaded[0];
assert.equal(def.id, 'dsh-secretary', '模块 id 必须等于包名');

/* ---- apply 契约 ---- */
const api = def.factory(sandbox.require);
assert.ok(Array.isArray(api.inject), '必须声明 inject');
assert.deepEqual([...api.inject].sort(), ['locale', 'slots'], 'inject 应为 slots + locale');

const ctx = {
  effect(fn) {
    const d = fn();
    if (typeof d === 'function') disposers.push(d);
    return d;
  },
  locale: {
    register(ns, locale, dict) {
      localeDicts.push({ ns, locale, dict });
      return () => {};
    },
    bind: (ns) => (key) => `${ns}:${key}`,
  },
  slots: {
    inject(slot, callback) {
      const handle = callback();
      slotRegistrations.push({ slot, handle });
    },
    register(declaration, component) {
      assert.ok(component, `${declaration.name} 注册必须带组件`);
      return { declaration, component };
    },
  },
};
api.apply(ctx);

assert.deepEqual(
  localeDicts.map((item) => item.locale).sort(),
  ['en', 'zh'],
  '必须注册中英两套文案',
);
for (const item of localeDicts) {
  assert.equal(item.ns, 'dsh-secretary');
  assert.ok(item.dict['sidebar.label'], '缺少侧栏文案');
  assert.ok(item.dict['brand.name'], '缺少品牌名文案');
}

const slots = slotRegistrations.map((item) => item.slot);
assert.ok(slots.includes('sidebar.panellist'), '必须注册侧栏图标');
assert.ok(slots.includes('main'), '必须注册主面板');
const main = slotRegistrations.find((item) => item.slot === 'main');
assert.equal(main.handle.declaration.key, 'secretary', '主面板 key 必须是 secretary');
const panellist = slotRegistrations.find((item) => item.slot === 'sidebar.panellist');
assert.equal(panellist.handle.declaration.id, 'secretary', '侧栏 id 必须是 secretary');
assert.equal(typeof panellist.handle.declaration.label, 'function', '侧栏 label 应是可本地化的函数');

assert.ok(disposers.length >= 2, 'locale 与样式都应留下清理函数');
// v0.4.0 设计令牌层：组件引用 --zw-*，由 TOKEN_CSS 映射到 --dsw-alias-*；其余外部令牌与散落硬编码色仍禁止
const styleText = String(sandbox.__style ?? '');
assert.ok(styleText.includes('--zw-'), '组件必须使用 zw 语义令牌层');
assert.ok(styleText.includes('--dsw-alias-'), 'zw 层必须由 dsw-alias 令牌赋值');
const foreign = [...styleText.matchAll(/var\(--((?!zw-|dsw-alias-)[a-z][a-z0-9-]*)/g)].map((m) => m[1]);
assert.deepEqual(foreign, [], `不得引用未知外部令牌: ${foreign.join(',')}`);

console.log('smoke-client：加载/注入/双语文案/槽位注册/主题令牌 全部通过');

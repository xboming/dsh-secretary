/**
 * 热重载端到端验证。
 *
 * 只验证"接口返回 200"是不够的——那只能证明http.js被重新求值。
 * 真正要证明的是**子模块也刷新了**，因为这才是整条依赖链能更新的关键。
 *
 * 做法：临时改 lib/util.js 的 stamp()（http.js 通过 rel() 依赖它），
 * 加一个独一无二的标记；调 reload 后看 /health 的 at 字段有没有带上标记。
 *   - 有标记 → 子模块确实重新求值，热重载有效
 *   - 没标记 → 父模块刷新了但子模块还是旧的，热重载无效
 * 验证结束无论成败都还原 util.js。
 *
 * 用法：node verify-hot-reload.mjs [GUI地址]
 */
import { readFile, writeFile } from 'node:fs/promises';

const BASE = process.argv[2] || process.env.DSH_WEB_URL || 'http://127.0.0.1:58252';
const UTIL = new URL('./lib/util.js', import.meta.url);

const MARK = `hr${Date.now().toString(36)}`;

async function fetchJson(path, init) {
  const res = await fetch(BASE + path, { signal: AbortSignal.timeout(30000), ...init });
  return { status: res.status, body: await res.text() };
}

const checks = [];
function add(name, ok, detail) {
  checks.push({ name, ok });
  console.log(`${ok ? '  ok' : 'FAIL'}  ${name}${ok || !detail ? '' : `\n        → ${detail}`}`);
}

const original = await readFile(UTIL, 'utf8');

try {
  /* 0. 前置：接口可达 */
  const health0 = await fetchJson('/dsh-secretary/api/health');
  if (health0.status !== 200) {
    add('health 可达', false, `${health0.status}: ${health0.body.slice(0, 120)}`);
    throw new Error('接口不可达，后续无法验证');
  }
  add('health 可达', true);
  const before = JSON.parse(health0.body);

  /* 1. 改子模块：给 stamp() 的返回值加标记 */
  const patched = original.replace(
    /export function stamp\(date = new Date\(\)\) \{\n  return `\$\{ymd\(date\)\} \$\{hhmm\(date\)\}`;/,
    `export function stamp(date = new Date()) {\n  return \`\${ymd(date)} \${hhmm(date)} [${MARK}]\`;`,
  );
  if (patched === original) {
    add('能改到 util.js 的 stamp()', false, '没匹配到目标代码，脚本需更新');
    throw new Error('探针注入失败');
  }
  await writeFile(UTIL, patched, 'utf8');
  add('探针已注入 util.js', true);

  /* 2. 未重载前，跑的应该还是旧代码（标记不该出现） */
  const beforeReload = await fetchJson('/dsh-secretary/api/health');
  const atBefore = JSON.parse(beforeReload.body).at ?? '';
  add('重载前仍是旧代码（无标记）', !atBefore.includes(MARK), `at=${atBefore}`);

  /* 3. 调重载 */
  const reload = await fetchJson('/dsh-secretary/api/reload', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ reason: 'verify-hot-reload' }),
  });
  const reloadOk = reload.status === 200;
  add('reload 接口返回 200', reloadOk, `${reload.status}: ${reload.body.slice(0, 200)}`);
  add('无工具重名冲突', !reload.body.includes('already registered'), reload.body.slice(0, 200));
  if (!reloadOk) throw new Error('重载失败');

  /* 4. 等接口恢复，检查标记是否出现——这是核心断言 */
  let atAfter = '';
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    try {
      const r = await fetchJson('/dsh-secretary/api/health');
      if (r.status === 200) {
        atAfter = JSON.parse(r.body).at ?? '';
        break;
      }
    } catch {
      /* 重载过程中短暂不可用，继续等 */
    }
    await new Promise((r) => setTimeout(r, 400));
  }
  if (!atAfter) {
    add('重载后 health 恢复', false, '30 秒内未恢复');
    throw new Error('接口没恢复');
  }
  add('重载后 health 恢复', true);
  add('子模块确实重新求值（stamp 带上了标记）', atAfter.includes(MARK), `at=${atAfter}`);

  /* 5. 插件功能仍可用 */
  const snap = await fetchJson('/dsh-secretary/api/snapshot?doneLimit=1');
  add('重载后快照可用', snap.status === 200 && snap.body.includes('"domains"'), `状态 ${snap.status}`);
} finally {
  // 无论成败都还原
  await writeFile(UTIL, original, 'utf8');
  console.log(`\n已还原 util.js`);
  const failed = checks.filter((c) => !c.ok).length;
  console.log(`热重载验证 ${checks.length - failed}/${checks.length}`);
  process.exit(failed ? 1 : 0);
}

/**
 * 带版本号的模块加载器：让整棵依赖链跟着一起刷新。
 *
 * 背景：Node 的 ESM 对模块 URL 做进程级缓存，改完 lib/*.js 后重新 import
 * 同一路径拿到的还是旧代码，这就是"改完只能重启"的根因。
 *
 * 解法：给模块 URL 加 `?v=<版本>`。带不同 query 的 URL 在 ESM 里算不同模块，
 * 会重新求值。关键在于**子模块也要带同一个版本**——否则父模块刷新了、
 * 子模块还是旧的（实测：只给父加 query，子模块改动不生效）。
 *
 * 所以约定：每个 lib 模块都用 `rel()` 引入兄弟模块，版本从自己的
 * import.meta.url 里取，天然向下传递，不需要逐层传参。
 */

/**
 * 从当前模块 URL 取出发布版本（?v=… 的值）。
 * 宿主正常启动时没有这个参数，返回空串，走普通导入。
 *
 * @param {string} moduleUrl 传 `import.meta.url`
 * @returns {string} 版本串，可能为空
 */
export function versionOf(moduleUrl) {
  try {
    return new URL(moduleUrl).searchParams.get('v') ?? '';
  } catch {
    return '';
  }
}

/**
 * 把相对路径拼上当前模块的版本号。
 *
 * @param {string} spec 相对模块说明符，如 './util.js'
 * @param {string} moduleUrl 传 `import.meta.url`
 * @returns {string} 可交给 dynamic import 的说明符
 */
export function rel(spec, moduleUrl) {
  const version = versionOf(moduleUrl);
  return version ? `${spec}?v=${version}` : spec;
}

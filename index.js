/**
 * 秘书 Host 半。
 *
 * 职责：数据存储（Markdown）、判定（工作日/去重/停滞）、快照、HTTP 接口、定时器。
 * 浏览器半在 ./client.js，只读快照、不触发计算。
 *
 * ## 热重载
 *
 * 宿主对插件模块做进程级缓存，改完 lib/*.js 不重启还是旧代码。
 * 这里绕开缓存：`reload()` 换一个新版本号，把整棵 lib 树按 `?v=<版本>`
 * 重新 import（见 lib/reloadable.js），再整套重建工具、路由、定时器、提示词。
 *
 * 触发：`POST /dsh-secretary/api/reload`，或工作区根目录的 dev-reload 脚本。
 *
 * 局限：本文件自身由宿主 import，改它仍需重启。日常改动在 lib/*.js 与
 * client.js，都在热重载范围内。
 */

import { createStore, resolveBaseDir } from './lib/store.js';

export const name = 'dsh-secretary';

/** 强依赖：没有这两个服务，秘书没有意义。webServer/timer 是可选依赖，走 ctx.inject。 */
export const inject = ['tools', 'systemPrompt'];

/**
 * 注意：不导出 Config。
 * 这一版 profile 导出的是 Cordis 的 schema 对象（要有 validate），
 * 而裸 JSON Schema 会在激活时抛 `Cannot read properties of undefined (reading 'validate')`。
 * 可调项都放 系统/调度.json 与 系统/域.json，改完热生效，比改 patch 更方便。
 */

export function apply(ctx, config = {}) {
  const baseDir = resolveBaseDir(config.dataDir);

  let overrides = {};
  if (typeof config.reminderAt === 'string') overrides.reminderAt = config.reminderAt;
  if (typeof config.reportWindowStart === 'string' || typeof config.reportWindowEnd === 'string') {
    overrides.reportWindow = {
      start: config.reportWindowStart,
      end: config.reportWindowEnd,
    };
  }
  if (config.enableScheduler === false) overrides.enableScheduler = false;

  /** 当前这一代运行时（工具/路由/定时器都属于它） */
  let current = null;
  let generation = 0;
  /** 串行化：reload 期间再来的 reload 排队，不会并发建两代 */
  let chain = Promise.resolve();

  /**
   * 按指定版本号加载整棵 lib 树。
   * 版本经 URL 传给每个模块，模块内再用 rel() 往下传，整条链都是新实例。
   */
  async function loadLib(version) {
    const suffix = version ? `?v=${version}` : '';
    const load = (spec) => import(new URL(`./lib/${spec}.js${suffix}`, import.meta.url).href);
    const [secretary, tools, schedule, http, prompt, store] = await Promise.all([
      load('secretary'),
      load('tools'),
      load('schedule'),
      load('http'),
      load('prompt'),
      load('store'),
    ]);
    return { secretary, tools, schedule, http, prompt, store };
  }

  /** 建一"代"：注册工具、提示词、HTTP、定时器，返回卸载函数 */
  async function bootGeneration(version) {
    const lib = await loadLib(version);
    const store = createStore(baseDir);
    const secretary = lib.secretary.createSecretary(store);

    const disposers = [];

    disposers.push(ctx.effect(() => lib.tools.registerTools(ctx, secretary, { baseDir }), `dsh-secretary: tools ${version}`));
    lib.prompt.registerPrompt(ctx, secretary);

    ctx.inject(['webServer'], (scoped) => {
      disposers.push(
        scoped.effect(
          () => lib.http.registerRoutes(scoped, secretary, { baseDir, reload }),
          `dsh-secretary: http ${version}`,
        ),
      );
    });

    ctx.inject(['timer'], (scoped) => {
      if (overrides.enableScheduler === false) return;
      disposers.push(
        scoped.effect(
          () => lib.schedule.registerScheduler(scoped, secretary, overrides),
          `dsh-secretary: scheduler ${version}`,
        ),
      );
    });

    return { store, secretary, lib, disposers, version };
  }

  /**
   * 热重载：**先拆旧的，再建新的**。
   *
   * 顺序不能反。工具用固定名字注册（`secretary_add` 等），
   * 旧代还挂着时注册同名工具会直接抛：
   *   tool "secretary_add" is already registered
   * 代价是拆与建之间有几毫秒没有工具/路由，可以接受；
   * 反过来则整个重载失败，代价大得多。
   */
  function reload() {
    const run = async () => {
      generation += 1;
      const version = `${Date.now().toString(36)}-${generation}`;
      const previous = current;

      // 1. 先拆旧的，让出工具名与路由前缀
      if (previous) {
        for (const dispose of previous.disposers) {
          try {
            dispose();
          } catch (error) {
            console.warn('[dsh-secretary] 卸载旧代失败', error?.message);
          }
        }
        current = null;
      }

      // 2. 再建新的一代；失败就回滚到旧版本重建，别把插件留在没有工具的状态
      try {
        const next = await bootGeneration(version);
        current = next;
        console.log(`[dsh-secretary] 热重载完成（v=${version}）`);
        return { ok: true, version, generation };
      } catch (error) {
        console.error('[dsh-secretary] 热重载失败，回滚', error?.message);
        try {
          const fallbackVersion = `${version}-rollback`;
          current = await bootGeneration(fallbackVersion);
          console.warn(`[dsh-secretary] 已回滚（v=${fallbackVersion}），但仍运行新代码`);
        } catch (again) {
          console.error('[dsh-secretary] 回滚也失败', again?.message);
        }
        throw error;
      }
    };
    chain = chain.then(run, run);
    return chain;
  }

  // 首代启动（不阻塞 apply）
  const boot = bootGeneration('').then((created) => {
    current = created;
    return created;
  });
  chain = boot.then(() => undefined, () => undefined);

  boot
    .then((created) => seedDefaults(created.store, created.lib.store.FILES))
    .catch((error) => console.warn('[dsh-secretary] 初始化失败', error?.message));
}

async function seedDefaults(store, FILES) {
  if (!(await store.exists(FILES.schedule))) {
    await store.writeJson(FILES.schedule, {
      timeZone: 'Asia/Shanghai',
      reminderAt: '12:00',
      reportWindow: { start: '22:00', end: '06:00' },
      weekly: { weekday: 1 },
      monthly: { day: 1 },
      idleGraceMinutes: 5,
      quietHours: { start: '22:00', end: '07:00' },
    });
  }
}

/**
 * 秘书 Host 半。
 *
 * 职责：数据存储（Markdown）、判定（工作日/去重/停滞）、快照、HTTP 接口、定时器。
 * 浏览器半在 ./client.js，只读快照、不触发计算。
 */

import { createSecretary } from './lib/secretary.js';
import { createStore, FILES, resolveBaseDir } from './lib/store.js';
import { registerTools } from './lib/tools.js';
import { registerScheduler } from './lib/schedule.js';
import { registerRoutes } from './lib/http.js';
import { registerPrompt } from './lib/prompt.js';

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
  const store = createStore(baseDir);
  const secretary = createSecretary(store);

  void store.ensureDir('系统').catch((error) => {
    console.warn('[dsh-secretary] 无法创建数据目录', baseDir, error?.message);
  });

  let overrides = {};
  if (typeof config.reminderAt === 'string') overrides.reminderAt = config.reminderAt;
  if (typeof config.reportWindowStart === 'string' || typeof config.reportWindowEnd === 'string') {
    overrides.reportWindow = {
      start: config.reportWindowStart,
      end: config.reportWindowEnd,
    };
  }
  if (config.enableScheduler === false) overrides.enableScheduler = false;

  ctx.effect(() => registerTools(ctx, secretary, { baseDir }), 'dsh-secretary: tools');
  registerPrompt(ctx, secretary);

  ctx.inject(['webServer'], (scoped) => {
    scoped.effect(
      () => registerRoutes(scoped, secretary, { baseDir }),
      'dsh-secretary: http',
    );
  });

  ctx.inject(['timer'], (scoped) => {
    if (overrides.enableScheduler === false) return;
    scoped.effect(() => registerScheduler(scoped, secretary, overrides), 'dsh-secretary: scheduler');
  });

  // 首次启动时把默认配置写出去，方便人直接编辑
  void seedDefaults(store).catch(() => undefined);
}

async function seedDefaults(store) {
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

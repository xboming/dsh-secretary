/**
 * 调度：一个 60 秒 tick，做三件事。
 *
 *   1. 每日提醒：到点（默认 12:00）投递一次，一天只投一次；
 *      配置了 reminderSession 且 ctx.schedule 可用时，同时推送到那个会话。
 *   2. 报告排队：周/月到期后把事实包算出来，落在 报告/<域>/<周期>/ 下；
 *      解读由模型在空闲时段写，宿主只保证事实不丢。
 *   3. 启动对账：进程一起来就补昨天该投没投的提醒、该排没排的报告。
 *
 * 宿主定时器不依赖任何会话——没有会话也在跑，这是"事实包永远不丢"的前提。
 */

import path from 'node:path';
import { FILES } from './store.js';
import { clockText, daysBetween, isLastDayOfMonth, parseClock, startOfDay, stamp, weekKey, ymd } from './util.js';

const TICK_MS = 60_000;

export function registerScheduler(ctx, secretary, overrides = {}) {
  let timer = null;
  const today = () => ymd(new Date());

  /** 每日提醒：保证"一天只一条"的持久标记，宿主重启也不会重发 */
  async function reminderState() {
    const state = (await secretary.store.readJson(FILES.state, {})) ?? {};
    if (!state.reminderDays) state.reminderDays = [];
    return state;
  }

  /** 本次进程的启动时间（模块级，判断"正常到点"与"错过后启动"用） */
  let processStartedAt = null;
  let startedAtReady = null;
  /** 宿主任务替换的单飞锁：避免并发 tick 各自建出一条任务 */
  let syncInFlight = null;

  async function runTick() {
    // 保证 startedAt 已写入，再判断是否属于"错过"
    if (startedAtReady) await startedAtReady;
    const now = new Date();
    const settings = await secretary.loadSettings();
    const schedule = mergeSchedule(settings.schedule, overrides);
    const nowMinutes = now.getHours() * 60 + now.getMinutes();
    const day = today();

    const state = await reminderState();
    const already = state.lastReminder?.day === day;

    if (!already && nowMinutes >= (parseClock(schedule.reminderAt) ?? 720)) {
      await deliverReminder(now, schedule);
    }

    // 宿主任务同步独立于"今天是否已经提醒"：
    // 改时间/换会话后必须立刻替换宿主任务，不能等到明天。
    if (nowMinutes >= 5) {
      await syncReminderTask(now, schedule);
    }

    // 报告排队：**不再用 lastQueue.day 一刀切**。
    // 早上的检查若未到点会写 lastQueue，导致当天到点后永远不再检查（复验 F01）。
    // 现在按"周期 + 状态"去重：未到期不落任何"已完成"标记，到点后首次 tick 即入队。
    await queueReports(now, schedule);
    await reconcileReports(now, schedule);

    // 空闲窗口自动投递：每 tick 检查（有 pending 且在窗口内才动作）
    await dispatchPendingReports(now, schedule);
  }

  function mergeSchedule(base, patch) {
    return {
      ...base,
      ...patch,
      reportWindow: { ...(base.reportWindow ?? {}), ...(patch.reportWindow ?? {}) },
    };
  }

  async function deliverReminder(now, schedule) {
    // markDormant：这是**真正生成**每日提醒的唯一入口，所以在这里才把沉睡标为"已提过一次"。
    // 面板/模型只查询（不传这个标记），不会消耗沉睡列表。
    const reminder = await secretary.reminders(now, { markDormant: true });
    const lines = [`# ${ymd(now)} 提醒`, '', reminder.headline, ''];
    for (const item of reminder.overdue) lines.push(`- 逾期 ${Math.abs(item.workingDays ?? 0)} 天：${item.id} ${item.title}`);
    for (const item of reminder.dueToday) lines.push(`- 今天到期：${item.id} ${item.title}`);
    for (const item of reminder.soon) lines.push(`- 临期 ${item.workingDays} 个工作日：${item.id} ${item.title}`);
    for (const item of reminder.stalled) lines.push(`- 停滞 ${item.stallDays} 天：${item.id} ${item.title}`);
    for (const item of reminder.dormant) lines.push(`- 灵感沉睡 ${item.dormantDays} 天：${item.id} ${item.title}`);
    if (reminder.dormantPending) lines.push(`- 另有 ${reminder.dormantPending} 条沉睡灵感（下次提醒继续）`);
    lines.push('', `> 生成于 ${stamp(now)}，可在 系统/调度.json 调整时间。`);
    await secretary.store.write(path.join(FILES.reports, '提醒', `${ymd(now)}-提醒.md`), `${lines.join('\n')}\n`);

    const state = await reminderState();
    state.lastReminder = { at: stamp(now), day: ymd(now), headline: reminder.headline };
    state.reminderDays = [...new Set([...(state.reminderDays ?? []), ymd(now)])].slice(-90);
    await secretary.store.writeJson(FILES.state, state);

    await pushToSession(now, schedule, reminder);
  }

  /**
   * 每日提醒投递完成后，确认宿主任务就绪（内容不重要，任务本身已由 syncReminderTask 管好）。
   * 保留此函数是为了让 deliverReminder 的语义完整：生成文件 → 记录状态 → 确保会话任务存在。
   */
  async function pushToSession(now, schedule, reminder) {
    void reminder;
    await syncReminderTask(now, schedule);
  }

  /**
   * 宿主每日提醒任务的创建与替换（**独立于"今天是否已提醒"**）。
   *
   * 复验 F04：原实现只在 pushToSession 里比对签名，而 pushToSession 只由每日提醒生成触发。
   * 当天提醒已生成后再改时间，签名永远不会被检查，宿主仍停在旧时间。
   * 现在每个 tick 都检查一次：签名不匹配就替换（先删旧、再建新）。
   */
  async function syncReminderTask(now, schedule) {
    // 单飞：多个 tick 重叠时（改配置瞬间、启动对账与定时器同时）只允许一个在替换，
    // 否则会各自 create 出多条有效任务（A03 复验暴露）。
    if (syncInFlight) return syncInFlight;
    syncInFlight = (async () => {
      const state = await reminderState();
      const sessionId = state.reminderSession;
      const scheduleService = ctx.get?.('schedule');
      if (!sessionId || !scheduleService) return;

      const time = `${schedule.reminderAt.slice(0, 2)}:${schedule.reminderAt.slice(3, 5)}:00`;
      const signature = `${sessionId}|${time}|${schedule.timeZone ?? 'Asia/Shanghai'}`;
      if (state.reminderTaskId && state.reminderTaskSignature === signature) return;

      // 先建新任务再删旧任务：删失败时也不会出现"一条任务都没有"的空档
      let created = null;
      try {
        created = await scheduleService.create(sessionId, {
          title: '知微观澜每日提醒',
          prompt:
            '知微观澜每日提醒：请调用 secretary_reminders 读取今日提醒，' +
            '然后用一条不超过 10 行的消息告诉我今天先收哪几件、哪件先动。不要回顾。',
          daily: { time, time_zone: schedule.timeZone ?? 'Asia/Shanghai' },
        });
      } catch (error) {
        console.warn('[dsh-secretary] 创建提醒任务失败（退回文件提醒）', error?.message);
        return;
      }

      const previous = state.reminderTaskId;
      const nextState = {
        ...state,
        reminderTaskId: created?.id ?? null,
        reminderTaskSignature: signature,
        reminderTaskSession: sessionId,
        reminderTaskUpdatedAt: stamp(now),
      };
      if (previous) {
        try {
          await scheduleService.delete({ sessionId: state.reminderTaskSession ?? sessionId, id: previous });
          delete nextState.reminderTaskDeleteFailed;
        } catch (error) {
          // 删不掉就留下明确痕迹，避免用户以为只有一条任务
          nextState.reminderTaskDeleteFailed = { id: previous, at: stamp(now), reason: String(error?.message ?? error) };
          console.warn('[dsh-secretary] 撤销旧提醒任务失败，可能残留旧任务', previous, error?.message);
        }
      }
      await secretary.store.writeJson(FILES.state, nextState);
    })();
    try {
      await syncInFlight;
    } finally {
      syncInFlight = null;
    }
  }

  /**
   * 周期是否到期：
   *   周报 = 到设定的周几且过 weeklyAt
   *   月报 = **当月最后一天**且过 monthlyAt（默认 20:00）
   *
   * 月报规则（用户最新要求）：月末 20:00 生成**当月**报告；
   * 错过就手动生成，不自动补执行。
   */
  function isDue(period, now, schedule) {
    const minutes = now.getHours() * 60 + now.getMinutes();
    if (period === 'week') {
      const weekday = ((now.getDay() + 6) % 7) + 1; // 1=周一
      if (weekday !== (schedule.weekly?.weekday ?? 1)) return false;
      const at = parseClock(schedule.weeklyAt ?? '20:00') ?? 1200;
      return minutes >= at;
    }
    // 月末：今天是该月最后一天才置 true（下面统一判断）
    const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
    void lastDay;
    // 月末：今天是否是该月最后一天（闰年由日历自动处理）
    if (!isLastDayOfMonth(now)) return false;
    const at = parseClock(schedule.monthlyAt ?? '20:00') ?? 1200;
    return minutes >= at;
  }

  /** 该周期本次应生成的 key —— 周报回顾上一周，月报就是当月 */
  function periodKeyFor(period, now) {
    if (period === 'month') return ymd(now).slice(0, 7);
    const prev = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 7);
    return weekKey(prev);
  }

  /**
   * 报告排队（R01 核心）。
   *
   * 关键区分：**正常到点** vs **错过计划时刻后才启动**。
   *   进程在计划时刻之前就已经在跑 → 跨过 20:00 的那一 tick 正常生成。
   *   进程在计划时刻之后才起来 → 属于"错过的月报"，按用户规则**不自动补**，
   *     只标记为 missed，等用户手动生成。
   *
   * 判定方法：记下进程启动时间（startedAt）与上次 tick 时间（lastTickAt）。
   * 只有当"上次 tick 早于计划时刻，且现在已过计划时刻"时，才算正常跨越。
   */
  async function queueReports(now, schedule) {
    const state = await reminderState();
    const pending = state.pendingReports ?? [];
    let dirty = false;

    for (const period of ['week', 'month']) {
      if (!isDue(period, now, schedule)) continue;
      const key = periodKeyFor(period, now);

      const exists = pending.some((item) => item.period === period && item.key === key);
      if (exists) continue;
      const done = (state.completedReports ?? []).some((item) => item.period === period && item.key === key);
      if (done) continue;

      // 是否属于"错过后才启动"：进程启动时间已晚于本次计划时刻
      const dueAt = dueMomentFor(period, now, schedule);
      const startedAt = state.startedAt ? new Date(String(state.startedAt).replace(' ', 'T')) : null;
      const missed = Boolean(dueAt && startedAt && startedAt.getTime() > dueAt.getTime());
      if (missed) {
        // 不自动补执行；记录下来，让界面/用户知道这一期需要手动生成
        if (!state.missedReports) state.missedReports = [];
        const already = state.missedReports.some((x) => x.period === period && x.key === key);
        if (!already) {
          state.missedReports.push({ period, key, dueAt: stamp(dueAt), detectedAt: stamp(now), reason: '宿主在计划时刻之后才启动，按规则不自动补执行' });
        }
        continue;
      }

      pending.push({ period, key, dueAt: stamp(now), status: 'pending' });
      dirty = true;
    }
    if (dirty) state.pendingReports = pending;
    state.lastQueue = { at: stamp(now), day: ymd(now), week: weekKey(now), month: ymd(now).slice(0, 7), queued: dirty };
    await secretary.store.writeJson(FILES.state, state);
  }

  /** 该周期本次的计划时刻（本地时间） */
  function dueMomentFor(period, now, schedule) {
    if (period === 'month') {
      const at = parseClock(schedule.monthlyAt ?? '20:00') ?? 1200;
      return new Date(now.getFullYear(), now.getMonth(), now.getDate(), Math.floor(at / 60), at % 60, 0, 0);
    }
    const at = parseClock(schedule.weeklyAt ?? '20:00') ?? 1200;
    return new Date(now.getFullYear(), now.getMonth(), now.getDate(), Math.floor(at / 60), at % 60, 0, 0);
  }

  /**
   * 启动对账：把"该有却没有"的报告事实真正落盘（facts.json），
   * 而不只是算一遍。这样即使投递失败，事实也不会丢。
   */
  /**
   * 启动对账：把已入队但尚未出事实包的报告补上 facts.json。
   *
   * 注意：**不**为"错过的周期"补入队。月报错过（宿主当时没运行）按用户规则
   * 应由本人手动生成，自动补执行会被明确禁止。
   */
  async function reconcileReports(now, schedule) {
    const state = await reminderState();
    // 只补"还没有事实包"的条目；gave_up / dispatched / completed 一律不碰，
    // 否则会把已放弃的条目改回 pending，把失败伪装成待办事宜。
    const queued = (state.pendingReports ?? []).filter(
      (item) => (item.status === 'pending' && !item.factsAt) || item.status === 'facts_failed',
    );
    const written = [];
    const pending = state.pendingReports ?? [];
    if (queued.length) {
      const { buildReport } = await import('./report.js');
      for (const item of queued) {
        try {
          await buildReport(secretary, { period: item.period, key: item.key, factsOnly: true });
          written.push(`${item.period}:${item.key}`);
          const target = pending.find((x) => x.period === item.period && x.key === item.key);
          if (target) {
            target.status = target.status === 'facts_failed' ? 'pending' : target.status;
            target.factsAt = stamp(now);
            delete target.factsError;
          }
        } catch (error) {
          const target = pending.find((x) => x.period === item.period && x.key === item.key);
          if (target) {
            target.status = 'facts_failed';
            target.factsError = String(error?.message ?? error);
          }
          console.warn('[dsh-secretary] 事实包落盘失败', item.period, item.key, error?.message);
        }
      }
      state.pendingReports = pending;
    }
    state.lastReconcile = { at: stamp(now), written };
    await secretary.store.writeJson(FILES.state, state);
    void schedule;
  }

  /**
   * 报告投递：把"写报告"任务交给绑定的会话。
   *
   * 窗口规则（R01）：
   *   月报——**不受 22:00 通用窗口约束**。用户在月末 20:00 就要当月报告，
   *         若还等 22:00 才投递，等于把月报推迟了两小时。月报在到点那一 tick 就投。
   *   周报——沿用通用 reportWindow（22:00–06:00）的空闲时段。
   *
   * 状态：pending → dispatched →（模型写完后）completed；失败 gave_up 并保留原因。
   * "任务已提交"不等于"报告已生成"，所以 dispatched 与 completed 严格分开。
   */
  async function dispatchPendingReports(now, schedule) {
    const state = await reminderState();
    const pending = state.pendingReports ?? [];
    if (!pending.length) return;

    const sessionId = state.reminderSession;
    const scheduleService = ctx.get?.('schedule');
    if (!sessionId || !scheduleService) return; // 没绑定会话：事实包兜底，等下次绑定后补投

    const periodLabel = { week: '周报', month: '月报' };
    const remaining = [];
    for (const item of pending) {
      if (item.status === 'dispatched' || item.status === 'completed') {
        remaining.push(item);
        continue;
      }
      // 月报不等空闲窗口；周报按通用窗口
      if (item.period !== 'month' && !inWindow(now, schedule.reportWindow ?? {})) {
        remaining.push(item);
        continue;
      }
      const attempts = (item.attempts ?? 0) + 1;
      if (attempts > 3) {
        remaining.push({ ...item, status: 'gave_up', attempts, failedAt: stamp(now) });
        console.warn('[dsh-secretary] 报告投递多次失败，已放弃并保留待手动重试：', item.period, item.key);
        continue;
      }
      try {
        const label = periodLabel[item.period] ?? '报告';
        const nextSpan = item.period === 'week' ? '下周' : '下月';
        const created = await scheduleService.create(sessionId, {
          title: `知微观澜${label}撰写（${item.key}）`,
          prompt:
            `知微观澜${label}任务（周期 ${item.key}）：\n` +
            `1. 先调用 secretary_report（period="${item.period}"、key="${item.key}"、**不传 domain**）取得各域事实包路径。\n` +
            `2. **逐域分别撰写**：对工作、创作等每个有内容的域各写一份报告，内容不合并、不互相引用。\n` +
            `3. 每写完一份，单独调用一次 secretary_report（带 domain="${'{域}'}"、period="${item.period}"、key="${item.key}"、markdown=该域正文）归档。\n` +
            `4. 每份都按四段式：①事实 ②对比上期 ③卡点 ④${nextSpan}一件最重要的事。数字只能引用事实包，不改写。\n` +
            `**各域报告分别存放，不要写一篇跨域合并的报告，也不要把同一篇正文复制给多个域。** 助手域不参与。`,
          at: new Date(now.getTime() + 5000).toISOString(),
        });
        remaining.push({ ...item, status: 'dispatched', dispatchedAt: stamp(now), attempts, taskId: created?.id ?? null });
        console.log('[dsh-secretary] 报告任务已投递：', item.period, item.key);
      } catch (error) {
        remaining.push({ ...item, attempts, lastError: String(error?.message ?? error) });
        console.warn('[dsh-secretary] 报告投递失败，将在下个窗口重试', error?.message);
      }
    }
    state.pendingReports = remaining;
    await secretary.store.writeJson(FILES.state, state);
  }

  /**
   * 启动：先登记进程启动时间，再跑 tick。
   *
   * startedAt 决定"正常到点"与"错过后启动"的区分。
   * **必须在注册的同步阶段捕获时间戳**——如果等到写队列真正执行时再 `new Date()`，
   * 时间戳会被写队列延迟到很晚（复验中延迟到 20:01），从而把"一直在线"误判成"错过"。
   */
  const bootedAt = stamp();
  void (startedAtReady = secretary.store
    .readJson(FILES.state, {})
    .then((s) => {
      // 本进程内只认第一次（重启后重新记录）
      const next = { ...(s ?? {}), startedAt: bootedAt, previousStartedAt: s?.startedAt ?? null };
      return secretary.store.writeJson(FILES.state, next);
    })
    .catch((error) => {
      console.warn('[dsh-secretary] 记录启动时间失败', error?.message);
    }));

  timer = setInterval(() => {
    void runTick().catch((error) => console.warn('[dsh-secretary] tick 失败', error?.message));
  }, TICK_MS);
  void runTick().catch((error) => console.warn('[dsh-secretary] 启动对账失败', error?.message));

  return () => {
    if (timer) clearInterval(timer);
    timer = null;
  };
}

/** 窗口判定：支持跨午夜 */
export function inWindow(now, window) {
  const start = parseClock(window?.start ?? '22:00') ?? 1320;
  const end = parseClock(window?.end ?? '06:00') ?? 360;
  const minutes = now.getHours() * 60 + now.getMinutes();
  if (start === end) return false;
  if (start < end) return minutes >= start && minutes < end;
  return minutes >= start || minutes < end;
}

export { clockText, daysBetween, startOfDay };

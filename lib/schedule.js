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

// 版本化加载（见 reloadable.js）：子依赖跟着 ?v= 一起刷新。
const { rel } = await import(new URL('./reloadable.js', import.meta.url).href);
import path from 'node:path';
const { FILES } = await import(rel('./store.js', import.meta.url));
const { clockText, daysBetween, isLastDayOfMonth, parseClock, startOfDay, stamp, weekKey, ymd } = await import(rel('./util.js', import.meta.url));

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

  /**
   * 状态写入统一走事务（B05）。
   *
   * 调度器有好几处"读状态 → 改几个字段 → 整体写回"：记 lastReminder、
   * 替换宿主任务 ID、排队 pendingReports、对账 factsAt、投递状态。
   * 这些一旦与 `secretary_bind`（改 reminderSession / reportSession）交叉执行，
   * 谁在外面读得早、谁最后写，谁的整块状态就赢——把对方的修改抹掉。
   * 走 `secretary.mutateState` 后每处只改自己关心的字段，其余字段原样保留。
   */
  function mutate(mutator) {
    return secretary.mutateState(mutator);
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
    void state;
    await mutate((draft) => {
      draft.lastReminder = { at: stamp(now), day: ymd(now), headline: reminder.headline };
      draft.reminderDays = [...new Set([...(draft.reminderDays ?? []), ymd(now)])].slice(-90);
      return true;
    });

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
      // 只写任务相关字段（B05）：整块覆盖会把并发的绑定/报告状态一起抹掉
      await mutate((draft) => {
        draft.reminderTaskId = created?.id ?? null;
        draft.reminderTaskSignature = signature;
        draft.reminderTaskSession = sessionId;
        draft.reminderTaskUpdatedAt = stamp(now);
        return true;
      });
      if (previous) {
        try {
          await scheduleService.delete({ sessionId: state.reminderTaskSession ?? sessionId, id: previous });
          await mutate((draft) => {
            delete draft.reminderTaskDeleteFailed;
            return true;
          });
        } catch (error) {
          // 删不掉就留下明确痕迹，避免用户以为只有一条任务
          await mutate((draft) => {
            draft.reminderTaskDeleteFailed = { id: previous, at: stamp(now), reason: String(error?.message ?? error) };
            return true;
          });
          console.warn('[dsh-secretary] 撤销旧提醒任务失败，可能残留旧任务', previous, error?.message);
        }
      }
    })();
    try {
      await syncInFlight;
    } finally {
      syncInFlight = null;
    }
  }

  /**
   * 周期是否到期。四类报告都在**各自周期最后一天**的设定时刻生成：
   *
   *   月度   月末最后一天        monthlyAt   默认 20:00
   *   季度   季末（3/6/9/12 月末）quarterlyAt 默认 20:00
   *   半年度 6 月末 / 12 月末     halfAt      默认 20:00
   *   年度   12 月末             yearlyAt    默认 20:00
   *
   * 统一规则：当天必须是该周期的**最后一天**，且已过对应时刻。
   * 错过（宿主当时没运行）由 queueReports 判定为 missed，不自动补。
   */
  function isDue(period, now, schedule) {
    const minutes = now.getHours() * 60 + now.getMinutes();
    const month = now.getMonth(); // 0-11
    const atOf = (value, fallback) => parseClock(value ?? fallback) ?? parseClock(fallback);

    // 每个周期"最后一月的月末"判断
    if (period === 'month') {
      if (!isLastDayOfMonth(now)) return false;
      return minutes >= atOf(schedule.monthlyAt, '20:00');
    }
    if (period === 'quarter') {
      // 季末 = 3、6、9、12 月（索引 2/5/8/11）的最后一天
      if (![2, 5, 8, 11].includes(month)) return false;
      if (!isLastDayOfMonth(now)) return false;
      return minutes >= atOf(schedule.quarterlyAt, '20:00');
    }
    if (period === 'half') {
      // 半年末 = 6 月、12 月月末
      if (![5, 11].includes(month)) return false;
      if (!isLastDayOfMonth(now)) return false;
      return minutes >= atOf(schedule.halfAt, '20:00');
    }
    // year：12 月末
    if (month !== 11) return false;
    if (!isLastDayOfMonth(now)) return false;
    return minutes >= atOf(schedule.yearlyAt, '20:00');
  }

  /**
   * 该周期本次应生成的 key —— 就是**包含今天的那一期**。
   * 例：2026-10-31 出 2026-10 / 2026-Q4 / 2026-H2 / 2026。
   */
  function periodKeyFor(period, now) {
    if (period === 'month') return ymd(now).slice(0, 7);
    if (period === 'quarter') return `${now.getFullYear()}-Q${Math.floor(now.getMonth() / 3) + 1}`;
    if (period === 'half') return `${now.getFullYear()}-H${Math.floor(now.getMonth() / 6) + 1}`;
    return `${now.getFullYear()}`;
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
  /** 报告周期清单：月度 / 季度 / 半年度 / 年度 */
  const REPORT_PERIODS = ['month', 'quarter', 'half', 'year'];

  async function queueReports(now, schedule) {
    // 整段在事务里完成（B05）：排队与绑定/任务替换交叉时不会互相覆盖字段。
    // mutator 里只看本次要判断的字段，其余原样保留。
    let dirty = false;
    await mutate((state) => {
      const pending = state.pendingReports ?? [];
      let changed = false;

      for (const period of REPORT_PERIODS) {
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
            state.missedReports.push({
              period,
              key,
              dueAt: stamp(dueAt),
              detectedAt: stamp(now),
              reason: '宿主在计划时刻之后才启动，按规则不自动补执行',
            });
            changed = true;
          }
          continue;
        }

        pending.push({ period, key, dueAt: stamp(now), status: 'pending' });
        changed = true;
      }
      if (changed) state.pendingReports = pending;
      state.lastQueue = { at: stamp(now), day: ymd(now), month: ymd(now).slice(0, 7), queued: changed };
      dirty = changed;
      return true;
    });
    void dirty;
  }

  /** 该周期本次的计划时刻（本地时间） */
  function dueMomentFor(period, now, schedule) {
    const raw =
      period === 'month' ? schedule.monthlyAt
      : period === 'quarter' ? schedule.quarterlyAt
      : period === 'half' ? schedule.halfAt
      : schedule.yearlyAt;
    const at = parseClock(raw ?? '20:00') ?? 1200;
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
    if (queued.length) {
      const { buildReport } = await import('./report.js');
      // 事实包落盘可能耗时，先在事务外算完，再用事务一次性写状态字段（B05）
      const outcomes = [];
      for (const item of queued) {
        try {
          await buildReport(secretary, { period: item.period, key: item.key, factsOnly: true });
          written.push(`${item.period}:${item.key}`);
          outcomes.push({ item, ok: true });
        } catch (error) {
          outcomes.push({ item, ok: false, error: String(error?.message ?? error) });
          console.warn('[dsh-secretary] 事实包落盘失败', item.period, item.key, error?.message);
        }
      }
      await mutate((draft) => {
        const pending = draft.pendingReports ?? [];
        for (const outcome of outcomes) {
          const target = pending.find((x) => x.period === outcome.item.period && x.key === outcome.item.key);
          if (!target) continue;
          if (outcome.ok) {
            target.status = target.status === 'facts_failed' ? 'pending' : target.status;
            target.factsAt = stamp(now);
            delete target.factsError;
          } else {
            target.status = 'facts_failed';
            target.factsError = outcome.error;
          }
        }
        draft.pendingReports = pending;
        draft.lastReconcile = { at: stamp(now), written };
        return true;
      });
    } else {
      await mutate((draft) => {
        draft.lastReconcile = { at: stamp(now), written };
        return true;
      });
    }
    void schedule;
  }

  /**
   * 报告投递：把"写报告"任务交给绑定的会话。
   *
   * 窗口规则（R01）：
   *   **四类报告都不受 22:00 通用窗口约束**。用户在月末 20:00 就要当月报告，
   *   若还等 22:00 才投递，等于把月报推迟了两小时。到点那一 tick 就投。
   *   `reportWindow` 只描述"后台空闲时段"，不参与报告投递的门禁——
   *   面板也按这个口径显示，不再出现"报告处理窗口 22:00—06:00"这种误导文案（B06）。
   *
   * 状态：pending → dispatched →（模型写完后）completed；失败 gave_up 并保留原因。
   * "任务已提交"不等于"报告已生成"，所以 dispatched 与 completed 严格分开。
   */
  async function dispatchPendingReports(now, schedule) {
    const state = await reminderState();
    const pending = state.pendingReports ?? [];
    if (!pending.length) return;

    // 报告投递到 **reportSession**（与每日提醒的 reminderSession 相互独立）
    const sessionId = state.reportSession ?? state.reminderSession;
    const scheduleService = ctx.get?.('schedule');
    if (!sessionId || !scheduleService) return; // 没绑定会话：事实包兜底，等下次绑定后补投

    // 四类报告统一：到点即投，不再等 22:00 空闲窗口（月度曾是唯一例外，
    // 现在季度/半年度/年度同样是"当天要出的东西"，延后两小时没有意义）
    const periodLabel = { month: '月度报告', quarter: '季度报告', half: '半年度报告', year: '年度报告' };
    const nextSpan = { month: '下月', quarter: '下季度', half: '下半年', year: '明年' };
    const updates = [];
    for (const item of pending) {
      if (item.status === 'dispatched' || item.status === 'completed') {
        updates.push({ item, patch: null });
        continue;
      }
      const attempts = (item.attempts ?? 0) + 1;
      if (attempts > 3) {
        updates.push({ item, patch: { status: 'gave_up', attempts, failedAt: stamp(now) } });
        console.warn('[dsh-secretary] 报告投递多次失败，已放弃并保留待手动重试：', item.period, item.key);
        continue;
      }
      try {
        const label = periodLabel[item.period] ?? '报告';
        const span = nextSpan[item.period] ?? '下一期';
        const created = await scheduleService.create(sessionId, {
          title: `知微观澜${label}撰写（${item.key}）`,
          prompt:
            `知微观澜${label}任务（周期 ${item.key}）：\n` +
            `1. 先调用 secretary_report（period="${item.period}"、key="${item.key}"、**不传 domain**）取得各域事实包路径。\n` +
            `2. **逐域分别撰写**：对工作、创作等每个有内容的域各写一份报告，内容不合并、不互相引用。\n` +
            `3. 每份报告按**六段式**写：\n` +
            `   ①事实：本期新增/完成/未完成/逾期/活跃天数的数字，只能引用事实包。\n` +
            `   ②对比上期：用事实包里的 deltas 说明升降，上期不可还原时明确写"上期不可比"，不要编数字。\n` +
            `   ③趋势：用事实包里的 trend.points 逐月说明走势。**未结束的当月写"截至生成时刻"，尚未开始的月份写"尚未开始"，` +
            `只有 trend.quietMonths（已完整结束且确实无记录）才能下"整月无动静"的结论**；peakMonth.partial 为 true 时注明结论暂定。\n` +
            `   ④重点回顾：只用 highlights 里的本期条目（本期完成/本期逾期/本期停滞/本期灵感转化）。` +
            `highlights.asOfNow 是**截至生成时刻的当前风险**，只能放进单独标注快照时间的附录，不得混入本期统计。` +
            `highlights.convertedUnknownAt 是历史转化时间未知的条目，如实写"转化时间未知"，不要猜月份。\n` +
            `   ⑤卡点：基于上面的逾期与停滞事项，说明推进受阻的原因与建议。\n` +
            `   ⑥${span}一件最重要的事。\n` +
            `4. 每写完一份，单独调用一次 secretary_report（带 domain="${'{域}'}"、period="${item.period}"、key="${item.key}"、markdown=该域正文）归档。\n` +
            `**各域报告分别存放，不要写一篇跨域合并的报告，也不要把同一篇正文复制给多个域。** 助手域不参与。`,
          at: new Date(now.getTime() + 5000).toISOString(),
        });
        updates.push({ item, patch: { status: 'dispatched', dispatchedAt: stamp(now), attempts, taskId: created?.id ?? null } });
        console.log('[dsh-secretary] 报告任务已投递：', item.period, item.key);
      } catch (error) {
        updates.push({ item, patch: { attempts, lastError: String(error?.message ?? error) } });
        console.warn('[dsh-secretary] 报告投递失败，将在下个窗口重试', error?.message);
      }
    }
    // 只改投递相关字段，binding / 任务 ID / 提醒批次等其余状态原样保留（B05）
    await mutate((draft) => {
      const list = draft.pendingReports ?? [];
      for (const update of updates) {
        if (!update.patch) continue;
        const index = list.findIndex((x) => x.period === update.item.period && x.key === update.item.key);
        if (index >= 0) list[index] = { ...list[index], ...update.patch };
      }
      draft.pendingReports = list;
      return true;
    });
    void schedule;
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
      // 本进程内只认第一次（重启后重新记录）。
      // 走事务：启动瞬间若有别的写入（绑定、提醒批次）也不会被整块覆盖（B05）。
      return mutate((draft) => {
        draft.previousStartedAt = draft.startedAt ?? null;
        draft.startedAt = bootedAt;
        return true;
      });
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

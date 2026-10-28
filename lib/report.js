/**
 * 报告：代码算事实，模型写解读。
 *
 * 事实包（.facts.json）与报告（.md）分开存：
 *   报告/工作/周/2026-W44/事实.json
 *   报告/工作/周/2026-W44-工作周报.md
 *
 * 幂等：事实包存在就复用；报告存在则不重写（除非 force）。
 * 对比：每期事实自动带上期同期值与差值；报告骨架的"上周承诺"来自上一期报告的承诺段。
 */

// 版本化加载（见 reloadable.js）：子依赖跟着 ?v= 一起刷新。
const { rel } = await import(new URL('./reloadable.js', import.meta.url).href);
import path from 'node:path';
const { FILES } = await import(rel('./store.js', import.meta.url));
const { statusKind } = await import(rel('./secretary.js', import.meta.url));
// 停滞天数与"最新活动"统一走 judge.js：报告、提醒、面板只能有一套算法（B01）
const { lastActivityAt, stallDaysOf } = await import(rel('./judge.js', import.meta.url));
const { monthKey, startOfDay, stamp, weekKey, ymd } = await import(rel('./util.js', import.meta.url));

/**
 * 报告周期。四类：月度 / 季度 / 半年度 / 年度。
 *
 * key 规则（都按自然日历，不含周）：
 *   month   2026-10        当月
 *   quarter 2026-Q4        第 4 季度（10–12 月）
 *   half    2026-H2        下半年（7–12 月）
 *   year    2026           自然年
 */
const PERIOD_LABEL = { month: '月报', quarter: '季报', half: '半年报', year: '年报' };
const PERIOD_NAME = { month: '月度报告', quarter: '季度报告', half: '半年度报告', year: '年度报告' };
const PERIODS = ['month', 'quarter', 'half', 'year'];
const DELTA_FIELDS = ['created', 'completed', 'open', 'overdue', 'activeDays'];

/** 每个周期各自覆盖的月数（用于窗口推算） */
const PERIOD_MONTHS = { month: 1, quarter: 3, half: 6, year: 12 };

const pad2 = (n) => String(n).padStart(2, '0');

/** 生成某个起始月 + 跨度的窗口 */
function makeWindow(startYear, startMonth, spanMonths, key, label) {
  const start = new Date(startYear, startMonth, 1);
  const end = new Date(startYear, startMonth + spanMonths, 0);
  return { key, label, from: start, to: end };
}

/**
 * 周期窗口。offset=0 为当前期，offset=1 为上一期。
 *
 * 注意"当前期"指**包含 now 的那一期**：
 *   2026-10-31 → month=2026-10, quarter=2026-Q4, half=2026-H2, year=2026
 */
export function periodWindow(period, now = new Date(), offset = 0) {
  const year = now.getFullYear();
  const month = now.getMonth(); // 0-11

  if (period === 'month') {
    // 用 (年, 月) 构造，避免 31 日遇到短月溢出（3-31 减一月必须得到 2 月）
    const base = new Date(year, month - offset, 1);
    const y = base.getFullYear();
    const m = base.getMonth();
    return makeWindow(y, m, 1, `${y}-${pad2(m + 1)}`, `${y}年${m + 1}月`);
  }

  if (period === 'quarter') {
    const q = Math.floor(month / 3); // 0-3
    const baseQuarterIndex = year * 4 + q - offset;
    const y = Math.floor(baseQuarterIndex / 4);
    const qi = ((baseQuarterIndex % 4) + 4) % 4;
    return makeWindow(y, qi * 3, 3, `${y}-Q${qi + 1}`, `${y}年第${qi + 1}季度`);
  }

  if (period === 'half') {
    const h = Math.floor(month / 6); // 0-1
    const baseHalfIndex = year * 2 + h - offset;
    const y = Math.floor(baseHalfIndex / 2);
    const hi = ((baseHalfIndex % 2) + 2) % 2;
    return makeWindow(y, hi * 6, 6, `${y}-H${hi + 1}`, `${y}年${hi === 0 ? '上' : '下'}半年`);
  }

  // year
  const y = year - offset;
  return makeWindow(y, 0, 12, `${y}`, `${y}年度`);
}

/**
 * key → 时间窗口（按 key 生成指定周期）。
 * 非法 key 返回 null。也兼容旧 key（周报 YYYY-Www）以便历史报告仍可读。
 */
export function windowFor(period, key) {
  if (typeof key !== 'string' || !key) return null;
  const k = key.trim();

  if (period === 'month') {
    const m = /^(\d{4})-(\d{2})$/.exec(k);
    if (!m) return null;
    const y = Number(m[1]);
    const mo = Number(m[2]) - 1;
    if (mo < 0 || mo > 11) return null;
    return makeWindow(y, mo, 1, k, `${y}年${mo + 1}月`);
  }

  if (period === 'quarter') {
    const m = /^(\d{4})-Q([1-4])$/.exec(k);
    if (!m) return null;
    const y = Number(m[1]);
    const qi = Number(m[2]) - 1;
    return makeWindow(y, qi * 3, 3, k, `${y}年第${qi + 1}季度`);
  }

  if (period === 'half') {
    const m = /^(\d{4})-H([12])$/.exec(k);
    if (!m) return null;
    const y = Number(m[1]);
    const hi = Number(m[2]) - 1;
    return makeWindow(y, hi * 6, 6, k, `${y}年${hi === 0 ? '上' : '下'}半年`);
  }

  if (period === 'year') {
    const m = /^(\d{4})$/.exec(k);
    if (!m) return null;
    const y = Number(m[1]);
    return makeWindow(y, 0, 12, k, `${y}年度`);
  }

  // 旧周报 key（历史数据兼容）
  if (period === 'week') {
    const m = /^(\d{4})-W(\d{2})$/.exec(k);
    if (!m) return null;
    const year = Number(m[1]);
    const week = Number(m[2]);
    if (week < 1 || week > 53) return null;
    const jan4 = new Date(year, 0, 4);
    const jan4Day = (jan4.getDay() + 6) % 7;
    const week1Monday = new Date(year, 0, 4 - jan4Day);
    const start = new Date(week1Monday.getFullYear(), week1Monday.getMonth(), week1Monday.getDate() + (week - 1) * 7);
    const end = new Date(start.getFullYear(), start.getMonth(), start.getDate() + 6);
    return {
      key: k,
      label: `${start.getMonth() + 1}月${start.getDate()}日–${end.getMonth() + 1}月${end.getDate()}日`,
      from: start,
      to: end,
    };
  }

  return null;
}

/** 某个日期所属的周期 key（用于调度判断"这一期该出了吗"） */
export function keyFor(period, now = new Date()) {
  return periodWindow(period, now).key;
}

export async function buildFacts(secretary, { domains, now = new Date(), key, period } = {}) {
  const settings = await secretary.loadAll(true);
  // 默认口径：报告面向用户的业务域，助手域（开发日志）不参与汇总；显式点名时除外
  const list = domains ?? settings.domains.filter((d) => d.id !== 'assistant');
  const facts = {};
  for (const domain of list) {
    const entry = {
      id: domain.id,
      name: domain.name,
      shape: domain.shape,
      weekdaysLeft: workdaysLeftInWeek(now),
    };
    for (const p of PERIODS) {
      // 只算被请求的那一类（其余按当前期算，保持结构完整但成本可控）
      const useKey = period && p !== period ? undefined : key;
      entry[p] = factsFor(settings, domain, p, now, useKey);
    }
    facts[domain.id] = entry;
  }
  return { generatedAt: stamp(now), date: ymd(now), periods: PERIODS, domains: facts };
}

function factsFor(settings, domain, period, now, explicitKey) {
  const win = (explicitKey && windowFor(period, explicitKey)) || periodWindow(period, now);
  const prev = periodWindow(period, win.from, 1);
  const all = settings.entries.filter((entry) => entry.domain === domain.id);

  const current = windowFacts(all, domain, win, now);
  const previous = windowFacts(all, domain, prev, now);
  const deltas = {};
  for (const field of DELTA_FIELDS) {
    // 上期不可还原时（例如条目状态已被后续改动覆盖）不给假 0
    if (current[field] == null || previous[field] == null) {
      deltas[field] = null;
    } else {
      deltas[field] = current[field] - previous[field];
    }
  }

  return {
    ...current,
    previous,
    deltas,
    commitments: null,
    // 周期越长越需要看"走势"和"重点"：月度也一并给，但季/半/年才是主要用途
    trend: buildTrend(all, domain, period, win, now),
    highlights: buildHighlights(all, domain, win, now),
  };
}

/**
 * 趋势：把报告周期按自然月拆成若干段，逐月给出新增/完成/活跃天数。
 *
 * 为什么按"月"拆：月度报告只有 1 段（趋势无意义但有值）；季报 3 段、
 * 半年报 6 段、年报 12 段——正好能看出"哪个月在推进、哪个月停了"。
 * 所有数字都来自时间戳，可精确回溯，不是估算。
 *
 * B04：每个月份点必须区分**已结束 / 进行中 / 未开始**。
 * 原实现只看数字是否为 0，于是在 10 月生成年报时，11、12 月也被判成
 * "整月无动静"——那不是事实，是还没发生。只有**已经完整结束**的月份
 * 才能得出"整月无动静"；当月叫"截至生成时刻"；未来月叫"尚未开始"。
 * 高峰月同样要说明它是否包含不完整月份，否则"最活跃是 10 月"可能
 * 只是因为 11、12 月还没到。
 */
function buildTrend(all, domain, period, win, now) {
  const months = [];
  const today = startOfDay(now);
  const cursor = new Date(win.from.getFullYear(), win.from.getMonth(), 1);
  const lastMonth = new Date(win.to.getFullYear(), win.to.getMonth(), 1);
  while (cursor <= lastMonth) {
    const start = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
    const end = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0);
    const label = `${start.getMonth() + 1}月`;
    const created = all.filter((e) => inside(e.created, { from: start, to: end })).length;
    const completed = all.filter((e) => inside(e.completedAt, { from: start, to: end })).length;
    const activeDays = new Set(
      all
        .flatMap((e) => e.timeline ?? [])
        .filter((item) => inside(item.at, { from: start, to: end }))
        .map((item) => String(item.at).slice(0, 10)),
    ).size;
    // 时间状态：月末早于今天 = 已结束；月初晚于今天 = 未开始；否则就是当月进行中
    const phase = startOfDay(end) < today ? 'ended' : startOfDay(start) > today ? 'notStarted' : 'inProgress';
    months.push({
      key: `${start.getFullYear()}-${pad2(start.getMonth() + 1)}`,
      label,
      created,
      completed,
      activeDays,
      phase,
      // 只有已结束的月份能给出"整月"结论；其余给可读的原因，避免被当成空窗
      note:
        phase === 'ended'
          ? null
          : phase === 'inProgress'
            ? '截至生成时刻，月份未结束'
            : '尚未开始',
    });
    cursor.setMonth(cursor.getMonth() + 1);
  }

  const sum = (field) => months.reduce((acc, m) => acc + m[field], 0);
  // 高峰月与空窗月：给模型一个可直接引用的结论锚点
  const peak = months.reduce((best, m) => (m.completed > (best?.completed ?? -1) ? m : best), null);
  // B04：只有**已完整结束**且确实一条记录都没有的月份才算"整月无动静"
  const quiet = months
    .filter((m) => m.phase === 'ended' && m.created === 0 && m.completed === 0 && m.activeDays === 0)
    .map((m) => m.label);
  const notStarted = months.filter((m) => m.phase === 'notStarted').map((m) => m.label);
  const inProgress = months.filter((m) => m.phase === 'inProgress').map((m) => m.label);
  const peakIsPartial = Boolean(peak && peak.phase !== 'ended');

  return {
    unit: 'month',
    points: months,
    total: { created: sum('created'), completed: sum('completed'), activeDays: sum('activeDays') },
    peakMonth: peak && peak.completed > 0 ? { label: peak.label, completed: peak.completed, phase: peak.phase, partial: peakIsPartial } : null,
    quietMonths: quiet,
    // 未结束/未开始月单独列出，报告可以照抄，不必自己推断
    partialMonths: inProgress,
    notStartedMonths: notStarted,
    // 比较口径说明：含不完整月份时，任何"最活跃/最低"结论都只是暂定
    comparisonNote: inProgress.length
      ? `包含未结束的月份（${inProgress.join('、')}），相关比较仅为截至生成时刻的暂定值`
      : notStarted.length
        ? `不含未开始月份（${notStarted.join('、')}），比较基于已结束月份`
        : '周期内各月均已结束，比较口径一致',
    coverage: months.length,
    domainShape: domain.shape,
  };
}

/**
 * 重点回顾：从报告周期内挑出"值得回看"的具体事项。
 *
 * **两个口径必须分开**（审查报告 B02）：
 *
 *   ① `period`（本期历史回顾）——只收报告期**之内**发生的事。
 *      历史周期不得出现报告期之后才创建的事项：生成 2026-09 月报时，
 *      10-10 创建、10-15 截止的事项当时根本不存在，写进去就是伪造历史。
 *      过滤条件：`created <= 期末`（即"在报告期结束前已经存在"）。
 *
 *   ② `asOfNow`（截至生成时刻的当前风险）——现在仍然逾期/停滞的事项，
 *      与报告期无关。它单独命名、单独标注快照时间，报告正文里作为附录引用，
 *      不能混进本期事实。
 *
 * 无法还原的情况（例如历史周期里某条记录的当时状态已被后续改动覆盖）
 * 明确标为"未知"，不猜。
 *
 * 挑选依据都是可验证的事实，不做主观判断。
 */
function buildHighlights(all, domain, win, now) {
  const inWin = (value) => inside(value, win);
  // 报告期结束前是否已存在：created 缺失时无法判断，按"未知"处理（不纳入、不排除）
  const existedBy = (entry) => {
    const created = timeOf(entry.created);
    if (!created) return null; // 未知
    return created <= win.to.getTime() + 86399000;
  };
  const existsBeforeEnd = (entry) => existedBy(entry) !== false;

  const completed = all
    .filter((e) => inWin(e.completedAt))
    .sort((a, b) => String(b.completedAt).localeCompare(String(a.completedAt)))
    .map((e) => ({ id: e.id, title: e.title, at: String(e.completedAt).slice(0, 10) }));

  /**
   * 本期逾期 = **期末时仍然逾期**的事项。三个条件缺一不可：
   *   1. 报告期结束前已经存在（之后才创建的不算，B02）
   *   2. 截止日早于期末（期末之后才到期的，当时还没逾期）
   *   3. 期末时还没完成（已完成的不算"仍逾期"）
   *
   * 不能直接拿"当前是否逾期"来充数：那样历史报告会把报告期之后
   * 才发生的事写成当期事实。判定全部基于磁盘上的时间戳，可逐条复核。
   */
  const periodEnd = win.to.getTime() + 86399000;
  const overdueInPeriod = all
    .filter((e) => existsBeforeEnd(e) && e.deadline)
    .filter((e) => timeOf(e.deadline) > 0 && timeOf(e.deadline) < periodEnd)
    .filter((e) => {
      // 期末前已完成 → 当时不再逾期
      const done = timeOf(e.completedAt);
      return !(done > 0 && done <= periodEnd);
    })
    .sort((a, b) => String(a.deadline).localeCompare(String(b.deadline)))
    .map((e) => ({ id: e.id, title: e.title, deadline: e.deadline }));

  /**
   * 本期停滞：期末时**已经停了很久**的在办事项。
   *
   * `stallCut` 取"期末"与"当前"中较早的那个：历史周期用期末算，
   * 这样 9 月报告里的停滞天数不会随着 10 月流逝而继续增长。
   */
  const stallCut = periodEnd < now.getTime() ? new Date(periodEnd) : now;
  const stalledInPeriod = all
    .filter((e) => statusKind(domain, e) === 'open' && existsBeforeEnd(e) && existedBy(e) !== null)
    .filter((e) => {
      // 期末前已完成的不算停滞
      const done = timeOf(e.completedAt);
      return !(done > 0 && done <= periodEnd);
    })
    .map((e) => ({ entry: e, days: stallDaysOf(e, stallCut) }))
    // 阈值取域声明，与快照/提醒同一口径；不在报告里另写一个固定 5 天（B01）
    .filter((x) => x.days >= (domain.stallDays ?? 7))
    .sort((a, b) => b.days - a.days)
    .slice(0, 5)
    .map((x) => ({ id: x.entry.id, title: x.entry.title, stallDays: x.days }));

  /**
   * 灵感转化：按**真实转化时间**归月（B03）。
   *   - 有 promotedAt：落在本期内才算
   *   - 有 promotedTo 但没有 promotedAt：时间未知，单独列进 convertedUnknownAt
   */
  const convertedAll = domain.shape === 'stream' ? all.filter((e) => e.promotedTo) : [];
  const converted = convertedAll
    .filter((e) => e.promotedAt && inWin(e.promotedAt))
    .map((e) => ({ id: e.id, title: e.title, promotedTo: e.promotedTo, at: String(e.promotedAt).slice(0, 10) }));
  const convertedUnknownAt = convertedAll
    .filter((e) => !e.promotedAt)
    .map((e) => ({ id: e.id, title: e.title, promotedTo: e.promotedTo }));

  // ② 当前风险：与报告期无关，独立命名 + 快照时间，绝不混作本期事实
  const openNow = all.filter((e) => statusKind(domain, e) === 'open');
  const overdueNow = openNow
    .filter((e) => e.deadline && new Date(e.deadline) < startOfDay(now))
    .sort((a, b) => String(a.deadline).localeCompare(String(b.deadline)))
    .map((e) => ({ id: e.id, title: e.title, deadline: e.deadline }));
  const stalledNow = openNow
    .map((e) => ({ entry: e, days: stallDaysOf(e, now) }))
    .filter((x) => x.days >= (domain.stallDays ?? 7))
    .sort((a, b) => b.days - a.days)
    .slice(0, 5)
    .map((x) => ({ id: x.entry.id, title: x.entry.title, stallDays: x.days }));

  return {
    // ---- ① 本期历史回顾（只含报告期内存在的事项）----
    completed: completed.slice(0, 10),
    completedCount: completed.length,
    overdue: overdueInPeriod.slice(0, 10),
    overdueCount: overdueInPeriod.length,
    stalled: stalledInPeriod,
    converted: converted.slice(0, 10),
    convertedCount: converted.length,
    convertedUnknownAt,
    convertedUnknownCount: convertedUnknownAt.length,
    periodScope: {
      from: ymd(win.from),
      to: ymd(win.to),
      // 明确写清筛选规则，模型写报告时可以直接引用
      rule: '仅统计报告期内已存在的事项；报告期之后才创建的事项不纳入',
      stallThresholdDays: domain.stallDays ?? 7,
      stallCutAt: stamp(stallCut),
    },
    // ---- ② 截至生成时刻的当前风险（附录口径，不是本期事实）----
    asOfNow: {
      snapshotAt: stamp(now),
      overdue: overdueNow.slice(0, 10),
      overdueCount: overdueNow.length,
      stalled: stalledNow,
      note: '当前仍在办的风险快照，与报告期无关；写报告时请作为附录单独标注，不计入本期统计',
    },
  };
}

/**
 * 窗口内的事实。
 *
 * open / overdue 是**按窗口期末**估的：用当前状态无法真正还原历史，
 * 所以这里显式区分两类指标——
 *   created / completed / activeDays：有确切时间戳，可精确回溯
 *   open / overdue：只能给"当前值"，并在历史/未来周期标为不可用（null）
 *
 * B02：`stalled` 同样只能算"期末之前已存在、且到期末都没再动"的事项。
 * 报告期之后才建的条目在那个时点根本不存在，不能反过来算进历史停滞。
 * 历史周期连"当时是否仍在办"都不可还原，所以这里直接给 null，并附
 * `historyAvailable: false` 让报告写明"不可还原"，而不是拿当前状态充数。
 *
 * 日期边界（F06）：`timeOf(ymd(now))` 会把纯日期解析成 UTC 零点，
 * 而窗口端点用本地零点，上海时区下周期最后一天会被误判成历史。这里统一按
 * 本地日期比较：`from ≤ 今天 ≤ to`，且同时排除未来周期。
 */
function windowFacts(all, domain, win, now) {
  const today = startOfDay(now);                       // 本地当天 00:00
  const from = startOfDay(win.from);
  const to = startOfDay(win.to);
  const isCurrentPeriod = today >= from && today <= to; // 含边界，且不含未来
  const isHistory = to < today;
  const created = all.filter((entry) => inside(entry.created, win));
  const completed = all.filter((entry) => inside(entry.completedAt, win));
  const activeDays = new Set(
    all
      .flatMap((entry) => entry.timeline ?? [])
      .filter((item) => inside(item.at, win))
      .map((item) => String(item.at).slice(0, 10)),
  );

  // 只有当前周期能给出准确的在办/逾期快照；历史与未来周期标为不可用
  const openNow = all.filter((entry) => statusKind(domain, entry) === 'open');
  const overdueNow = openNow.filter((entry) => entry.deadline && new Date(entry.deadline) < startOfDay(now));
  const openValue = isCurrentPeriod ? openNow.length : null;
  const overdueValue = isCurrentPeriod ? overdueNow.length : null;

  /**
   * 期末停滞数。
   *   - 当前周期：截至今天，仍没动的在办事项
   *   - 历史周期：截至期末（`win.to`），且**必须在期末前已存在**
   *   - 未来周期：null（还没发生）
   */
  const stallCut = isCurrentPeriod ? today : to;
  const stalled =
    isCurrentPeriod || isHistory
      ? openNow.filter((entry) => {
          if (isHistory) {
            const createdTime = timeOf(entry.created);
            // 期末之后才创建的，当时不存在，不参与历史停滞
            if (createdTime && createdTime > stallCut.getTime() + 86399000) return false;
          }
          const last = lastActivityAt(entry);
          return last > 0 && startOfDay(new Date(last)) < stallCut;
        })
      : [];

  return {
    period: win.key,
    label: win.label,
    from: ymd(win.from),
    to: ymd(win.to),
    created: created.length,
    completed: completed.length,
    open: openValue,
    overdue: overdueValue,
    activeDays: activeDays.size,
    // 历史周期的"当时在办数"不可还原 → null；未来周期同理
    stalled: isCurrentPeriod ? stalled.length : null,
    // 历史停滞按标题列出（可精确回溯：期末前存在 + 期末仍没动）
    stalledTitles: stalled.slice(0, 8).map((entry) => entry.title),
    completionRate: created.length ? Math.round((completed.length / Math.max(1, created.length)) * 100) : null,
    completedTitles: completed.slice(0, 8).map((entry) => entry.title),
    createdTitles: created.slice(0, 8).map((entry) => entry.title),
    overdueTitles: isCurrentPeriod ? overdueNow.slice(0, 8).map((entry) => entry.title) : [],
    historyAvailable: isCurrentPeriod,
  };
}

function timeOf(value) {
  const time = new Date(String(value ?? '').replace(' ', 'T')).getTime();
  return Number.isNaN(time) ? 0 : time;
}

function inside(value, win) {
  const time = timeOf(value);
  if (!time) return false;
  return time >= win.from.getTime() && time <= win.to.getTime() + 86399000;
}

function workdaysLeftInWeek(now) {
  const day = (now.getDay() + 6) % 7;
  return Math.max(0, 5 - Math.min(5, day + 1));
}

/**
 * 从**目标报告周期的上一期**提取"下一期一件最重要的事"，作为本期对照。
 *
 * F05：原实现用 `new Date()`（当前日期）倒推上一期，手动补写历史周期时会
 * 拿错周期——补 2026-09 的月报，却读到了 2026-09 自己的承诺。
 * 现在必须传入**目标周期窗口**，由它倒推上一期。
 *
 * 章节名兼容四类周期：下周（旧周报）/ 下月 / 下季度 / 下半年 / 明年。
 */
async function previousCommitments(secretary, domain, period, targetWin) {
  const prevWin = periodWindow(period, targetWin.from, 1);
  const dir = path.join(FILES.reports, domain.name, PERIOD_LABEL[period] ?? '报告');
  const files = await secretary.store.listFiles(dir, (p) => p.endsWith('.md'));
  const match = files.find((p) => p.includes(prevWin.key));
  if (!match) return null;
  const text = await secretary.store.readText(match);
  if (!text) return null;
  const section = /##?\s*(下周|下月|下季度|下半年|明年|下一期)一件最重要的事([\s\S]*?)(?=\n##?\s|\n---|$)/.exec(text);
  if (!section) return null;
  const body = section[2].trim();
  return { period: prevWin.key, from: match, text: body || null };
}

/**
 * 工具入口：没有 markdown 就给事实（并落 facts.json），给了就落报告。
 *
 * 周期类型：month（月度）/ quarter（季度）/ half（半年度）/ year（年度）。
 * - `key` 指定具体周期，不传则取**包含今天的当前期**。
 * - **不指定 domain 时是"逐域各出一份"，不是跨域合并**：各域报告只写自己的目录，
 *   绝不把同一篇正文复制到别的域（用户要求：报告不可混域存放）。
 * - 返回值只含可序列化字段：不存在的键用 null 表示，绝不返回 undefined。
 */
export async function buildReport(secretary, { domain: domainKey, period = 'month', key, markdown, force = false, factsOnly = false }) {
  if (!PERIODS.includes(period)) {
    throw new Error(`period 只能是 ${PERIODS.join(' / ')}。月度用 month，季度 quarter，半年度 half，年度 year。`);
  }
  const settings = await secretary.loadAll(true);
  const target = domainKey ? [secretary.domainOf(settings, domainKey)] : settings.domains.filter((d) => d.id !== 'assistant');
  const requested = key ? windowFor(period, key) : null;
  if (key && !requested) {
    throw new Error(
      `周期 key 格式不对：${key}。` +
        '月度用 YYYY-MM（2026-10），季度用 YYYY-Qn（2026-Q4），半年度用 YYYY-Hn（2026-H2），年度用 YYYY（2026）。',
    );
  }
  const win = requested ?? periodWindow(period);

  // 单域：传该域自己的 markdown，直接落盘。
  // 多域：**每域独立生成**——只写 facts.json 供模型逐域撰写，不复制正文。
  // factsOnly：仅补事实包（调度对账用），不产出报告正文、也不要求用户只写一份。
  if (factsOnly || (!markdown && target.length > 1)) {
    const facts = await buildFacts(secretary, { domains: target, key, period });
    const lines = [];
    const factsPaths = [];
    for (const domain of target) {
      const data = facts.domains[domain.id][period];
      const dir = path.join(FILES.reports, domain.name, PERIOD_LABEL[period] ?? '报告');
      const factsPath = path.join(dir, `${domain.id}-${win.key}.facts.json`);
      data.commitments = await previousCommitments(secretary, domain, period, win);
      await secretary.store.write(factsPath, `${JSON.stringify({ ...data, generatedAt: facts.generatedAt }, null, 2)}\n`);
      factsPaths.push({ domain: domain.id, name: domain.name, path: factsPath });
      // factLine 已包含完成/逾期/趋势/重点，这里只补"上期承诺"一条
      lines.push(factLine(domain, data));
      if (data.commitments?.text) lines.push(`　上期承诺：${data.commitments.text.split('\n')[0].slice(0, 60)}`);
    }
    return {
      period,
      periodName: PERIOD_NAME[period],
      key: win.key,
      label: win.label,
      facts,
      written: null,
      path: null,
      factsPaths,
      lines,
      headline: `${win.label}${PERIOD_NAME[period]}事实（${target.map((d) => d.name).join('、')}）`,
      message:
        '各域的事实包已分别落入各自目录。请**逐域**写解读，然后对每个域单独调用一次 secretary_report（带上 domain 和同一个 key）把正文传回来；' +
        '不要写一篇跨域合并的报告，报告的存放互不混合。',
    };
  }

  const facts = await buildFacts(secretary, { domains: target, key, period });
  const written = [];
  const lines = [];
  for (const domain of target) {
    const data = facts.domains[domain.id][period];
    const dir = path.join(FILES.reports, domain.name, PERIOD_LABEL[period] ?? '报告');
    const base = path.join(dir, `${domain.id}-${win.key}`);
    const factsPath = `${base}.facts.json`;
    const reportPath = `${base}-${domain.name}${PERIOD_LABEL[period] ?? '报告'}.md`;
    data.commitments = await previousCommitments(secretary, domain, period, win);

    if (markdown) {
      if (target.length > 1) {
        // 多域时带正文 = 想把同一篇复制到每个域，明确拒绝
        throw new Error('多个域不能共用同一篇报告正文。请指定 domain，逐域各写一份。');
      }
      const body = `${markdown.trim()}\n\n---\n\n> 数据来源：${factsPath}　生成于 ${stamp()}\n`;
      if (!force && (await secretary.store.exists(reportPath))) {
        written.push({ path: reportPath, skipped: true });
      } else {
        await secretary.store.write(reportPath, `# ${domain.name}${PERIOD_LABEL[period]}　${win.label}\n\n${body}`);
        written.push({ path: reportPath, skipped: false });
      }
      continue;
    }

    await secretary.store.write(factsPath, `${JSON.stringify({ ...data, generatedAt: facts.generatedAt }, null, 2)}\n`);
    // factLine 已包含完成/逾期/趋势/重点，这里只补"上期承诺"
    lines.push(factLine(domain, data));
    if (data.commitments?.text) lines.push(`　上期承诺：${data.commitments.text.split('\n')[0].slice(0, 60)}`);
  }

  const writtenValue = written.length ? written : null;
  return {
    period,
    key: win.key,
    label: win.label,
    facts,
    written: writtenValue,
    path: writtenValue ? writtenValue[0].path : null,
    headline: markdown ? `报告已写入 ${written.length} 个文件` : `${win.label} 事实（${target.map((d) => d.name).join('、')}）`,
    lines,
    message: markdown
      ? `报告已写入周期 ${win.key}。正文应含六段（趋势与重点回顾必写），结尾留一段「下一期一件最重要的事」，下期会拿它对照。`
      : '事实如上（含趋势与重点回顾）。请据实写解读，再把 markdown 传回来落盘。',
  };
}

function factLine(domain, data) {
  const delta = data.deltas ?? {};
  const arrow = (value) => {
    if (value === null || value === undefined) return '上期不可比';
    return value > 0 ? `+${value}` : `${value}`;
  };
  const show = (value) => (value === null || value === undefined ? '不可还原' : String(value));
  const lines = [
    `【${domain.name} ${data.label}】新增 ${data.created}（${arrow(delta.created)}） · ` +
      `完成 ${data.completed}（${arrow(delta.completed)}） · ` +
      `未完成 ${show(data.open)} · 逾期 ${show(data.overdue)} · ` +
      `有动静 ${data.activeDays} 天 · 期末停滞 ${show(data.stalled)}` +
      (data.completionRate !== null ? ` · 完成率 ${data.completionRate}%` : ''),
  ];

  // 趋势：逐月走势（月度只有 1 段，展示价值有限，仍给出便于核对）
  const trend = data.trend;
  if (trend && trend.points?.length) {
    const points = trend.points
      .map((p) => {
        const mark = p.phase === 'ended' ? '' : p.phase === 'inProgress' ? '（进行中）' : '（未开始）';
        return `${p.label}${mark} 新${p.created}/完${p.completed}/动${p.activeDays}`;
      })
      .join('，');
    lines.push(`　趋势：${points}`);
    if (trend.peakMonth) {
      lines.push(
        `　最活跃：${trend.peakMonth.label}（完成 ${trend.peakMonth.completed} 件）` +
          (trend.peakMonth.partial ? '　※该月未结束，此结论为暂定' : ''),
      );
    }
    // 只有已结束且确实无记录的月份才算"整月无动静"（B04）
    if (trend.quietMonths?.length) lines.push(`　整月无动静：${trend.quietMonths.join('、')}`);
    if (trend.partialMonths?.length) lines.push(`　进行中（不可下"整月"结论）：${trend.partialMonths.join('、')}`);
    if (trend.notStartedMonths?.length) lines.push(`　尚未开始：${trend.notStartedMonths.join('、')}`);
    if (trend.comparisonNote) lines.push(`　对比口径：${trend.comparisonNote}`);
  }

  // 重点回顾：具体事项，供模型引用而不是臆测
  const hl = data.highlights;
  if (hl) {
    if (hl.completedCount) {
      const names = hl.completed.slice(0, 5).map((x) => x.title).join('、');
      lines.push(`　本期完成 ${hl.completedCount} 件：${names}${hl.completedCount > 5 ? ' 等' : ''}`);
    }
    if (hl.overdueCount) {
      const names = hl.overdue.slice(0, 5).map((x) => `${x.title}（截止 ${x.deadline}）`).join('、');
      lines.push(`　本期逾期 ${hl.overdueCount} 件：${names}${hl.overdueCount > 5 ? ' 等' : ''}`);
    }
    if (hl.stalled?.length) {
      const names = hl.stalled.map((x) => `${x.title}（停滞 ${x.stallDays} 天）`).join('、');
      lines.push(`　本期停滞（≥${hl.periodScope?.stallThresholdDays ?? 7} 天）：${names}`);
    }
    if (hl.convertedCount) {
      const names = hl.converted.slice(0, 5).map((x) => `${x.title}→${x.promotedTo}`).join('、');
      lines.push(`　本期灵感转化 ${hl.convertedCount} 条：${names}`);
    }
    if (hl.convertedUnknownCount) {
      const names = hl.convertedUnknownAt.slice(0, 5).map((x) => x.title).join('、');
      lines.push(`　转化时间未知 ${hl.convertedUnknownCount} 条（不计入本期，也不推测月份）：${names}`);
    }
    // ② 当前风险附录：与本期事实分开，标明快照时间（B02）
    const now = hl.asOfNow;
    if (now && (now.overdueCount || now.stalled?.length)) {
      const bits = [];
      if (now.overdueCount) bits.push(`逾期 ${now.overdueCount} 件`);
      if (now.stalled?.length) bits.push(`停滞 ${now.stalled.length} 件`);
      lines.push(`　〔附录·当前风险 ${now.snapshotAt}〕${bits.join('，')}——不计入本期统计`);
    }
  }
  return lines.join('\n');
}

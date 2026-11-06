/**
 * 数据看板：按**一段时间**看销售链条的五个维度。
 *
 * ── 规格（用户给定，不要自行增删） ──
 * 数据标签：签订合同额、签订合同数量、销售项目数量、客户交流数量、商机数量
 * 统计图表：销售项目跟踪状态统计、合同签订数量统计、客户交流数量统计、
 *          商机数量统计、合同状态分布统计
 *
 * ── 口径约定 ──
 * 所有"数量"都按**该记录自己的归期日期**落进时间段：
 *   商机数量      → created（建于期间）
 *   销售项目数量  → created
 *   客户交流数量  → planDate（计划拜访日；没有则退回 created）
 *   签订合同数量  → signedAt（签订日）
 *   签订合同额    → signedAt 同口径，取合同金额（含已签收补充协议）
 *
 * 为什么合同用 signedAt 而不是 created：
 * "今年签了几份合同"问的是签约行为发生在什么时候，
 * 不是"什么时候录进系统的"。用 created 会把补录的老合同算进今年。
 */

import { contractTotal } from './contracts.js';

const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const pad = (n) => String(n).padStart(2, '0');
const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

/** 解析 YYYY-MM-DD（或带时间）成本地时间戳；无效返回 0 */
export function timeOf(value) {
  if (!value) return 0;
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2}))?/.exec(String(value).trim());
  if (!m) return 0;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4] ?? 0), Number(m[5] ?? 0));
  return Number.isNaN(d.getTime()) ? 0 : d.getTime();
}

const monthKeyOf = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;

/** 时间段判断：值是否落在 [from, to] 这一整段里 */
function inside(value, win) {
  const ts = timeOf(value);
  if (!ts) return false;
  return ts >= win.from.getTime() && ts <= win.to.getTime() + 86399999;
}

/**
 * 把窗口标识解析成 { kind, label, from, to }。
 *
 * 支持 本月 / 本季 / 今年 / 自定义。今年（ytd）是后加的——
 * "签订合同额"这种累计指标最常按整年看。
 */
export function resolveWindow(kind, options = {}) {
  const now = options.now instanceof Date ? options.now : new Date();

  if (kind === 'month') {
    const from = new Date(now.getFullYear(), now.getMonth(), 1);
    const to = new Date(now.getFullYear(), now.getMonth() + 1, 0);
    return { kind, key: kind, label: `${now.getFullYear()} 年 ${now.getMonth() + 1} 月`, from, to };
  }

  if (kind === 'quarter') {
    const q = Math.floor(now.getMonth() / 3);
    const from = new Date(now.getFullYear(), q * 3, 1);
    const to = new Date(now.getFullYear(), q * 3 + 3, 0);
    return { kind, key: kind, label: `${now.getFullYear()} 年 第 ${q + 1} 季度`, from, to };
  }

  if (kind === 'year' || kind === 'ytd') {
    const from = new Date(now.getFullYear(), 0, 1);
    const to = new Date(now.getFullYear(), 11, 31);
    return { kind: 'year', key: 'year', label: `${now.getFullYear()} 年`, from, to };
  }

  if (kind === 'custom') {
    const from = options.from ? new Date(`${options.from}T00:00:00`) : null;
    const to = options.to ? new Date(`${options.to}T00:00:00`) : null;
    if (!from || !to || Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
      // 参数不全回落到本月，不报错——看板是只读视图，缺参数不该白屏
      return resolveWindow('month', options);
    }
    const [start, end] = from <= to ? [from, to] : [to, from];
    return { kind: 'custom', key: 'custom', label: `${ymd(start)} ~ ${ymd(end)}`, from: start, to: end };
  }

  return resolveWindow('month', options);
}

/** 金额缩写：3200000 → "320万" */
export function compactMoney(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '0';
  const abs = Math.abs(n);
  if (abs === 0) return '0';
  if (abs < 10000) return String(Math.round(n));
  const wan = n / 10000;
  const shown = Math.abs(wan) >= 100 ? Math.round(wan) : Math.round(wan * 10) / 10;
  return `${shown}万`;
}

/**
 * 按月分桶，给"数量统计"类图表用。
 *
 * 返回最近 N 个月（默认 12），每个月 { key, label, count }。
 * **固定给 12 个月**而不是跟着窗口走：
 * 只给窗口内的月份时，"本月"就只有一根柱子，看不出趋势。
 * 窗口只是用来决定哪几根柱子高亮。
 */
function monthlyBuckets(records, dateOf, win, now, months = 12) {
  const buckets = [];
  for (let i = months - 1; i >= 0; i -= 1) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const fromTs = d.getTime();
    const toTs = new Date(d.getFullYear(), d.getMonth() + 1, 0).getTime() + 86399999;
    buckets.push({
      key: monthKeyOf(d),
      label: `${d.getMonth() + 1}月`,
      count: 0,
      amount: 0,
      inWindow: toTs >= win.from.getTime() && fromTs <= win.to.getTime() + 86399999,
    });
  }
  const index = new Map(buckets.map((b) => [b.key, b]));

  for (const rec of records) {
    const ts = dateOf(rec);
    if (!ts) continue;
    const bucket = index.get(monthKeyOf(new Date(ts)));
    if (!bucket) continue;
    bucket.count += 1;
    bucket.amount += num(rec.__amount);
  }
  return buckets;
}

/**
 * 算看板。
 *
 * @param {Array} entries 全部条目
 * @param {object} options { now, window, domains }
 */
export function computeBoard(entries, options = {}) {
  const now = options.now instanceof Date ? options.now : new Date();
  const win = options.window ?? resolveWindow('month', { now });
  const domainList = Array.isArray(options.domains) ? options.domains : [];
  const nameOf = (id) => domainList.find((d) => d.id === id)?.name ?? id;

  const opportunities = entries.filter((e) => e.domain === 'opportunity');
  const sales = entries.filter((e) => e.domain === 'sales');
  const contracts = entries.filter((e) => e.domain === 'contract');
  const visits = entries.filter((e) => e.domain === 'visit');

  /* ================= 五个数据标签 ================= */

  /**
   * 签订合同：按 signedAt 归期。
   *
   * ── 已解除的合同**也算**签订 ──
   * "今年签了几份合同、签了多少钱"是**历史事实**：那天确实签了。
   * 后来解除了不改变"签过"这件事。把已解除的排除掉，
   * 会让签订额随合同的后续状态而**回溯性变化**——
   * 用户上个月看到 800 万，这个月解约一份就变成 500 万，
   * 历史数字自己动，比少算一份更让人困惑。
   *
   * 注意：这条只适用于"签订数量/金额"这类**流量**指标。
   * 合同状态分布那张图是**存量**（现在各处于什么状态），
   * 那张图上已解除的自然单独一类，两处口径不同是对的。
   *
   * 没有 signedAt 的（草拟中，还没签）不计入——那不是"签订"。
   */
  const signedContracts = contracts.filter((c) => inside(c.signedAt, win));
  const signedAmount = signedContracts.reduce((s, c) => s + contractTotal(c), 0);

  const stats = {
    /** 签订合同额：期内签订的合同金额合计（含已签收补充协议） */
    signedAmount,
    /** 签订合同数量：期内 signedAt 落在窗口内的合同数 */
    signedCount: signedContracts.length,
    /** 销售项目数量：期内新建的项目销售记录 */
    salesCount: sales.filter((e) => inside(e.created, win)).length,
    /** 客户交流数量：期内计划拜访的（planDate 优先，没有则用 created） */
    visitCount: visits.filter((e) => inside(e.planDate || e.created, win)).length,
    /** 商机数量：期内新建的商机 */
    opportunityCount: opportunities.filter((e) => inside(e.created, win)).length,
  };

  /* ================= 图1：销售项目跟踪状态统计 ================= */

  /**
   * 按项目销售的**阶段**分组（初期阶段 / 方案报价 / 招采阶段），
   * 再加一个"已中标"——
   * 中标之后阶段就没意义了，它是收口状态，单独一根柱子更清楚。
   *
   * 口径是**当前存量**（不按窗口筛）：
   * "跟踪状态"问的是"现在这些项目各处于什么阶段"，
   * 加时间窗就变成"这段时间新建的项目现在什么阶段"，意义很绕。
   */
  const SALES_STAGES = ['初期阶段', '方案报价', '招采阶段'];
  const salesByStage = SALES_STAGES.map((stage) => ({
    key: stage,
    label: stage,
    count: sales.filter((s) => s.awardStatus !== '已中标' && s.status === stage).length,
  }));
  salesByStage.push({
    key: '已中标',
    label: '已中标',
    count: sales.filter((s) => s.awardStatus === '已中标').length,
  });
  salesByStage.push({
    key: '未中标',
    label: '未中标',
    count: sales.filter((s) => s.awardStatus === '未中标').length,
  });

  /* ================= 图2：合同签订数量统计 ================= */

  /** 逐月签订份数（近 12 个月），高亮落在窗口内的月份 */
  const signedMonthly = monthlyBuckets(contracts, (c) => timeOf(c.signedAt), win, now);

  /* ================= 图3：客户交流数量统计 ================= */

  /**
   * 逐月拜访次数。
   * 归期用 planDate 优先——拜访记录的 created 是"什么时候录的"，
   * planDate 才是"什么时候去的"。两者常常不同（提前约、事后补录）。
   */
  const visitMonthly = monthlyBuckets(visits, (v) => timeOf(v.planDate) || timeOf(v.created), win, now);

  /* ================= 图4：商机数量统计 ================= */

  const opportunityMonthly = monthlyBuckets(opportunities, (o) => timeOf(o.created), win, now);

  /* ================= 图5：合同状态分布统计 ================= */

  /**
   * 按合同状态分组。
   * 口径是**当前存量**：状态分布问的是"手上这些合同各是什么状态"，
   * 是快照不是流量。
   */
  const CONTRACT_STATUS = ['草拟', '已签订', '履行中', '已完成', '已解除'];
  const contractByStatus = CONTRACT_STATUS.map((status) => ({
    key: status,
    label: status,
    count: contracts.filter((c) => c.status === status).length,
    amount: contracts.filter((c) => c.status === status).reduce((s, c) => s + contractTotal(c), 0),
  }));

  /* ================= 汇总 ================= */

  return {
    window: {
      kind: win.kind,
      key: win.key,
      label: win.label,
      from: ymd(win.from),
      to: ymd(win.to),
      isCurrent: now.getTime() >= win.from.getTime() && now.getTime() <= win.to.getTime() + 86399999,
    },
    generatedAt: `${ymd(now)} ${pad(now.getHours())}:${pad(now.getMinutes())}`,

    /** 五个数据标签 */
    stats,
    /** 给标签显示用的格式化值 */
    statsView: {
      signedAmount: compactMoney(signedAmount),
      signedAmountFull: signedAmount,
      signedCount: stats.signedCount,
      salesCount: stats.salesCount,
      visitCount: stats.visitCount,
      opportunityCount: stats.opportunityCount,
    },

    /** 五张图 */
    charts: {
      salesByStage: {
        title: '销售项目跟踪状态统计',
        kind: 'bar',
        unit: '个',
        items: salesByStage,
        total: salesByStage.reduce((s, x) => s + x.count, 0),
      },
      signedMonthly: {
        title: '合同签订数量统计',
        kind: 'monthly',
        unit: '份',
        items: signedMonthly,
        total: signedMonthly.reduce((s, x) => s + x.count, 0),
      },
      visitMonthly: {
        title: '客户交流数量统计',
        kind: 'monthly',
        unit: '次',
        items: visitMonthly,
        total: visitMonthly.reduce((s, x) => s + x.count, 0),
      },
      opportunityMonthly: {
        title: '商机数量统计',
        kind: 'monthly',
        unit: '个',
        items: opportunityMonthly,
        total: opportunityMonthly.reduce((s, x) => s + x.count, 0),
      },
      contractByStatus: {
        title: '合同状态分布统计',
        kind: 'donut',
        unit: '份',
        items: contractByStatus,
        total: contractByStatus.reduce((s, x) => s + x.count, 0),
      },
    },

    /** 域显示名，前端画图时用（保证和面板按钮一致） */
    labels: {
      sales: nameOf('sales'),
      contract: nameOf('contract'),
      visit: nameOf('visit'),
      opportunity: nameOf('opportunity'),
    },
  };
}

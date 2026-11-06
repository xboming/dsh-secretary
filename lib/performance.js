/**
 * 绩效视图：按半年/年两档，从已有记录算出考核用的指标。
 *
 * ── 为什么是「视图」不是「一类记录」 ──
 * 方案把绩效管理定性为**派生结果**，不单独存储。它不占域、不建文件，
 * 每次现算。理由和"利润率不入库"同一条：存了就有两份数字，
 * 改了原始记录忘改绩效，两个数会静默打架。
 *
 * ── 为什么只做半年和年 ──
 * 年中述职＝半年报、年终述职＝年报，不新增周期类型。
 * 月度/季度报告保留但只用于自己查看分析，不进考核——
 * 所以这里**不接受 month/quarter**，传进来直接报错，
 * 免得出现"同一段时间两个都正确"的结论。
 *
 * ── 指标为什么必须从表里选 ──
 * 方案要求"指标只能从这张表里选，表里没有的说明缺字段，不允许自由写脚本取数"。
 * 自由取数等于允许自定义口径，而口径一变，历史结论全变。
 * 这里把每个指标写死成一个函数，是**唯一允许的取数方式**。
 *
 * ── 身份是被考核方 ──
 * 算的是"我的完成情况"，用于自查和述职，不用于给别人打分。
 * 所以不做标准封存、不做防篡改审计。
 */

/** 允许的周期：只有半年和年 */
export const PERF_PERIODS = ['half', 'year'];

/**
 * 合同总额 = 主合同 + 已签收补充协议的增减。
 *
 * 这里**就地算**而不是读条目上的 total：`total` 是 decorate 现算的派生值，
 * 挂在 entryView 上，而 computePerf 拿到的是原始 entries——
 * 原始条目根本没有 total 这个字段，读了只会得到 0 且不报错。
 */
function contractTotalOf(entry) {
  const base = Number(entry?.amount) || 0;
  const list = Array.isArray(entry?.agreements) ? entry.agreements : [];
  const delta = list
    .filter((a) => a?.status === '已签收')
    .reduce((sum, a) => sum + (Number(a.amount) || 0), 0);
  return base + delta;
}

const HALF_LABEL = { H1: '上半年', H2: '下半年' };

/** 把周期键解析成时间窗口；不合法返回 null */
export function perfWindow(key, now = new Date()) {
  const text = String(key ?? '').trim();
  // 年度：2026
  const yearMatch = /^(\d{4})$/.exec(text);
  if (yearMatch) {
    const year = Number(yearMatch[1]);
    return { kind: 'year', key: `${year}`, label: `${year} 年`, year, from: new Date(year, 0, 1), to: new Date(year, 11, 31, 23, 59, 59, 999) };
  }
  // 半年度：2026-H1 / 2026-H2
  const halfMatch = /^(\d{4})-H([12])$/i.exec(text);
  if (halfMatch) {
    const year = Number(halfMatch[1]);
    const half = halfMatch[2] === '1' ? 1 : 2;
    const from = half === 1 ? new Date(year, 0, 1) : new Date(year, 6, 1);
    const to = half === 1 ? new Date(year, 5, 30, 23, 59, 59, 999) : new Date(year, 11, 31, 23, 59, 59, 999);
    return { kind: 'half', key: `${year}-H${half}`, label: `${year} 年${HALF_LABEL[`H${half}`]}`, year, from, to };
  }
  // 不传：按今天推当前期
  if (!text) {
    const year = now.getFullYear();
    const half = now.getMonth() < 6 ? 1 : 2;
    return perfWindow(`${year}-H${half}`, now);
  }
  return null;
}

/** 该时间是否落在窗口内（含端点，按本地日比较） */
function inside(value, win) {
  const time = parseTime(value);
  if (!time) return false;
  return time >= win.from.getTime() && time <= win.to.getTime();
}

function parseTime(value) {
  if (!value) return 0;
  const text = String(value).trim();
  // YYYY-MM-DD 或 YYYY-MM-DD HH:mm
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2}))?/.exec(text);
  if (!m) return 0;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4] ?? 0), Number(m[5] ?? 0));
  return Number.isNaN(d.getTime()) ? 0 : d.getTime();
}

function today0(date = new Date()) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);

/**
 * 指标表。**这是唯一允许的取数口径**，加指标只能往这里加。
 *
 * 每个指标返回 `{ value, note }`：
 *   value —— 数值或 null（null 表示"这个期算不了"，不是 0）
 *   note  —— 一句话说明口径，写进报告里
 */
const METRICS = {
  /** 商机数：期内新建 */
  opportunities: (ctx) => ({
    value: ctx.opportunitiesInWindow.length,
    note: '期内新建的商机数',
  }),

  /** 转销售数：期内转出的商机 */
  promoted: (ctx) => ({
    value: ctx.promotedInWindow.length,
    note: '期内从商机转成项目销售的条数',
  }),

  /** 转化率：分子分母都按商机创建日期归期，不重复计 */
  conversionRate: (ctx) => {
    const denom = ctx.opportunitiesInWindow.length;
    if (!denom) return { value: null, note: '期内没有新增商机' };
    return {
      value: Math.round((ctx.promotedInWindow.length / denom) * 1000) / 10,
      note: '期内转销售数 ÷ 期内新增商机数，两头都按商机创建日归期',
    };
  },

  /** 投标数：中标 + 未中标，只算招标项目 */
  bids: (ctx) => ({
    value: ctx.bidsInWindow.length,
    note: '期内出结果的招标项目（中标 + 未中标）',
  }),

  /** 中标数 */
  awards: (ctx) => ({
    value: ctx.awardsInWindow.length,
    note: '期内中标数，按成交通知日期归期',
  }),

  /** 中标率：只算招标项目 */
  awardRate: (ctx) => {
    const denom = ctx.bidsInWindow.length;
    if (!denom) return { value: null, note: '期内没有招标结果' };
    return {
      value: Math.round((ctx.awardsInWindow.length / denom) * 1000) / 10,
      note: '中标数 ÷ 投标数，只算招标项目；直签不进来',
    };
  },

  /** 中标金额 */
  awardAmount: (ctx) => ({
    value: ctx.awardsInWindow.reduce((s, e) => s + num(e.amount), 0),
    note: '期内中标金额合计（成交价格，不是合同额）',
  }),

  /** 中标利润 */
  awardProfit: (ctx) => ({
    value: ctx.awardsInWindow.reduce((s, e) => s + num(e.profit), 0),
    note: '期内中标利润合计',
  }),

  /** 利润率：现算，不入库 */
  awardMargin: (ctx) => {
    const amount = ctx.awardsInWindow.reduce((s, e) => s + num(e.amount), 0);
    const profit = ctx.awardsInWindow.reduce((s, e) => s + num(e.profit), 0);
    if (amount <= 0) return { value: null, note: '期内没有中标金额' };
    return { value: Math.round((profit / amount) * 1000) / 10, note: '中标利润 ÷ 中标金额' };
  },

  /** 直签签约数 */
  directSigned: (ctx) => ({
    value: ctx.directInWindow.filter((e) => e.awardStatus === '已中标').length,
    note: '期内签约的直签项目数',
  }),

  /** 直签金额 */
  directAmount: (ctx) => ({
    value: ctx.directInWindow.filter((e) => e.awardStatus === '已中标').reduce((s, e) => s + num(e.amount), 0),
    note: '期内直签成交金额合计',
  }),

  /** 直签平均让价幅度：谈价能力的原始材料 */
  directDiscount: (ctx) => {
    const list = ctx.directInWindow
      .filter((e) => e.awardStatus === '已中标')
      .map((e) => {
        const first = num(e.firstQuote);
        const final = num(e.finalPrice) || num(e.amount);
        if (first <= 0 || final <= 0) return null;
        return first - final;
      })
      .filter((v) => v !== null);
    if (!list.length) return { value: null, note: '期内没有可算让价的直签（需要初次报价与最终签约价都有）' };
    return {
      value: Math.round(list.reduce((s, v) => s + v, 0) / list.length),
      note: '直签（初次报价 − 最终签约价）的平均值，单位元',
    };
  },

  /** 合同额：按签订日归期，含已签收补充协议 */
  contractAmount: (ctx) => ({
    value: ctx.contractsInWindow.reduce((s, c) => s + contractTotalOf(c), 0),
    note: '期内签订的合同总额合计（含已签收补充协议的增减）',
  }),

  /** 合同数 */
  contractCount: (ctx) => ({
    value: ctx.contractsInWindow.length,
    note: '期内签订的主合同数',
  }),

  /** 回款额：按实际回款日归期 */
  collected: (ctx) => ({
    value: ctx.collectedInWindow,
    note: '期内实际到账金额合计，按实际回款日归期',
  }),

  /** 回款率：期内到账 ÷ 期内签订的合同额 */
  collectRate: (ctx) => {
    const denom = ctx.contractsInWindow.reduce((s, c) => s + contractTotalOf(c), 0);
    if (denom <= 0) return { value: null, note: '期内没有签订合同' };
    return {
      value: Math.round((ctx.collectedInWindow / denom) * 1000) / 10,
      note: '期内到账 ÷ 期内签订合同额',
    };
  },

  /** 完成率：销售域按合同签订数，其他域按完成值 */
  completionRate: (ctx) => {
    const denom = ctx.salesCreatedInWindow.length;
    if (!denom) return { value: null, note: '期内没有新建项目销售记录' };
    return {
      value: Math.round((ctx.salesSignedInWindow.length / denom) * 1000) / 10,
      note: '期内签订的主合同数 ÷ 期内新建的项目销售记录数；商机不进完成率',
    };
  },

  /** 按时率：分母是已完成的，只算有计划结束时间的 */
  onTimeRate: (ctx) => {
    const done = ctx.completedInWindow.filter((e) => e.deadline && e.completedAt);
    if (!done.length) return { value: null, note: '期内没有带期限的完成记录' };
    const onTime = done.filter((e) => parseTime(ymdOf(e.completedAt)) <= parseTime(e.deadline)).length;
    return {
      value: Math.round((onTime / done.length) * 1000) / 10,
      note: '准时完成数 ÷ 已完成的带期限记录数；和完成率是两个指标',
    };
  },

  /** 逾期数：期内结束时仍未完成且已过截止 */
  overdue: (ctx) => ({
    value: ctx.overdueAtEnd.length,
    note: '期末时仍逾期未完成的条数',
  }),
};

/** 取 YYYY-MM-DD 部分 */
function ymdOf(value) {
  const text = String(value ?? '');
  const m = /^(\d{4}-\d{2}-\d{2})/.exec(text);
  return m ? m[1] : '';
}

/** 指标清单：给面板/报告列出"有哪些可用指标" */
export function perfMetricKeys() {
  return Object.keys(METRICS);
}

/**
 * 算出某一期的绩效事实。
 *
 * 返回结构直接可以喂给报告：`{ period, label, from, to, metrics }`。
 * `metrics` 里每项是 `{ key, label, value, note }`。
 *
 * ── 归期口径（方案里逐条定过，这里照做） ──
 *   商机数      按商机创建日
 *   转化率      分子分母都按商机创建日（不按转出日，否则会超 100%）
 *   投标数      按投标截止日
 *   中标数      按收到成交通知书的日期（成交日）
 *   合同额      按签订日
 *   回款额      按实际回款日
 *   完成率      分母按项目销售记录创建日
 */
export function computePerf(entries, win) {
  const byDomain = (id) => entries.filter((e) => e.domain === id);

  const opportunities = byDomain('opportunity');
  const sales = byDomain('sales');
  const contracts = byDomain('contract');
  const done = entries.filter((e) => e.completedAt && inside(e.completedAt, win));

  const opportunitiesInWindow = opportunities.filter((e) => inside(e.created, win));
  // 转销售：看商机的 promotedAt（转化时间），但要归到**商机创建日**所在的期
  const promotedInWindow = opportunities.filter(
    (e) => e.promotedTo && inside(e.created, win) && inside(e.promotedAt, win),
  );

  // 招标项目里，本期出结果的：中标按成交日、未中标按结果公布日
  const bidInWindow = (e) =>
    e.procureMode === '招标' &&
    ((e.awardStatus === '已中标' && inside(e.awardDate, win)) ||
      (e.awardStatus === '未中标' && inside(e.resultDate, win)));
  const bidsInWindow = sales.filter(bidInWindow);
  /**
   * 中标数/中标金额**只算招标**。
   *
   * 直签虽然也记 awardStatus='已中标'（它没有等待开标这个过程，成交即中标），
   * 但它必须排除在中标率和中标金额之外——理由和"中标率只统计招标项目"同一条：
   * 直签没有和别家比价这个过程，混进来会让中标率虚高，看不出真实的投标竞争力。
   * 直签的数据走 directInWindow 单独统计。
   */
  const awardsInWindow = sales.filter(
    (e) => e.procureMode === '招标' && e.awardStatus === '已中标' && inside(e.awardDate, win),
  );

  // 直签：按成交日归期
  const directInWindow = sales.filter((e) => e.procureMode === '直签' && inside(e.awardDate, win));

  const contractsInWindow = contracts.filter((e) => inside(e.signedAt, win));

  // 回款：按每一期的实际回款日累加
  let collectedInWindow = 0;
  for (const contract of contracts) {
    const list = Array.isArray(contract.installments) ? contract.installments : [];
    for (const item of list) {
      if (item.exempt === true) continue;
      if (!item.paidAt) continue;
      if (!inside(item.paidAt, win)) continue;
      collectedInWindow += num(item.amount);
    }
  }

  const salesCreatedInWindow = sales.filter((e) => inside(e.created, win));
  // 期内签订的主合同 → 反查它来自哪条项目销售
  const signedIds = new Set(contractsInWindow.map((c) => c.origin).filter(Boolean));
  const salesSignedInWindow = sales.filter((e) => signedIds.has(e.id));

  // 期末仍逾期：deadline 早于期末，且到现在都没完成
  const endTime = Math.min(win.to.getTime(), Date.now());
  const overdueAtEnd = entries.filter((e) => {
    if (!e.deadline) return false;
    const due = parseTime(e.deadline);
    if (!due || due >= endTime) return false;
    const completed = parseTime(e.completedAt);
    return !completed || completed > endTime;
  });

  const ctx = {
    opportunitiesInWindow,
    promotedInWindow,
    bidsInWindow,
    awardsInWindow,
    directInWindow,
    contractsInWindow,
    collectedInWindow,
    salesCreatedInWindow,
    salesSignedInWindow,
    completedInWindow: done,
    overdueAtEnd,
  };

  const labels = {
    opportunities: '新增商机',
    promoted: '转销售',
    conversionRate: '转化率(%)',
    bids: '投标数',
    awards: '中标数',
    awardRate: '中标率(%)',
    awardAmount: '中标金额(元)',
    awardProfit: '中标利润(元)',
    awardMargin: '利润率(%)',
    directSigned: '直签签约数',
    directAmount: '直签金额(元)',
    directDiscount: '直签平均让价(元)',
    contractAmount: '合同额(元)',
    contractCount: '合同数',
    collected: '回款额(元)',
    collectRate: '回款率(%)',
    completionRate: '完成率(%)',
    onTimeRate: '按时率(%)',
    overdue: '期末逾期数',
  };

  const metrics = Object.entries(METRICS).map(([key, fn]) => {
    const { value, note } = fn(ctx);
    return { key, label: labels[key] ?? key, value, note };
  });

  return { metrics };
}

/**
 * 把绩效事实整理成一段可读的文本。
 *
 * 为什么单独一个渲染函数：报告与面板都要用，两处各写一遍
 * 迟早会长出两套措辞，而"同一套数据两种说法"正是方案要避免的。
 */
export function renderPerf(facts) {
  const lines = [`${facts.label}（${facts.from} ~ ${facts.to}）`, ''];
  for (const item of facts.metrics) {
    const shown = item.value === null ? '—' : item.value;
    lines.push(`· ${item.label}：${shown}`);
  }
  return lines.join('\n');
}

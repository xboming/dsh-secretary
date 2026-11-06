/**
 * 数据看板：跨域的全局视角。
 *
 * ── 它和另外三个东西的分工 ──
 *   snapshot    —— **今天**的状态：哪些待办、哪些逾期。回答"我现在该做什么"
 *   report      —— **单域单周期**的统计，落成一份文档。回答"这个月工作域怎么样"
 *   performance —— **半年/年度**的考核指标。回答"我这一期成绩如何"
 *   本模块      —— **跨域、看整体**。回答"我手上这些货，整体是什么形态"
 *
 * 四者口径互不重叠。看板不产出文档、不落盘，每次现算。
 *
 * ── 为什么摘要只放四个数 ──
 * 它常驻在面板顶部，占的是一行高度。多一个数就挤一分，
 * 挤到后面就没人看。所以只留"变了就该动手"的那几个：
 *   在办、该收的钱、逾期的钱、卡住的事。
 * 其余细节折叠到悬浮提示里，鼠标停上去才展开。
 */

import {
  contractTotal,
  collectedSum,
  overdueInstallments,
  pendingAgreements,
  reconcileInstallments,
} from './contracts.js';

/** 数字兜底 */
const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);

/** 解析 YYYY-MM-DD（或带时间）成本地时间戳；无效返回 0 */
function timeOf(value) {
  if (!value) return 0;
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2}))?/.exec(String(value).trim());
  if (!m) return 0;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4] ?? 0), Number(m[5] ?? 0));
  return Number.isNaN(d.getTime()) ? 0 : d.getTime();
}

/** YYYY-MM */
function monthKeyOf(ts) {
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

/**
 * 金额缩写：3200000 → "320万"
 *
 * 顶部只给一行，完整数字（3,200,000）读起来太慢，
 * 而且宽度会随金额位数跳动。缩写后宽度稳定。
 * 万以下仍然给原数，避免"0.3万"这种更难读的形式。
 */
export function compactMoney(value) {
  const n = num(value);
  const abs = Math.abs(n);
  if (abs === 0) return '0';
  if (abs < 10000) return String(Math.round(n));
  const wan = n / 10000;
  // 100 万以下保留一位小数，再大就取整——"1234.5万"这种精度没人需要
  const shown = Math.abs(wan) >= 100 ? Math.round(wan) : Math.round(wan * 10) / 10;
  return `${shown}万`;
}

/**
 * 算看板。
 *
 * @param {Array} entries 全部条目（已解析，含 agreements/installments）
 * @param {object} options { now, isWorkday }
 */
export function computeBoard(entries, options = {}) {
  const now = options.now instanceof Date ? options.now : new Date();
  const byDomain = (id) => entries.filter((e) => e.domain === id);

  const opportunities = byDomain('opportunity');
  const sales = byDomain('sales');
  const contracts = byDomain('contract');
  const implements_ = byDomain('implement');
  const visits = byDomain('visit');

  /* ---------------- ① 销售漏斗 ---------------- */

  /**
   * 四个环节的存量与金额。
   *
   * 口径是按**记录当前所处的域**算，不是按状态——
   * 一条商机转成项目销售后，它在商机域里被标成「已转销售」，
   * 真正还在推进的是项目销售域那条。所以漏斗各段互不重叠。
   */
  const openOpportunities = opportunities.filter((e) => !e.promotedTo);
  const salesInFlight = sales.filter((e) => e.awardStatus === '未定');
  /**
   * 合同段：除了「已解除」以外都算在手上。
   *
   * 最初只算 草拟/已签订/履行中，结果**刚转过来还没填状态的合同全被漏掉**——
   * 它们停在默认的「草拟」，而那正是最常见的中间态（刚从销售转过来、还没签约）。
   * 用排除法（排除已解除）而不是列举法，新加状态时不会漏。
   */
  const contractsActive = contracts.filter((e) => e.status !== '已解除' && e.status !== '已完成');
  const implementActive = implements_.filter((e) => e.status !== '已终止' && e.status !== '已验收');

  /** 在这一段里停留最久的那条（按 created 算天数） */
  function longestStuck(list) {
    let best = null;
    for (const item of list) {
      const ts = timeOf(item.created);
      if (!ts) continue;
      const days = Math.floor((now.getTime() - ts) / 86400000);
      if (!best || days > best.days) best = { id: item.id, title: item.title, days };
    }
    return best;
  }

  const funnel = [
    {
      key: 'opportunity',
      label: '商机',
      count: openOpportunities.length,
      amount: openOpportunities.reduce((s, e) => s + num(e.estimate), 0),
      amountLabel: '预期',
      stuck: longestStuck(openOpportunities),
    },
    {
      key: 'sales',
      label: '项目销售',
      count: salesInFlight.length,
      amount: salesInFlight.reduce((s, e) => s + num(e.ourQuote), 0),
      amountLabel: '在报',
      stuck: longestStuck(salesInFlight),
    },
    {
      key: 'contract',
      label: '合同',
      count: contractsActive.length,
      amount: contractsActive.reduce((s, e) => s + contractTotal(e), 0),
      amountLabel: '在履',
      stuck: longestStuck(contractsActive),
    },
    {
      key: 'implement',
      label: '实施',
      count: implementActive.length,
      amount: implementActive.reduce((s, e) => s + num(e.amount), 0),
      amountLabel: '在交',
      stuck: longestStuck(implementActive),
    },
  ];

  /* ---------------- ② 回款水位 ---------------- */

  /**
   * 把所有合同的期次摊平，按计划回款日聚合。
   *
   * 「应收」= 所有未免除的期次金额之和（含已收的）。
   * 用合同总额会高估：补充协议没对平的部分根本还没排进期次。
   * 所以口径统一走期次，和"回款率按已签收补充协议算"是两套数，
   * 这里给的是"按合同约定的付款计划，我还有多少没收到"。
   */
  let receivable = 0;
  let received = 0;
  let overdueAmount = 0;
  let overdueCount = 0;
  let dueThisMonth = 0;
  const overdueList = [];
  const thisMonth = monthKeyOf(now.getTime());

  for (const contract of contracts) {
    if (contract.status === '已解除') continue; // 解除的合同不再按原计划要钱
    const list = Array.isArray(contract.installments) ? contract.installments : [];
    for (const item of list) {
      if (item.exempt === true) continue;
      const amount = num(item.amount);
      if (amount <= 0) continue;
      receivable += amount;
      if (item.paidAt) {
        received += amount;
        continue;
      }
      const dueTs = timeOf(item.dueAt);
      if (!dueTs) continue;
      if (monthKeyOf(dueTs) === thisMonth) dueThisMonth += amount;
      if (dueTs < now.getTime()) {
        overdueAmount += amount;
        overdueCount += 1;
        overdueList.push({
          contractId: contract.id,
          contractTitle: contract.title,
          customer: contract.customer ?? null,
          name: item.name,
          amount,
          dueAt: item.dueAt,
          days: Math.max(0, Math.floor((now.getTime() - dueTs) / 86400000)),
        });
      }
    }
  }
  overdueList.sort((a, b) => b.days - a.days);

  const payments = {
    receivable,
    received,
    outstanding: Math.max(0, receivable - received),
    overdueAmount,
    overdueCount,
    dueThisMonth,
    overdue: overdueList.slice(0, 5),
    contractsWithOverdue: new Set(overdueList.map((i) => i.contractId)).size,
  };

  /* ---------------- ③ 近 12 个月节奏 ---------------- */

  /**
   * 每月新建数、完成数。
   *
   * 只统计**事项类**记录（流水域和日志域没有"完成"这个概念，
   * 把它们算进完成率会失真——这一点报告模块已经踩过坑）。
   */
  const countedDomains = new Set(['work', 'opportunity', 'sales', 'contract', 'implement', 'visit', 'creation']);
  const months = [];
  for (let i = 11; i >= 0; i -= 1) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    months.push({ key: monthKeyOf(d.getTime()), label: `${d.getMonth() + 1}月`, created: 0, completed: 0 });
  }
  const index = new Map(months.map((m) => [m.key, m]));

  for (const entry of entries) {
    if (!countedDomains.has(entry.domain)) continue;
    const createdTs = timeOf(entry.created);
    if (createdTs) {
      const bucket = index.get(monthKeyOf(createdTs));
      if (bucket) bucket.created += 1;
    }
    const doneTs = timeOf(entry.completedAt);
    if (doneTs) {
      const bucket = index.get(monthKeyOf(doneTs));
      if (bucket) bucket.completed += 1;
    }
  }

  const peakCreated = months.reduce((m, x) => Math.max(m, x.created), 0);
  const trend = {
    months,
    peak: peakCreated,
    // 本月与上月对比：忙了还是闲了
    thisMonth: months[months.length - 1],
    lastMonth: months[months.length - 2] ?? null,
  };

  /* ---------------- ④ 风险清单 ---------------- */

  /**
   * 只放"会变成实际损失"的四类，按钱和不可逆性排序。
   *
   * 不放"逾期任务"——那个已经每天在提醒里了，
   * 看板重复一遍等于把提醒变成两处，用户会开始忽略其中一处。
   */
  const risks = [];

  if (overdueCount) {
    risks.push({
      kind: 'payOverdue',
      level: 'high',
      label: '回款逾期',
      count: overdueCount,
      amount: overdueAmount,
      note: `${payments.contractsWithOverdue} 份合同 · 逾期 ${overdueList[0]?.days ?? 0} 天起`,
      ids: [...new Set(overdueList.map((i) => i.contractId))],
    });
  }

  // 协议待签收
  let pendingCount = 0;
  const pendingContracts = [];
  for (const contract of contracts) {
    if (contract.status === '已解除') continue;
    const list = pendingAgreements(contract);
    if (list.length) {
      pendingCount += list.length;
      pendingContracts.push(contract.id);
    }
  }
  if (pendingCount) {
    risks.push({
      kind: 'agreementPending',
      level: 'medium',
      label: '协议待签收',
      count: pendingCount,
      note: '签收后才计入合同总额',
      ids: pendingContracts,
    });
  }

  // 期次没对平
  const unbalanced = contracts.filter((c) => {
    if (c.status === '已解除') return false;
    const r = reconcileInstallments(c);
    // 期次为空时算"没排"，不算"没对平"——还没排期是新合同的正常状态
    return r.sum > 0 && !r.ok;
  });
  if (unbalanced.length) {
    risks.push({
      kind: 'notReconciled',
      level: 'medium',
      label: '期次未对平',
      count: unbalanced.length,
      amount: unbalanced.reduce((s, c) => s + reconcileInstallments(c).diff, 0),
      note: '期次合计与合同总额不等',
      ids: unbalanced.map((c) => c.id),
    });
  }

  // 长期停滞（超过域阈值两倍还没动）
  const stalledHard = [];
  for (const entry of entries) {
    if (!countedDomains.has(entry.domain)) continue;
    if (entry.completedAt || entry.promotedTo) continue;
    const last = timeOf(entry.updated ?? entry.created);
    if (!last) continue;
    const days = Math.floor((now.getTime() - last) / 86400000);
    // 30 天一刀切：各域自己的停滞阈值在提醒里已经用过了，
    // 这里要的是"烂得比较久"，不是"该提醒了"
    if (days >= 30) stalledHard.push({ id: entry.id, title: entry.title, domain: entry.domain, days });
  }
  stalledHard.sort((a, b) => b.days - a.days);
  if (stalledHard.length) {
    risks.push({
      kind: 'stalled',
      level: 'low',
      label: '长期停滞',
      count: stalledHard.length,
      note: `最久 ${stalledHard[0].days} 天没动`,
      ids: stalledHard.slice(0, 10).map((s) => s.id),
    });
  }

  /* ---------------- 顶部摘要 ---------------- */

  /**
   * 一行四个数，顺序按"看到之后要动手的紧迫度"：
   *   该收的钱 > 逾期的钱 > 在办的货 > 卡住的事
   *
   * 全部为 0 时摘要只显示"手上是空的"，不显示四个 0——
   * 一排零比不显示更吵。
   */
  /**
   * 在办数：只算**事项类**域。
   *
   * 不含灵感（流水，本来就没有"办完"这回事）和助手（经验教训库）。
   * 把它们算进去会让"在办"变成一个永远不降的数字——灵感只会越积越多，
   * 用户看到 40 条"在办"但实际待办只有 3 件，那个数字就废了。
   */
  const openCount = entries.filter((e) => {
    if (!countedDomains.has(e.domain)) return false;
    if (e.completedAt || e.promotedTo) return false;
    return true;
  }).length;

  const summary = {
    open: openCount,
    outstanding: payments.outstanding,
    overdueAmount,
    riskCount: risks.reduce((s, r) => s + r.count, 0),
    // 给前端直接渲染的短文本
    money: `待收 ${compactMoney(payments.outstanding)}`,
    overdue: overdueAmount > 0 ? `逾期 ${compactMoney(overdueAmount)}` : null,
    // 本月该收（悬浮才显示）
    dueThisMonth,
    received: payments.received,
  };

  /* ---------------- 业务分布（补充视角） ---------------- */

  /**
   * 各域的在办数。看板不放图表，只给数——面板宽度有限，
   * 十几条记录的柱状图读起来不如数字直接。
   */
  const byDomainCount = {};
  for (const entry of entries) {
    if (entry.completedAt || entry.promotedTo) continue;
    byDomainCount[entry.domain] = (byDomainCount[entry.domain] ?? 0) + 1;
  }

  return {
    generatedAt: `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`,
    summary,
    funnel,
    payments,
    trend,
    risks,
    byDomain: byDomainCount,
    // 拜访这一层单独给，它不在漏斗上但有节奏意义
    visits: {
      total: visits.length,
      thisMonth: visits.filter((v) => {
        const ts = timeOf(v.created ?? v.planDate);
        return ts && monthKeyOf(ts) === thisMonth;
      }).length,
    },
  };
}

/**
 * 数据看板：按**一段时间**看各项工作的整体情况。
 *
 * ── 它和另外三个东西的分工 ──
 *   snapshot    —— 今天的状态：哪些待办、哪些逾期。回答"我现在该做什么"
 *   report      —— 单域单周期，落成一份文档
 *   performance —— 半年/年度的考核指标
 *   本模块      —— **跨域 + 可切换时间窗口**。回答"这段时间我各方面干得怎么样"
 *
 * ── 时间窗口是它的骨架 ──
 * 同样是"在办 5 件"，放在"本月"和"今年"里含义完全不同。
 * 所以每个数都必须标明自己是**期内新增**、**期内完成**，还是**期末余额**——
 * 混在一起是这类看板最容易犯的错（用户会拿期内新增当存量读）。
 *
 * 本模块给三种窗口：本月、本季、自定义区间。
 */

import {
  contractTotal,
  pendingAgreements,
  reconcileInstallments,
} from './contracts.js';

const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);

/** 解析 YYYY-MM-DD（或带时间）成本地时间戳；无效返回 0 */
export function timeOf(value) {
  if (!value) return 0;
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2}))?/.exec(String(value).trim());
  if (!m) return 0;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4] ?? 0), Number(m[5] ?? 0));
  return Number.isNaN(d.getTime()) ? 0 : d.getTime();
}

const pad = (n) => String(n).padStart(2, '0');
const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const monthKeyOf = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;

/**
 * 把窗口标识解析成 { key, label, from, to }。
 *
 * `from` / `to` 都是**本地零点**；`to` 指向窗口最后一天的零点，
 * 判断"在不在窗口内"时用它 + 一天的毫秒。
 */
export function resolveWindow(kind, options = {}) {
  const now = options.now instanceof Date ? options.now : new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  if (kind === 'month') {
    const from = new Date(now.getFullYear(), now.getMonth(), 1);
    const to = new Date(now.getFullYear(), now.getMonth() + 1, 0);
    return { key: 'month', kind: 'month', label: `${now.getFullYear()} 年 ${now.getMonth() + 1} 月`, from, to };
  }

  if (kind === 'quarter') {
    const q = Math.floor(now.getMonth() / 3);
    const from = new Date(now.getFullYear(), q * 3, 1);
    const to = new Date(now.getFullYear(), q * 3 + 3, 0);
    return { key: 'quarter', kind: 'quarter', label: `${now.getFullYear()} 年 第 ${q + 1} 季度`, from, to };
  }

  if (kind === 'custom') {
    const from = options.from ? new Date(`${options.from}T00:00:00`) : null;
    const to = options.to ? new Date(`${options.to}T00:00:00`) : null;
    if (!from || !to || Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
      // 参数不合法时回落到本月，而不是报错——看板是只读视图，缺参数不该让页面白屏
      return resolveWindow('month', options);
    }
    // 允许用户把起止写反：自动对调，比报错友好
    const [start, end] = from <= to ? [from, to] : [to, from];
    return {
      key: 'custom',
      kind: 'custom',
      label: `${ymd(start)} ~ ${ymd(end)}`,
      from: start,
      to: end,
    };
  }

  return resolveWindow('month', options);
}

/** 时间段判断：`value` 的时刻是否落在 [from, to] 这一整段里 */
function inside(value, win) {
  const ts = timeOf(value);
  if (!ts) return false;
  return ts >= win.from.getTime() && ts <= win.to.getTime() + 86399999;
}

/**
 * 金额缩写：3200000 → "320万"
 *
 * 看板是扫视用的，完整数字（3,200,000）读起来太慢，宽度也会随位数跳动。
 * 万以下仍给原数，避免"0.3万"这种更难读的形式。
 */
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

/** 哪些域算"事项"（有完成概念，进统计）。流水与经验教训库不算。 */
const COUNTED = new Set(['work', 'opportunity', 'sales', 'contract', 'implement', 'visit', 'creation']);

/**
 * 算看板。
 *
 * @param {Array} entries 全部条目
 * @param {object} options { now, window, domains }
 *   window —— resolveWindow 的结果；不传按本月
 *   domains —— 域声明（用来取显示名与顺序），不传则用 id
 */
export function computeBoard(entries, options = {}) {
  const now = options.now instanceof Date ? options.now : new Date();
  const win = options.window ?? resolveWindow('month', { now });
  const domainList = Array.isArray(options.domains) ? options.domains : [];

  /** 域显示名：有声明用声明的，没有就退回 id */
  const nameOf = (id) => domainList.find((d) => d.id === id)?.name ?? id;
  /** 未完成：没有完成时间、也没转出去 */
  const isOpen = (e) => !e.completedAt && !e.promotedTo;

  /* ================= ① 每个领域一行汇总 ================= */

  /**
   * 每行四个数，全部标明口径：
   *   在办   —— **期末余额**（当前还没收口的条数），不受窗口影响
   *   新增   —— **期内**按 created 归期
   *   完成   —— **期内**按 completedAt 归期
   *   逾期   —— **期末余额**（当前已过截止仍未完成）
   *
   * 「在办」和「逾期」是余额不是流量，这点必须在标签上写清楚，
   * 否则用户会把"本月新增 3 件"和"在办 12 件"放在一起乱比。
   */
  const domainRows = [];
  for (const id of COUNTED) {
    const items = entries.filter((e) => e.domain === id);
    if (!items.length) continue;
    const openItems = items.filter(isOpen);
    const row = {
      id,
      name: nameOf(id),
      open: openItems.length,
      created: items.filter((e) => inside(e.created, win)).length,
      completed: items.filter((e) => inside(e.completedAt, win)).length,
      overdue: openItems.filter((e) => {
        const due = timeOf(e.deadline);
        return due > 0 && due < now.getTime();
      }).length,
    };
    // 一行都没有数的域不占位置
    if (row.open || row.created || row.completed || row.overdue) domainRows.push(row);
  }
  // 按域声明的顺序排（事务 → 客户交流 → 商机 → …），保证看板和面板一致
  const orderOf = (id) => {
    const d = domainList.find((x) => x.id === id);
    return Number.isFinite(d?.order) ? d.order : 999;
  };
  domainRows.sort((a, b) => orderOf(a.id) - orderOf(b.id));

  /* ================= ② 销售链条漏斗 ================= */

  /**
   * 四个环节的**当前存量**（不是期内流量）。
   * 漏斗回答"我手上这些货现在分布在哪一段"，是和窗口无关的快照。
   *
   * 用排除法判"在办"而不是列举法：除已解除/已完成之外都算。
   * 列举法漏掉过刚转入还在默认状态的记录。
   */
  const sales = entries.filter((e) => e.domain === 'sales');
  const contracts = entries.filter((e) => e.domain === 'contract');
  const implementItems = entries.filter((e) => e.domain === 'implement');
  const opportunities = entries.filter((e) => e.domain === 'opportunity');

  const segOpenOpportunities = opportunities.filter((e) => !e.promotedTo);
  const segSalesInFlight = sales.filter((e) => e.awardStatus === '未定');
  const segContractsActive = contracts.filter((e) => e.status !== '已解除' && e.status !== '已完成');
  const segImplementActive = implementItems.filter((e) => e.status !== '已终止' && e.status !== '已验收');

  /** 这一段里停留最久的那条（按 created 算天数） */
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
      label: nameOf('opportunity'),
      count: segOpenOpportunities.length,
      amount: segOpenOpportunities.reduce((s, e) => s + num(e.estimate), 0),
      amountLabel: '预期',
      stuck: longestStuck(segOpenOpportunities),
    },
    {
      key: 'sales',
      label: nameOf('sales'),
      count: segSalesInFlight.length,
      amount: segSalesInFlight.reduce((s, e) => s + num(e.ourQuote), 0),
      amountLabel: '在报',
      stuck: longestStuck(segSalesInFlight),
    },
    {
      key: 'contract',
      label: nameOf('contract'),
      count: segContractsActive.length,
      amount: segContractsActive.reduce((s, e) => s + contractTotal(e), 0),
      amountLabel: '在履',
      stuck: longestStuck(segContractsActive),
    },
    {
      key: 'implement',
      label: nameOf('implement'),
      count: segImplementActive.length,
      amount: segImplementActive.reduce((s, e) => s + num(e.amount), 0),
      amountLabel: '在交',
      stuck: longestStuck(segImplementActive),
    },
  ];

  /* ================= ③ 回款情况 ================= */

  /**
   * 两个视角放在一起，因为它们是不同的问题：
   *   · 台账视角（不受窗口影响）：我一共应收多少、已收多少、还差多少
   *   · 期间视角（受窗口影响）：**这段时间**应该收多少、实际收到多少
   *
   * 期间视角按每一期的**计划回款日**归期算"该收"，
   * 按**实际回款日**归期算"收到"——这两个日期可以落在不同窗口，
   * 所以必须分开算，不能拿"该收"减"收到"当"没收到"。
   */
  let receivable = 0;
  let received = 0;
  let overdueAmount = 0;
  let overdueCount = 0;
  let dueInWindow = 0;
  let receivedInWindow = 0;
  const overdueList = [];

  for (const contract of contracts) {
    if (contract.status === '已解除') continue;
    const list = Array.isArray(contract.installments) ? contract.installments : [];
    for (const item of list) {
      if (item.exempt === true) continue;
      const amount = num(item.amount);
      if (amount <= 0) continue;
      receivable += amount;

      const dueTs = timeOf(item.dueAt);
      const paidTs = timeOf(item.paidAt);

      // 期间视角
      if (dueTs && inside(item.dueAt, win)) dueInWindow += amount;
      if (paidTs && inside(item.paidAt, win)) receivedInWindow += amount;

      if (paidTs) {
        received += amount;
        continue;
      }
      if (!dueTs) continue;
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
    // 台账余额（不受窗口影响）
    receivable,
    received,
    outstanding: Math.max(0, receivable - received),
    overdueAmount,
    overdueCount,
    overdue: overdueList.slice(0, 6),
    contractsWithOverdue: new Set(overdueList.map((i) => i.contractId)).size,
    // 期间口径
    dueInWindow,
    receivedInWindow,
    windowRate: dueInWindow > 0 ? Math.round((receivedInWindow / dueInWindow) * 1000) / 10 : null,
  };

  /* ================= ④ 月度趋势 ================= */

  /**
   * 窗口内的逐月新建与完成。
   *
   * 窗口是"本月"时只有一根柱子——那没意义，所以**趋势图始终给 12 个月**，
   * 但高亮落在窗口内的那些月。这样无论选哪个窗口，都能看出"这个月是不是特别忙"。
   */
  const months = [];
  for (let i = 11; i >= 0; i -= 1) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const from = d.getTime();
    const to = new Date(d.getFullYear(), d.getMonth() + 1, 0).getTime() + 86399999;
    const inWindow = to >= win.from.getTime() && from <= win.to.getTime() + 86399999;
    months.push({
      key: monthKeyOf(d),
      label: `${d.getMonth() + 1}月`,
      created: 0,
      completed: 0,
      inWindow,
    });
  }
  const monthIndex = new Map(months.map((m) => [m.key, m]));

  for (const entry of entries) {
    if (!COUNTED.has(entry.domain)) continue;
    const createdTs = timeOf(entry.created);
    if (createdTs) {
      const bucket = monthIndex.get(monthKeyOf(new Date(createdTs)));
      if (bucket) bucket.created += 1;
    }
    const doneTs = timeOf(entry.completedAt);
    if (doneTs) {
      const bucket = monthIndex.get(monthKeyOf(new Date(doneTs)));
      if (bucket) bucket.completed += 1;
    }
  }

  const peak = months.reduce((m, x) => Math.max(m, x.created, x.completed), 0);
  const trend = { months, peak };

  /* ================= 风险 ================= */

  /**
   * 只放"会变成实际损失"的，按钱与不可逆性排序。
   * 不放"逾期任务"——它已经每天在提醒里了，看板重复一遍
   * 等于把提醒变成两处，用户会开始忽略其中一处。
   */
  const risks = [];

  if (overdueCount) {
    risks.push({
      kind: 'payOverdue',
      level: 'high',
      label: '回款逾期',
      count: overdueCount,
      amount: overdueAmount,
      note: `${payments.contractsWithOverdue} 份合同 · 最久 ${overdueList[0]?.days ?? 0} 天`,
      ids: [...new Set(overdueList.map((i) => i.contractId))],
    });
  }

  let pendingCount = 0;
  const pendingIds = [];
  for (const contract of contracts) {
    if (contract.status === '已解除') continue;
    const list = pendingAgreements(contract);
    if (list.length) {
      pendingCount += list.length;
      pendingIds.push(contract.id);
    }
  }
  if (pendingCount) {
    risks.push({
      kind: 'agreementPending',
      level: 'medium',
      label: '协议待签收',
      count: pendingCount,
      note: '签收后才计入合同总额',
      ids: pendingIds,
    });
  }

  const unbalanced = contracts.filter((c) => {
    if (c.status === '已解除') return false;
    const r = reconcileInstallments(c);
    // 期次为空算"还没排"，不算"没对平"——刚立的新合同本来就没排
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

  const stalledHard = [];
  for (const entry of entries) {
    if (!COUNTED.has(entry.domain)) continue;
    if (!isOpen(entry)) continue;
    const last = timeOf(entry.updated ?? entry.created);
    if (!last) continue;
    const days = Math.floor((now.getTime() - last) / 86400000);
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

  /* ================= 汇总 ================= */

  const totals = {
    open: entries.filter((e) => COUNTED.has(e.domain) && isOpen(e)).length,
    created: entries.filter((e) => COUNTED.has(e.domain) && inside(e.created, win)).length,
    completed: entries.filter((e) => COUNTED.has(e.domain) && inside(e.completedAt, win)).length,
    // 完成率＝期内完成 ÷ 期内新建。分母为 0 时给 null，不是 0
    completionRate:
      entries.filter((e) => COUNTED.has(e.domain) && inside(e.created, win)).length
        ? Math.round(
            (entries.filter((e) => COUNTED.has(e.domain) && inside(e.completedAt, win)).length /
              entries.filter((e) => COUNTED.has(e.domain) && inside(e.created, win)).length) *
              1000,
          ) / 10
        : null,
  };

  return {
    window: {
      kind: win.kind,
      key: win.key,
      label: win.label,
      from: ymd(win.from),
      to: ymd(win.to),
      // 方便前端判断"是不是当前正在进行的窗口"
      isCurrent: now.getTime() >= win.from.getTime() && now.getTime() <= win.to.getTime() + 86399999,
    },
    generatedAt: `${ymd(now)} ${pad(now.getHours())}:${pad(now.getMinutes())}`,
    /**
     * 顶部摘要条用的四个数。
     *
     * 面板顶部那条常驻摘要只放四个数（在办/待收/逾期/风险），
     * 它读的就是这里。看板页本身用下面的 totals + 各区块。
     * 两处共用同一份计算结果，避免摘要和页面数字对不上。
     */
    summary: {
      open: totals.open,
      outstanding: payments.outstanding,
      overdueAmount: payments.overdueAmount,
      riskCount: risks.reduce((s, r) => s + r.count, 0),
      money: `待收 ${compactMoney(payments.outstanding)}`,
      overdue: payments.overdueAmount > 0 ? `逾期 ${compactMoney(payments.overdueAmount)}` : null,
    },
    totals,
    domains: domainRows,
    funnel,
    payments,
    trend,
    risks,
  };
}

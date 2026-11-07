/** Read-only business views. Period flows and current balances are never mixed in a rate. */
import { rel } from './reloadable.js';
const { BUILTIN_DOMAINS, completionValuesOf, dropValuesOf, doneFieldOf } = await import(rel('./domains.js', import.meta.url));
const { contractTotal } = await import(rel('./contracts.js', import.meta.url));

const DAY = 86400000;
const finite = (v) => v !== null && v !== '' && v !== undefined && Number.isFinite(Number(v));
const number = (v) => finite(v) ? Number(v) : 0;
const date = (value) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(value ?? ''));
  if (!m) return null;
  const d = new Date(+m[1], +m[2] - 1, +m[3]);
  return d.getFullYear() === +m[1] && d.getMonth() === +m[2] - 1 && d.getDate() === +m[3] ? d : null;
};
const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const ratio = (n, d) => d > 0 ? Math.round(n / d * 1000) / 10 : null;

/** At most 12 readable buckets, covering exactly the selected dates (including historical years). */
function buckets(win) {
  const days = Math.round((Date.UTC(win.to.getFullYear(), win.to.getMonth(), win.to.getDate()) - Date.UTC(win.from.getFullYear(), win.from.getMonth(), win.from.getDate())) / DAY) + 1;
  const months = (win.to.getFullYear() - win.from.getFullYear()) * 12 + win.to.getMonth() - win.from.getMonth() + 1;
  const result = [];
  let start = new Date(win.from);
  while (start <= win.to && result.length < 12) {
    const end = days <= 31
      ? new Date(start.getFullYear(), start.getMonth(), start.getDate() + 6)
      : new Date(start.getFullYear(), start.getMonth() + Math.ceil(months / 12), 0);
    const stop = end > win.to ? new Date(win.to) : end;
    const label = days <= 31 ? `${start.getMonth() + 1}/${start.getDate()}` : months <= 12 ? `${start.getMonth() + 1}月` : `${start.getFullYear()}/${start.getMonth() + 1}`;
    result.push({ key: iso(start), label, from: iso(start), to: iso(stop), start: +start, end: +stop + DAY - 1 });
    start = new Date(stop.getFullYear(), stop.getMonth(), stop.getDate() + 1);
  }
  return result;
}

export function buildBoardViews(entries, { window: win, now = new Date(), domains = [], compare = true }) {
  const domainOf = (id) => domains.find(d => d.id === id) ?? BUILTIN_DOMAINS.find(d => d.id === id);
  const inPeriod = (value) => { const d = date(value); return d !== null && d >= win.from && d <= win.to; };
  const asOf = (value) => { const d = date(value); return d !== null && d <= win.to; };
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const elapsed = (value) => { const d = date(value); return d ? Math.floor((today - d) / DAY) : null; };
  const done = (e) => { const d = domainOf(e.domain); return d && completionValuesOf(d).includes(e[doneFieldOf(d)]); };
  const closed = (e) => { const d = domainOf(e.domain); return done(e) || (d && dropValuesOf(d).includes(e[doneFieldOf(d)])); };
  const byDomain = id => entries.filter(e => e.domain === id);
  const sales = byDomain('sales'), opportunities = byDomain('opportunity'), contracts = byDomain('contract'), visits = byDomain('visit');
  const won = sales.filter(done);
  const signed = contracts.filter(c => inPeriod(c.signedAt));
  const newOpp = opportunities.filter(e => inPeriod(e.created));
  const newSales = sales.filter(e => inPeriod(e.created));
  const completedVisits = visits.filter(e => done(e) && inPeriod(e.completedAt));
  const plannedVisits = visits.filter(e => inPeriod(e.planDate || e.created));
  const salesIds = new Set(sales.map(e => e.id));
  // A created cohort, measured as of period end. A conversion into another domain is not a sale.
  const converted = newOpp.filter(e => salesIds.has(e.promotedTo) && asOf(e.promotedAt));
  const tenderWins = won.filter(e => e.procureMode === '招标' && inPeriod(e.awardDate));
  const tenderLosses = sales.filter(e => e.procureMode === '招标' && closed(e) && !done(e) && inPeriod(e.resultDate));
  const directWins = won.filter(e => e.procureMode === '直签' && inPeriod(e.awardDate));
  const signedOrigins = new Set(contracts.filter(c => date(c.signedAt)).map(c => c.origin).filter(Boolean));
  const signedContractIds = new Set(contracts.filter(c => date(c.signedAt)).map(c => c.id));
  const unsigned = won.filter(e => !signedOrigins.has(e.id) && !signedContractIds.has(e.promotedTo));
  const active = entries.filter(e => ['work', 'opportunity', 'sales', 'implement', 'visit', 'creation'].includes(e.domain) && !closed(e));
  const overdueTasks = active.filter(e => elapsed(e.deadline) > 0);
  const stale = active.filter(e => elapsed(e.lastAt || e.updated || e.updatedAt || e.created) >= 14);

  const installments = contracts.flatMap(c => (Array.isArray(c.installments) ? c.installments : [])
    .filter(p => p.exempt !== true).map(p => ({ ...p, contractId: c.id })));
  const receipts = installments.filter(p => inPeriod(p.paidAt));
  // Unknown or malformed payment dates are not silently classified as unpaid or as receipts.
  const unpaid = installments.filter(p => !p.paidAt);
  const overdue = unpaid.filter(p => elapsed(p.dueAt) > 0);
  const sum = (list, field = 'amount') => list.reduce((total, e) => total + number(e[field]), 0);
  const knownSum = list => list.length && list.every(e => !finite(e.amount)) ? null : sum(list);
  const missingAmount = list => list.filter(e => !finite(e.amount)).length;
  const signedAmount = signed.length && signed.every(c => !finite(c.amount)) ? null : signed.reduce((n, c) => n + contractTotal(c), 0);
  const signedNote = '本期签订 · 含已签收补充协议' + (missingAmount(signed) ? ` · ${missingAmount(signed)} 份基础金额待补` : '');
  const missingResults = sales.filter(e => closed(e) && !date(done(e) ? e.awardDate : e.resultDate)).length;
  const noSchedule = contracts.filter(c => date(c.signedAt) && contractTotal(c) > 0 && !(c.installments?.length)).length;
  const issueCounts = [
    { label: '成交结果缺日期', value: missingResults },
    { label: '已完成交流缺日期', value: visits.filter(e => done(e) && !date(e.completedAt)).length },
    { label: '非草拟合同缺签订日', value: contracts.filter(c => c.status !== domainOf('contract')?.fields?.status?.default && !date(c.signedAt)).length },
    { label: '合同缺金额', value: missingAmount(contracts) },
    { label: '回款期次缺金额', value: missingAmount(installments) },
    { label: '回款日期格式无效', value: installments.filter(p => p.paidAt && !date(p.paidAt)).length },
    { label: '已成交项目缺采购方式', value: won.filter(e => !['招标', '直签'].includes(e.procureMode)).length },
  ];
  const qualityCount = issueCounts.reduce((n, i) => n + i.value, 0);
  const bins = buckets(win);
  const series = (label, records, dateOf, valueOf = () => 1, tone = 'accent') => ({
    label, tone,
    values: bins.map(b => records.reduce((n, e) => { const d = date(dateOf(e)); return n + (d && +d >= b.start && +d <= b.end ? number(valueOf(e)) : 0); }, 0)),
  });
  const trend = (id, title, unit, seriesList, note = '按所选周期归期') => ({ id, kind: 'trend', title, unit, note, buckets: bins.map(({ start, end, ...b }) => b), series: seriesList });
  const bars = (id, title, rows, note, unit = '条') => ({ id, kind: 'bars', title, rows, note, unit });
  const metric = (label, value, unit, note, tone = '') => ({ label, value, unit, note, tone });
  const moneyTrend = trend('money', '签约与回款', '元', [
    series('签订合同额', contracts, e => e.signedAt, contractTotal),
    series('实际回款额', installments, e => e.paidAt, e => e.amount, 'success'),
  ], '两项分别按签订日、实际回款日统计，不相除作为完成率');
  const riskChart = bars('risks', '当前待推进', [
    { label: '事项已逾期', value: overdueTasks.length, tone: 'danger' },
    { label: '14 天未更新', value: stale.length, tone: 'warning' },
    { label: '成交后未签约', value: unsigned.length, tone: 'accent' },
    { label: '逾期回款期次', value: overdue.length, tone: 'danger' },
  ], '当前状态 · 各项可能重叠，不能相加');
  const quality = bars('quality', '数据完整性', issueCounts, '当前缺失项 · 同一记录可能有多项缺失', '项');
  const stages = domainOf('sales')?.fields?.status?.values ?? [];
  const statuses = domainOf('contract')?.fields?.status?.values ?? [];
  const unknownContracts = contracts.filter(c => !statuses.includes(c.status)).length;
  const unknownSales = sales.filter(e => !closed(e) && !stages.includes(e.status)).length;
  const outcomeRows = [
    { label: '招标中标', count: tenderWins.length, amount: knownSum(tenderWins), missing: missingAmount(tenderWins) },
    { label: '招标未中标', count: tenderLosses.length, amount: null, missing: 0 },
    { label: '直签成交', count: directWins.length, amount: knownSum(directWins), missing: missingAmount(directWins) },
  ];
  const aging = [
    { label: '未到期', value: sum(unpaid.filter(p => elapsed(p.dueAt) !== null && elapsed(p.dueAt) <= 0)), tone: 'accent' },
    { label: '逾期 1–30 天', value: sum(overdue.filter(p => elapsed(p.dueAt) <= 30)), tone: 'warning' },
    { label: '逾期 31–90 天', value: sum(overdue.filter(p => elapsed(p.dueAt) > 30 && elapsed(p.dueAt) <= 90)), tone: 'danger' },
    { label: '逾期超过 90 天', value: sum(overdue.filter(p => elapsed(p.dueAt) > 90)), tone: 'danger' },
    { label: '未填到期日', value: sum(unpaid.filter(p => !date(p.dueAt))), tone: 'muted' },
  ];
  const result = {
    schemaVersion: 1,
    qualityCount,
    views: [
      {
        id: 'overview', title: '业务总览', description: '看成果、看投入，也看接下来需要推进的事。',
        metrics: [
          metric('签订合同额', signedAmount, '元', signedNote),
          metric('实际回款额', knownSum(receipts), '元', '本期到账 · 包含往期合同回款', 'success'),
          metric('新增商机', newOpp.length, '条', '按创建日期'),
          metric('新增销售项目', newSales.length, '个', '按创建日期'),
          metric('已完成交流', completedVisits.length, '次', '按系统记录的完成时间'),
        ],
        charts: [moneyTrend,
          trend('visits', '客户交流：安排与完成', '次', [series('安排交流', visits, e => e.planDate || e.created), series('记录完成', visits.filter(done), e => e.completedAt, () => 1, 'success')], '安排按计划日（缺失用创建日）；完成按记录完成时间，包含不同批次'),
          trend('opportunities', '新增商机趋势', '条', [series('新增商机', opportunities, e => e.created)]), riskChart, quality],
      },
      {
        id: 'sales', title: '销售转化', description: '从商机走向成交，招标与直签分别衡量。',
        metrics: [
          metric('新增商机', newOpp.length, '条', '所选周期创建的商机'),
          metric('其中已转销售', converted.length, '条', '上述商机中，截至期末已转销售'),
          metric('商机转化率', ratio(converted.length, newOpp.length), '%', '同批次商机转销售 ÷ 新增商机'),
          metric('招标中标数', tenderWins.length, '个', '按成交日期 · 不含直签'),
          metric('招标中标率', ratio(tenderWins.length, tenderWins.length + tenderLosses.length), '%', '本期中标 ÷ 本期已出结果招标'),
        ],
        charts: [
          bars('stages', '销售项目跟踪状态', [
            ...stages.map(label => ({ label, value: sales.filter(e => !closed(e) && e.status === label).length })),
            { label: '已成交', value: won.length, tone: 'success' },
            { label: '未中标', value: sales.filter(e => closed(e) && !done(e)).length, tone: 'danger' },
            ...(unknownSales ? [{ label: '未分类', value: unknownSales, tone: 'muted' }] : []),
          ], '当前存量 · 成交含招标中标和直签'),
          { id: 'outcomes', kind: 'outcomes', title: '本期成交结果', note: '按成交 / 结果公布日 · 金额为成交金额，不是合同额', rows: outcomeRows },
          trend('sales-created', '新增销售项目趋势', '个', [series('新增销售项目', sales, e => e.created)]),
          bars('visit-status', '本期安排交流的当前状态', (domainOf('visit')?.fields?.status?.values ?? []).map(label => ({ label, value: plannedVisits.filter(e => e.status === label).length })), '本期计划日（缺失用创建日）的交流记录，按当前状态分组', '次'),
          riskChart,
        ],
      },
      {
        id: 'finance', title: '合同回款', description: '签了多少、收了多少，以及哪些款项需要跟进。',
        metrics: [
          metric('签订合同额', signedAmount, '元', signedNote),
          metric('签订合同数', signed.length, '份', '本期按签订日归期'),
          metric('实际回款额', knownSum(receipts), '元', '本期按实际回款日归期', 'success'),
          metric('当前未收款', knownSum(unpaid), '元', '仅已登记且未免除的未付款期次'),
          metric('当前逾期款', knownSum(overdue), '元', `${overdue.length} 个逾期期次 · 不含今天到期`, 'danger'),
        ],
        charts: [moneyTrend,
          trend('signed-count', '合同签订数量', '份', [series('签订合同', contracts, e => e.signedAt)]),
          { id: 'contract-status', kind: 'distribution', title: '合同状态分布', note: '当前全部合同 · 不随周期筛选', unit: '份', rows: [...statuses.map(label => ({ label, value: contracts.filter(c => c.status === label).length })), ...(unknownContracts ? [{ label: '未分类', value: unknownContracts }] : [])] },
          bars('aging', '当前未收款账龄', aging, '按已登记期次到期日计算；免除期次不计入', '元'),
          bars('coverage', '回款计划与数据检查', [
            { label: '合同未建期次', value: noSchedule },
            { label: '未收期次缺到期日', value: unpaid.filter(p => !date(p.dueAt)).length },
            { label: '期次缺金额', value: missingAmount(installments) },
            { label: '合同缺金额', value: missingAmount(contracts) },
          ], '当前缺失项 · 无期次合同不推算成已收清', '项'),
        ],
      },
    ],
  };
  if (compare) {
    let previous;
    if (['month', 'quarter', 'year'].includes(win.kind)) {
      const months = win.kind === 'month' ? 1 : win.kind === 'quarter' ? 3 : 12;
      previous = { kind: win.kind, from: new Date(win.from.getFullYear(), win.from.getMonth() - months, 1), to: new Date(win.from.getFullYear(), win.from.getMonth(), 0) };
    } else {
      const days = Math.round((Date.UTC(win.to.getFullYear(), win.to.getMonth(), win.to.getDate()) - Date.UTC(win.from.getFullYear(), win.from.getMonth(), win.from.getDate())) / DAY) + 1;
      previous = { kind: 'custom', from: new Date(win.from.getFullYear(), win.from.getMonth(), win.from.getDate() - days), to: new Date(win.from.getFullYear(), win.from.getMonth(), win.from.getDate() - 1) };
    }
    const prior = buildBoardViews(entries, { window: previous, now, domains, compare: false });
    result.comparison = { from: iso(previous.from), to: iso(previous.to) };
    for (const view of result.views) {
      const old = prior.views.find(v => v.id === view.id);
      for (const metric of view.metrics) {
        if (metric.label.startsWith('当前')) continue;
        const prev = old.metrics.find(m => m.label === metric.label).value;
        metric.change = metric.value === null || prev === null ? null : {
          previous: prev,
          delta: Math.round((metric.value - prev) * 100) / 100,
          percent: prev === 0 ? null : Math.round((metric.value - prev) / Math.abs(prev) * 1000) / 10,
        };
      }
    }
  }
  return result;
}

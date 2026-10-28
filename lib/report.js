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
const { monthKey, startOfDay, stamp, weekKey, ymd } = await import(rel('./util.js', import.meta.url));

const PERIOD_LABEL = { week: '周报', month: '月报' };
const DELTA_FIELDS = ['created', 'completed', 'open', 'overdue', 'activeDays'];

/** 周期窗口与上一期窗口 */
export function periodWindow(period, now = new Date(), offset = 0) {
  if (period === 'month') {
    // 先定位到月初再移动月份：直接 setMonth 在 31 日遇到短月会溢出回到本月
    // （例如 3-31 减一月会得到 3-03，key 仍是当月）。用 (年, 月) 构造避免日参与运算。
    const start = new Date(now.getFullYear(), now.getMonth() - offset, 1);
    const end = new Date(start.getFullYear(), start.getMonth() + 1, 0);
    return {
      key: `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, '0')}`,
      label: `${start.getFullYear()}年${start.getMonth() + 1}月`,
      from: start,
      to: end,
    };
  }
  const shift = new Date(now.getFullYear(), now.getMonth(), now.getDate() - offset * 7);
  const day = (shift.getDay() + 6) % 7;
  const start = new Date(shift.getFullYear(), shift.getMonth(), shift.getDate() - day);
  const end = new Date(start.getFullYear(), start.getMonth(), start.getDate() + 6);
  return {
    key: weekKey(shift),
    label: `${start.getMonth() + 1}月${start.getDate()}日–${end.getMonth() + 1}月${end.getDate()}日`,
    from: start,
    to: end,
  };
}

/**
 * 周期 key → 时间窗口（用于工具按 key 生成指定周期）。
 * week 接受 `YYYY-Www`，month 接受 `YYYY-MM`；非法 key 返回 null。
 */
export function windowFor(period, key) {
  if (typeof key !== 'string' || !key) return null;
  if (period === 'month') {
    const m = /^(\d{4})-(\d{2})$/.exec(key);
    if (!m) return null;
    const year = Number(m[1]);
    const month = Number(m[2]) - 1;
    if (month < 0 || month > 11) return null;
    const start = new Date(year, month, 1);
    const end = new Date(year, month + 1, 0);
    return { key, label: `${year}年${month + 1}月`, from: start, to: end };
  }
  const m = /^(\d{4})-W(\d{2})$/.exec(key);
  if (!m) return null;
  const year = Number(m[1]);
  const week = Number(m[2]);
  if (week < 1 || week > 53) return null;
  // 该年 1 月 4 日所在周的周一作为第 1 周起点（ISO 8601）
  const jan4 = new Date(year, 0, 4);
  const jan4Day = (jan4.getDay() + 6) % 7;
  const week1Monday = new Date(year, 0, 4 - jan4Day);
  const start = new Date(week1Monday.getFullYear(), week1Monday.getMonth(), week1Monday.getDate() + (week - 1) * 7);
  const end = new Date(start.getFullYear(), start.getMonth(), start.getDate() + 6);
  return {
    key,
    label: `${start.getMonth() + 1}月${start.getDate()}日–${end.getMonth() + 1}月${end.getDate()}日`,
    from: start,
    to: end,
  };
}

export async function buildFacts(secretary, { domains, now = new Date(), key } = {}) {
  const settings = await secretary.loadAll(true);
  // 默认口径：报告面向用户的业务域，助手域（开发日志）不参与汇总；显式点名时除外
  const list = domains ?? settings.domains.filter((d) => d.id !== 'assistant');
  const result = { generatedAt: stamp(now), date: ymd(now), week: weekKey(now), month: monthKey(now), periods: { week: {}, month: {} }, domains: {} };
  for (const domain of list) {
    result.domains[domain.id] = {
      id: domain.id,
      name: domain.name,
      shape: domain.shape,
      week: factsFor(settings, domain, 'week', now, 'week', key),
      month: factsFor(settings, domain, 'month', now, 'month', key),      weekdaysLeft: workdaysLeftInWeek(now),
    };
  }
  return result;
}

function factsFor(settings, domain, period, now, periodKey, explicitKey) {
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

  return { ...current, previous, deltas, commitments: null };
}

/**
 * 窗口内的事实。
 *
 * open / overdue 是**按窗口期末**估的：用当前状态无法真正还原历史，
 * 所以这里显式区分两类指标——
 *   created / completed / activeDays：有确切时间戳，可精确回溯
 *   open / overdue：只能给"当前值"，并在历史/未来周期标为不可用（null）
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

  const stalled = openNow.filter((entry) => lastActivity(entry, win.from) < win.from);

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
    stalled: stalled.length,
    completionRate: created.length ? Math.round((completed.length / Math.max(1, created.length)) * 100) : null,
    completedTitles: completed.slice(0, 8).map((entry) => entry.title),
    createdTitles: created.slice(0, 8).map((entry) => entry.title),
    overdueTitles: isCurrentPeriod ? overdueNow.slice(0, 8).map((entry) => entry.title) : [],
    historyAvailable: isCurrentPeriod,
  };
}

function lastActivity(entry, boundary) {
  const items = entry.timeline ?? [];
  if (!items.length) return entry.updated ? timeOf(entry.updated) : 0;
  return Math.max(...items.map((item) => timeOf(item.at) || 0));
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
 * 从**目标报告周期的上一期**提取"下周/下月一件最重要的事"，作为本期对照。
 *
 * F05：原实现用 `new Date()`（当前日期）倒推上一期，手动补写历史月份时会
 * 拿错周期——补 2026-09 的月报，却读到了 2026-09 自己的承诺。
 * 现在必须传入**目标周期窗口**，由它倒推上一期。
 */
async function previousCommitments(secretary, domain, period, targetWin) {
  const prevWin = periodWindow(period, targetWin.from, 1);
  const dir = path.join(FILES.reports, domain.name, PERIOD_LABEL[period] ?? '报告');
  const files = await secretary.store.listFiles(dir, (p) => p.endsWith('.md'));
  const match = files.find((p) => p.includes(prevWin.key));
  if (!match) return null;
  const text = await secretary.store.readText(match);
  if (!text) return null;
  const section = /##?\s*(下周|下月)一件最重要的事([\s\S]*?)(?=\n##?\s|\n---|$)/.exec(text);
  if (!section) return null;
  const body = section[2].trim();
  return { period: prevWin.key, from: match, text: body || null };
}

/**
 * 工具入口：没有 markdown 就给事实（并落 facts.json），给了就落报告。
 *
 * - `key` 指定周期（YYYY-Www / YYYY-MM），调度投递会显式传；
 *   不传才是"当前周期"。这样周一说"上周周报"不会再落到本周。
 * - **不指定 domain 时是"逐域各出一份"，不是跨域合并**：各域报告只写自己的目录，
 *   绝不把同一篇正文复制到别的域（用户要求：报告不可混域存放）。
 * - 返回值只含可序列化字段：不存在的键用 null 表示，绝不返回 undefined。
 */
export async function buildReport(secretary, { domain: domainKey, period = 'week', key, markdown, force = false, factsOnly = false }) {
  const settings = await secretary.loadAll(true);
  const target = domainKey ? [secretary.domainOf(settings, domainKey)] : settings.domains.filter((d) => d.id !== 'assistant');
  const requested = key ? windowFor(period, key) : null;
  if (key && !requested) throw new Error(`周期 key 格式不对：${key}。周报用 YYYY-Www，月报用 YYYY-MM。`);
  const win = requested ?? periodWindow(period);

  // 单域：传该域自己的 markdown，直接落盘。
  // 多域：**每域独立生成**——只写 facts.json 供模型逐域撰写，不复制正文。
  // factsOnly：仅补事实包（调度对账用），不产出报告正文、也不要求用户只写一份。
  if (factsOnly || (!markdown && target.length > 1)) {
    const facts = await buildFacts(secretary, { domains: target, key });
    const lines = [];
    const factsPaths = [];
    for (const domain of target) {
      const data = facts.domains[domain.id][period];
      const dir = path.join(FILES.reports, domain.name, PERIOD_LABEL[period] ?? '报告');
      const factsPath = path.join(dir, `${domain.id}-${win.key}.facts.json`);
      data.commitments = await previousCommitments(secretary, domain, period, win);
      await secretary.store.write(factsPath, `${JSON.stringify({ ...data, generatedAt: facts.generatedAt }, null, 2)}\n`);
      factsPaths.push({ domain: domain.id, name: domain.name, path: factsPath });
      lines.push(factLine(domain, data));
      if (data.commitments?.text) lines.push(`　上期承诺：${data.commitments.text.split('\n')[0].slice(0, 60)}`);
      if (data.completedTitles.length) lines.push(`　完成：${data.completedTitles.join('、')}`);
      if (data.overdueTitles.length) lines.push(`　逾期：${data.overdueTitles.join('、')}`);
    }
    return {
      period,
      key: win.key,
      label: win.label,
      facts,
      written: null,
      path: null,
      factsPaths,
      lines,
      headline: `${win.label} 事实（${target.map((d) => d.name).join('、')}）`,
      message:
        '各域的事实包已分别落入各自目录。请**逐域**写解读，然后对每个域单独调用一次 secretary_report（带上 domain 和同一个 key）把正文传回来；' +
        '不要写一篇跨域合并的报告，报告的存放互不混合。',
    };
  }

  const facts = await buildFacts(secretary, { domains: target, key });
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
    lines.push(factLine(domain, data));
    if (data.commitments?.text) lines.push(`　上期承诺：${data.commitments.text.split('\n')[0].slice(0, 60)}`);
    if (data.completedTitles.length) lines.push(`　完成：${data.completedTitles.join('、')}`);
    if (data.overdueTitles.length) lines.push(`　逾期：${data.overdueTitles.join('、')}`);
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
      ? `报告已写入周期 ${win.key}。结尾请留一段「下周/下月一件最重要的事」，下期报告会拿它对照。`
      : '事实如上。请据实写解读，再把 markdown 传回来落盘。',
  };
}

function factLine(domain, data) {
  const delta = data.deltas ?? {};
  const arrow = (value) => {
    if (value === null || value === undefined) return '上期不可比';
    return value > 0 ? `+${value}` : `${value}`;
  };
  const show = (value) => (value === null || value === undefined ? '不可用' : String(value));
  return (
    `【${domain.name} ${data.label}】新增 ${data.created}（${arrow(delta.created)}） · ` +
    `完成 ${data.completed}（${arrow(delta.completed)}） · ` +
    `未完成 ${show(data.open)} · 逾期 ${show(data.overdue)} · ` +
    `有动静 ${data.activeDays} 天 · 停滞 ${data.stalled}` +
    (data.completionRate !== null ? ` · 完成率 ${data.completionRate}%` : '')
  );
}

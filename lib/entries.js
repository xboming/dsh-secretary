/**
 * 条目的读写：三种形态共用一套"frontmatter + 正文 + 时间轴"的结构。
 *
 * 记法约定（这一版最值钱的遗产，别改）：
 *   - 原话一字不改，只进时间轴，且只出现一次
 *   - 系统解释、点评、"有问题告诉我"一律不落盘
 *   - 时间轴只认 `## 时间轴` 小节；备注条目不写 [日期 时间] 方括号
 */

// 版本化加载（见 reloadable.js）：子依赖跟着 ?v= 一起刷新。
const { rel } = await import(new URL('./reloadable.js', import.meta.url).href);
import path from 'node:path';
const { buildDocument, readSection, splitDocument, writeSection } = await import(rel('./frontmatter.js', import.meta.url));
const { addDays, oneLine, safeName, stamp, ymd } = await import(rel('./util.js', import.meta.url));
const { defaultStageOf, defaultStatusOf, doneFieldOf, normalizeStatusValue, completionValuesOf } = await import(rel('./domains.js', import.meta.url));
const { readContractBody } = await import(rel('./contract-body.js', import.meta.url));

const TIMELINE_HEADING = '时间轴';
const NEWS_HEADING = '备注';
const MAX_TIMELINE_SHOWN = 8;

/** 条目相对路径 */
export function entryPath(domain, entry) {
  const dir = domain.dir;
  if (domain.shape === 'stream') {
    const month = (entry.created ?? ymd()).slice(0, 7);
    return path.join(dir, month.slice(0, 4), `${month}.md`);
  }
  if (domain.shape === 'project') {
    const name = safeName(entry.title, 40);
    return path.join(dir, `${entry.id}-${name}`, '项目.md');
  }
  const month = (entry.created ?? ymd()).slice(0, 7);
  return path.join(dir, month.slice(0, 4), month.slice(5, 7), `${entry.id}-${safeName(entry.title, 40)}.md`);
}

/** 从文件内容解析出条目 */
export function parseEntry(domain, relative, text, mtimeMs) {
  const { data, body } = splitDocument(text);
  /**
   * 状态值读时归一化：历史文件里可能存着改名前的英文（todo/doing/done/dropped、
   * idea/drafting/revising/done/parked）。统一成当前声明里的汉字值再往下走，
   * 这样 `statusKind`、面板下拉、完成率统计看到的是同一套值。
   *
   * **只改内存里的值，不回写文件**——真实记录一字不动（同 deadline 的处理约定）。
   */
  if (domain?.legacyValues) {
    if (typeof data.status === 'string') data.status = normalizeStatusValue(domain, 'status', data.status);
    if (typeof data.stage === 'string') data.stage = normalizeStatusValue(domain, 'stage', data.stage);
  }
  const entry = {
    ...data,
    domain: domain.id,
    path: relative,
    mtimeMs,
    timeline: parseTimeline(body),
    notes: parseNotes(body),
    body,
  };
  /**
   * 合同的结构化部分（补充协议、回款期次）在正文表格里，不在 frontmatter。
   *
   * 只对声明了 `structured: true` 的域解析：别的域正文里也可能有 Markdown 表格，
   * 一律去读会让每次加载都多做两次全表扫描，而且可能把普通表格误认成期次。
   */
  if (domain?.structured?.includes('contract')) {
    const parsed = readContractBody(body);
    entry.agreements = parsed.agreements;
    entry.installments = parsed.installments;
  }
  if (!entry.title) {
    if (domain.shape === 'stream') entry.title = oneLine(body.split('\n')[0] ?? '', 40);
    else entry.title = path.basename(relative).replace(/\.md$/, '');
  }
  return entry;
}

/**
 * 只认 `## 时间轴` 小节里的 `- [日期 时间] 标题`
 *
 * ── 引用是**多行**的（这里曾经只取一行） ──
 * 原实现只把紧跟标题的第一行 `>` 当成引用：
 *     const quote = i + 1 < lines.length ? /^\s*>\s?(.*)$/.exec(lines[i + 1]) : null;
 * 于是用户在「记一条跟踪」里写的多行内容，落盘时每一行都是独立 `>` 行（见
 * appendTimeline），读回来却只剩第一行——文件里明明有四行，面板只显示一行。
 *
 * 实测过的样子：时间轴显示「宗泰鹏沟通：」，而文件里下面还有三条要点，
 * 用户在面板上根本看不到自己记的东西。
 *
 * 现在收集**连续**的 `>` 行，按原样用换行拼回去（保留空行，段间就是空行），
 * 停止条件是遇到第一条不是 `>` 的行（下一条时间轴条目或小节标题）。
 */
export function parseTimeline(body) {
  const section = readSection(body, TIMELINE_HEADING);
  if (!section) return [];
  const out = [];
  const lines = section.split('\n');
  for (let i = 0; i < lines.length; i += 1) {
    const match = /^\s*-\s*\[([^\]]+)\]\s*(.*)$/.exec(lines[i]);
    if (!match) continue;
    const quoted = [];
    let j = i + 1;
    for (; j < lines.length; j += 1) {
      const line = lines[j];
      // 空行不终止：多行原话之间可以有段落空行
      if (line.trim() === '') continue;
      const quotedMatch = /^\s*>\s?(.*)$/.exec(line);
      if (!quotedMatch) break;
      quoted.push(quotedMatch[1]);
    }
    // 跳过已消费的引用行：j 停在第一条非引用行上，下一轮从 i+1 自然继续即可
    i = Math.max(i, j - 1);
    out.push({
      at: match[1].trim(),
      text: match[2].trim(),
      // 没有引用行时给 null（不是空串）：面板/导出的"有没有原话"判断依赖这个区别
      quote: quoted.length ? quoted.join('\n') : null,
    });
  }
  return out;
}

/** 备注条目：`- 日期 说明`（不带方括号） */
export function parseNotes(body) {
  const section = readSection(body, NEWS_HEADING);
  if (!section) return [];
  return section
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.startsWith('- '))
    .map((line) => line.slice(2).trim());
}

/** 时间轴最上面一条（最新） */
export function latestTimeline(entry) {
  return entry.timeline.length ? entry.timeline[0] : null;
}

/**
 * 域声明里"除核心字段之外"的标量字段，从条目原样取出。
 *
 * 为什么需要：`entryView` 是**手写字段表**，域新增的字段不会自动出现在前端面上。
 * 销售域加了 customer/bidNo/amount/profit，不补这一步的话面板拿不到值，
 * 详情里永远显示空——用户会以为数据没存上（实际文件里有）。
 *
 * 只取 number / string / date：
 *   - enum 由 status/stage 这些专门字段承载，语义不同
 *   - tags 已经单独给过
 *   - boolean 目前没有域在用
 */
const CORE_VIEW_KEYS = new Set([
  'status',
  'stage',
  'progress',
  'deadline',
  'next',
  'tags',
  'source',
  'category',
  'month',
  'origin',
  'promotedTo',
]);

/**
 * 这些 enum 虽然不在核心字段里，但**必须下发**——否则面板拿不到值，
 * 编辑框永远显示空，用户以为数据没存上（实测过这个误解）。
 *
 * 判断标准：这个字段决定"这条记录怎么被理解"，而不只是它的一个属性。
 *   awardStatus —— 决定这条收没收口（done/dropped）
 *   procureMode —— 决定后面哪些字段该填（招标 vs 直签）
 * status/stage 有自己的专门分支，不在这里。
 */
const SECONDARY_ENUM_KEYS = new Set(['awardStatus', 'procureMode']);

function domainExtraFields(domain, entry) {
  const out = {};
  const second = doneFieldOf(domain);
  for (const [key, spec] of Object.entries(domain?.fields ?? {})) {
    if (CORE_VIEW_KEYS.has(key)) continue;
    /**
     * 第二条轴与"决定记录形态"的枚举单独放行。
     * 只放行这两个，其他 enum 仍然不进——避免把 status/stage 的语义重复下发。
     */
    if ((key === second || SECONDARY_ENUM_KEYS.has(key)) && spec?.type === 'enum') {
      const value = entry?.[key];
      if (value !== undefined && value !== null && value !== '') out[key] = value;
      continue;
    }
    if (!['number', 'string', 'date'].includes(spec?.type)) continue;
    const value = entry?.[key];
    if (value === undefined || value === null || value === '') continue;
    out[key] = value;
  }
  return out;
}

/**
 * 前端面（面板/列表用）
 *
 * `options.timelineLimit`：时间轴带回多少条，缺省 `MAX_TIMELINE_SHOWN`（8）。
 * 传 `Infinity` 表示全部——**详情页**用这个。
 *
 * 为什么列表和详情要分开：列表里每条只预览最新一条进展（`excerpt`），
 * 时间轴整段只是附带；但详情页是用户"翻自己记过什么"的地方，
 * 只给 8 条就会出现"我记了很多，面板只显示一点"。
 * 一律全量又会把快照撑大（每条记录几十上百条时间轴 × 每次轮询都拉一遍）。
 */
export function entryView(domain, entry, extra = {}) {
  const latest = latestTimeline(entry);
  // timelineLimit 是给本函数的指令，不进返回值；其余 extra 照旧原样带出
  const { timelineLimit, ...rest } = extra;
  const limit = timelineLimit ?? MAX_TIMELINE_SHOWN;
  return {
    id: entry.id,
    domain: domain.id,
    domainName: domain.name,
    shape: domain.shape,
    title: entry.title,
    status: entry.status ?? entry.stage ?? null,
    stage: entry.stage ?? null,
    /**
     * 完成/终止值可能不在 status 里（项目销售用 awardStatus）。
     * 面板的"标记完成"按钮要读 `doneValue` 才知道该写哪个值、
     * 当前算不算已经收口，所以这里把判定字段原样带出去。
     */
    doneField: doneFieldOf(domain),
    doneValue: entry?.[doneFieldOf(domain)] ?? null,
    progress: entry.progress ?? null,
    deadline: entry.deadline ?? null,
    next: entry.next ?? null,
    tags: Array.isArray(entry.tags) ? entry.tags : [],
    created: entry.created ?? null,
    updated: entry.updated ?? null,
    completedAt: entry.completedAt ?? null,
    origin: entry.origin ?? null,
    // 灵感的转化目标与**转化时间**分开给：报告按转化时间归月（B03）
    promotedTo: entry.promotedTo ?? null,
    promotedAt: entry.promotedAt ?? null,
    openEnded: entry.openEnded === true,
    /**
     * 合同的结构化部分原样下发。
     *
     * 不下发的话面板拿不到期次和协议，用户会以为数据没存上；
     * 而派生值（合同总额、回款进度）**不在这里算**——
     * 它们由 decorate 调 contracts.js 现算，避免两处口径。
     */
    ...(domain.structured?.includes('contract')
      ? {
          agreements: Array.isArray(entry.agreements) ? entry.agreements : [],
          installments: Array.isArray(entry.installments) ? entry.installments : [],
        }
      : {}),
    /**
     * 域声明的其他标量字段原样下发（销售域 customer/bidNo/amount/profit 等）。
     *
     * 不下发的话面板拿不到值：编辑框永远显示空，用户以为数据没存上。
     * 核心字段与 tags/enum 另有专门字段，这里只补声明过的 number/string/date，
     * 且只补 `entryView` 还没给的键（避免覆盖上面已经处理好的语义）。
     */
    ...domainExtraFields(domain, entry),
    excerpt: latest?.quote ?? latest?.text ?? '',
    lastAt: latest?.at ?? entry.updated ?? null,
    notes: entry.notes.slice(0, 3),
    // timelineLimit 是给前端的**指令**，不是条目数据，不能跟着 ...extra 回流出去
    timeline: Number.isFinite(limit) ? entry.timeline.slice(0, limit) : entry.timeline,
    /**
     * 时间轴总条数：面板据此显示"还有 N 条"，也用于断言"详情确实拿到了全部"。
     * 不靠 `timeline.length` 反推——那正是被截断之后看不出来的地方。
     */
    timelineTotal: entry.timeline.length,
    path: entry.path,
    ...rest,
  };
}

/** 新建条目的初始 frontmatter */
export function newEntryData(domain, fields, options = {}) {
  const now = new Date();
  const today = ymd(now);
  const data = {
    id: fields.id,
    title: fields.title,
    created: today,
    updated: today,
  };
  for (const [key, spec] of Object.entries(domain.fields)) {
    if (key === 'status' || key === 'stage' || key === 'progress') continue;
    if (fields[key] !== undefined && fields[key] !== null && fields[key] !== '') data[key] = fields[key];
    else if (spec.default !== undefined && domain.shape !== 'stream') data[key] = spec.default;
  }
  /**
   * 状态字段只给"有完成动作的域"。
   *
   * `lifecycle: 'journal'`（经验教训库）**不写 status**：
   * 早先按 task 形态建条，每条都带 `status: todo`，于是经验永远"未完成"、
   * 越积越多的同时把任务计数撑高。现在建条就不写它，
   * 老文件里已有的 status 也不动（真实记录不改写），由 statusKind 统一收敛。
   *
   * 默认值取自**域声明**（`fields.status.default`），不再硬编码 'todo'：
   * 销售域的默认状态是「商机」，写 todo 进去等于给它一个不存在的阶段。
   */
  const tracksStatus = domain.lifecycle !== 'journal';
  if (domain.shape === 'task' && tracksStatus) data.status = fields.status ?? defaultStatusOf(domain);
  /**
   * 第二条轴的默认值也要在建条时立刻落下。
   *
   * 项目销售的「是否中标」有它自己的枚举（未定/已中标/未中标），
   * 不写的话 frontmatter 里根本没有这个键，`statusKind` 读到空串
   * 就永远算 open——一单已经收口的生意会一直挂在待办里。
   * "每个状态新建时立即落值，不留空"是方案里的硬规则。
   */
  if (domain.shape === 'task' && tracksStatus) {
    const second = doneFieldOf(domain);
    if (second !== 'status') {
      const spec = domain.fields?.[second];
      const fallback = typeof spec?.default === 'string' ? spec.default : spec?.values?.[0];
      if (fallback) data[second] = fields[second] ?? fallback;
      /**
       * 建条时就已经是完成值的，**必须同时写 completedAt**。
       *
       * 最常见的场景是直签：它没有"等待开标"这个过程，建条时 awardStatus
       * 就是「已中标」。不写完成时间的话，这条记录算 done 却不计进完成率
       * （completedAt 是完成率的唯一依据），而且没有任何地方会报错。
       *
       * 更新路径（updateRecord）一直有这段逻辑，建条路径漏了——
       * 两条路径对同一件事必须给同一个结果。
       */
      if (completionValuesOf(domain).includes(data[second])) {
        data.completedAt = `${today} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
      }
    }
  }
  if (domain.shape === 'project') data.stage = fields.stage ?? defaultStageOf(domain);
  if (domain.shape === 'stream') data.month = today.slice(0, 7);
  /**
   * 来源指针：`options.origin` 与 `fields.origin` 都接受。
   *
   * 原先只认 options，而转化链路（link.js）习惯性地把它写进 fields，
   * 结果 origin 静默丢失——转化出来的记录找不回来源，追溯链断掉且不报错。
   * 两个入口都认，调用方不必记住该走哪一个。
   */
  const origin = options.origin ?? fields.origin;
  if (origin) data.origin = origin;
  return data;
}

/** 正文骨架 */
export function newEntryBody(domain, fields, now = new Date()) {
  if (domain.shape === 'stream') {
    const text = String(fields.text ?? '').replace(/\r\n?/g, '\n').trim();
    const head = `### ${fields.id} ${oneLine(fields.title, 60)}`;
    const meta = [`> 记录于 ${stamp(now)}`];
    if (fields.source) meta.push(`> 来源：${fields.source}`);
    const quote = text
      .split('\n')
      .map((line) => `> ${line}`.replace(/\s+$/, ''))
      .join('\n');
    return `${head}\n\n${meta.join('\n')}\n${quote ? `\n${quote}\n` : ''}`;
  }
  const lines = [`# ${fields.title}`, ''];
  if (domain.shape === 'project') {
    lines.push('## 当前状态', '', `**阶段**: ${fields.stage ?? defaultStageOf(domain)}`, `**进度**: ${fields.progress ?? 0}%`);
    if (fields.next) lines.push(`**下一步**: ${fields.next}`);
    lines.push('');
    lines.push('## 里程碑', '', '- [ ] 第一个里程碑', '');
  } else if (domain.lifecycle === 'journal') {
    // 经验教训库：不要"进度 0%"——它没有进度可言。
    // 换成对这类记录真正有用的骨架：现象 / 根因 / 约束。
    lines.push('## 现象', '');
    lines.push('## 根因', '');
    lines.push('## 约束', '');
    lines.push('');
  } else {
    /**
     * task 形态的骨架。**状态要写出来**：
     * 销售域的阶段（商机/跟踪/立项/报价）就存在 status 里，
     * 只在 frontmatter 里写、正文不显示的话，打开文件看到的是"进度 0%"，
     * 完全看不出这单走到哪一步了。
     */
    const statusText = fields.status ?? defaultStatusOf(domain);
    lines.push('## 当前状态', '', `**状态**: ${statusText}`, `**进度**: ${fields.progress ?? 0}%`);
    if (fields.next) lines.push(`**下一步**: ${fields.next}`);
    lines.push('');
  }
  lines.push(`## ${TIMELINE_HEADING}`, '');
  lines.push(`## ${NEWS_HEADING}`, '');
  return `${lines.join('\n')}`;
}

/** 追加一条时间轴（最新在上）。原话单独一行引用。 */
export function appendTimeline(body, { at, text, quote }) {
  const existing = readSection(body, TIMELINE_HEADING);
  const lines = existing ? existing.split('\n').filter((line) => line.trim() !== '') : [];
  const block = [`- [${at}] ${text}`];
  if (quote) {
    for (const line of String(quote).replace(/\r\n?/g, '\n').split('\n')) {
      block.push(`  > ${line}`.replace(/\s+$/, ''));
    }
  }
  return writeSection(body, TIMELINE_HEADING, [...block, '', ...lines]);
}

/** 追加一条备注 */
export function appendNote(body, text, now = new Date()) {
  const existing = readSection(body, NEWS_HEADING);
  const lines = existing ? existing.split('\n').filter((line) => line.trim() !== '') : [];
  return writeSection(body, NEWS_HEADING, [...lines, `- ${ymd(now)} ${text}`]);
}

/** 更新时间轴里某条的进度/阶段之外的"当前状态"块 */
export function updateStatusBlock(body, { status, stage, progress, next }) {
  const lines = [];
  if (stage !== undefined) lines.push(`**阶段**: ${stage}`);
  if (status !== undefined) lines.push(`**状态**: ${status}`);
  if (progress !== undefined) lines.push(`**进度**: ${progress}%`);
  if (next !== undefined) lines.push(`**下一步**: ${next}`);
  return writeSection(body, '当前状态', lines);
}

/** 序列化整个条目 */
export function serializeEntry(domain, data, body) {
  const ordered = {};
  // 顺序表只影响 frontmatter 的可读性，不影响正确性：
  // 不在表里的字段会走下面的兜底循环照常写入，不会丢。
  for (const key of ['id', 'title', 'created', 'updated', 'status', 'stage', 'progress', 'next', 'deadline', 'customer', 'bidNo', 'amount', 'profit', 'category', 'source', 'tags', 'month', 'origin', 'promotedTo', 'promotedAt', 'completedAt']) {
    if (data[key] !== undefined && data[key] !== null && data[key] !== '') ordered[key] = data[key];
  }
  for (const [key, value] of Object.entries(data)) {
    if (key in ordered) continue;
    if (value === undefined || value === null || value === '') continue;
    ordered[key] = value;
  }
  return buildDocument(ordered, body);
}

/** 时间轴去重键 */
export function timelineKey(item) {
  return `${item.at}|${item.text}|${item.quote ?? ''}`;
}

/** 合并两段时间轴（去重、按时间倒序） */
export function mergeTimeline(a, b) {
  const seen = new Set();
  const out = [];
  for (const item of [...a, ...b]) {
    const key = timelineKey(item);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out.sort((x, y) => String(y.at).localeCompare(String(x.at)));
}

/** 生成下一个周期日期（周报用） */
export function nextPeriodDate(kind, from = new Date()) {
  if (kind === 'week') return addDays(from, 7);
  if (kind === 'month') {
    const d = new Date(from);
    d.setMonth(d.getMonth() + 1);
    return d;
  }
  return addDays(from, 1);
}

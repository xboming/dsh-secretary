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
const { defaultStatusOf } = await import(rel('./domains.js', import.meta.url));

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
  const entry = {
    ...data,
    domain: domain.id,
    path: relative,
    mtimeMs,
    timeline: parseTimeline(body),
    notes: parseNotes(body),
    body,
  };
  if (!entry.title) {
    if (domain.shape === 'stream') entry.title = oneLine(body.split('\n')[0] ?? '', 40);
    else entry.title = path.basename(relative).replace(/\.md$/, '');
  }
  return entry;
}

/** 只认 `## 时间轴` 小节里的 `- [日期 时间] 标题` */
export function parseTimeline(body) {
  const section = readSection(body, TIMELINE_HEADING);
  if (!section) return [];
  const out = [];
  const lines = section.split('\n');
  for (let i = 0; i < lines.length; i += 1) {
    const match = /^\s*-\s*\[([^\]]+)\]\s*(.*)$/.exec(lines[i]);
    if (!match) continue;
    const quote = i + 1 < lines.length ? /^\s*>\s?(.*)$/.exec(lines[i + 1]) : null;
    if (quote) i += 1;
    out.push({
      at: match[1].trim(),
      text: match[2].trim(),
      quote: quote ? quote[1] : null,
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

function domainExtraFields(domain, entry) {
  const out = {};
  for (const [key, spec] of Object.entries(domain?.fields ?? {})) {
    if (CORE_VIEW_KEYS.has(key)) continue;
    if (!['number', 'string', 'date'].includes(spec?.type)) continue;
    const value = entry?.[key];
    if (value === undefined || value === null || value === '') continue;
    out[key] = value;
  }
  return out;
}

/** 前端面（面板/列表用） */
export function entryView(domain, entry, extra = {}) {
  const latest = latestTimeline(entry);
  return {
    id: entry.id,
    domain: domain.id,
    domainName: domain.name,
    shape: domain.shape,
    title: entry.title,
    status: entry.status ?? entry.stage ?? null,
    stage: entry.stage ?? null,
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
    timeline: entry.timeline.slice(0, MAX_TIMELINE_SHOWN),
    path: entry.path,
    ...extra,
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
  if (domain.shape === 'project') data.stage = fields.stage ?? 'idea';
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
    lines.push('## 当前状态', '', `**阶段**: ${fields.stage ?? 'idea'}`, `**进度**: ${fields.progress ?? 0}%`);
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

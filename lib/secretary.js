/**
 * 秘书核心：读全库 → 判定 → 快照 / 事实 / 提醒 / 写入。
 *
 * 工具、面板、报告都走这一层，口径只有一份。
 *
 * 子模块用 `rel()` 引入：带上本模块 URL 里的 `?v=` 版本号，使整棵依赖树
 * 在热重载时一起重新求值（见 reloadable.js）。
 */

import { randomUUID } from 'node:crypto';
import path from 'node:path';

// 版本化加载（见 reloadable.js）：子依赖跟着 ?v= 一起刷新。
const { rel } = await import(new URL('./reloadable.js', import.meta.url).href);

// 每次宿主加载本模块生成新版本：面板据此知道自己跑的是旧 UI，自动重载一次
export const UI_VERSION = randomUUID();

const { buildHolidayTable, describeDay, hasYear, holidaysInMonth, normalizeDeadline, workingDaysUntil } = await import(rel('./calendar.js', import.meta.url));
const { findDomain, resolveDomains } = await import(rel('./domains.js', import.meta.url));
const {
  appendNote,
  appendTimeline,
  entryPath,
  entryView,
  newEntryBody,
  newEntryData,
  parseEntry,
  serializeEntry,
} = await import(rel('./entries.js', import.meta.url));
const { splitDocument } = await import(rel('./frontmatter.js', import.meta.url));
const { bigrams, buildProbe, dormantDaysOf, findDuplicate, priorityOf, stallDaysOf } = await import(rel('./judge.js', import.meta.url));
const { FILES } = await import(rel('./store.js', import.meta.url));
const { appendStream, nextStreamId, parseStreamFile, setStreamMeta, streamBlock, streamPath } = await import(rel('./stream.js', import.meta.url));
const { daysBetween, monthKey, oneLine, stamp, startOfDay, startOfWeek, weekKey, ymd } = await import(rel('./util.js', import.meta.url));

const OPEN = new Set(['todo', 'doing']);
const DONE = new Set(['done']);

export function statusKind(domain, entry) {
  if (domain.shape === 'project') {
    if (entry.stage === 'done') return 'done';
    if (entry.stage === 'parked') return 'dropped';
    return 'open';
  }
  if (domain.shape === 'stream') return entry.promotedTo ? 'promoted' : 'open';
  if (entry.status === 'done') return 'done';
  if (entry.status === 'dropped') return 'dropped';
  return 'open';
}

export function createSecretary(store) {
  let cache = null;
  let cacheAt = 0;
  const CACHE_MS = 2000;

  async function loadSettings() {
    const [domainFile, scheduleFile, holidayFile] = await Promise.all([
      store.readJson(FILES.domains, null),
      store.readJson(FILES.schedule, null),
      store.readJson(FILES.holidays, null),
    ]);
    return {
      domains: resolveDomains(Array.isArray(domainFile) ? domainFile : (domainFile?.domains ?? [])),
      schedule: normalizeSchedule(scheduleFile),
      holidays: buildHolidayTable(holidayFile),
    };
  }

  function normalizeSchedule(raw) {
    const source = raw && typeof raw === 'object' ? raw : {};
    const clock = (value, fallback) => (/^([01]\d|2[0-3]):[0-5]\d$/.test(value ?? '') ? value : fallback);
    return {
      timeZone: typeof source.timeZone === 'string' ? source.timeZone : 'Asia/Shanghai',
      reminderAt: clock(source.reminderAt, '12:00'),
      // 报告生成窗口：月报默认 20:00 起（用户要求），跨午夜到次日 06:00
      reportWindow: { start: clock(source.reportWindow?.start, '20:00'), end: clock(source.reportWindow?.end, '06:00') },
      weekly: { weekday: Number.isInteger(source.weekly?.weekday) ? source.weekly.weekday : 1 },
      // 月报固定在**每月最后一天**（用户规则），不保留"几号"配置项。
      // 早期版本的 monthly.day 会被忽略，避免出现"配了 1 号其实是月末"的误导。
      // 周报/月报的出具时间（当天几点开始排队生成）
      weeklyAt: clock(source.weeklyAt, '20:00'),
      monthlyAt: clock(source.monthlyAt, '20:00'),
      idleGraceMinutes: Number.isFinite(source.idleGraceMinutes) ? source.idleGraceMinutes : 5,
      quietHours: { start: clock(source.quietHours?.start, '22:00'), end: clock(source.quietHours?.end, '07:00') },
    };
  }

  async function loadAll(force = false) {
    const now = Date.now();
    if (!force && cache && now - cacheAt < CACHE_MS) return cache;
    const settings = await loadSettings();
    const entries = [];
    for (const domain of settings.domains) {
      const files = await store.listMarkdown(domain.dir);
      for (const relative of files) {
        const read = await store.read(relative);
        if (!read) continue;
        try {
          if (domain.shape === 'stream') {
            entries.push(...parseStreamFile(read.text, relative, domain, read.mtimeMs));
          } else {
            entries.push(parseEntry(domain, relative, read.text, read.mtimeMs));
          }
        } catch (error) {
          console.warn('[dsh-secretary] 解析失败', relative, error?.message);
        }
      }
    }
    cache = { ...settings, entries, loadedAt: now };
    cacheAt = now;
    return cache;
  }

  function domainOf(settings, key) {
    const domain = findDomain(settings.domains, key);
    if (!domain) {
      const names = settings.domains.map((d) => `${d.id}（${d.name}）`).join('、');
      throw new Error(`未知的域：${key}。可用：${names}`);
    }
    return domain;
  }

  /* ---------------- 写入 ---------------- */

  async function addRecord({ domain: domainKey, text, title, fields = {}, updateExisting = false }) {
    const settings = await loadAll(true);
    const domain = domainOf(settings, domainKey);
    const rawText = String(text ?? '').replace(/\r\n?/g, '\n').trim();
    if (!rawText) throw new Error('内容不能为空。');
    const resolvedTitle = oneLine(title ?? firstLine(rawText), 60);
    const now = new Date();

    if (domain.shape === 'stream') return addIdea(domain, { text: rawText, title: resolvedTitle, fields, now });

    const probe = buildProbe(resolvedTitle, rawText);
    const candidates = settings.entries.filter((e) => e.domain === domain.id && statusKind(domain, e) === 'open');
    const hit = findDuplicate(probe, candidates);

    if (hit && hit.tier === 2) {
      const merged = await appendToEntry(domain, hit.entry, rawText, now, '进展');
      return { action: 'merged', id: hit.entry.id, title: hit.entry.title, path: merged, reason: hit.reason, message: `并入已有条目（${hit.reason}）。` };
    }
    if (hit && hit.tier === 1 && !updateExisting) {
      return {
        action: 'duplicate',
        id: hit.entry.id,
        title: hit.entry.title,
        path: hit.entry.path,
        reason: hit.reason,
        message: '看起来像同一件事，还没写入。确认是同一件事就带 updateExisting: true 再调一次。',
      };
    }
    if (hit && updateExisting) {
      const merged = await appendToEntry(domain, hit.entry, rawText, now, '进展');
      return { action: 'merged', id: hit.entry.id, title: hit.entry.title, path: merged, reason: hit.reason, message: '已并入确认过的条目。' };
    }

    // 到期时间防线：工作/创作没有 deadline 就不许默默落库——没有期限，到期提醒整条失效。
    // 助手域是开发日志，不设期限强制（它的提醒只有 14 天停滞）。
    // 模型必须先跟用户确认"什么时候要"，或用户明确说"不急"（openEnded）才能无期限建条。
    const cleaned = sanitizeFields(domain, fields);
    const deadlineOptional = domain.shape === 'stream' || domain.id === 'assistant';
    if (!deadlineOptional && !cleaned.deadline && cleaned.openEnded !== true) {
      const today = ymd(now);
      const suggestions = suggestDeadlines(now, settings.holidays);
      return {
        action: 'need_deadline',
        title: resolvedTitle,
        message:
          `这条还没有计划结束时间，没有期限就无法在到期前提醒。` +
          `请先向用户确认什么时候要，再带 deadline 重新调用；用户明确说"不急"时带 openEnded: true。` +
          `可建议：${suggestions}`,
        suggestions,
        today,
      };
    }

    // ID 分配 + 落盘放在同一临界区，避免并发创建拿到同一个号
    return store.enqueue(async () => {
      const id = await nextId(domain, settings);
      const data = newEntryData(domain, { ...cleaned, id, title: resolvedTitle });
      if (data.deadline && daysBetween(now, new Date(data.deadline)) < 0) {
        delete data.deadline;
      }
      if (cleaned.openEnded === true) data.openEnded = true;
      const body = newEntryBody(domain, { ...data, text: rawText });
      const withTimeline = appendTimeline(body, { at: stamp(now), text: '创建', quote: rawText });
      const relative = entryPath(domain, data);
      // 防撞号：目标文件已存在（手动迁移/外部建过同号文件）就自动跳号，最多试 10 次
      let finalRelative = relative;
      for (let attempt = 1; attempt <= 10 && (await store.exists(finalRelative)); attempt += 1) {
        data.id = await bumpId(domain, data.id);
        finalRelative = entryPath(domain, data);
      }
      await store.writeNow(finalRelative, serializeEntry(domain, data, withTimeline));
      cache = null;

      const working = data.deadline ? workingDaysUntil(new Date(data.deadline), now, settings.holidays) : undefined;
      const priority = priorityOf({ title: resolvedTitle, content: rawText, deadline: data.deadline, workingDays: working });
      return {
        action: 'created',
        id: data.id,
        title: resolvedTitle,
        path: finalRelative,
        priority: priority.priority,
        priorityReasons: priority.reasons,
        message: '已新建一条。',
      };
    });
  }

  /** 号 +1：W-2026-007 → W-2026-008 */
  async function bumpId(domain, currentId) {
    const match = /^(.*-)(\d+)$/.exec(currentId);
    if (!match) return `${currentId}-x${Date.now() % 100}`;
    return `${match[1]}${String(Number(match[2]) + 1).padStart(match[2].length, '0')}`;
  }

  function sanitizeFields(domain, fields) {
    const out = {};
    for (const [key, value] of Object.entries(fields ?? {})) {
      // deadline 和 openEnded 是核心字段，任何域都放行——到期提醒不依赖域声明
      if (key === 'deadline' || key === 'openEnded') {
        out[key] = value;
        continue;
      }
      if (!domain.fields[key]) continue;
      out[key] = value;
    }
    return out;
  }

  /** 给模型的 deadline 建议：本周五 / 下周一 / 下周五 / 一周后 */
  function suggestDeadlines(now, holidays) {
    const day = (now.getDay() + 6) % 7;
    const friday = new Date(now.getFullYear(), now.getMonth(), now.getDate() + ((5 - day + 7) % 7 || 7));
    const nextMonday = new Date(friday.getTime() + 3 * 86400000);
    const nextFriday = new Date(nextMonday.getTime() + 4 * 86400000);
    const fmt = (d) => ymd(d);
    return `本周五 ${fmt(friday)}、下周一 ${fmt(nextMonday)}、下周五 ${fmt(nextFriday)}`;
  }

  /**
   * 灵感追加：读取、分配 ID、拼接、写入必须在**同一个临界区**内完成。
   * 只把最后的 write 放进队列是不够的——并发调用会读到同一份旧文件，互相覆盖。
   * 因此整段走 store.enqueue（store.write 内部也 enqueue，所以这里用 rawWrite 绕过重入）。
   */
  async function addIdea(domain, { text, title, fields, now }) {
    const relative = streamPath(domain, now);
    return store.enqueue(async () => {
      const existing = (await store.readText(relative)) ?? `# ${monthKey(now)} 灵感\n`;
      const id = nextStreamId(existing, now);
      const block = streamBlock({ id, title, text, source: fields.source, tags: fields.tags, now });
      await store.writeNow(relative, appendStream(existing, block));
      cache = null;
      return { action: 'captured', id, title, path: relative, message: '已记下一条灵感。' };
    });
  }

  /**
   * 分配下一个 ID。创作项目的文件名恒为「项目.md」，basename 里没有编号，
   * 必须从**路径中的项目目录名**或 frontmatter 的 id 取号。
   */
  async function nextId(domain, settings) {
    const prefix = domain.shape === 'project' ? 'C' : domain.id === 'work' ? 'W' : domain.id.slice(0, 1).toUpperCase();
    const year = new Date().getFullYear();
    const pattern = new RegExp(`${prefix}-${year}-(\\d{3})`);
    let max = 0;
    for (const entry of settings?.entries ?? []) {
      if (entry.domain !== domain.id) continue;
      const match = pattern.exec(String(entry.id ?? ''));
      if (match) max = Math.max(max, Number(match[1]));
    }
    // 兜底：路径里任何位置的编号（覆盖尚未解析进 entries 的文件）
    const files = await store.listMarkdown(domain.dir);
    for (const relative of files) {
      const match = pattern.exec(relative);
      if (match) max = Math.max(max, Number(match[1]));
    }
    return `${prefix}-${year}-${String(max + 1).padStart(3, '0')}`;
  }

  async function appendToEntry(domain, entry, quote, now, kind) {
    const read = await store.read(entry.path);
    if (!read) throw new Error('条目文件不见了，请重新查询。');
    const { data, body } = splitDocument(read.text);
    const nextBody = appendTimeline(body, { at: stamp(now), text: kind, quote });
    const nextData = { ...data, updated: ymd(now) };
    await store.write(entry.path, serializeEntry(domain, nextData, nextBody), read.mtimeMs);
    cache = null;
    return entry.path;
  }

  /* ---------------- 读取 / 更新 ---------------- */

  function findEntry(settings, id) {
    const target = String(id ?? '').trim().toUpperCase();
    const found = settings.entries.find((entry) => String(entry.id).toUpperCase() === target);
    if (!found) throw new Error(`找不到条目 ${id}。先用 secretary_query 查一下。`);
    return found;
  }

  async function updateRecord({ id, status, stage, progress, next, deadline, openEnded, category, note, quote, expectedUpdated }) {
    const settings = await loadAll(true);
    const entry = findEntry(settings, id);
    const domain = domainOf(settings, entry.domain);
    const now = new Date();

    if (domain.shape === 'stream') {
      if (!status && !note) throw new Error('灵感只有两种改法：status 改成"promoted"并给 to，或写一条 note。');
    }

    const read = await store.read(entry.path);
    if (!read) throw new Error('条目文件不见了，请重新查询。');
    // 乐观锁：带着上次见到的 updated 来改；期间文件被别人（如 Obsidian）动过就拒绝，不盖掉
    if (expectedUpdated !== undefined && expectedUpdated !== null && String(expectedUpdated) !== '') {
      const { data: fresh } = splitDocument(read.text);
      if (String(fresh.updated ?? '') !== String(expectedUpdated)) {
        throw new Error(
          `条目在你上次读取后已被改动（现 updated: ${fresh.updated ?? '无'}，你持有 ${expectedUpdated}）。先 secretary_query 重读再改。`,
        );
      }
    }
    const { data, body } = splitDocument(read.text);
    const nextData = { ...data, updated: ymd(now) };
    let nextBody = body;

    if (domain.shape === 'task') {
      if (status) {
        const value = String(status);
        if (!['todo', 'doing', 'done', 'dropped'].includes(value)) throw new Error('status 只能是 todo / doing / done / dropped。');
        nextData.status = value;
        // 完成时记时间；重开（离开 done）必须清掉，否则它还带着完成时间参与统计
        if (value === 'done') nextData.completedAt = stamp(now);
        else delete nextData.completedAt;
      }
      if (progress !== undefined) nextData.progress = clampProgress(progress);
    }
    if (domain.shape === 'project') {
      if (stage) {
        const value = String(stage);
        if (!domain.fields.stage.values.includes(value)) throw new Error(`stage 只能是 ${domain.fields.stage.values.join(' / ')}。`);
        nextData.stage = value;
        if (value === 'done') nextData.completedAt = stamp(now);
        else delete nextData.completedAt;
      }
      if (progress !== undefined) nextData.progress = clampProgress(progress);
    }
    if (next !== undefined) nextData.next = String(next).trim();
    if (category !== undefined) {
      if (category === null || category === '') delete nextData.category;
      else nextData.category = String(category).trim().slice(0, 20);
    }
    if (deadline !== undefined) {
      if (deadline === null || deadline === '') delete nextData.deadline;
      else nextData.deadline = String(deadline);
    }
    // openEnded 可在建条之后补标（例如用户后来才说"不急"），
    // 也可以取消（重新给了期限就当有期限）。
    if (openEnded !== undefined) {
      if (openEnded === true) nextData.openEnded = true;
      else delete nextData.openEnded;
    }
    if (nextData.deadline && nextData.openEnded) delete nextData.openEnded;

    if (progress !== undefined || next !== undefined || status || stage) {
      const block = [];
      if (stage) block.push(`**阶段**: ${nextData.stage}`);
      if (status) block.push(`**状态**: ${nextData.status}`);
      if (progress !== undefined) block.push(`**进度**: ${nextData.progress}%`);
      if (next !== undefined) block.push(`**下一步**: ${nextData.next ?? ''}`);
      const { writeSection } = await import('./frontmatter.js');
      nextBody = writeSection(nextBody, '当前状态', block);
    }
    if (quote) nextBody = appendTimeline(nextBody, { at: stamp(now), text: note?.trim() || '进展', quote });
    else if (note) nextBody = appendNote(nextBody, note.trim(), now);

    await store.write(entry.path, serializeEntry(domain, nextData, nextBody), read.mtimeMs);
    cache = null;
    // 返回值必须是可无损序列化的 JSON：undefined 字段会丢，Progress 可能是 undefined，显式归 null
    return {
      id: entry.id,
      title: entry.title,
      path: entry.path,
      status: nextData.status ?? null,
      stage: nextData.stage ?? null,
      progress: nextData.progress ?? null,
      message: '已更新。',
    };
  }

  function clampProgress(value) {
    const num = Number(value);
    if (!Number.isFinite(num)) throw new Error('progress 必须是 0-100 的数字。');
    return Math.max(0, Math.min(100, Math.round(num)));
  }

  /* ---------------- 快照 / 事实 ---------------- */

  function openEntries(settings, domain) {
    return settings.entries.filter((e) => e.domain === domain.id && statusKind(domain, e) === 'open');
  }

  function overdueOf(settings, domain, entry, now) {
    if (!entry.deadline) return null;
    // 截止落在非工作日时折叠到之前的最近工作日：周六截止视为周五，避免"剩0个工作日"的周末假象
    const effective = normalizeDeadline(new Date(entry.deadline), settings.holidays);
    const days = workingDaysUntil(effective, now, settings.holidays);
    if (days < 0) return { days, level: 'overdue' };
    if (days === 0) return { days, level: 'today' };
    if (days <= 2) return { days, level: 'soon' };
    return { days, level: 'normal' };
  }

  function decorate(settings, domain, entry, now) {
    const due = overdueOf(settings, domain, entry, now);
    const stall = stallDaysOf(entry, now);
    return entryView(domain, entry, {
      kind: statusKind(domain, entry),
      due,
      workingDays: due ? due.days : null,
      stallDays: stall,
      dormantDays: domain.shape === 'stream' ? dormantDaysOf(entry, now) : null,
      hrefPath: entry.path,
    });
  }

  /**
   * 统一的提醒判定：把"这条为什么值得提醒"算一次，快照/提醒/面板都用同一份结果。
   * 阈值来自域声明（stallDays / dormantDays / reminders），不再在总览或前端另写一份。
   * 优先级：逾期 > 今天到期 > 临期 > 停滞 > 沉睡（同一条只出一个原因，避免重复计数）。
   */
  function reminderReason(domain, entry, decorated) {
    if (entry.kind !== 'open') return null;
    const declared = new Set(domain.reminders ?? []);
    if (decorated.due?.level === 'overdue' && declared.has('due')) return 'overdue';
    if (decorated.due?.level === 'today' && declared.has('due')) return 'today';
    if (decorated.due?.level === 'soon' && declared.has('due')) return 'soon';
    if (declared.has('stall') && decorated.stallDays >= (domain.stallDays ?? 7)) return 'stall';
    if (declared.has('dormant') && (decorated.dormantDays ?? 0) >= (domain.dormantDays ?? 30)) return 'dormant';
    // openEnded 兜底：明确"不急"的条目 7 天没动，也进停滞观察
    if (entry.openEnded && decorated.stallDays >= 7) return 'stall';
    return null;
  }

  /**
   * 快照。
   *
   * `doneLimit`：每个域随快照带回多少条已完成记录。
   *   默认 8（面板首屏够用，快照体积小），但**面板"全部记录"页可以请求更多**，
   *   否则第 9 条及更早的完成记录永远不会出现在界面上（数据不可见）。
   *   传 `all` 表示不限。同时始终返回 `doneCount`，面板据此判断"还有多少没加载"。
   */
  async function snapshot(now = new Date(), options = {}) {
    const doneLimit = options.doneLimit === 'all' ? Infinity : Math.max(1, Number(options.doneLimit) || 8);
    const settings = await loadAll(true);
    const domainsView = [];
    const all = [];
    const reasons = new Map();

    for (const domain of settings.domains) {
      const items = settings.entries.filter((e) => e.domain === domain.id);
      const done = items.filter((e) => statusKind(domain, e) === 'done');
      const decorated = items.map((e) => decorate(settings, domain, e, now));
      all.push(...decorated);
      for (const item of decorated) {
        const entry = items.find((e) => e.id === item.id);
        const reason = entry ? reminderReason(domain, { ...entry, kind: item.kind }, item) : null;
        if (reason) reasons.set(item.id, reason);
        item.reason = reason ?? null;
      }
      const doneSorted = decorated
        .filter((e) => e.kind === 'done')
        .sort((a, b) => String(b.completedAt ?? '').localeCompare(String(a.completedAt ?? '')));
      domainsView.push({
        id: domain.id,
        name: domain.name,
        icon: domain.icon,
        shape: domain.shape,
        open: decorated.filter((e) => e.kind === 'open').sort(sortByUrgency),
        doneCount: done.length,
        recentDone: doneSorted.slice(0, doneLimit),
        // 已完成总数与已带回数量分开给，面板能显示"还有 N 条"并请求加载
        doneReturned: Math.min(doneSorted.length, doneLimit === Infinity ? doneSorted.length : doneLimit),
        total: items.length,
        stalled: decorated.filter((e) => e.kind === 'open' && reasons.get(e.id) === 'stall').length,
        dormant: decorated.filter((e) => reasons.get(e.id) === 'dormant').length,
      });
    }

    // 分类统计：按域的 category/tags 字段聚合（工作=分类，灵感/创作=标签），面板筛选用
    const categories = buildCategories(settings, all);

    // 按统一 reason 分组：同一条只出现一次
    const byReason = (reason) => all.filter((e) => reasons.get(e.id) === reason);
    const overdue = byReason('overdue');
    const dueToday = byReason('today');
    const soon = byReason('soon');
    const stalled = byReason('stall');
    const dormant = byReason('dormant');
    const open = all.filter((e) => e.kind === 'open');

    return {
      generatedAt: stamp(now),
      uiVersion: UI_VERSION,
      date: ymd(now),
      domains: domainsView,
      stats: {
        open: open.length,
        overdue: overdue.length,
        dueToday: dueToday.length,
        soon: soon.length,
        stalled: stalled.length,
        dormant: dormant.length,
        done: all.filter((e) => e.kind === 'done').length,
      },
      dueToday,
      overdue,
      soon,
      // 面板只展示前若干条，但**完整集合**留给 reminders() 做去重与分页，
      // 否则第 N 条之后永远提醒不到（见审查报告第 10 条）。
      stalled: stalled.slice(0, 6),
      dormant: dormant.slice(0, 6),
      stalledAll: stalled,
      dormantAll: dormant,
      categories,
      calendar: await calendarOf(settings, now),
      schedule: settings.schedule,
      community: await communityOf(),
      reports: await reportState(settings),
    };
  }

  /**
   * 社区入口：读 系统/社区.json，只放行 http(s)。
   *
   * 配置驱动而非写死常量，换地址/换社区不用改代码；文件删除即入口消失。
   * URL 在这里就校验，坏配置直接当没有——面板永远拿不到不可点的字符串。
   */
  async function communityOf() {
    const raw = await store.readJson(FILES.community, null);
    const url = typeof raw?.url === 'string' ? raw.url.trim() : '';
    if (!url) return null;
    let parsed;
    try {
      parsed = new URL(url);
    } catch {
      return null;
    }
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return null;
    if (parsed.username || parsed.password) return null;
    const label = typeof raw?.label === 'string' ? raw.label.trim() : '';
    return { label: oneLine(label || 'GitHub 社区', 24), url: parsed.toString() };
  }

  /**
   * 分类聚合：每条记录归到它声明的分类/标签下。
   * 工作用的 category 字段，创作/灵感用 tags；没声明的一律进"未分类"，不丢。
   */
  function buildCategories(settings, decorated) {
    const map = new Map();
    for (const item of decorated) {
      const domain = settings.domains.find((d) => d.id === item.domain);
      const declared = domain?.fields?.category ? [item.category].filter(Boolean) : [];
      const tags = Array.isArray(item.tags) ? item.tags : [];
      const keys = [...new Set([...declared, ...tags])].filter(Boolean);
      if (!keys.length) keys.push('未分类');
      for (const key of keys) {
        const entry = map.get(key) ?? { name: key, total: 0, open: 0 };
        entry.total += 1;
        if (item.kind === 'open') entry.open += 1;
        map.set(key, entry);
      }
      item.categories = keys;
    }
    return [...map.values()].sort((a, b) => b.total - a.total);
  }

  function sortByUrgency(a, b) {
    const weight = (e) => {
      if (!e.due) return 900;
      if (e.due.level === 'overdue') return -1000 + e.due.days;
      if (e.due.level === 'today') return 0;
      return Math.max(1, e.due.days);
    };
    return weight(a) - weight(b) || String(a.title).localeCompare(String(b.title), 'zh');
  }

  async function calendarOf(settings, now) {
    const month = now.getMonth();
    const year = now.getFullYear();
    const days = {};
    const counts = new Map();
    for (const entry of settings.entries) {
      if (!entry.deadline) continue;
      const key = String(entry.deadline).slice(0, 10);
      const domain = findDomain(settings.domains, entry.domain);
      const list = counts.get(key) ?? [];
      const due = overdueOf(settings, domain, entry, now);
      list.push(due?.level === 'overdue' ? 'overdue' : due?.level === 'today' ? 'today' : 'later');
      counts.set(key, list);
    }
    for (let offset = -1; offset <= 1; offset += 1) {
      const cursor = new Date(year, month + offset, 1);
      const total = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0).getDate();
      for (let day = 1; day <= total; day += 1) {
        const date = new Date(cursor.getFullYear(), cursor.getMonth(), day);
        const key = ymd(date);
        const marks = counts.get(key) ?? [];
        const desc = describeDay(date, settings.holidays);
        days[key] = {
          count: marks.length,
          overdue: marks.filter((m) => m === 'overdue').length,
          level: marks.includes('overdue') ? 'overdue' : marks.includes('today') ? 'today' : marks.length ? 'soon' : null,
          holiday: desc.holiday,
          holidayName: desc.holidayName,
          makeup: desc.makeup,
          makeupName: desc.makeupName,
          workday: desc.workday,
          missingData: desc.missingData,
        };
      }
    }
    const monthHolidays = holidaysInMonth(settings.holidays ? year : year, month + 1, settings.holidays);
    return {
      today: ymd(now),
      month: `${year}-${String(month + 1).padStart(2, '0')}`,
      days,
      monthHolidays,
      holidayDataMissing: !hasYear(settings.holidays, year),
    };
  }

  async function reportState(settings) {
    const dirs = await store.listFiles(FILES.reports, (p) => p.endsWith('.facts.json'));
    return dirs.map((p) => ({ path: p, kind: p.includes(`周`) ? 'week' : 'month' }));
  }

  /**
   * 今日提醒（12:00 那条）。
   *
   * 两个约定：
   *   1. 临期（soon）与到期、逾期一样进入提醒内容，不只是面板可见。
   *   2. 沉睡"只提一次"：**先在完整候选集合上排除已通知的**，再取批量上限。
   *      反过来做（先截 6 条再过滤）会让第 7 条以后永远提醒不到。
   *      另外查询与标记分离：只有 markDormant=true（真正生成提醒时）才写状态，
   *      模型再查一次不会把沉睡列表"消耗"掉。
   */
  async function reminders(now = new Date(), options = {}) {
    const markDormant = options.markDormant === true;
    const snap = await snapshot(now);
    const state = (await store.readJson(FILES.state, {})) ?? {};
    const notified = Array.isArray(state.dormantNotified) ? state.dormantNotified : [];
    const today = snap.date;

    // F03：会话随后按推送提示再来查询时，必须能看到**当日已生成的那一批**。
    // 原实现生成时就把沉睡标为已通知，会话再查得到空列表——交接丢失。
    // 现在把整批快照存档到 state.reminderBatches[date]，查询优先回放它。
    const archived = state.reminderBatches?.[today];
    if (!markDormant && archived) {
      return {
        ...archived,
        fromArchive: true,
        dormantPending: archived.dormantPending ?? 0,
        reports: snap.reports,
      };
    }

    // 1) 完整候选集先去重（用 snapshot 的完整集合，不用面板截断后的 6 条）
    const dormantAll = snap.dormantAll ?? snap.dormant;
    const freshDormantAll = dormantAll.filter((item) => !notified.includes(item.id));
    // 2) 再去重后截断
    const freshDormant = freshDormantAll.slice(0, 10);

    const lines = [];
    if (snap.stats.overdue) lines.push(`已逾期 ${snap.stats.overdue} 件`);
    if (snap.stats.dueToday) lines.push(`今天到期 ${snap.stats.dueToday} 件`);
    // 与面板措辞一致：soon 是"剩 2 个工作日内"，不是自然日
    if (snap.stats.soon) lines.push(`剩 2 个工作日内 ${snap.stats.soon} 件`);
    if (snap.stats.stalled) lines.push(`停滞 ${snap.stats.stalled} 件`);
    if (freshDormant.length) lines.push(`沉睡灵感 ${freshDormant.length} 条`);

    const batch = {
      date: today,
      headline: lines.length ? lines.join(' · ') : '今天没有到期和停滞的条目。',
      overdue: snap.overdue,
      dueToday: snap.dueToday,
      soon: snap.soon,
      stalled: snap.stalled,
      dormant: freshDormant,
      dormantPending: Math.max(0, freshDormantAll.length - freshDormant.length),
      generatedAt: stamp(now),
    };

    if (markDormant) {
      // 只在真正生成时：标记沉睡已通知 + 存档本批供会话回读
      if (freshDormant.length) {
        state.dormantNotified = [...new Set([...notified, ...freshDormant.map((i) => i.id)])].slice(-300);
      }
      if (!state.reminderBatches) state.reminderBatches = {};
      state.reminderBatches[today] = batch;
      // 只保留最近 14 天，避免状态文件膨胀
      const keys = Object.keys(state.reminderBatches).sort();
      for (const key of keys.slice(0, Math.max(0, keys.length - 14))) delete state.reminderBatches[key];
      await store.writeJson(FILES.state, state);
    }

    return { ...batch, reports: snap.reports };
  }

  async function find(id) {
    const settings = await loadAll(true);
    const entry = findEntry(settings, id);
    const domain = domainOf(settings, entry.domain);
    return { entry, domain, settings };
  }

  async function query({ domain: domainKey, kind, keyword, limit = 20 }) {
    const settings = await loadAll(true);
    let domains = settings.domains;
    if (domainKey) domains = [domainOf(settings, domainKey)];
    const needles = String(keyword ?? '').trim().toLowerCase();
    const out = [];
    for (const domain of domains) {
      for (const entry of settings.entries.filter((e) => e.domain === domain.id)) {
        const status = statusKind(domain, entry);
        if (kind && kind !== 'all') {
          if (kind === 'open' && status !== 'open') continue;
          if (kind === 'done' && status !== 'done') continue;
        }
        if (needles) {
          const hay = `${entry.title} ${(entry.timeline ?? []).map((t) => `${t.text} ${t.quote ?? ''}`).join(' ')}`.toLowerCase();
          if (!hay.includes(needles)) continue;
        }
        out.push(decorate(settings, domain, entry, new Date()));
      }
    }
    return out.slice(0, Math.max(1, Math.min(100, limit)));
  }

  async function updateSchedule(patch = {}) {
    const current = (await store.readJson(FILES.schedule, null)) ?? normalizeSchedule(null);
    const next = JSON.parse(JSON.stringify(current));
    const clock = (value) => (typeof value === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(value) ? value : null);
    const changed = [];

    if (patch.reminderAt !== undefined) {
      const value = clock(patch.reminderAt);
      if (!value) throw new Error('reminderAt 必须是 HH:mm，例如 12:00。');
      next.reminderAt = value;
      changed.push(`提醒 ${value}`);
    }
    for (const [key, field] of [['reportWindowStart', 'start'], ['reportWindowEnd', 'end']]) {
      if (patch[key] === undefined) continue;
      const value = clock(patch[key]);
      if (!value) throw new Error(`${key} 必须是 HH:mm。`);
      next.reportWindow = { ...(next.reportWindow ?? {}), [field]: value };
      changed.push(`报告窗口${field === 'start' ? '开始' : '结束'} ${value}`);
    }
    if (patch.weeklyWeekday !== undefined) {
      const day = Number(patch.weeklyWeekday);
      if (!Number.isInteger(day) || day < 1 || day > 7) throw new Error('weeklyWeekday 是 1-7（1=周一）。');
      next.weekly = { weekday: day };
      changed.push(`周报在周${'一二三四五六日'[day - 1]}`);
    }
    // 月报固定在**每月最后一天**（用户规则），不再用"几号"配置，
    // 因此没有 monthlyDay 分支；只能调时间点和开关。
    if (patch.monthlyAt !== undefined) {
      const value = clock(patch.monthlyAt);
      if (!value) throw new Error('monthlyAt 必须是 HH:mm，例如 20:00。');
      next.monthlyAt = value;
      changed.push(`月报在月末 ${value}`);
    }
    if (patch.weeklyAt !== undefined) {
      const value = clock(patch.weeklyAt);
      if (!value) throw new Error('weeklyAt 必须是 HH:mm。');
      next.weeklyAt = value;
      changed.push(`周报在 ${value}`);
    }
    if (!changed.length) {
      const current2 = normalizeSchedule(next);
      return {
        message:
          `当前：每天 ${current2.reminderAt} 提醒；小时区 ${current2.timeZone}；` +
          `周报 ${['周一', '周二', '周三', '周四', '周五', '周六', '周日'][(current2.weekly.weekday ?? 1) - 1]} ${current2.weeklyAt}；` +
          `月报 每月最后一天 ${current2.monthlyAt}；周报空闲窗口 ${current2.reportWindow.start}–${current2.reportWindow.end}。`,
        schedule: current2,
      };
    }

    const start = parseClockOf(next.reportWindow?.start ?? '22:00') ?? 1320;
    const end = parseClockOf(next.reportWindow?.end ?? '06:00') ?? 360;
    const span = start <= end ? end - start : 1440 - start + end;
    if (span < 60) throw new Error('报告窗口至少 1 小时，否则永远等不到。');

    await store.writeJson(FILES.schedule, next);
    cache = null;
    const normalized = normalizeSchedule(next);
    return {
      message: `已改：${changed.join('，')}。下次提醒 ${nextRunPreview(normalized)}。`,
      schedule: normalized,
      nextRun: nextRunPreview(normalized),
    };
  }

  function parseClockOf(value) {
    const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(String(value ?? ''));
    return match ? Number(match[1]) * 60 + Number(match[2]) : null;
  }

  function nextRunPreview(schedule) {
    const now = new Date();
    const target = parseClockOf(schedule.reminderAt) ?? 720;
    const minutes = now.getHours() * 60 + now.getMinutes();
    const later = target > minutes ? '今天' : '明天';
    return `${later} ${schedule.reminderAt}`;
  }

  /**
   * 记住"哪个会话要收提醒"：秘书工具第一次被调用时由工具层写入。
   * 只记根会话（子代理的会话收不到投递）。
   */
  async function bindReminderSession(sessionId) {
    const state = (await store.readJson(FILES.state, {})) ?? {};
    if (state.reminderSession === sessionId) return state.reminderSession;
    state.reminderSession = sessionId;
    await store.writeJson(FILES.state, state);
    return sessionId;
  }

  async function currentState() {
    return (await store.readJson(FILES.state, {})) ?? {};
  }

  return {
    store,
    loadAll,
    loadSettings,
    addRecord,
    updateRecord,
    updateSchedule,
    bindReminderSession,
    currentState,
    query,
    find,
    snapshot,
    reminders,
    decorate,
    domainOf,
    statusKind,
    reportState,
    statusKindOf: statusKind,
  };
}

function firstLine(text) {
  const line = String(text ?? '').split('\n').find((item) => item.trim()) ?? '';
  return line.trim().slice(0, 60);
}
// touch 133638

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

const { buildHolidayTable, describeDay, hasYear, holidaysInMonth, isWorkday, normalizeDeadline, workingDaysUntil } = await import(rel('./calendar.js', import.meta.url));
const {
  completionValuesOf,
  defaultStageOf,
  defaultStatusOf,
  dropValuesOf,
  findDomain,
  normalizeStatusValue,
  promotionTargetsOf,
  resolveDomains,
  stageValuesOf,
  statusValuesOf,
} = await import(rel('./domains.js', import.meta.url));
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

/**
 * 原先这里有两个写死英文状态值的集合：
 *   const OPEN = new Set(['todo', 'doing']);
 *   const DONE = new Set(['done']);
 * 它们已经没有任何地方在用，而状态值现在是各域声明的汉字
 * （事务「待办/进行中/已完成/已放弃」、创作「构思/起草/修订/完成/搁置」）。
 * 留着只会误导人以为改了名字之后它们还管用，所以删掉——
 * 判定一律走 statusKind → completionValuesOf / dropValuesOf。
 */

/** 周期中文名，给面板显示"错过哪一期"用 */
const REPORT_LABEL = { month: '月报', quarter: '季报', half: '半年报', year: '年报' };

/**
 * 条目在业务上的"种类"。
 *
 * 除了已完成/未完成，还有一个 `archived`：**经验教训库**里的一条记录。
 * 它不是待办事项，没有"做完"这回事（见 domains.js 的 lifecycle）。
 * 为什么必须单独一个种类而不是归进 open——
 *   - 归 open：它会进 stats.open、待办计数、逾期/停滞判定，
 *     8 条经验就把"还有多少件事要做"这个数字污染掉；
 *   - 归 done：会让"完成率"凭空好看，而且语义上也不对（没做完什么）；
 *   - 于是给它自己一档：参与展示与检索，不参与完成/待办/逾期统计。
 *
 * 历史兼容：早期助手域用 task 形态建过条，文件里留着 `status: done`，也新建过
 * `status: todo`。lifecycle='journal' 时这两种老值都收敛成 archived，
 * 不迁移、不改写用户文件（真实记录一字不动）。
 */
export function statusKind(domain, entry) {
  if (domain.lifecycle === 'journal') return 'archived';
  /**
   * 项目形态（创作）：阶段值同样**读域声明**。
   *
   * 以前这里写死 `stage === 'done' / 'parked'`。创作阶段改成汉字之后，
   * 那条判断就永远不成立——「完成」的项目会被当成 open，永远挂在待办里，
   * 而且不报错。这正是 domains.js 里反复提到的"静默污染"。
   */
  if (domain.shape === 'project') {
    const stage = String(entry.stage ?? '');
    if (completionValuesOf(domain).includes(stage)) return 'done';
    if (dropValuesOf(domain).includes(stage)) return 'dropped';
    return 'open';
  }
  if (domain.shape === 'stream') return entry.promotedTo ? 'promoted' : 'open';
  /**
   * task 形态：完成/终止值可**由域声明**（销售域用「中标 / 未中标」）。
   *
   * 以前这里硬编码判断 'done' / 'dropped'，其余一律当 open。
   * 后果不是报错，是**静默污染**：一个状态叫「中标」的商机明明已经收口，
   * 却永远算在办，把待办数和逾期数撑高，而且看不出哪里错了。
   * 没有自定义声明的域（工作域）走 doneValuesOf/dropValuesOf 的缺省，
   * 仍然是 done/dropped，行为一字不变。
   */
  const status = String(entry.status ?? '');
  if (completionValuesOf(domain).includes(status)) return 'done';
  if (dropValuesOf(domain).includes(status)) return 'dropped';
  return 'open';
}

/** 这个域是否有"完成 / 改期"这类动作。journal 域一律没有。 */
export function hasCompletion(domain) {
  return domain?.lifecycle !== 'journal';
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
      // 报告生成窗口：季度/半年度/年度报告的空闲窗口（月度按 monthlyAt 直接出，不受此限）
      reportWindow: { start: clock(source.reportWindow?.start, '20:00'), end: clock(source.reportWindow?.end, '06:00') },
      // 四类报告都在各自周期的**最后一天**生成，时间点可分别配置
      monthlyAt: clock(source.monthlyAt, '20:00'),
      quarterlyAt: clock(source.quarterlyAt, '20:00'),
      halfAt: clock(source.halfAt, '20:00'),
      yearlyAt: clock(source.yearlyAt, '20:00'),
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

  /**
   * 经验教训库的**软提醒**：写进来了，但如果看不出可复用的约束，附一句提示。
   *
   * ── 为什么最终是"软"的 ──
   * 试过三版硬拦截，拿 20 条真实数据逐条验证，每次都顾此失彼：
   *   1. "没有结论信号就拦"   → 把「经验丙」这种刚开头的短记录也拦了
   *   2. "版本号+完成动词"     → 漏判 6 条、误伤 3 条（正文引用了流水句的经验被误伤）
   *   3. "短+动作+无约束"      → 误伤 0，但漏判 11/11（这批流水每条都超 120 字）
   *   4. "只看有无可执行约束"   → 漏判 3，误伤 3，其中 A-2026-003 是真经验却被拦
   *
   * 根本困难：**"标题是经验、正文是流水"** 的记录（如 A-2026-007）人工都难分，
   * 正则更不可能稳。硬拦截的代价是用户写不下真经验（以为工具坏了），
   * 而漏放的代价只是库里多一条噪音（用户自己看得见、能删）。
   *
   * 所以改成：**永远落库**，只在结果里带 `qualityHint` 让模型/用户知道
   * "这条没有可复用的结论，考虑补一句约束"。
   */
  const JOURNAL_CONSTRAINT_HINTS = /下次|禁止|不要|别用|应当|应该|必须|记得|务必|改用|只能用|绝不用|以后都|一律|切记/;

  /** 这条记录里有没有可执行的约束句（用于软提醒，不用于拦截） */
  function lacksConclusion(text) {
    const source = String(text ?? '').trim();
    if (/##\s*(现象|根因|约束)/.test(source)) return false;
    if (JOURNAL_CONSTRAINT_HINTS.test(source)) return false;
    if (/约束[：:]|教训[：:]|根因[：:]/.test(source)) return false;
    return true;
  }

  async function addRecord({ domain: domainKey, text, title, fields = {}, updateExisting = false, createSeparate = false, allowProgressLog = false }) {
    const settings = await loadAll(true);
    const domain = domainOf(settings, domainKey);
    const rawText = String(text ?? '').replace(/\r\n?/g, '\n').trim();
    if (!rawText) throw new Error('内容不能为空。');
    const resolvedTitle = oneLine(title ?? firstLine(rawText), 60);
    const now = new Date();

    if (domain.shape === 'stream') return addIdea(domain, { text: rawText, title: resolvedTitle, fields, now });

    /**
     * 经验教训库：**软提醒**，不阻写。
     *
     * 记录照常落库（用户的记录不该被工具挡住），只在返回值里带
     * `qualityHint`，让模型能顺口提醒一句"这条没有可复用的结论"。
     * 面板/用户自己看得见，也能随时删。
     *
     * 为什么不做硬拦截：见上方 lacksConclusion 的注释——
     * 试了四版判据都必然误伤真经验，代价比漏放一条噪音大得多。
     */
    const qualityHint =
      domain.lifecycle === 'journal' && !allowProgressLog && lacksConclusion(`${resolvedTitle}\n${rawText}`)
        ? `${domain.name}域是经验教训库：这条没有可复用的结论（现象/根因/约束）。` +
          '如果它是进度流水（改了什么版本、提交了什么），更适合放 git log；' +
          '如果确实值得留，建议补一句"下次遇到 X 就做 Y"。'
        : null;

    /**
     * 去重判定。
     *
     * `createSeparate` 是**用户已确认"这确实是另一件事"**的显式信号（U03）。
     * 它只跳过重复判断，不改变任何字段：`deadline` / `openEnded` / 分类等
     * 都照传不误。以前面板的"另建记录"按钮复用了 `openEnded: true`，
     * 既绕不过去重（照样返回 duplicate），又会顺手把用户选的期限抹成"无期限"——
     * 两个语义被一个参数顶替了。
     */
    const probe = buildProbe(resolvedTitle, rawText);
    const candidates = settings.entries.filter((e) => e.domain === domain.id && statusKind(domain, e) === 'open');
    const hit = createSeparate ? null : findDuplicate(probe, candidates);

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
        message:
          '看起来像同一件事，还没写入。确认是同一件事就带 updateExisting: true 再调一次；' +
          '确认是**另一件事**就带 createSeparate: true 再调一次（会得到独立编号，期限等字段保持不变）。',
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

    // ID 分配 + 落盘放在同一临界区，避免并发创建拿到同一个号。
    // **必须在临界区内重新读取 settings**：用外面读来的快照算号，
    // 三个并发请求会各自看到同一个 max，算出同一个 ID，后写的覆盖先写的（实测丢文件）。
    return store.enqueue(async () => {
      const fresh = await loadAll(true);
      const freshDomain = domainOf(fresh, domain.id);
      const id = await nextId(freshDomain, fresh);
      const data = newEntryData(freshDomain, { ...cleaned, id, title: resolvedTitle });
      // 过去的截止日期**不再静默丢弃**：补录历史事项时它是真实数据，
      // 丢掉会让"逾期"统计凭空消失（实测：deadline=2020-01-01 落库后变成无期限）。
      // 保留并让 overdue 逻辑自然判为逾期即可。
      const deadlineInPast = Boolean(data.deadline && daysBetween(now, new Date(data.deadline)) < 0);
      if (cleaned.openEnded === true) data.openEnded = true;
      const body = newEntryBody(freshDomain, { ...data, text: rawText });
      const withTimeline = appendTimeline(body, { at: stamp(now), text: '创建', quote: rawText });
      const relative = entryPath(freshDomain, data);
      // 防撞号：目标文件已存在（手动迁移/外部建过同号文件）就自动跳号，最多试 10 次
      let finalRelative = relative;
      for (let attempt = 1; attempt <= 10 && (await store.exists(finalRelative)); attempt += 1) {
        data.id = await bumpId(freshDomain, data.id);
        finalRelative = entryPath(freshDomain, data);
      }
      await store.writeNow(finalRelative, serializeEntry(freshDomain, data, withTimeline));
      cache = null;

      const working = data.deadline ? workingDaysUntil(new Date(data.deadline), now, fresh.holidays) : undefined;
      const priority = priorityOf({ title: resolvedTitle, content: rawText, deadline: data.deadline, workingDays: working });
      return {
        action: 'created',
        id: data.id,
        title: resolvedTitle,
        path: finalRelative,
        priority: priority.priority,
        priorityReasons: priority.reasons,
        // 补录历史事项时明确告知：期限已过，会立刻计入逾期
        deadlineInPast,
        // 经验教训库的软提醒：已写入，但这条看不出可复用的结论
        qualityHint,
        message: deadlineInPast
          ? `已新建一条。注意：截止日 ${data.deadline} 已是过去，它会立刻计入逾期。`
          : '已新建一条。',
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
      /**
       * 这里只保留键、**不做类型校验**（历史如此）。
       *
       * 后果是声明了就会原样落盘：`amount: "三百万"` 也能写进去。
       * 数值字段因此在下游被 `Number()` 兜一遍——见 sumField()，
       * 非数字一律当 0 跳过，不会把合计算成 NaN。
       */
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
      const existing = (await store.readText(relative)) ?? streamHeader(domain, now);
      const id = nextStreamId(existing, now, streamPrefixOf(domain));
      /**
       * 域声明的**其他标量字段**作为块元信息写入（拜访记录的客户单位、对接人）。
       *
       * 只挑 string 类型：流水块的元信息是 `- 键：值` 单行，
       * tags 有自己的一行（用逗号连接），date 会写成 YYYY-MM-DD 也还行但这里用不到。
       * 不传的话，用户说"今天去了滨海新区水务局"，
       * 「客户单位」就丢了——拜访记录最大的价值就是能按客户聚起来。
       */
      const meta = {};
      for (const [key, spec] of Object.entries(domain.fields ?? {})) {
        if (spec?.type !== 'string') continue;
        // source 有自己的一行（`- 来源：`），这里跳过免得写两遍
        // （实测出现过「- 来源：上门」和「- 形式：上门」并排，同一个值重复两次）
        if (key === 'source') continue;
        const value = fields?.[key];
        if (value === undefined || value === null || value === '') continue;
        meta[spec.label ?? key] = String(value).trim();
      }
      const block = streamBlock({ id, title, text, source: fields.source, tags: fields.tags, now, meta });
      await store.writeNow(relative, appendStream(existing, block));
      cache = null;
      return { action: 'captured', id, title, path: relative, message: `已记下一条${domain.name}记录。` };
    });
  }

  /** 流水文件的标题行：灵感是「# YYYY-MM 灵感」，拜访是「# YYYY-MM 拜访」。 */
  function streamHeader(domain, now) {
    return `# ${monthKey(now)} ${domain.name}\n`;
  }

  /**
   * 流水编号前缀：优先用域声明的 `idPrefix`，否则用域 id 首字母大写。
   *
   * 灵感的 id 是 `idea` → 首字母虽为 I，但历史数据是 `I-`，正好一致；
   * 拜访声明了 `idPrefix: 'V'`，否则会退化成 `V`（visit 首字母）——也对。
   * 但**不能靠巧合**：显式声明优先，兜底只是防止新域漏声明。
   *
   * 这里必须传下去而不是让 stream.js 自己猜：stream.js 拿不到域声明的一致性，
   * 而且它还要服务「同一份文件里已有旧前缀条目」的场景。
   */
  function streamPrefixOf(domain) {
    if (typeof domain?.idPrefix === 'string' && domain.idPrefix.trim()) return domain.idPrefix.trim();
    const first = String(domain?.id ?? '').trim().charAt(0);
    return first ? first.toUpperCase() : 'I';
  }

  /**
   * 分配下一个 ID。创作项目的文件名恒为「项目.md」，basename 里没有编号，
   * 必须从**路径中的项目目录名**或 frontmatter 的 id 取号。
   */
  async function nextId(domain, settings) {
    // 域可显式声明前缀（销售域是 S）。不声明时沿用原规则，
    // 所以创作仍是 C、工作仍是 W，已有数据的号段一条不动。
    const prefix =
      domain.idPrefix ??
      (domain.shape === 'project' ? 'C' : domain.id === 'work' ? 'W' : domain.id.slice(0, 1).toUpperCase());
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

  async function updateRecord({ id, status, stage, progress, next, deadline, openEnded, category, note, quote, expectedUpdated, ...rest }) {
    const settings = await loadAll(true);
    const entry = findEntry(settings, id);
    const domain = domainOf(settings, entry.domain);
    const now = new Date();

    if (domain.shape === 'stream') {
      if (!status && !note) throw new Error('灵感只有两种改法：status 改成"promoted"并给 to，或写一条 note。');
    }

    /**
     * 经验教训库不接受"完成 / 改期 / 进度"。
     *
     * 明确报错而不是静默忽略：模型按"任务"的习惯调用时，必须立刻知道这条路走不通，
     * 否则它会以为改成功了，用户却看不到任何变化。
     * 允许的改动只有：补一条进展（quote/note）、改下一步、打标签/分类。
     */
    if (domain.lifecycle === 'journal') {
      const rejected = [
        status !== undefined ? 'status（完成/重开）' : null,
        stage !== undefined ? 'stage（阶段）' : null,
        progress !== undefined ? 'progress（进度）' : null,
        deadline !== undefined ? 'deadline（截止日期）' : null,
      ].filter(Boolean);
      if (rejected.length) {
        throw new Error(
          `${domain.name}域是经验教训库，条目没有完成、改期、进度这些动作（收到：${rejected.join('、')}）。` +
            '要补充内容就写 note 或 quote（会追加到时间轴），要调整就改 next 或 tags。',
        );
      }
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

    if (domain.shape === 'task' && domain.lifecycle !== 'journal') {
      if (status) {
        const value = String(status);
        /**
         * 允许的状态值**由域声明**，不再硬编码四个英文词。
         *
         * 事务域是 待办/进行中/已完成/已放弃，销售域是 商机/.../未中标。
         * 报错信息也按域给，否则用户会收到一套与他的域毫不相干的提示。
         *
         * 同时接受**历史英文值并归一化**（todo→待办 等）：老记录、老提示词、
         * 以及用户自己从别处拷来的写法都能落到当前枚举上，不会把中英混存成两个值。
         */
        const normalized = normalizeStatusValue(domain, 'status', value);
        const allowed = statusValuesOf(domain);
        if (!allowed.includes(normalized)) {
          throw new Error(`${domain.name}域的状态只能是 ${allowed.join(' / ')}。`);
        }
        nextData.status = normalized;
        // 完成时间只在"进入完成值"时记录；离开完成值（含改成未中标、退回在办）必须清掉，
        // 否则它还带着完成时间参与统计——`completedAt` 是完成率的唯一依据。
        if (completionValuesOf(domain).includes(normalized)) nextData.completedAt = stamp(now);
        else delete nextData.completedAt;
      }
      if (progress !== undefined) nextData.progress = clampProgress(progress);
    }
    if (domain.shape === 'project') {
      if (stage) {
        const value = String(stage);
        /**
         * 阶段值也由域声明，报错信息用域给的中文值列表。
         * 同时**接受历史英文值并归一化**：模型按旧提示词传 'drafting' 时不至于报错，
         * 也不会把一个中英混存的值写进文件。
         */
        const normalized = normalizeStatusValue(domain, 'stage', value);
        const allowed = stageValuesOf(domain);
        if (!allowed.includes(normalized)) {
          throw new Error(`${domain.name}域的阶段只能是 ${allowed.join(' / ')}。`);
        }
        nextData.stage = normalized;
        if (completionValuesOf(domain).includes(normalized)) nextData.completedAt = stamp(now);
        else delete nextData.completedAt;
      }
      if (progress !== undefined) nextData.progress = clampProgress(progress);
    }
    if (next !== undefined) nextData.next = String(next).trim();
    if (category !== undefined) {
      if (category === null || category === '') delete nextData.category;
      else nextData.category = String(category).trim().slice(0, 20);
    }
    /**
     * 域声明的**其他标量字段**（销售域的 customer / bidNo / amount / profit 等）。
     *
     * 为什么需要这一段：updateRecord 的签名是逐个字段手写的，
     * 没写进来的键**静默不落盘**——工具参数表加了、HTTP 也透传了，
     * 却在这最后一跳丢掉，而且返回"已更新"。
     * 这里按域声明兜底：声明过的 string/number/date 字段都接受赋值，
     * enum/tags/核心字段有各自的语义，仍走上面各自的专门分支。
     *
     * 只处理 `rest`（签名之外的字段），所以 status/stage/progress 这类
     * 带副作用的字段不可能被这里二次赋值。
     */
    for (const [key, value] of Object.entries(rest)) {
      const spec = domain.fields?.[key];
      if (!spec) continue;
      if (['status', 'stage', 'progress', 'tags'].includes(key)) continue;
      if (value === undefined) continue;
      if (value === null || value === '') {
        delete nextData[key];
        continue;
      }
      if (spec.type === 'number') {
        const num = Number(value);
        if (!Number.isFinite(num)) throw new Error(`${spec.label ?? key} 必须是数字（收到：${value}）。`);
        nextData[key] = num;
      } else if (spec.type === 'enum') {
        const text = String(value);
        if (!spec.values.includes(text)) {
          throw new Error(`${spec.label ?? key} 只能是 ${spec.values.join(' / ')}。`);
        }
        nextData[key] = text;
      } else {
        const text = String(value).trim();
        if (Number.isFinite(spec.max) && text.length > spec.max) {
          throw new Error(`${spec.label ?? key} 最多 ${spec.max} 个字符。`);
        }
        nextData[key] = text;
      }
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
    const kind = statusKind(domain, entry);
    /**
     * 经验教训库（journal）不计算到期与停滞。
     *
     * 早期这些条目是按 task 形态建的，文件里留着历史的 `deadline`
     * （A-2026-007..012 六条）。如果照常算 due，面板就会在某些经验下面
     * 显示「今天到期」「剩 3 个工作日」——**一个经验条目怎么可能到期**。
     * 这里在源头停算：前端拿到的 due 恒为 null，不必让每个渲染分支再判一次。
     *
     * 注意只影响"计算与展示"，**不改用户文件里的 deadline**（真实记录不动）。
     */
    const journal = domain.lifecycle === 'journal';
    const due = journal ? null : overdueOf(settings, domain, entry, now);
    const stall = journal ? 0 : stallDaysOf(entry, now);
    return entryView(domain, entry, {
      kind,
      // 生命周期随条目一起下发：前端据此决定"这条算不算待办"，
      // 不必再去反查域表（前端拿不到域声明，只能看到快照里的 domains 视图）。
      lifecycle: domain.lifecycle ?? 'task',
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
   *
   * `archived`（经验教训库）**不参与提醒**：
   * 一条经验记下来就是为了将来查阅，不是等着被"处理掉"。
   * 把它按停滞报警，会让 20 条经验永久挂在待办里，提醒也就失去意义。
   */
  function reminderReason(domain, entry, decorated, context = {}) {
    if (entry.kind !== 'open') return null;
    /**
     * **已转出的记录不再提醒**。
     *
     * 工作事项转成商机之后，工作域那条保留着（用户要求保留原始记录），
     * 但它已经不是你要盯的那件事了——真正要跟的是转入后的那条。
     * 两条都挂待办、标题还一模一样，用户只会看到"重复的记录"。
     *
     * 这里只停**提醒**，不停展示：记录仍出现在「全部记录」里，
     * 点进去能看到"已转成销售 S-2026-001"，追溯链完整。
     * 状态不动，要不要标完成仍由人决定（转出去不等于这件事完了）。
     */
    if (entry.promotedTo) return null;
    const declared = new Set(domain.reminders ?? []);
    // 到期类优先级最高：有明确截止日，就不必再说"每天跟进"
    if (decorated.due?.level === 'overdue' && declared.has('due')) return 'overdue';
    if (decorated.due?.level === 'today' && declared.has('due')) return 'today';
    if (decorated.due?.level === 'soon' && declared.has('due')) return 'soon';
    /**
     * `daily`：**每个工作日都提醒一次**。
     *
     * 用户对销售的明确要求：一条商机从摸到到开标没有准数，
     * 只能每天提一下，才知道今天该推哪个。
     *
     * 用工作日而不是自然日：周末弹出来没人处理，只会让人把提醒当噪音关掉。
     * 节假日按 系统/节假日.json（含调休）判定——国庆上班的那天该提醒，
     * 周末补班也该提醒。
     *
     * 放在 due 之后、stall 之前：已经有截止日的走 due 的分级，
     * 没截止日的商机才落到"每天跟进"。同一条只会出一个原因。
     */
    if (declared.has('daily') && context.isWorkday !== false) return 'daily';
    if (declared.has('stall') && decorated.stallDays >= (domain.stallDays ?? 7)) return 'stall';
    if (declared.has('dormant') && (decorated.dormantDays ?? 0) >= (domain.dormantDays ?? 30)) return 'dormant';
    // openEnded 兜底：明确"不急"的条目 7 天没动，也进停滞观察
    // （archived 不会走到这里，因为 kind 不是 open）
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
    /**
     * 今天是不是工作日。
     *
     * `daily` 类提醒（销售商机：每个工作日都提）要靠它决定今天提不提。
     * 算一次传下去，不要在每个条目的判定里各算一遍——
     * 节假日表要查调休与法定假日，逐条重算是纯浪费。
     */
    const workdayToday = isWorkday(now, settings.holidays);

    for (const domain of settings.domains) {
      const items = settings.entries.filter((e) => e.domain === domain.id);
      const done = items.filter((e) => statusKind(domain, e) === 'done');
      const decorated = items.map((e) => decorate(settings, domain, e, now));
      all.push(...decorated);
      for (const item of decorated) {
        const entry = items.find((e) => e.id === item.id);
        const reason = entry ? reminderReason(domain, { ...entry, kind: item.kind }, item, { isWorkday: workdayToday }) : null;
        if (reason) reasons.set(item.id, reason);
        item.reason = reason ?? null;
      }
      const doneSorted = decorated
        .filter((e) => e.kind === 'done')
        .sort((a, b) => String(b.completedAt ?? '').localeCompare(String(a.completedAt ?? '')));
      /**
       * 经验教训库的条目单独一档 `archived`。
       * 面板按"时间倒序"展示它——经验库要的是"最近又踩了什么坑"，
       * 不是按紧急度排队（它本来就没有紧急度）。
       */
      const archivedSorted = decorated
        .filter((e) => e.kind === 'archived')
        .sort((a, b) => String(b.created ?? '').localeCompare(String(a.created ?? '')));
      domainsView.push({
        id: domain.id,
        name: domain.name,
        icon: domain.icon,
        shape: domain.shape,
        // 这个域有没有"完成/改期"动作：面板据此隐藏按钮，别给无效动作（用户要求）
        hasCompletion: hasCompletion(domain),
        lifecycle: domain.lifecycle ?? 'task',
        /**
         * 这个域能转成哪些域：面板据此决定要不要显示「转入」按钮、按钮文案是什么。
         *
         * 不下发的话，前端只能靠 `item.domain === 'idea'` 这种硬编码判断，
         * 那正是加了销售域后"工作事项在面板上根本没有转化入口"的根因——
         * 后端早就支持了，前端不知道有这个能力。能力下发给前端，判断才不用写死。
         */
        promotesTo: promotionTargetsOf(settings.domains, domain.id),
        /**
         * 这个域的状态取值、默认值、完成/终止值：面板据此渲染"推进阶段"下拉，
         * 并知道「标记完成」到底该写哪个值。
         *
         * 不下发的话前端只能硬编码 todo/doing/done/dropped，
         * 那是加销售域后「点标记完成直接报错」的根因——销售域没有 done 这个值。
         *
         * 项目形态（创作）的状态存在 `stage` 里，所以这里按形态取对应的那套值：
         * 面板只有一个通用的"推进阶段"下拉，不该为了创作再分一条代码路径。
         */
        statusValues: domain.shape === 'project' ? stageValuesOf(domain) : statusValuesOf(domain),
        statusDefault: domain.shape === 'project' ? defaultStageOf(domain) : defaultStatusOf(domain),
        doneValues: completionValuesOf(domain),
        droppedValues: dropValuesOf(domain),
        open: decorated.filter((e) => e.kind === 'open').sort(sortByUrgency),
        doneCount: done.length,
        recentDone: doneSorted.slice(0, doneLimit),
        // 已完成总数与已带回数量分开给，面板能显示"还有 N 条"并请求加载
        doneReturned: Math.min(doneSorted.length, doneLimit === Infinity ? doneSorted.length : doneLimit),
        archived: archivedSorted.slice(0, doneLimit),
        archivedCount: archivedSorted.length,
        archivedReturned: Math.min(archivedSorted.length, doneLimit === Infinity ? archivedSorted.length : doneLimit),
        total: items.length,
        stalled: decorated.filter((e) => e.kind === 'open' && reasons.get(e.id) === 'stall').length,
        dormant: decorated.filter((e) => reasons.get(e.id) === 'dormant').length,
      });
    }

    // 分类统计：按域的 category/tags 字段聚合（工作=分类，灵感/创作=标签），面板筛选用
    const categories = buildCategories(settings, all);

    /**
     * 客户台账：按**客户单位**把三类记录聚到一起。
     *
     * 用户的要求是"客户台账包含中标客户、未中标客户、拜访客户"。
     * 这三者在插件里本来就是三种记录：
     *   · 中标 / 未中标 → 销售域里 status 为「中标」「未中标」的商机
     *   · 拜访         → 拜访域的流水条目
     * 所以台账**不另存数据**，只做一个按客户名的横向视图——
     * 另存一份台账会和原始记录对不上，改了一边忘了另一边。
     *
     * 客户名的归一化只做最小处理（去空白、去括号后缀里的空格），
     * **不做模糊匹配**：把"滨海新区水务局"和"滨海水务"并成一个客户，
     * 猜错的代价比让用户多写几个字大得多。
     */
    const customers = buildCustomers(all);

    // 按统一 reason 分组：同一条只出现一次
    const byReason = (reason) => all.filter((e) => reasons.get(e.id) === reason);
    const overdue = byReason('overdue');
    const dueToday = byReason('today');
    const soon = byReason('soon');
    const stalled = byReason('stall');
    const dormant = byReason('dormant');
    // 每个工作日都要跟进的（销售商机）。单列一档，不和"停滞"混在一起——
    // 停滞是"你忘了它"，跟进是"它本来就需要天天推"，措辞不同。
    const followup = byReason('daily');
    const open = all.filter((e) => e.kind === 'open');

    return {
      generatedAt: stamp(now),
      uiVersion: UI_VERSION,
      date: ymd(now),
      // 今天是不是工作日：面板据此决定要不要显示"今日跟进"分组（周末不显示）
      isWorkday: workdayToday,
      domains: domainsView,
      stats: {
        open: open.length,
        overdue: overdue.length,
        dueToday: dueToday.length,
        soon: soon.length,
        stalled: stalled.length,
        dormant: dormant.length,
        followup: followup.length,
        done: all.filter((e) => e.kind === 'done').length,
        // 经验教训库的条数单列：它不是"待办"，混进 open 会让任务数虚高
        archived: all.filter((e) => e.kind === 'archived').length,
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
      // 今日跟进：同样给完整集合，提醒文案要按它逐条列
      followup,
      categories,
      // 客户台账视图：按客户聚合商机结果与拜访记录（面板"客户"页签用）
      customers,
      calendar: await calendarOf(settings, now),
      schedule: settings.schedule,
      community: await communityOf(),
      reports: await reportState(settings),
      /**
       * 会话绑定状态：面板右栏要显示"提醒推送到哪"。
       * 之前这里**从未输出** state 字段，前端只能读到 undefined，
       * 于是界面永远显示"会话未绑定"——即使实际已绑定也无法察觉。
       */
      state: await bindingOf(),
    };
  }

  /** 当前会话绑定情况（供面板展示，不泄露会话标识本身） */
  async function bindingOf() {
    const raw = (await store.readJson(FILES.state, {})) ?? {};
    const tailOf = (value) => (typeof value === 'string' && value ? String(value).slice(-4) : null);
    const reminderBound = typeof raw.reminderSession === 'string' && raw.reminderSession.length > 0;
    // 报告会话回落到提醒会话：老数据里只有 reminderSession，两者当时是同一个
    const reportId = raw.reportSession ?? raw.reminderSession;
    const reportBound = typeof reportId === 'string' && reportId.length > 0;
    return {
      // 兼容旧字段名（面板与既有测试仍在读 reminderSession 这个布尔）
      reminderSession: reminderBound,
      sessionTail: tailOf(raw.reminderSession),
      boundAt: raw.reminderBoundAt ?? null,
      // 两个投递目标分别给出，面板可以显示"提醒→A，报告→B"
      reminder: { bound: reminderBound, tail: tailOf(raw.reminderSession), at: raw.reminderBoundAt ?? null },
      report: { bound: reportBound, tail: tailOf(reportId), at: raw.reportBoundAt ?? null },
      sameSession: reminderBound && reportBound && raw.reminderSession === reportId,
      scheduleLost: Boolean(raw.reminderTaskDeleteFailed),
      reminderTaskId: raw.reminderTaskId ?? null,
      startedAt: raw.startedAt ?? null,
      lastReminder: raw.lastReminder?.day ?? null,
      pendingReports: (raw.pendingReports ?? []).length,
      missedReports: (raw.missedReports ?? []).length,
      /**
       * 错过的周期标识（B06）：只给数量等于没说——用户要知道"补哪一期"。
       * 面板据此显示"2026-09 月报需要手动补"，而不是一句模糊的"有 N 期错过"。
       */
      missedKeys: (raw.missedReports ?? []).map((item) => `${item.key} ${REPORT_LABEL[item.period] ?? item.period}`).slice(0, 6),
      lastReminderHeadline: raw.lastReminder?.headline ?? null,
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

  /**
   * 客户台账：按客户单位把商机结果与拜访记录聚在一起。
   *
   * 三类数据本来就分散在不同的域里：
   *   · 中标 / 未中标 → 销售域 status 为「中标」「未中标」的商机
   *   · 拜访         → 拜访域（stream 形态）的月度流水条目
   * 这里**不另存一份台账**，只做横向聚合视图。理由：另存就会和原始记录对不上，
   * 改了一边忘另一边，两个数字静默打架——和利润率不入库是同一个道理。
   *
   * 客户名归一化只做最小处理：去首尾空白、全角转半角括号。
   * **不做模糊匹配**：把"滨海新区水务局"和"滨海水务"并成一个客户，
   * 猜对的收益远小于猜错的代价（客户台账错位比多几行难看得多）。
   */
  function buildCustomers(decorated) {
    const map = new Map();

    /** 取归一化后的客户名；取不到就返回空串 */
    function customerOf(item) {
      const raw = item.customer ?? item.extra?.['客户单位'] ?? item.extra?.['客户'] ?? '';
      return String(raw).trim().replace(/（/g, '(').replace(/）/g, ')');
    }

    function bucket(name) {
      let found = map.get(name);
      if (!found) {
        found = {
          name,
          won: [],        // 中标商机
          lost: [],       // 未中标商机
          running: [],    // 还在跟的商机
          visits: [],     // 拜访记录
          wonAmount: 0,   // 中标金额合计（元）
          wonProfit: 0,   // 中标利润合计（元）
          lastVisitAt: null,
        };
        map.set(name, found);
      }
      return found;
    }

    for (const item of decorated) {
      const name = customerOf(item);
      // 没填客户的不进台账：留一个"未填客户"的桶只会让它变成垃圾桶
      if (!name) continue;

      if (item.domain === 'sales') {
        const entry = bucket(name);
        const status = String(item.status ?? '');
        if (status === '中标') {
          entry.won.push(item);
          if (Number.isFinite(item.amount)) entry.wonAmount += item.amount;
          if (Number.isFinite(item.profit)) entry.wonProfit += item.profit;
        } else if (status === '未中标') {
          entry.lost.push(item);
        } else {
          entry.running.push(item);
        }
        continue;
      }

      if (item.domain === 'visit') {
        const entry = bucket(name);
        entry.visits.push(item);
        const at = item.created ?? item.lastAt ?? null;
        if (at && (!entry.lastVisitAt || String(at) > String(entry.lastVisitAt))) entry.lastVisitAt = at;
      }
    }

    const list = [...map.values()].map((entry) => {
      const contact = entry.visits.length ? (entry.visits[0].contact ?? null) : null;
      return {
        name: entry.name,
        // 三类计数分开给：面板要能按"中标客户/未中标客户/拜访客户"筛
        wonCount: entry.won.length,
        lostCount: entry.lost.length,
        runningCount: entry.running.length,
        visitCount: entry.visits.length,
        wonAmount: entry.wonAmount,
        wonProfit: entry.wonProfit,
        // 利润率现算，不入库（和销售域同一口径）
        wonMargin: entry.wonAmount > 0 ? Math.round((entry.wonProfit / entry.wonAmount) * 1000) / 10 : null,
        contact,
        lastVisitAt: entry.lastVisitAt,
        // 明细只给 id 与标题，避免快照膨胀；点开走详情
        won: entry.won.map((i) => ({ id: i.id, title: i.title, amount: i.amount ?? null, completedAt: i.completedAt ?? null })),
        lost: entry.lost.map((i) => ({ id: i.id, title: i.title, completedAt: i.completedAt ?? null })),
        running: entry.running.map((i) => ({ id: i.id, title: i.title, status: i.status ?? null, deadline: i.deadline ?? null })),
        visits: entry.visits.slice(0, 5).map((i) => ({ id: i.id, title: i.title, at: i.created ?? i.lastAt ?? null, excerpt: i.excerpt ?? '' })),
      };
    });

    // 排序：先按中标金额（谁最值钱），再按中标数，最后按拜访数
    return list.sort(
      (a, b) =>
        b.wonAmount - a.wonAmount ||
        b.wonCount - a.wonCount ||
        b.visitCount - a.visitCount ||
        a.name.localeCompare(b.name, 'zh'),
    );
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
    // 今日跟进排在停滞之前：这是主动要推进的（商机），比"忘了动"更该先看到
    if (snap.stats.followup) lines.push(`跟进中 ${snap.stats.followup} 件`);
    if (snap.stats.stalled) lines.push(`停滞 ${snap.stats.stalled} 件`);
    if (freshDormant.length) lines.push(`沉睡灵感 ${freshDormant.length} 条`);

    const batch = {
      date: today,
      headline: lines.length ? lines.join(' · ') : '今天没有到期和停滞的条目。',
      overdue: snap.overdue,
      dueToday: snap.dueToday,
      soon: snap.soon,
      followup: snap.followup ?? [],
      stalled: snap.stalled,
      dormant: freshDormant,
      dormantPending: Math.max(0, freshDormantAll.length - freshDormant.length),
      generatedAt: stamp(now),
    };

    if (markDormant) {
      // 只在真正生成时：标记沉睡已通知 + 存档本批供会话回读。
      // 走事务而不是整体覆盖状态（B05）：生成提醒的同时可能有绑定写入、调度器写入，
      // 用外层读到的 state 整体写回会把它们的改动抹掉。
      await mutateState((state) => {
        const notifiedNow = Array.isArray(state.dormantNotified) ? state.dormantNotified : [];
        if (freshDormant.length) {
          state.dormantNotified = [...new Set([...notifiedNow, ...freshDormant.map((i) => i.id)])].slice(-300);
        }
        if (!state.reminderBatches) state.reminderBatches = {};
        state.reminderBatches[today] = batch;
        // 只保留最近 14 天，避免状态文件膨胀
        const keys = Object.keys(state.reminderBatches).sort();
        for (const key of keys.slice(0, Math.max(0, keys.length - 14))) delete state.reminderBatches[key];
        return true;
      });
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
          // 经验教训库：kind=archived 只收这类条目
          if (kind === 'archived' && status !== 'archived') continue;
        }
        if (needles) {
          /**
           * 关键词搜索范围必须覆盖**条目里所有可读的文字**：
           * 标题、正文（含经验库的现象/根因/约束小节）、备注、时间轴。
           *
           * 踩过的坑：
           *   1. 只搜标题 + 时间轴时，经验库正文里的约束搜不到——
           *      记录明明写了"用 read/edit 写工具代替 shell"，搜关键词却返回 0 条。
           *   2. 修好正文后又漏了备注：A-2026-019 的 "Get-Content" 恰好只出现在
           *      备注段（`- 日期 说明`），于是这条最该被搜到的经验依然搜不到。
           * 一次把四段都放进来，别再漏。
           */
          const hay = [
            entry.title,
            entry.body,
            (entry.notes ?? []).join(' '),
            (entry.timeline ?? []).map((t) => `${t.text} ${t.quote ?? ''}`).join(' '),
          ]
            .filter(Boolean)
            .join(' ')
            .toLowerCase();
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
    // B06：这里原来还接受 `weeklyWeekday` 并回报"周报在周X"，
    // 但报告只有四类周期、没有周报——留着等于给模型一个会成功的假接口，
    // 用户说完"周报改到周一"配置写了、报告却永远不会出。
    // 现在直接拒绝，并指回真实可调的四个时刻。
    if (patch.weeklyWeekday !== undefined) {
      throw new Error(
        '没有周报功能。报告只有四类：月度（月末）、季度（季末）、半年度（6/12 月末）、年度（12 月末），' +
          '可调的是 monthlyAt / quarterlyAt / halfAt / yearlyAt 四个时刻。',
      );
    }
    // 四类报告的时间点都可调；日期固定为各自周期的最后一天
    for (const [key, label] of [
      ['monthlyAt', '月度报告'],
      ['quarterlyAt', '季度报告'],
      ['halfAt', '半年度报告'],
      ['yearlyAt', '年度报告'],
    ]) {
      if (patch[key] === undefined) continue;
      const value = clock(patch[key]);
      if (!value) throw new Error(`${key} 必须是 HH:mm，例如 20:00。`);
      next[key] = value;
      changed.push(`${label} ${value}`);
    }
    if (!changed.length) {
      const current2 = normalizeSchedule(next);
      return {
        message:
          `当前：每天 ${current2.reminderAt} 提醒（${current2.timeZone}）。\n` +
          `报告都在各自周期最后一天生成：\n` +
          `· 月度报告 月末 ${current2.monthlyAt}\n` +
          `· 季度报告 季末 ${current2.quarterlyAt}\n` +
          `· 半年度报告 半年末 ${current2.halfAt}\n` +
          `· 年度报告 年末 ${current2.yearlyAt}`,
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
   * 会话绑定。**每日提醒与报告各自独立**：
   *   reminderSession —— 每日 12:00 那条提醒投到哪
   *   reportSession   —— 四类报告的撰写任务投到哪
   *
   * 分开的理由：提醒是"每天看一眼"的轻量消息，报告是"要坐下来写一篇"的重活，
   * 用户很可能希望报告在专门的一个会话里生成，不打断日常对话。
   *
   * `target`：
   *   'reminder' 只改提醒会话
   *   'report'   只改报告会话
   *   'both'     （默认）两者都指向这个会话——这是最常见的"换个地方聊"的心智
   * 只记根会话（子代理的会话收不到投递）。
   */
  async function bindSession(sessionId, target = 'both') {
    const which = target === 'reminder' || target === 'report' ? target : 'both';
    // 整段读改写在同一事务内完成（B05）：并发改提醒与报告不会再互相覆盖
    const outcome = await mutateState((state) => {
      const changed = [];
      if (which === 'reminder' || which === 'both') {
        if (state.reminderSession !== sessionId) {
          state.reminderSession = sessionId;
          state.reminderBoundAt = stamp();
          // 换会话后旧的宿主任务签名失效，交给调度器下次 tick 重建
          delete state.reminderTaskSignature;
          changed.push('reminder');
        }
      }
      if (which === 'report' || which === 'both') {
        if (state.reportSession !== sessionId) {
          state.reportSession = sessionId;
          state.reportBoundAt = stamp();
          changed.push('report');
        }
      }
      // 没有变化就明确返回 false：mutateState 会跳过写入，
      // 免得每次幂等调用都白白刷一次 mtime（回归用例会断言这一点）
      return changed.length ? changed : false;
    });

    return {
      sessionId,
      changed: outcome.result ?? [],
      reminderSession: outcome.state.reminderSession ?? null,
      reportSession: outcome.state.reportSession ?? null,
      written: outcome.written,
    };
  }

  /** 兼容旧名：只改提醒会话（保留给既有调用方） */
  async function bindReminderSession(sessionId) {
    const result = await bindSession(sessionId, 'reminder');
    return result.reminderSession;
  }

  /**
   * 状态文件（系统/状态.json）的**原子读改写**。
   *
   * 为什么必须走这里（审查报告 B05）：
   *   原来每个写者都是 `readJson → 改内存 → writeJson` 的三段式，中间没有任何互斥。
   *   并发执行"提醒改为 B"和"报告改为 B"时，两个请求各自读到旧状态，
   *   后写的那个把先写的字段整块覆盖掉——实测结果是提醒仍停在 A、只有报告改成了 B。
   *   同样的覆盖在"绑定"与"调度写 pendingReports / reminderTaskId"交叉时也会发生。
   *
   * 三条约束：
   *   1. 整段在 store.enqueue 内：与条目写入共用同一条队列，读到的就是最新状态。
   *   2. 内部只能用 writeNow：write() 会再次入队，在队列内等待同一条队列 = 死锁。
   *   3. mutator 拿到的是**深拷贝**，即使中途抛错也不会污染磁盘上的旧状态。
   *
   * mutator 返回 false 时跳过写入（没有变化就不落盘，避免无谓的 mtime 抖动）。
   */
  function mutateState(mutator) {
    return store.enqueue(async () => {
      const raw = (await store.readJson(FILES.state, {})) ?? {};
      const draft = JSON.parse(JSON.stringify(raw));
      const result = await mutator(draft);
      if (result === false) return { state: raw, result: null, written: false };
      await store.writeNow(FILES.state, `${JSON.stringify(draft, null, 2)}\n`);
      return { state: draft, result: result ?? null, written: true };
    });
  }

  /** 只读状态：给面板/工具看，不参与写入 */
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
    bindSession,
    bindReminderSession,
    currentState,
    // 状态文件的原子读改写：调度器也用这个写 pendingReports / 任务 ID，
    // 与绑定互不覆盖（B05）
    mutateState,
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

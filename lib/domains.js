/**
 * 域注册表：加一个域 = 加一份声明，不改工具、不改面板、不改报告生成器。
 *
 * 形态只有三种，这是刻意的限制：
 *   task    事项：一事项一文件（有状态、截止、下一步）
 *   project 项目：一项目一文件（有阶段、里程碑、进度）
 *   stream  流水：月度单文件追加（记录成本最低，不要求标题）
 *
 * 声明可放在 系统/域.json，与内置合并（同 id 覆盖）。
 */

export const SHAPES = ['task', 'project', 'stream'];

export const BUILTIN_DOMAINS = [
  {
    /**
     * 事务域（原「工作」）。
     *
     * ── 为什么要改名换定位 ──
     * 实测数据：工作域 3 条里 2 条转成了商机，只剩 1 条是真事务。
     * 用户实际的工作绝大部分会落在销售域，工作域如果也叫"工作"，
     * 每次记东西都要纠结"这该进工作还是销售"，判断成本高、判错还两头留记录。
     *
     * 现在的定位：**不是商机的事**——内部协调、行政、绩效、软著这类
     * 没有客户也没有金额、但要办完的事。它是兜底，不是主体。
     *
     * ── 只改显示名，id 与目录一律不动 ──
     * `id` 仍是 `work`、`dir` 仍是 `工作`：
     * 改任何一个都会让已有记录找不到（条目按 domain.id 归属、按 domain.dir 定位）。
     * 显示名只是面板上的一行文字，改名零风险。
     */
    id: 'work',
    name: '事务',
    en: 'Affairs',
    shape: 'task',
    dir: '工作',
    icon: '▣',
    /**
     * 报告目录固定成「工作」，不跟显示名走。
     *
     * 历史报告已经写在 `报告/工作/` 下（按当时的 name 建的目录）。
     * 现在 name 改成"事务"，如果报告目录也跟着改，
     * `previousCommitments` 会去 `报告/事务/` 找上一期——找不到，
     * 报告里"上期承诺对照"整段静默变空，而且**不报错**，很难发现。
     *
     * 所以这里显式钉住目录名。以后真想搬目录，改这一行 + 手动移文件。
     */
    reportDir: '工作',
    fields: {
      /**
       * 状态值用**汉字**，不用 API 里的 todo/doing 这类英文词。
       *
       * 为什么不是"面板翻译、文件里留英文"：
       * 文件是唯一真相（零加密的 Markdown），用户打开 `W-2026-004.md`
       * 看到 `status: doing` 读不懂；而销售域、实施域本来就是汉字
       * （商机/中标、待启动/已验收），两套口径并存最费解。
       *
       * 代价是**已有记录里存的是英文**，必须靠 legacyValues 认老账，
       * 否则一条 `status: doing` 在读完新代码后会被当成"未知状态"，
       * 从"在办"掉进兜底分支——看起来就是任务从待办里消失了。
       */
      status: { type: 'enum', values: ['待办', '进行中', '已完成', '已放弃'], default: '待办', label: '状态' },
      progress: { type: 'number', min: 0, max: 100, label: '进度' },
      deadline: { type: 'date', label: '截止' },
      next: { type: 'string', max: 200, label: '下一步' },
      category: { type: 'string', max: 20, label: '分类' },
      tags: { type: 'tags', label: '标签' },
    },
    required: ['title'],
    dedupe: 'title',
    /**
     * 事务常常会"长成"一个商机（原先只是去谈，谈出眉目了才成为商机）。
     * 声明去向，转化才走得通；不声明就只能靠人重建一条，原话和时间轴全丢。
     *
     * 这也是**简化流转**那一半：谈出眉目就转走，事务域只留正在办的。
     * 转出后源记录自动标完成并退出待办（见 link.js），不占地方。
     */
    promotesTo: ['sales'],
    reminders: ['due', 'stall'],
    stallDays: 5,
    // 老记录里存过英文，认这些值并归一化成上面的汉字（见 normalizeLegacyStatus）
    legacyValues: { todo: '待办', doing: '进行中', done: '已完成', dropped: '已放弃' },
    analysis: ['flow', 'completion', 'due', 'stall', 'distribution'],
    lifecycle: 'task',
    tone: 'colleague',
  },
  {
    /**
     * 销售漏斗：一条商机一个文件，状态即流程阶段。
     *
     * ── 为什么状态叫 status 而不是新增 stage 字段 ──
     * `stage` 被创作域绑死了：`entries.js` 建条时跳过舞台字段、只给 project 形态补回，
     * `secretary.js` 的 updateRecord 也只在 `shape === 'project'` 时处理它。
     * task 形态即使声明了 stage，值也会在落库前被静默丢弃。
     * 把阶段做成 status 的枚举值，走的是已经成熟的 task 链路，不碰创作的骨架。
     *
     * ── 阶段链的依据 ──
     * 用户原话：资格审查与投标准备"在业主发布项目招标文件之前，已与业主方提前完成确认"。
     * 所以这两步发生在流程**开始之前**，不占阶段位——它们记进「跟踪」阶段的时间轴。
     */
    id: 'sales',
    name: '销售',
    en: 'Sales',
    shape: 'task',
    dir: '销售',
    icon: '◆',
    fields: {
      status: {
        type: 'enum',
        values: ['商机', '跟踪', '立项', '报价', '中标', '未中标'],
        default: '商机',
        label: '阶段',
      },
      customer: { type: 'string', max: 40, label: '客户' },
      bidNo: { type: 'string', max: 40, label: '招标编号' },
      deadline: { type: 'date', label: '当前阶段截止' },
      // 金额单位统一为**元**，存整数或两位小数都可以（number 原样序列化）
      amount: { type: 'number', min: 0, label: '中标金额(元)' },
      profit: { type: 'number', label: '中标利润(元)' },
      next: { type: 'string', max: 200, label: '下一步' },
      tags: { type: 'tags', label: '标签' },
    },
    required: ['title'],
    dedupe: 'title',
    // 销售域「有完成动作」的值不是 done/dropped，由下面三个声明说清楚
    doneValues: ['中标'],
    droppedValues: ['未中标'],
    reminders: ['due', 'daily'],
    /**
     * 商机不像事项那样有个"该做完了"的时刻，只有持续跟。
     * 用户原话：一条商机从摸到到开标没有准确时间，"只能你每个工作日都提醒我一下"。
     *
     * 所以用 `daily`（每个工作日都进提醒）而不是靠 stallDays 的间隔判断——
     * 间隔要么太吵要么漏，而且把"跟得勤不勤"交给一个拍出来的天数决定。
     * stallDays 仍保留：面板显示"距上次更新 N 天"，让你自己看这单跟得够不够。
     */
    stallDays: 7,
    analysis: ['flow', 'completion', 'due', 'stall', 'distribution'],
    lifecycle: 'task',
    tone: 'colleague',
    // 显式声明编号前缀。不声明的话 project 形态恒为 C、其余取 id 首字母，
    // 销售域会变成 S——目前恰好对，但那是巧合，不是约定。
    idPrefix: 'S',
    // 双向：商机也可以退回工作域。谈崩了要退回跟进池，只能单向的话
    // 用户只能删掉重建，而删掉的是带完整时间轴的真实记录。
    promotesTo: ['work', 'implement'],
  },
  {
    /**
     * 实施管理：中标之后的事。
     *
     * 用户明确划定了范围：**只做状态更新和回款情况**。
     * 不做进度甘特、不做验收流程、不做任务分解——那些等真正跑起来再说。
     *
     * 所以字段刻意少：状态（实施中/验收中/已验收）＋ 回款（累计回款金额）。
     * 回款进度由 `collected / amount` 现算，和销售利润率一样**不入库**——
     * 存了就是冗余，改了金额忘改进度，两个数会静默打架。
     */
    id: 'implement',
    name: '实施',
    en: 'Delivery',
    shape: 'task',
    dir: '实施',
    icon: '⛭',
    fields: {
      status: {
        type: 'enum',
        values: ['待启动', '实施中', '验收中', '已验收', '已终止'],
        default: '待启动',
        label: '实施状态',
      },
      customer: { type: 'string', max: 40, label: '客户' },
      // 合同金额与累计回款：回款进度 = collected / amount
      amount: { type: 'number', min: 0, label: '合同金额(元)' },
      collected: { type: 'number', min: 0, label: '累计回款(元)' },
      deadline: { type: 'date', label: '计划完成' },
      next: { type: 'string', max: 200, label: '下一步' },
      tags: { type: 'tags', label: '标签' },
    },
    required: ['title'],
    dedupe: 'title',
    doneValues: ['已验收'],
    droppedValues: ['已终止'],
    reminders: ['due', 'stall'],
    // 实施周期长，半个月没更新算正常；比商机的每日跟进松得多
    stallDays: 15,
    analysis: ['flow', 'completion', 'due', 'stall', 'distribution'],
    lifecycle: 'task',
    tone: 'colleague',
    idPrefix: 'D',
  },
  {
    /**
     * 客户台账：拜访记录。
     *
     * 用 stream 形态（月度单文件、只追加）。理由：
     *   拜访是**高频、短、彼此独立**的记录，一条一条建文件会让目录爆炸，
     *   而且要按客户横向看"这个客户聊过几次"，流水格式天然好聚。
     *
     * 台账的"中标客户 / 未中标客户"不靠这个域算——
     * 那是从销售域按 customer 聚合出来的，见 client.js 的客户视图。
     * 这个域只管**拜访**这一件事，不重复存销售状态，避免两处打架。
     */
    id: 'visit',
    name: '拜访',
    en: 'Visits',
    shape: 'stream',
    dir: '拜访',
    icon: '☎',
    fields: {
      customer: { type: 'string', max: 40, label: '客户单位' },
      contact: { type: 'string', max: 40, label: '对接人' },
      // 没有 source 字段：`来源` 是流水格式自带的（`- 来源：`），
      // 再声明一个 `形式` 会让同一个值写两行（实测出现过）。
      // 形式的差别写进正文或标签即可。
      tags: { type: 'tags', label: '标签' },
    },
    required: [],
    dedupe: 'none',
    reminders: [],
    analysis: ['flow', 'distribution'],
    lifecycle: 'task',
    tone: 'collector',
    idPrefix: 'V',
  },
  {
    id: 'creation',
    name: '创作',
    en: 'Creation',
    shape: 'project',
    dir: '创作',
    icon: '✎',
    fields: {
      stage: {
        type: 'enum',
        // 同事务域：阶段值也落成汉字。创作是 project 形态，状态存在 stage 而不是 status，
        // 所以完成/终止值也必须由本域声明，不能走 task 分支的缺省 done/dropped。
        values: ['构思', '起草', '修订', '完成', '搁置'],
        default: '构思',
        label: '阶段',
      },
      progress: { type: 'number', min: 0, max: 100, label: '进度' },
      deadline: { type: 'date', label: '截止' },
      next: { type: 'string', max: 200, label: '下一步' },
      tags: { type: 'tags', label: '标签' },
    },
    required: ['title'],
    dedupe: 'title',
    doneValues: ['完成'],
    droppedValues: ['搁置'],
    // 老创作项目里存着 idea/drafting/... ，认这些并归一化，否则改代码后
    // 「起草中」的项目会掉出在办列表（见 normalizeLegacyStatus）
    legacyValues: { idea: '构思', drafting: '起草', revising: '修订', done: '完成', parked: '搁置' },
    reminders: ['due', 'stall'],
    stallDays: 10,
    analysis: ['flow', 'completion', 'stall', 'distribution'],
    lifecycle: 'task',
    tone: 'creator',
  },
  {
    id: 'idea',
    name: '灵感',
    en: 'Ideas',
    shape: 'stream',
    dir: '灵感',
    icon: '✦',
    fields: {
      source: { type: 'string', max: 40, label: '来源' },
      tags: { type: 'tags', label: '标签' },
      promotedTo: { type: 'string', max: 40, label: '转化为' },
    },
    required: [],
    dedupe: 'none',
    // 想法要动手了就转成创作项目——这是原有的能力，不能因为改成通用转化而丢掉
    promotesTo: ['creation'],
    reminders: ['dormant'],
    dormantDays: 30,
    analysis: ['flow', 'promotion', 'dormant', 'distribution'],
    lifecycle: 'task',
    tone: 'collector',
  },
];

/**
 * 域可选的 `lifecycle` 声明：这个域的条目**有没有**完成/改期这类动作。
 *
 *   'task'    （默认）有完成动作，有到期时间，会进待办与逾期统计
 *   'journal' 只追加的经验教训库：没有"完成"，也没有"改期"，
 *             条目不参与待办/逾期/完成率，只在长期没动时提示回看
 *
 * 为什么需要它：助手域记的是"踩过的坑"，一条经验**不是待办事项**。
 * 用 task 形态去装它，会逼出两个错误行为——
 *   1. 每条新记录默认 status: todo，于是永远"未完成"，越积越多；
 *   2. 面板给出"标记完成""修改截止日期"两个按钮，而这两个动作对它没有意义。
 * 更糟的是经验被算进 stats.open，把"还有多少件事要做"这个数字污染掉。
 */
export const LIFECYCLES = ['task', 'journal'];

const ENUM_STATUS = new Set(['待办', '进行中', '已完成', '已放弃']);

export function cloneDomain(domain) {
  return JSON.parse(JSON.stringify(domain));
}

/** 合并内置与用户声明；用户同 id 覆盖，新增 id 追加 */
export function resolveDomains(userDomains) {
  const map = new Map();
  for (const domain of BUILTIN_DOMAINS) map.set(domain.id, cloneDomain(domain));

  if (Array.isArray(userDomains)) {
    for (const entry of userDomains) {
      const normalized = normalizeDomain(entry);
      if (!normalized) continue;
      const current = map.get(normalized.id);
      map.set(normalized.id, current ? mergeDomain(current, normalized) : normalized);
    }
  }
  return [...map.values()];
}

function mergeDomain(base, patch) {
  const merged = { ...base, ...patch };
  merged.fields = { ...base.fields, ...(patch.fields ?? {}) };
  merged.required = patch.required ?? base.required;
  merged.reminders = patch.reminders ?? base.reminders;
  merged.analysis = patch.analysis ?? base.analysis;
  merged.lifecycle = patch.lifecycle ?? base.lifecycle ?? 'task';
  merged.doneValues = patch.doneValues ?? base.doneValues;
  merged.droppedValues = patch.droppedValues ?? base.droppedValues;
  merged.legacyValues = patch.legacyValues ?? base.legacyValues;
  merged.promotesTo = patch.promotesTo ?? base.promotesTo;
  merged.idPrefix = patch.idPrefix ?? base.idPrefix;
  merged.reportDir = patch.reportDir ?? base.reportDir;
  return merged;
}

function normalizeDomain(entry) {
  if (!entry || typeof entry !== 'object') return null;
  const id = String(entry.id ?? '').trim();
  if (!/^[a-z][a-z0-9_-]{0,23}$/.test(id)) return null;
  const shape = SHAPES.includes(entry.shape) ? entry.shape : 'task';
  const name = String(entry.name ?? id).trim() || id;
  const dir = String(entry.dir ?? name).replace(/[\\/:*?"<>|]/g, '').trim() || id;
  const fields = {};
  if (entry.fields && typeof entry.fields === 'object') {
    for (const [key, spec] of Object.entries(entry.fields)) {
      if (!/^[A-Za-z][\w-]{0,23}$/.test(key) || !spec || typeof spec !== 'object') continue;
      const type = ['string', 'number', 'date', 'enum', 'tags', 'boolean'].includes(spec.type)
        ? spec.type
        : 'string';
      fields[key] = { ...spec, type };
    }
  }
  return {
    id,
    name,
    en: String(entry.en ?? name),
    shape,
    dir,
    icon: String(entry.icon ?? '•').slice(0, 2),
    fields,
    required: Array.isArray(entry.required) ? entry.required.filter((k) => typeof k === 'string') : ['title'],
    dedupe: entry.dedupe === 'none' ? 'none' : 'title',
    reminders: Array.isArray(entry.reminders) ? entry.reminders : ['due'],
    stallDays: Number.isFinite(entry.stallDays) ? entry.stallDays : 7,
    dormantDays: Number.isFinite(entry.dormantDays) ? entry.dormantDays : 30,
    analysis: Array.isArray(entry.analysis) ? entry.analysis : ['flow'],
    lifecycle: LIFECYCLES.includes(entry.lifecycle) ? entry.lifecycle : 'task',
    // 编号前缀与转化去向：只在声明时下发，老域不声明就完全不带这两个键，
    // 行为与加这两个特性之前一致。
    ...(typeof entry.idPrefix === 'string' && entry.idPrefix.trim()
      ? { idPrefix: entry.idPrefix.trim().slice(0, 8) }
      : {}),
    ...(Array.isArray(entry.promotesTo) && entry.promotesTo.length
      ? { promotesTo: entry.promotesTo.filter((k) => typeof k === 'string').slice(0, 8) }
      : {}),
    ...(typeof entry.reportDir === 'string' && entry.reportDir.trim()
      ? { reportDir: entry.reportDir.replace(/[\\/:*?"<>|]/g, '').trim().slice(0, 40) }
      : {}),
    // 自定义完成/终止值：只在声明时下发，没声明就不带这两个键，
    // 由 completionValuesOf/dropValuesOf 回落到域形态的缺省（老域行为不变）
    ...(Array.isArray(entry.doneValues) && entry.doneValues.length
      ? { doneValues: entry.doneValues.map(String) }
      : {}),
    ...(Array.isArray(entry.droppedValues) && entry.droppedValues.length
      ? { droppedValues: entry.droppedValues.map(String) }
      : {}),
    // 历史英文状态值的映射表（读时归一化用）。用户自己在 系统/域.json 里加域时
    // 也可以声明它，把旧值迁到新枚举值上，不必改历史文件。
    ...(entry.legacyValues && typeof entry.legacyValues === 'object'
      ? {
          legacyValues: Object.fromEntries(
            Object.entries(entry.legacyValues).filter(([, to]) => typeof to === 'string' && to),
          ),
        }
      : {}),
    tone: String(entry.tone ?? 'neutral'),
  };
}

/** 找域；接受 id 或中文名 */
export function findDomain(domains, key) {
  const text = String(key ?? '').trim().toLowerCase();
  if (!text) return null;
  return (
    domains.find((d) => d.id === text) ??
    domains.find((d) => d.name === key) ??
    domains.find((d) => d.en.toLowerCase() === text) ??
    null
  );
}

/**
 * 某个域能转向哪些域。
 *
 * 双向是刻意的：商机谈崩了要退回跟进池，只能单向的话用户只能删了重建，
 * 而删掉的是带完整时间轴的真实记录。
 *
 * 放在 domains.js 而不是 link.js：`secretary.js` 算快照时也要用，
 * 而 link.js 依赖 secretary 实例，两边互相引用会成环。
 */
export function promotionTargets(domains, domain) {
  if (!domain) return [];
  const forward = Array.isArray(domain.promotesTo) ? domain.promotesTo : [];
  const backward = domains
    .filter((d) => Array.isArray(d.promotesTo) && d.promotesTo.includes(domain.id))
    .map((d) => d.id);
  return [...new Set([...forward, ...backward])].filter((id) => id !== domain.id);
}

/** 同上，但返回 `{ id, name }`，给面板直接渲染按钮文案 */
export function promotionTargetsOf(domains, domainKey) {
  const domain = findDomain(domains, domainKey);
  if (!domain) return [];
  return promotionTargets(domains, domain)
    .map((key) => findDomain(domains, key))
    .filter(Boolean)
    .map((d) => ({ id: d.id, name: d.name }));
}

/** 域内状态键：不同形态用不同字段 */
export function statusFieldOf(domain) {
  if (domain.shape === 'project') return 'stage';
  if (domain.shape === 'stream') return 'promotedTo';
  return 'status';
}

/**
 * 域声明的**可写状态值**（task 形态专用）。
 *
 * 域自己用 `status` 字段声明了枚举，就以声明为准。数组顺序就是面板下拉的顺序。
 *
 * 为什么必须单独有这个函数：`secretary.js` 的 updateRecord 原先硬编码了
 * `['todo','doing','done','dropped']`，任何自定义状态值都会被它挡掉——
 * 而且报错信息还会告诉用户"只能 todo/doing/done/dropped"，具误导性。
 */
export function statusValuesOf(domain) {
  const declared = domain?.fields?.status?.values;
  return Array.isArray(declared) && declared.length ? declared : ['待办', '进行中', '已完成', '已放弃'];
}

/** 项目（创作）形态的可写阶段值；与 statusValuesOf 对称，给 project 链路用 */
export function stageValuesOf(domain) {
  const declared = domain?.fields?.stage?.values;
  return Array.isArray(declared) && declared.length ? declared : ['构思', '起草', '修订', '完成', '搁置'];
}

/**
 * 完成 / 终止值：域可自定义，缺省回落到「已完成 / 已放弃」。
 *
 * 销售域用「中标 / 未中标」表达这两个语义——它没有 done 这个状态，
 * 但统计口径（完成率、逾期、待办）必须还能认出"这条已经收口了"。
 *
 * 以前 project 形态在这里被写死成 done/parked，于是创作阶段改成汉字之后，
 * 一条「完成」的项目会被认成 open、永远挂在待办里。现在一律先看域声明。
 */
export function completionValuesOf(domain) {
  if (domain.shape === 'stream') return ['promotedTo'];
  const declared = domain?.doneValues;
  if (Array.isArray(declared) && declared.length) return declared;
  return domain.shape === 'project' ? ['完成'] : ['已完成'];
}

export function dropValuesOf(domain) {
  if (domain.shape === 'stream') return [];
  const declared = domain?.droppedValues;
  if (Array.isArray(declared) && declared.length) return declared;
  return domain.shape === 'project' ? ['搁置'] : ['已放弃'];
}

/**
 * 把历史遗留的英文状态值归一化成当前声明里的汉字值。
 *
 * 为什么需要：状态改名前建的记录，文件里存的是 `status: doing`。
 * 不认它的话，这条会落进"未知状态"——`statusKind` 找不到它属于完成还是终止，
 * 一律当在办，面板照样显示，但**用新值去比对就永远不相等**：
 * 详情里当前值不在下拉选项内、点完成再重开会得到两个语义相同的值并存。
 *
 * 只做**读时归一化**，不改用户文件（真实记录一字不动）。
 * 声明了 legacyValues 的域才映射；没声明的域原样返回，行为一字不变。
 */
export function normalizeStatusValue(domain, key, value) {
  const text = String(value ?? '');
  if (!text) return text;
  const spec = domain?.fields?.[key];
  // 已经是合法新值就直接返回，绝大多数记录走这条
  if (Array.isArray(spec?.values) && spec.values.includes(text)) return text;
  const legacy = domain?.legacyValues;
  if (legacy && typeof legacy === 'object' && typeof legacy[text] === 'string') return legacy[text];
  return text;
}

/** 这个域的默认状态值（新建条目时用），缺省取声明里的第一个 */
export function defaultStatusOf(domain) {
  const declared = domain?.fields?.status?.default;
  if (typeof declared === 'string' && declared) return declared;
  const values = statusValuesOf(domain);
  return values[0];
}

/** 项目形态的默认阶段（新建条目时用） */
export function defaultStageOf(domain) {
  const declared = domain?.fields?.stage?.default;
  if (typeof declared === 'string' && declared) return declared;
  const values = stageValuesOf(domain);
  return values[0];
}

export function validateField(domain, key, value) {
  const spec = domain.fields[key];
  if (!spec) return { ok: false, error: `未知字段 ${key}` };
  if (value === null || value === undefined || value === '') return { ok: true, value: undefined };
  switch (spec.type) {
    case 'enum': {
      const text = String(value);
      if (!spec.values.includes(text)) {
        return { ok: false, error: `${key} 只能是 ${spec.values.join(' / ')}` };
      }
      return { ok: true, value: text };
    }
    case 'number': {
      const num = Number(value);
      if (!Number.isFinite(num)) return { ok: false, error: `${key} 必须是数字` };
      if (Number.isFinite(spec.min) && num < spec.min) return { ok: false, error: `${key} 不能小于 ${spec.min}` };
      if (Number.isFinite(spec.max) && num > spec.max) return { ok: false, error: `${key} 不能大于 ${spec.max}` };
      return { ok: true, value: num };
    }
    case 'boolean':
      return { ok: true, value: value === true || value === 'true' };
    case 'date': {
      const text = String(value).trim();
      if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return { ok: false, error: `${key} 必须是 YYYY-MM-DD` };
      return { ok: true, value: text };
    }
    case 'tags': {
      const list = Array.isArray(value) ? value : String(value).split(/[,，\s]+/);
      const tags = [];
      for (const item of list) {
        const tag = String(item).trim().replace(/^#+/, '').slice(0, 24);
        if (!tag) continue;
        if (tags.includes(tag)) continue;
        tags.push(tag);
        if (tags.length >= 8) break;
      }
      return { ok: true, value: tags };
    }
    default: {
      const text = String(value).trim();
      if (Number.isFinite(spec.max) && text.length > spec.max) {
        return { ok: false, error: `${key} 最多 ${spec.max} 个字符` };
      }
      return { ok: true, value: text };
    }
  }
}

export { ENUM_STATUS };

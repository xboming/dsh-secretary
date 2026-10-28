/**
 * 模型接口：7 个工具。
 *
 * 只用注册表原生的 JSON Schema + output.render，不 import 任何 dsh 包，
 * 这样包可以零依赖地被 link 进 profile。
 */

const text = (value) => [{ type: 'text', text: String(value ?? '') }];

/**
 * 参数既可以写成 `{ type, description, required: true }` 的简写，也可以不加 required。
 * 这里把简写翻译成标准 JSON Schema：属性上只留真正的约束关键字，
 * required 收成顶层的字符串数组。
 *
 * 必须剥掉属性级的 required：JSON Schema 规定 required 只能是字符串数组，
 * 留着 `required: true` 会被上游严格校验判成
 * `Invalid schema for function 'secretary_add': true is not of type "array"`（HTTP 400），
 * 整个请求连同其余工具一起被拒，表现为每一轮都跑不起来、换账号也没用。
 */
/**
 * 递归清除 undefined：注册表要求工具返回值可无损 JSON 序列化，
 * 顶层或嵌套的 undefined 字段都会被拒（审查报告第 13 条）。
 * undefined 数组元素转 null，保持长度与位置。
 */
function lossless(value) {
  if (value === undefined) return null;
  if (value === null || typeof value !== 'object') {
    if (typeof value === 'function') return null;
    if (typeof value === 'number' && !Number.isFinite(value)) return null;
    return value;
  }
  if (Array.isArray(value)) return value.map((item) => (item === undefined ? null : lossless(item)));
  const out = {};
  for (const [key, item] of Object.entries(value)) {
    if (item === undefined) continue;
    out[key] = lossless(item);
  }
  return out;
}

function tool(name, description, parameters, render, execute) {
  const properties = {};
  const required = [];
  for (const [key, spec] of Object.entries(parameters)) {
    if (!spec || typeof spec !== 'object' || Array.isArray(spec)) {
      properties[key] = spec;
      continue;
    }
    const { required: isRequired, ...schema } = spec;
    properties[key] = schema;
    if (isRequired) required.push(key);
  }
  return {
    name,
    description,
    parameters: {
      type: 'object',
      properties,
      required,
      additionalProperties: false,
    },
    output: {
      schema: { type: 'object', additionalProperties: true },
      render: (_args, value) => text(render(value)),
    },
    async execute(...args) {
      const result = await execute(...args);
      return lossless(result);
    },
  };
}

const DOMAIN_PARAM = {
  type: 'string',
  description: '域 id 或中文名：work（工作）、creation（创作）、idea（灵感）。',
  required: true,
};

export function registerTools(ctx, secretary) {
  const disposers = [];

  /** 第一次被调用时绑定提醒接收会话（静默，不占输出） */
  const bindSession = async (exec) => {
    try {
      const sessionId = exec?.agent?.id;
      if (sessionId) await secretary.bindReminderSession(String(sessionId));
    } catch {
      /* 绑定失败不影响记录 */
    }
  };

  disposers.push(
    ctx.tools.register(
      tool(
        'secretary_add',
        '记一条：工作事项、创作项目或灵感。工作/创作必须有计划结束时间（deadline），没有会返回 need_deadline，此时先问用户"什么时候要"，用户说"不急"才传 openEnded: true。灵感按流水追加，不需要期限。',
        {
          domain: DOMAIN_PARAM,
          text: { type: 'string', description: '原始记录，用户的原话优先，一字不改。', required: true },
          title: { type: 'string', description: '标题；不传则取原话第一行。' },
          deadline: { type: 'string', description: '计划结束时间 YYYY-MM-DD。工作/创作强烈建议提供；这是到期提醒的依据。' },
          openEnded: { type: 'boolean', description: '用户明确说"不急/没期限"时传 true，允许无期限落库（7 天不动会按停滞提醒）。' },
          status: { type: 'string', description: '仅工作：todo / doing / done / dropped。' },
          stage: { type: 'string', description: '仅创作：idea / drafting / revising / done / parked。' },
          progress: { type: 'number', description: '进度 0-100。' },
          next: { type: 'string', description: '下一步。' },
          source: { type: 'string', description: '仅灵感：从哪来的。' },
          tags: { type: 'array', items: { type: 'string' }, description: '标签。' },
          updateExisting: { type: 'boolean', description: '已确认是同一件事、要把这次当进展并入时传 true。' },
        },
        renderAdd,
        async (args, exec) => {
          await bindSession(exec);
          const fields = {};
          for (const key of ['status', 'stage', 'progress', 'deadline', 'openEnded', 'next', 'source', 'tags']) {
            if (args[key] !== undefined) fields[key] = args[key];
          }
          return secretary.addRecord({
            domain: args.domain,
            text: args.text,
            title: args.title,
            fields,
            updateExisting: args.updateExisting === true,
          });
        },
      ),
    ),
  );

  disposers.push(
    ctx.tools.register(
      tool(
        'secretary_update',
        '改一条：状态、阶段、进度、下一步、截止，或追加一条进展/备注。改状态会自动补完成时间。',
        {
          id: { type: 'string', description: '条目 id，如 W-2026-001 / C-2026-003 / I-202610-01。', required: true },
          status: { type: 'string', description: '工作：todo / doing / done / dropped。' },
          stage: { type: 'string', description: '创作：idea / drafting / revising / done / parked。' },
          progress: { type: 'number', description: '进度 0-100。' },
          next: { type: 'string', description: '下一步。' },
          category: { type: 'string', description: '分类，如 沟通/文档/研发/会议；创作和灵感打标签。' },
          deadline: { type: 'string', description: '截止日期 YYYY-MM-DD；传空串表示清除。' },
          openEnded: { type: 'boolean', description: '用户后来说"不急"时传 true 标记为无期限；重新给了期限则不传或传 false。' },
          note: { type: 'string', description: '这次变更的说明，写进时间轴或备注。' },
          quote: { type: 'string', description: '用户原话；给了就作为进展写进时间轴。' },
        },
        (value) => `${value.message}\n${value.id} · ${value.title}\n${value.path}`,
        async (args, exec) => {
          await bindSession(exec);
          return secretary.updateRecord(args);
        },
      ),
    ),
  );

  disposers.push(
    ctx.tools.register(
      tool(
        'secretary_query',
        '查记录：按域、状态、关键词筛选，带剩余工作日、停滞天数、最近一条原话。',
        {
          domain: { type: 'string', description: '域 id 或中文名；不传查全部。' },
          kind: { type: 'string', description: 'open（未完成）/ done（已完成）/ all（默认）。' },
          keyword: { type: 'string', description: '在标题和时间轴里搜。' },
          limit: { type: 'number', description: '最多返回几条，默认 20。' },
        },
        renderList,
        async (args) => {
          const items = await secretary.query(args);
          return { count: items.length, items };
        },
      ),
    ),
  );

  disposers.push(
    ctx.tools.register(
      tool(
        'secretary_reminders',
        '今天该提醒什么：逾期、今天到期、临期、停滞、沉睡灵感，以及报告待生成情况。',
        {},
        (value) => {
          const lines = [`${value.date}　${value.headline}`];
          for (const item of value.overdue ?? []) lines.push(`· 逾期 ${Math.abs(item.workingDays ?? 0)} 天　${item.title}`);
          for (const item of value.dueToday ?? []) lines.push(`· 今天到期　${item.title}`);
          for (const item of value.soon ?? []) lines.push(`· 临期 ${item.workingDays} 个工作日　${item.title}`);
          for (const item of value.stalled ?? []) lines.push(`· 停滞 ${item.stallDays} 天　${item.title}`);
          for (const item of value.dormant ?? []) lines.push(`· 灵感沉睡 ${item.dormantDays} 天　${item.title}`);
          if (value.dormantPending) lines.push(`· 另有 ${value.dormantPending} 条沉睡灵感待下次提醒`);
          return lines.join('\n');
        },
        // 工具只做查询，不消耗沉睡状态；markDormant 只在真正的每日提醒生成时置位
        async () => secretary.reminders(new Date(), { markDormant: false }),
      ),
    ),
  );

  disposers.push(
    ctx.tools.register(
      tool(
        'secretary_report',
        '生成某域某期的统计事实（周报/月报）。事实由代码算，解读由你写：拿到事实后用 markdown 参数写回报告文件。要"上周/上月"就传 key，不传则是当前周期。',
        {
          domain: { type: 'string', description: '域 id 或中文名；不传则跨域汇总（助手域自动排除）。' },
          period: { type: 'string', description: 'week 或 month。', required: true },
          key: { type: 'string', description: '周期标识：周报 YYYY-Www（如 2026-W43），月报 YYYY-MM（如 2026-10）。省略=当前周期。' },
          markdown: { type: 'string', description: '你写的报告正文；给了就落盘。' },
          force: { type: 'boolean', description: '已存在也重新生成。' },
        },
        (value) => {
          if (value.written) return `报告已写入：${value.path}`;
          return [value.headline ?? '', ...(value.lines ?? [])].filter(Boolean).join('\n');
        },
        async (args) => {
          const { buildReport } = await import('./report.js');
          return buildReport(secretary, args);
        },
      ),
    ),
  );

  disposers.push(
    ctx.tools.register(
      tool(
        'secretary_link',
        '把一条灵感转成创作项目（灵感 → 创作），或给两条记录建立关联。转成项目属于新建记录，必须有计划结束时间：没给会返回 need_deadline，先问用户；用户说"不急"才传 openEnded: true。',
        {
          id: { type: 'string', description: '要转化的灵感 id，或来源条目 id。', required: true },
          action: { type: 'string', description: 'promote（灵感转创作）或 relate（互相标注）。', required: true },
          to: { type: 'string', description: 'relate 时的目标条目 id。' },
          title: { type: 'string', description: 'promote 时的项目标题；不传用灵感标题。' },
          deadline: { type: 'string', description: 'promote 时新项目的计划结束时间 YYYY-MM-DD。' },
          openEnded: { type: 'boolean', description: 'promote 时用户明确说"不急"才传 true，允许无期限。' },
        },
        (value) => value.message || (value.action === 'need_deadline' ? '需要先确认期限。' : ''),
        async (args) => {
          const { linkEntries } = await import('./link.js');
          return linkEntries(secretary, args);
        },
      ),
    ),
  );

  disposers.push(
    ctx.tools.register(
      tool(
        'secretary_schedule',
        '看或改知微观澜的作息：每日提醒时间、周报周期与时间、月报时间（月报固定每月最后一天）、周报空闲窗口。改完立即生效，不用重启。',
        {
          reminderAt: { type: 'string', description: '每日提醒时间 HH:mm。' },
          reportWindowStart: { type: 'string', description: '周报等后台工作的空闲窗口开始 HH:mm；月报不受此窗口限制。' },
          reportWindowEnd: { type: 'string', description: '空闲窗口结束 HH:mm。' },
          weeklyWeekday: { type: 'number', description: '周报在周几生成，1=周一。' },
          weeklyAt: { type: 'string', description: '周报当天几点生成 HH:mm，默认 20:00。' },
          monthlyAt: { type: 'string', description: '月报在月末当天几点生成 HH:mm，默认 20:00。' },
        },
        (value) => value.message,
        async (args, exec) => {
          await bindSession(exec);
          return secretary.updateSchedule(args);
        },
      ),
    ),
  );

  return () => {
    for (const dispose of disposers) {
      try {
        dispose();
      } catch {
        /* ignore */
      }
    }
  };
}

function renderAdd(value) {
  const lines = [value.message];
  if (value.action === 'need_deadline') {
    lines.push('⚠ 没有期限无法到期提醒——先问用户，别自己编日期。');
  }
  if (value.id) lines.push(`${value.id} · ${value.title}`);
  if (value.path) lines.push(value.path);
  if (value.priority === 'high' || value.priority === 'mid') {
    lines.push(`优先级：${value.priority === 'high' ? '高' : '中'}（${(value.priorityReasons ?? []).join('；')}）`);
  }
  if (value.action === 'duplicate') lines.push('要并入就再调一次，带 updateExisting: true。');
  return lines.join('\n');
}

function renderList(value) {
  if (!value.count) return '没有符合条件的记录。';
  const lines = [`${value.count} 条：`];
  for (const item of value.items) {
    const bits = [item.id, item.title];
    if (item.due) bits.push(item.due.level === 'overdue' ? `逾期 ${Math.abs(item.workingDays)} 天` : `剩 ${item.workingDays} 个工作日`);
    else if (item.domain === 'idea') bits.push(`沉睡 ${item.dormantDays ?? 0} 天`);
    else if (item.stallDays >= 3) bits.push(`停滞 ${item.stallDays} 天`);
    if (item.progress !== null && item.progress !== undefined) bits.push(`${item.progress}%`);
    lines.push(`· ${bits.join('　')}`);
    if (item.excerpt) lines.push(`  ${item.excerpt.replace(/\n/g, ' ').slice(0, 60)}`);
  }
  return lines.join('\n');
}

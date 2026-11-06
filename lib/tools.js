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
  description:
    '域 id 或中文名：work（日常事务）、opportunity（商机线索）、sales（项目销售）、implement（实施交付）、contract（合同管理）、visit（客户交流）、creation（创作项目）、idea（灵感记录）、assistant（助手备忘）。',
  required: true,
};

/**
 * 销售 / 实施 / 拜访 / 合同共用字段。**必须逐条加进 add 与 update 两处参数表**：
 * 工具 schema 是白名单，没列进来的参数模型根本传不进来，
 * 而且不会报错——表现为"用户说了金额，工具返回已更新，文件里却没有"。见 L-005。
 */
const SALES_FIELDS = {
  customer: { type: 'string', description: '销售/实施/采购/拜访：客户或招标单位。客户台账按它聚合。' },
  bidNo: { type: 'string', description: '仅项目销售：招标编号（立项依据）。' },
  amount: { type: 'number', description: '项目销售/合同：中标金额或合同金额，单位元。注意中标金额是成交价格，合同金额是有法律效力的数字，两者不等是常态。' },
  profit: { type: 'number', description: '仅项目销售：中标利润，单位元。利润率由 amount 与 profit 现算，不要单独存。' },
  collected: { type: 'number', description: '仅实施：累计回款金额，单位元。实施域已改用合同期次记账，新记录不建议再用这个字段。' },
  contact: { type: 'string', description: '仅客户交流/商机：对接人姓名。' },
  // ── 项目销售的两条轴与报价数据 ──
  awardStatus: { type: 'string', description: '仅项目销售：未定 / 已中标 / 未中标。这是**收口的那条轴**，不是阶段。直签项目直接写已中标，没有未定这个中间态。' },
  procureMode: { type: 'string', description: '仅项目销售：招标 / 直签。定了不改，改了就等于换了一个项目。' },
  awardDate: { type: 'string', description: '仅项目销售：成交日期 YYYY-MM-DD，收到成交通知书那天。中标率按它归期，不是改状态那天。' },
  resultDate: { type: 'string', description: '仅项目销售：结果公布日 YYYY-MM-DD，未中标的填这个，给投标数归期。' },
  ourQuote: { type: 'number', description: '仅项目销售（招标）：我方报价，单位元。' },
  winnerPrice: { type: 'number', description: '仅项目销售（招标未中标）：竞对中标价，单位元。与我方报价的差距自动算。' },
  firstQuote: { type: 'number', description: '仅项目销售（直签）：初次报价，单位元。' },
  finalPrice: { type: 'number', description: '仅项目销售（直签）：最终签约价，单位元。它就是直签的中标金额。' },
  failReason: { type: 'string', description: '仅项目销售（招标未中标）：失标原因，价格高 / 方案不合 / 关系不到位 / 资格不符 / 其他。' },
  // ── 商机 ──
  estimate: { type: 'number', description: '仅商机：预期金额，单位元。只是估计，真正的中标金额在项目销售域。' },
  fakeReason: { type: 'string', description: '仅商机：判定为伪商机时记一句为什么。' },
  // ── 合同 ──
  contractNo: { type: 'string', description: '仅合同：合同编号，和纸质件/扫描件对应。' },
  contractName: { type: 'string', description: '仅合同：合同名称，一般和项目名一致，也可能不同。' },
  signedAt: { type: 'string', description: '仅合同：签订日期 YYYY-MM-DD，履约期和质保期都从这天起算。' },
  performUntil: { type: 'string', description: '仅合同：履约期限 YYYY-MM-DD，判断延期拿它说话。' },
  warrantyDays: { type: 'number', description: '仅合同：质保期长度（天）。必须记成具体数字，否则质保金日期没依据。' },
  warrantyFrom: { type: 'string', description: '仅合同：质保起算日 YYYY-MM-DD，多数从验收日起算，按合同写。' },
  payTerms: { type: 'string', description: '仅合同：付款条件原样文字，如"验收后 30 天付 80%"。期次表达不了的约定放这里。' },
  filePath: { type: 'string', description: '仅合同：合同扫描件或电子件的位置。' },
  // ── 客户交流 ──
  planDate: { type: 'string', description: '仅客户交流：计划拜访日期 YYYY-MM-DD。提前 1 个工作日提醒，过期没去算逾期。' },
  agenda: { type: 'string', description: '仅客户交流：这次要谈什么。' },
  cancelReason: { type: 'string', description: '仅客户交流：取消原因（对方改期 / 项目暂缓 / 我方没去）。' },
};

export function registerTools(ctx, secretary) {
  const disposers = [];

  /** 写操作的工具会静默把**两个**会话都绑到当前会话（提醒与报告默认同处） */
  const bindHere = async (exec) => {
    try {
      const sessionId = exec?.agent?.id;
      if (sessionId) await secretary.bindSession(String(sessionId), 'both');
    } catch {
      /* 绑定失败不影响主操作 */
    }
  };

  /**
   * 只读工具用这个：**不自动改绑**，但在会话不一致时提示一句。
   *
   * 为什么要提示：绑定只是在写操作时静默发生的，
   * 用户在新会话里只问"我有哪些待办"并不会改绑，
   * 却很可能以为已经切过来了（实测过这个误判）。
   * 提示不打扰（只在真的不一致时出现），也给了明确的改绑指令。
   *
   * 返回值**不带前导换行**：调用方自己决定怎么拼（B07 的根因就是
   * 渲染函数把整段 nudge 丢掉了，光有字段没人显示，模型看不到）。
   */
  const nudgeIfElsewhere = async (exec) => {
    try {
      const sessionId = exec?.agent?.id ? String(exec.agent.id) : null;
      if (!sessionId) return '';
      const state = (await secretary.currentState()) ?? {};
      const reminderHere = state.reminderSession === sessionId;
      const reportHere = (state.reportSession ?? state.reminderSession) === sessionId;
      // 两边都在这里就不打扰
      if (reminderHere && reportHere) return '';
      const tailOf = (id) => (typeof id === 'string' ? id.slice(-4) : '');
      const bits = [];
      if (!reminderHere) bits.push(state.reminderSession ? `每日提醒发往 …${tailOf(state.reminderSession)}` : '每日提醒尚未绑定');
      if (!reportHere) bits.push(state.reportSession ? `报告发往 …${tailOf(state.reportSession)}` : '报告沿用提醒会话');
      if (!bits.length) return '';
      return `（提示：你现在在另一个会话里，${bits.join('，')}。要改到当前会话，调用 secretary_bind，target 可选 both/reminder/report。）`;
    } catch {
      return '';
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
          status: { type: 'string', description: '仅事务：待办 / 进行中 / 已完成 / 已放弃；仅销售：商机 / 跟踪 / 立项 / 报价 / 中标 / 未中标；仅实施：待启动 / 实施中 / 验收中 / 已验收 / 已终止。' },
          stage: { type: 'string', description: '仅创作：构思 / 起草 / 修订 / 完成 / 搁置。' },
          progress: { type: 'number', description: '进度 0-100。' },
          next: { type: 'string', description: '下一步。' },
          source: { type: 'string', description: '仅灵感：从哪来的。' },
          tags: { type: 'array', items: { type: 'string' }, description: '标签。' },
          ...SALES_FIELDS,
          updateExisting: { type: 'boolean', description: '已确认是同一件事、要把这次当进展并入时传 true。' },
          createSeparate: {
            type: 'boolean',
            description: '已确认是**另一件事**、要独立新建时传 true。只跳过去重判断，不影响 deadline/openEnded 等任何字段。',
          },
          allowProgressLog: {
            type: 'boolean',
            description:
              '仅经验教训库（助手域）：内容不含现象/根因/约束时会被拦下并返回 needs_conclusion。' +
              '用户明确要求记录进度流水时才传 true 强制写入。',
          },
        },
        renderAdd,
        async (args, exec) => {
          await bindHere(exec);
          const fields = {};
          /**
           * 字段白名单。**新增域字段必须同步加到这里**，否则工具收不到值：
           * schema 里声明了参数只保证模型能传，能不能落到 fields 由这一行决定。
           * 漏了不报错，是静默丢值。
           */
          for (const key of [
            'status', 'stage', 'progress', 'deadline', 'openEnded', 'next', 'source', 'tags',
            ...Object.keys(SALES_FIELDS),
          ]) {
            if (args[key] !== undefined) fields[key] = args[key];
          }
          return secretary.addRecord({
            domain: args.domain,
            text: args.text,
            title: args.title,
            fields,
            updateExisting: args.updateExisting === true,
            createSeparate: args.createSeparate === true,
            allowProgressLog: args.allowProgressLog === true,
          });
        },
      ),
    ),
  );

  disposers.push(
    ctx.tools.register(
      tool(
        'secretary_update',
        '改一条：状态、阶段、进度、下一步、截止，或追加一条进展/备注。改状态会自动补完成时间。' +
          '注意：助手域是经验教训库（lifecycle=journal），条目没有完成/重开/改期/进度这些动作，' +
          '只接受 note、quote、next、category；传 status/stage/progress/deadline 会被明确拒绝。',
        {
          id: { type: 'string', description: '条目 id，如 W-2026-001 / S-2026-003 / C-2026-003 / I-202610-01。', required: true },
          status: { type: 'string', description: '事务：待办 / 进行中 / 已完成 / 已放弃；销售：商机 / 跟踪 / 立项 / 报价 / 中标 / 未中标；实施：待启动 / 实施中 / 验收中 / 已验收 / 已终止。经验教训库不接受。' },
          stage: { type: 'string', description: '创作：构思 / 起草 / 修订 / 完成 / 搁置。' },
          progress: { type: 'number', description: '进度 0-100。经验教训库不接受。' },
          next: { type: 'string', description: '下一步。' },
          category: { type: 'string', description: '分类，如 沟通/文档/研发/会议；创作和灵感打标签。' },
          deadline: { type: 'string', description: '截止日期 YYYY-MM-DD；传空串表示清除。经验教训库不接受。' },
          openEnded: { type: 'boolean', description: '用户后来说"不急"时传 true 标记为无期限；重新给了期限则不传或传 false。' },
          note: { type: 'string', description: '这次变更的说明，写进时间轴或备注。' },
          quote: { type: 'string', description: '用户原话；给了就作为进展写进时间轴。销售跟踪记录必须用这个 + id，不要新建条目。' },
          ...SALES_FIELDS,
          /**
           * 合同的补充协议与回款期次：**给全量、整表重写**。
           *
           * 为什么不是"加一条/删一条"：期次和协议的编辑是需要看全局的动作——
           * 补一笔钱要判断加到哪一期、减一笔要从哪几期扣。提供增量接口会让
           * 调用方各自拼表，拼出来的表迟早和合同总额对不平。
           *
           * 不传就完全不动正文那两节，只改状态时不会把表格冲掉。
           */
          agreements: {
            type: 'array',
            items: { type: 'object', additionalProperties: true },
            description:
              '仅合同：补充协议全量列表。每项 { no, signedAt, summary, amount, status, expectAt, blockedBy, note }。' +
              'amount 正数是增加、负数是减少。status 只能是 起草中 / 待签收 / 已签收 / 已作废，' +
              '**只有已签收才计入合同总额**。已完成或已解除的合同不能再加协议（只能更新已有协议的状态）。',
          },
          installments: {
            type: 'array',
            items: { type: 'object', additionalProperties: true },
            description:
              '仅合同：回款期次全量列表。每项 { name, dueAt, paidAt, amount, note }。' +
              '期次数量不固定，按合同实际约定增删。dueAt 必填，它是这一期唯一的提醒依据；paidAt 收到款才填。' +
              '所有期次金额之和必须等于合同总额，不相等时工具会提示差多少，不会静默放过。',
          },
        },
        (value) => `${value.message}\n${value.id} · ${value.title}\n${value.path}`,
        async (args, exec) => {
          await bindHere(exec);
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
          kind: { type: 'string', description: 'open（未完成）/ done（已完成）/ archived（经验教训库条目）/ all（默认）。' },
          keyword: { type: 'string', description: '在标题和时间轴里搜。' },
          limit: { type: 'number', description: '最多返回几条，默认 20。' },
        },
        renderList,
        async (args, exec) => {
          const items = await secretary.query(args);
          const nudge = await nudgeIfElsewhere(exec);
          return { count: items.length, items, nudge };
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
          if (value.nudge) lines.push(String(value.nudge).trim());
          return lines.join('\n');
        },
        // 工具只做查询，不消耗沉睡状态；markDormant 只在真正的每日提醒生成时置位
        async (_args, exec) => {
          const data = await secretary.reminders(new Date(), { markDormant: false });
          return { ...data, nudge: await nudgeIfElsewhere(exec) };
        },
      ),
    ),
  );

  disposers.push(
    ctx.tools.register(
      tool(
        'secretary_report',
        '生成某域某期的统计事实并撰写报告。事实由代码算，解读由你写：拿到事实后用 markdown 参数写回报告文件。' +
          '支持月度/季度/半年度/年度四类（没有周报）：不传 key 就是包含今天的当前期。' +
          '自动生成规则：在各自周期的最后一天按设定时刻（默认 20:00）开始，不推迟到夜间窗口；' +
          '若那一刻 DSH 没开着，之后不会自动补跑——需要用户本人手动调用本工具生成。',
        {
          domain: { type: 'string', description: '域 id 或中文名；不传则逐域各出一份（助手域自动排除）。' },
          period: {
            type: 'string',
            description: '周期类型：month=月度报告，quarter=季度报告，half=半年度报告，year=年度报告。',
            required: true,
          },
          key: {
            type: 'string',
            description: '周期标识：月度 YYYY-MM（2026-10），季度 YYYY-Qn（2026-Q4），半年度 YYYY-Hn（2026-H2），年度 YYYY（2026）。省略=当前期。',
          },
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
        '把一条记录转成另一条更具体的记录，或给两条记录建立关联。' +
          '转化方向由域声明决定：工作 → 销售商机（谈出眉目了）、灵感 → 创作（想法要动手了），' +
          '销售商机也能退回工作域（谈崩了回跟进池）。' +
          '转化属于新建记录，必须有计划结束时间：没给会返回 need_deadline，先问用户；用户说"不急"才传 openEnded: true。' +
          '来源记录**保留不删**，只标注去向，历史进展会带过去。',
        {
          id: { type: 'string', description: '要转化的条目 id，或 relate 时的来源条目 id。', required: true },
          action: { type: 'string', description: 'promote（转化）或 relate（互相标注）。', required: true },
          to: { type: 'string', description: 'relate 时的目标条目 id；promote 时可代替 targetDomain 指定目标域。' },
          targetDomain: { type: 'string', description: 'promote 时转到哪个域（如 sales / work / creation）。只有一个去向时可省略。' },
          title: { type: 'string', description: 'promote 时新条目的标题；不传用来源标题。' },
          deadline: { type: 'string', description: 'promote 时新条目的计划结束时间 YYYY-MM-DD。' },
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
        '看或改知微观澜的作息：每日提醒时间，以及月度/季度/半年度/年度四类报告在各自周期最后一天的生成时间。改完立即生效，不用重启。',
        {
          reminderAt: { type: 'string', description: '每日提醒时间 HH:mm。' },
          monthlyAt: { type: 'string', description: '月度报告生成时间 HH:mm，默认 20:00（月末最后一天）。' },
          quarterlyAt: { type: 'string', description: '季度报告生成时间 HH:mm，默认 20:00（季末最后一天）。' },
          halfAt: { type: 'string', description: '半年度报告生成时间 HH:mm，默认 20:00（6月末/12月末）。' },
          yearlyAt: { type: 'string', description: '年度报告生成时间 HH:mm，默认 20:00（12月末）。' },
          reportWindowStart: { type: 'string', description: '后台工作空闲窗口开始 HH:mm。' },
          reportWindowEnd: { type: 'string', description: '空闲窗口结束 HH:mm。' },
        },
        (value) => value.message,
        async (args, exec) => {
          await bindHere(exec);
          return secretary.updateSchedule(args);
        },
      ),
    ),
  );

  disposers.push(
    ctx.tools.register(
      tool(
        'secretary_bind',
        '把每日提醒和/或报告投递到**当前会话**。提醒与报告可以分别绑到不同会话：例如报告放一个专门的撰写会话，提醒留在日常对话里。',
        {
          target: {
            type: 'string',
            description:
              'both（默认，提醒和报告都改到当前会话）/ reminder（只改每日提醒）/ report（只改报告）。',
          },
        },
        (value) => value.message,
        async (args, exec) => {
          const sessionId = exec?.agent?.id ? String(exec.agent.id) : null;
          if (!sessionId) {
            return { message: '拿不到当前会话标识，无法绑定。请在一个正常会话里重试。', changed: [], reminderSession: null, reportSession: null };
          }
          const result = await secretary.bindSession(sessionId, args?.target ?? 'both');
          const tail = (id) => (typeof id === 'string' ? id.slice(-4) : '—');
          const parts = [];
          parts.push(`每日提醒 → …${tail(result.reminderSession)}`);
          parts.push(`报告 → …${tail(result.reportSession)}`);
          const label = args?.target === 'reminder' ? '每日提醒' : args?.target === 'report' ? '报告' : '提醒与报告';
          return {
            message:
              `已把${label}绑到当前会话（…${tail(sessionId)}）。\n` +
              `当前：${parts.join('；')}。\n` +
              (result.changed.length ? '宿主任务会在下一分钟内自动切换到新会话。' : '原本就绑在这里，无需变更。'),
            changed: result.changed,
            reminderSession: result.reminderSession,
            reportSession: result.reportSession,
          };
        },
      ),
    ),
  );

  /**
   * 绩效视图：半年 / 年两档。
   *
   * 为什么单开一个工具而不是塞进 secretary_report：
   * 报告是"生成一篇文档并落盘"，绩效是"算出一组数给我看"——
   * 前者有周期规则、要写入文件；后者不落盘、随时可查。
   * 混在一起会让人分不清"我到底生成了报告，还是只算了一下"。
   */
  disposers.push(
    ctx.tools.register(
      tool(
        'secretary_performance',
        '算绩效：按半年或年，从已有记录算出考核用的指标（商机数、转化率、中标率、中标金额、利润率、直签让价、合同额、回款率、完成率、按时率…）。' +
          '**只做半年和年两档**——年中述职＝半年报、年终述职＝年报；月度季度报告只用于自用分析，不进考核。' +
          '结果不落盘，每次现算。指标口径写死在代码里，不接受自定义公式。',
        {
          period: {
            type: 'string',
            description: '周期类型：half=半年度，year=年度。只有这两个值，month/quarter 会被拒绝。',
            required: true,
          },
          key: {
            type: 'string',
            description: '周期标识：半年度写 2026-H1 / 2026-H2，年度写 2026。省略=包含今天的当期。',
          },
        },
        (value) => {
          const lines = [`${value.label}（${value.from} ~ ${value.to}）`, ''];
          for (const item of value.metrics) {
            const shown = item.value === null ? '—' : item.value;
            lines.push(`· ${item.label}：${shown}`);
          }
          return lines.join('\n');
        },
        async (args) => secretary.performance(args),
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

/**
 * 渲染函数对外暴露一份（仅供隔离回归使用）。
 *
 * B07 的缺陷恰恰在"渲染"这一层——字段有、但没输出。要断言"用户到底看到什么"，
 * 回归必须能直接调用真实的渲染函数，而不是复制一份期望字符串。
 */
export const renderers = { add: renderAdd, list: renderList };

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
  // 经验教训库软提醒：记录已写入，但看不出可复用的结论
  if (value.qualityHint) lines.push(`⚠ ${value.qualityHint}`);
  return lines.join('\n');
}

/**
 * 查询结果的渲染。
 *
 * B07：`nudge` 字段一直存在于返回对象里，但这里**两个分支都没输出它**，
 * 于是模型看到的只有"没有符合条件的记录"，根本不知道自己其实在另一个会话里。
 * 现在空结果与非空结果都带上提示；提示为空时不加空行（同一会话里不打扰）。
 */
function renderList(value) {
  const nudge = typeof value.nudge === 'string' ? value.nudge.trim() : '';
  if (!value.count) {
    return nudge ? `没有符合条件的记录。\n\n${nudge}` : '没有符合条件的记录。';
  }
  const lines = [`${value.count} 条：`];
  for (const item of value.items) {
    const bits = [item.id, item.title];
    if (item.due) bits.push(item.due.level === 'overdue' ? `逾期 ${Math.abs(item.workingDays)} 天` : `剩 ${item.workingDays} 个工作日`);
    else if (item.domain === 'idea') bits.push(`沉睡 ${item.dormantDays ?? 0} 天`);
    // 只有服务端判定为停滞（达到域阈值）才敢用"停滞"这个词；
    // 否则一律中性描述"距上次更新 N 天"（U06 —— 别把没到阈值的事项说成停滞）
    else if (item.reason === 'stall') bits.push(`停滞 ${item.stallDays} 天`);
    else if (item.stallDays > 0) bits.push(`距上次更新 ${item.stallDays} 天`);
    if (item.progress !== null && item.progress !== undefined) bits.push(`${item.progress}%`);
    lines.push(`· ${bits.join('　')}`);
    if (item.excerpt) lines.push(`  ${item.excerpt.replace(/\n/g, ' ').slice(0, 60)}`);
  }
  return nudge ? `${lines.join('\n')}\n\n${nudge}` : lines.join('\n');
}

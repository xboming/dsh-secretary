/**
 * 条目之间的转化与关联。
 *
 * 两种动作：
 *   relate   条目互相关联（双向标注）
 *   promote  一条记录转成另一条更具体的记录
 *
 * ── promote 为什么是通用的 ──
 * 早先只支持「灵感 → 创作」，来源和目标都写死在代码里：
 *   if (idea.domain !== 'idea') throw ...
 *   const creation = findDomain(settings.domains, 'creation');
 * 于是「工作事项 → 销售商机」这种同样常见的转化只能靠人重建一条，原话和时间轴全丢。
 * 现在改成从域声明里读 `promotesTo`，谁声明了就能往谁转，两个方向都支持。
 */

// 版本化加载（见 reloadable.js）：子依赖跟着 ?v= 一起刷新。
const { rel } = await import(new URL('./reloadable.js', import.meta.url).href);
const { completionValuesOf, defaultStageOf, defaultStatusOf, doneFieldOf, findDomain, promotionTargets, promotionTargetsOf, statusValuesOf } = await import(rel('./domains.js', import.meta.url));
const { markPromoted } = await import(rel('./stream.js', import.meta.url));
const { appendNote, appendTimeline } = await import(rel('./entries.js', import.meta.url));
const { splitDocument } = await import(rel('./frontmatter.js', import.meta.url));
const { serializeEntry } = await import(rel('./entries.js', import.meta.url));
const { newEntryBody, newEntryData, entryPath } = await import(rel('./entries.js', import.meta.url));
const { stamp, ymd } = await import(rel('./util.js', import.meta.url));

export async function linkEntries(secretary, { id, action, to, title, deadline, openEnded, targetDomain }) {
  if (action === 'promote') return promote(secretary, id, title, { deadline, openEnded, targetDomain, to });
  if (action === 'relate') return relate(secretary, id, to);
  throw new Error('action 只能是 promote 或 relate。');
}

async function promote(secretary, sourceId, title, options = {}) {
  const deadline = typeof options.deadline === 'string' ? options.deadline.trim() : '';
  const openEnded = options.openEnded === true;
  // `to` 在这里是**目标域**（与 relate 的语义不同：relate 的 to 是目标条目）
  const targetKey = options.targetDomain ?? options.to ?? '';

  /**
   * 编号分配 + 目标写入 + 来源回写必须处于**同一临界区**。
   *
   * 原实现先加载条目、在队列外算号，再分别写两个文件——并发转化会拿到同一个号，
   * 且来源回写失败时目标已经创建，留下重复编号的孤儿记录。
   * 这里整段使用 store.enqueue，内部一律用 writeNow 避免重入死锁。
   */
  return secretary.store.enqueue(async () => {
    const settings = await secretary.loadAll(true);
    const source = settings.entries.find((entry) => String(entry.id).toUpperCase() === String(sourceId).toUpperCase());
    if (!source) throw new Error(`找不到条目 ${sourceId}。`);

    const sourceDomain = findDomain(settings.domains, source.domain);
    if (!sourceDomain) throw new Error(`条目 ${sourceId} 的域 ${source.domain} 不存在。`);

    // 已经转过的，不再建第二条
    if (source.promotedTo) {
      return {
        action: 'already',
        id: source.promotedTo,
        sourceId: source.id,
        message: `${source.id} 已经转成 ${source.promotedTo}，没有重复创建。`,
      };
    }

    const candidates = promotionTargets(settings.domains, sourceDomain);
    if (!candidates.length) {
      throw new Error(`${sourceDomain.name}域没有声明可转化目标，不能转化。`);
    }

    let targetDomain;
    if (targetKey) {
      targetDomain = candidates
        .map((key) => findDomain(settings.domains, key))
        .find((d) => d && (d.id === String(targetKey) || d.name === String(targetKey)));
      if (!targetDomain) {
        const names = candidates
          .map((key) => findDomain(settings.domains, key))
          .filter(Boolean)
          .map((d) => `${d.id}（${d.name}）`)
          .join('、');
        throw new Error(`${sourceDomain.name}域只能转成：${names}。收到：${targetKey}`);
      }
    } else {
      targetDomain = findDomain(settings.domains, candidates[0]);
      // 有多个目标又没指定时，别猜——猜错了用户要删掉重建
      if (candidates.length > 1) {
        const names = candidates
          .map((key) => findDomain(settings.domains, key))
          .filter(Boolean)
          .map((d) => `${d.id}（${d.name}）`)
          .join('、');
        return {
          action: 'need_target',
          sourceId: source.id,
          title: title?.trim() || source.title,
          message: `${sourceDomain.name}域可以转成多个目标：${names}。请确认要转到哪一个，再带 targetDomain 调一次。`,
        };
      }
    }

    /**
     * 期限防线：转成新条目就是新建记录，必须和 addRecord 一样要求计划结束时间。
     * 例外是目标域本来就不强制（灵感流水、助手日志）。
     */
    const deadlineOptional = targetDomain.shape === 'stream' || targetDomain.id === 'assistant';
    if (!deadlineOptional && !deadline && !openEnded) {
      return {
        action: 'need_deadline',
        sourceId: source.id,
        title: title?.trim() || source.title,
        targetDomain: targetDomain.id,
        message:
          `把它转成${targetDomain.name}需要计划结束时间。请先确认什么时候要；` +
          '用户说"不急"时带 openEnded: true 再来一次。',
      };
    }

    const id = await nextIdOf(secretary, targetDomain, settings);
    const targetTitle = title?.trim() || source.title;

    /**
     * 新条目的初始字段按**目标域的形态**给：
     *   task    初始状态取域声明的默认值（工作=todo，销售=商机）
     *   project 阶段按域声明的默认值
     * 不能沿用来源域的状态——「商机」这个值在工作域里根本不存在。
     */
    const fields = { id, title: targetTitle, origin: source.id };
    if (targetDomain.shape === 'task') fields.status = defaultStatusOf(targetDomain);
    if (targetDomain.shape === 'project') fields.stage = defaultStageOf(targetDomain);
    if (deadline) fields.deadline = deadline;

    const data = newEntryData(targetDomain, fields);
    if (openEnded) data.openEnded = true;

    const convertedAt = stamp();
    /**
     * 新条目的创建原话取自**来源的创建记录**，不是 `timeline[0]`。
     *
     * 时间轴是新的在上，`timeline[0]` 是最新一条进展。早先按它取，
     * 结果转化出来的"创建"记录里写的是"对方提到预算在明年"，
     * 而记录真正的来龙去脉（这件事最初是怎么来的）反而丢了。
     * 找不到创建记录才退回最近一条原话、再退回标题。
     */
    const createdItem = (source.timeline ?? []).find((item) => item.text === '创建' && item.quote);
    const quote = createdItem?.quote ?? source.timeline?.[0]?.quote ?? source.title;
    let body = newEntryBody(targetDomain, { ...data, text: quote });

    /**
     * 先写"创建"这条——和 `addRecord` 一件一件对齐。
     *
     * `newEntryBody` 只生成正文骨架（## 当前状态 / ## 时间轴 / ## 备注），
     * **不会自己写时间轴**，addRecord 是在外面单独 appendTimeline 的。
     * 这里漏了这一步，实测转化出来的记录没有任何创建痕迹：
     * 用户打开只看到一条"由工作 W-XXX 转化"，会以为这记录凭空冒出来。
     */
    body = appendTimeline(body, { at: convertedAt, text: '创建', quote });

    /**
     * 历史进展按**时间顺序**追加，且**不重复搬运创建原话**。
     *
     * 早先的做法是把来源整条时间轴原样倒进去，于是同一句原话出现两次
     * （一次作为"创建"、一次作为搬运记录），而插件最核心的铁律是
     * "原话只进时间轴且只出现一次"。实测转化后一眼就能看到重复。
     *
     * 现在：跳过来源的"创建"那条（它的原话已经作为新条目的创建原话写入上面），
     * 其余进展按时间从早到晚追加，保留原有时间戳。
     */
    const carried = (source.timeline ?? [])
      .filter((item) => item?.at && item.text !== '创建')
      .slice()
      .sort((a, b) => String(a.at).localeCompare(String(b.at)));
    for (const item of carried) {
      body = appendTimeline(body, { at: item.at, text: item.text || '进展', quote: item.quote ?? '' });
    }

    /**
     * 最后写转化本身这条，放在最上面（时间轴新条目在上）。
     * 引用行留空：来源原话已经作为创建原话留着，再贴一遍就是重复。
     */
    body = appendTimeline(body, {
      at: convertedAt,
      text: `由${sourceDomain.name} ${source.id} 转化`,
      quote: '',
    });

    const relative = entryPath(targetDomain, data);

    // 先写目标，再回写来源；回写失败则回滚目标文件，避免孤儿与重复编号
    await secretary.store.writeNow(relative, serializeEntry(targetDomain, data, body));
    try {
      const sourceRead = await secretary.store.read(source.path);
      if (sourceRead) {
        if (sourceDomain.shape === 'stream') {
          // 灵感流水：转化标注写在流水块的元信息里（格式由 stream.js 维护）
          const next = markPromoted(sourceRead.text, source.id, id, convertedAt);
          await secretary.store.writeNow(source.path, next, sourceRead.mtimeMs);
        } else {
          /**
           * 其他形态：写 frontmatter 的 promotedTo / promotedAt，补一条时间轴，
           * 并**把源记录标为完成**。
           *
           * 用户的选择：「转入时自动把源记录标为完成」。
           * 理由是——工作事项"去摸一下这个项目做不做"这件活，在转成商机的那一刻
           * 确实已经结束了；后续要跟的是商机那条。两条都挂在待办里，
           * 标题还一模一样，用户只会看到"重复的记录"（实测就是这个现象）。
           *
           * 但**记录本身保留不删**：追溯链（origin ↔ promotedTo）必须完整，
           * 用户要回头查"这商机怎么来的"时还得找得到。
           *
           * 状态值按**源域声明**取，不硬编码 done：
           * 工作域是 done，销售域是「中标」——写错值会直接抛错。
           */
          const parsed = splitDocument(sourceRead.text);
          /**
           * 完成值写进**这条记录真正存放完成状态的字段**。
           *
           * 以前一律写 `status`，对单一轴的域没问题；但项目销售有两头轴：
           * status 装阶段（初期/方案报价/招采），完成与否在 awardStatus 上。
           * 往 status 里写「已中标」会被状态校验直接挡下（阶段没有这个值），
           * 于是"转出后源记录自动收口"这条对销售域就失效了。
           *
           * 字段由域声明 doneField 指定，不在这里硬编码。
           */
          const doneField = doneFieldOf(sourceDomain);
          const doneValue = completionValuesOf(sourceDomain)[0];
          const nextData = { ...parsed.data, updated: ymd(), promotedTo: id, promotedAt: convertedAt };
          if (doneValue) {
            nextData[doneField] = doneValue;
            // 完成时间要一起写，否则它不计进完成率（completedAt 是唯一依据）
            nextData.completedAt = convertedAt;
          }
          const nextBody = appendTimeline(parsed.body, {
            at: convertedAt,
            text: `已转成${targetDomain.name} ${id}，本条标记为已完成`,
            quote: '',
          });
          await secretary.store.writeNow(source.path, serializeEntry(sourceDomain, nextData, nextBody), sourceRead.mtimeMs);
        }
      }
    } catch (error) {
      // 回滚：删掉刚建的目标文件，保证"来源未标注 → 目标不存在"的一致状态
      try {
        await secretary.store.remove(relative);
      } catch (rollbackError) {
        console.error('[dsh-secretary] 转化回滚失败，请手动清理', relative, rollbackError?.message);
      }
      throw new Error(`回写来源失败，已撤销新建的 ${id}：${error?.message ?? error}`);
    }

    return {
      action: 'promoted',
      message:
        `已把 ${source.id}（${source.title}）转成${targetDomain.name} ${id}（${targetTitle}）。` +
        `${carried.length} 条历史进展已带过去，来源记录保留并标注了去向。`,
      id,
      sourceId: source.id,
      targetDomain: targetDomain.id,
      carriedTimeline: carried.length,
      path: relative,
    };
  });
}

/**
 * 目标域的下一个编号。
 *
 * 复用 `secretary.js` 的 nextId 不现实（它不在公开接口里），这里按域声明重算一遍。
 * 前缀优先取 `domain.idPrefix`，否则沿用原规则：
 * project 形态恒为 C、work 为 W、其余取 id 首字母大写。
 */
async function nextIdOf(secretary, domain, settings) {
  const year = new Date().getFullYear();
  const prefix =
    domain.idPrefix ??
    (domain.shape === 'project' ? 'C' : domain.id === 'work' ? 'W' : domain.id.slice(0, 1).toUpperCase());
  const head = `${prefix}-${year}-`;
  const pattern = new RegExp(`${head}(\\d{3})`);
  let max = 0;
  for (const entry of settings.entries) {
    if (entry.domain !== domain.id) continue;
    const match = pattern.exec(String(entry.id ?? ''));
    if (match) max = Math.max(max, Number(match[1]));
  }
  // 兜底：路径里的编号（覆盖尚未解析进 entries 的文件）
  for (const relative of await secretary.store.listMarkdown(domain.dir)) {
    const match = pattern.exec(relative);
    if (match) max = Math.max(max, Number(match[1]));
  }
  return `${head}${String(max + 1).padStart(3, '0')}`;
}

async function relate(secretary, fromId, toId) {
  if (!toId) throw new Error('relate 需要 to。');
  const from = await secretary.find(fromId);
  const to = await secretary.find(toId);
  const note = `关联：[[${to.entry.title}]]`;
  const back = `关联：[[${from.entry.title}]]`;

  const fromRead = await secretary.store.read(from.entry.path);
  const toRead = await secretary.store.read(to.entry.path);
  if (!fromRead || !toRead) throw new Error('条目文件不见了，请重新查询。');
  const a = splitDocument(fromRead.text);
  const b = splitDocument(toRead.text);
  await secretary.store.write(from.entry.path, serializeEntry(from.domain, a.data, appendNote(a.body, note)), fromRead.mtimeMs);
  await secretary.store.write(to.entry.path, serializeEntry(to.domain, b.data, appendNote(b.body, back)), toRead.mtimeMs);
  return { message: `已互相标注关联：${from.entry.title} ↔ ${to.entry.title}。` };
}

/**
 * 某个域能转向哪些域：实现见 `domains.js` 的 `promotionTargets`。
 * 这里只做重新导出，保持 `link.js` 原有的导出面不变。
 */
export { promotionTargetsOf };

// 保持导出面稳定：secretary.js 里用到的几个辅助仍在
export { completionValuesOf, statusValuesOf };

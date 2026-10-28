/**
 * 判定：去重、优先级、停滞、沉睡。
 * 阈值集中在这里，方便对着真实使用调，而不是散在工具里。
 *
 * 去重严格按原文的三条比例来算（中文都用相邻二元组）：
 *   标题相似度   = Dice(本次标题, 已有标题)
 *   标题覆盖率   = |已有标题 ∨ 本次输入| / |已有标题|
 *   时间轴覆盖率 = |已有时间轴 ∨ 本次输入| / |已有时间轴|
 * 比例之外再要求"绝对命中数"，防只共用一两个字就误并。
 *
 * 试过把单位从二元组降成单字，结果是"整理季度预算表"和"项目款协调进展"
 * 靠 度/表/下/周/款 五个字被并成一条——所以不用单字。
 */

export const THRESHOLDS = {
  /** 标题相似度：直接并入 */
  mergeSimilarity: 0.72,
  /** 标题覆盖率 + 绝对命中数：并入 */
  mergeCoverage: 0.2,
  mergeCoverageHits: 4,
  /** 时间轴覆盖率 + 绝对命中数：并入 */
  mergeTimelineCoverage: 0.12,
  mergeTimelineHits: 5,
  /**
   * 时间轴并入的**反向**门槛：本次输入至少这么多比例要被这条记录解释。
   * 没有它，输入越长越容易被误并入（见 judgeCandidate 里的说明）。
   */
  mergeTimelineReverse: 0.2,
  /**
   * 时间轴并入时，本次标题至少这么多比例要被已有标题解释。
   * 防"标题另起炉灶、正文顺带一提"被当成同一条记录的补充。
   */
  mergeTitleReverse: 0.5,
  /** 提示档：只是"像"，让人确认 */
  hintSimilarity: 0.45,
  hintCoverage: 0.25,
  /** 提醒提前量（工作日） */
  leadWorkdays: 2,
};

/** 相邻二元组（去空白与标点、转小写） */
export function bigrams(text) {
  const source = String(text ?? '')
    .toLowerCase()
    .replace(/[\s\p{P}\p{S}]+/gu, '');
  const out = new Set();
  for (let i = 0; i < source.length - 1; i += 1) out.add(source.slice(i, i + 2));
  if (source.length === 1) out.add(source);
  return out;
}

export function dice(a, b) {
  if (!a.size || !b.size) return 0;
  let inter = 0;
  for (const item of a) if (b.has(item)) inter += 1;
  return (2 * inter) / (a.size + b.size);
}

export function overlap(needle, haystack) {
  let hit = 0;
  for (const item of needle) if (haystack.has(item)) hit += 1;
  return hit;
}

export function coverage(needle, haystack) {
  if (!needle.size) return 0;
  return overlap(needle, haystack) / needle.size;
}

/**
 * 三档判定：
 *   并入（tier 2）= 标题相似度达标，或覆盖率达标且绝对命中够多
 *   提示（tier 1）= 只是"像"，让人确认后再并入
 */
export function judgeCandidate(entry, probe) {
  const entryTitle = bigrams(entry.title);
  const entryTimeline = bigrams((entry.timeline ?? []).map((item) => `${item.text} ${item.quote ?? ''}`).join(' '));

  const similarity = dice(probe.titleSet, entryTitle);
  /**
   * 标题覆盖率只用**本次标题**做探针，不能用 titleSet + 正文。
   *
   * 原来的分子是 overlap(entryTitle, probe.probeSet)，而 probeSet 含正文，
   * 于是正文写得越详细，越容易"覆盖"别人的标题：
   * 实测一条标题为「杂事记录」的日志，因正文提到对方单位与事项名，
   * 把「合作方项目款协作申请」的标题覆盖到 75%、命中 6 个，被判 tier 2 静默并入。
   * 标题覆盖率就该回答"两个标题像不像"，正文不该进来投票。
   */
  const titleHits = overlap(entryTitle, probe.titleSet);
  const titleCover = entryTitle.size ? titleHits / entryTitle.size : 0;
  const tlHits = overlap(entryTimeline, probe.probeSet);
  const tlCover = entryTimeline.size ? tlHits / entryTimeline.size : 0;

  /**
   * 反向覆盖：本次输入有多少被这条已有记录解释。
   *
   * 只看 tlCover（分母是已有时间轴）会有一个致命的单调性——
   * 输入越长，probeSet 越大，覆盖任何短时间轴的概率越接近 1，
   * 于是"内容写得详细"本身就成了自动并入的理由。
   * 实测：一篇 311 个二元组的开发日志，能凭空覆盖一条 37 个二元组的
   * 无关记录到 27%，标题命中数为 0 却被判 tier 2 直接合并，用户没有确认机会。
   *
   * 所以并入必须双向都成立：已有内容被解释，且本次输入也被解释。
   * 长文里顺带提到某个短条目几个词，方向二只有几个百分点，挡得住。
   */
  const tlReverse = coverage(probe.probeSet, entryTimeline);

  /**
   * 标题是否"还在说同一件事"。
   *
   * 光靠 tlReverse 分不开"顺带一提"和"真在讲这件事"：
   * 正文短的时候，一句"顺带想起 XX 那事还没回对方"就能把 tlReverse 顶到 21%，
   * 越过门槛被静默并入——但它标题写的是「季度预算表整理」，与目标条目毫无关系。
   * 真正的补充录入不会另起一个毫不相干的标题。
   *
   * 判据用"本次标题有多少被已有标题解释"，而不是标题命中数：
   * 「项目款申请」与「合作方项目款协作申请」没有共享的相邻二元组（项目款申/目款申请 vs 款协作申请），
   * 靠命中数会判成无关；但本次标题整体是被对方标题包住的，这才说明还在说同一件事。
   * 同时要求 titleCover 不高：标题若几乎等于已有标题，那是标题覆盖线该管的事。
   */
  const titleReverse = coverage(probe.titleSet, entryTitle);
  const titleRelated = titleReverse >= THRESHOLDS.mergeTitleReverse && titleCover < THRESHOLDS.hintCoverage;

  if (similarity >= THRESHOLDS.mergeSimilarity) {
    return { tier: 2, score: 3 + similarity, reason: `标题相似度 ${similarity.toFixed(2)}`, titleHits, titleCover, tlReverse };
  }
  if (titleCover >= THRESHOLDS.mergeCoverage && titleHits >= THRESHOLDS.mergeCoverageHits) {
    return {
      tier: 2,
      score: 2 + titleHits / 10,
      reason: `标题覆盖 ${(titleCover * 100).toFixed(0)}%（命中 ${titleHits}）`,
      titleHits,
      titleCover,
      tlReverse,
    };
  }
  // 时间轴并入：覆盖率达标、命中够多、本次输入基本被这条记录解释，**且**标题不是另起炉灶
  if (tlCover >= THRESHOLDS.mergeTimelineCoverage && tlHits >= THRESHOLDS.mergeTimelineHits && tlReverse >= THRESHOLDS.mergeTimelineReverse && titleRelated) {
    return { tier: 2, score: 1 + tlHits / 10, reason: `时间轴命中 ${tlHits} 处`, titleHits, titleCover, tlReverse };
  }
  // 任一条件不满足：可能是同一条记录的补充，也可能是无关长文里顺带一提——降级为提示，交给人确认
  if (tlCover >= THRESHOLDS.mergeTimelineCoverage && tlHits >= THRESHOLDS.mergeTimelineHits) {
    const why = !titleRelated ? '标题不同' : '内容差异大';
    return { tier: 1, score: tlCover, reason: `时间轴命中 ${tlHits} 处（${why}）`, titleHits, titleCover, tlReverse };
  }
  if (similarity >= THRESHOLDS.hintSimilarity) {
    return { tier: 1, score: similarity, reason: `标题相似度 ${similarity.toFixed(2)}`, titleHits, titleCover, tlReverse };
  }
  if (titleCover >= THRESHOLDS.hintCoverage) {
    return { tier: 1, score: titleCover, reason: `标题覆盖 ${(titleCover * 100).toFixed(0)}%`, titleHits, titleCover, tlReverse };
  }
  return null;
}

/** 去重：先按档位分组（够并入线的优先），再在组内取分数最高的 */
export function findDuplicate(probe, candidates) {
  const scored = [];
  for (const entry of candidates) {
    const verdict = judgeCandidate(entry, probe);
    if (verdict) scored.push({ entry, ...verdict });
  }
  if (!scored.length) return null;
  scored.sort((a, b) => b.tier - a.tier || b.score - a.score);
  return scored[0];
}

/** 由"本次标题 + 本次内容"构造探针 */
export function buildProbe(title, content) {
  return {
    titleSet: bigrams(title ?? ''),
    probeSet: bigrams(`${title ?? ''}\n${content ?? ''}`),
  };
}

/** 优先级：默认低，命中才升 */
export function priorityOf({ title, content, workingDays }) {
  const text = `${title ?? ''} ${content ?? ''}`;
  if (/紧急|重要|优先|尽快|马上|立刻|加急/.test(text)) {
    return { priority: 'high', reasons: ['原文出现紧急/重要字样'] };
  }
  if (Number.isFinite(workingDays) && workingDays <= 3) {
    return { priority: 'mid', reasons: [workingDays < 0 ? '已逾期' : `剩 ${workingDays} 个工作日`] };
  }
  return { priority: 'low', reasons: [] };
}

function parseStamp(text) {
  const match = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2}))?/.exec(String(text ?? ''));
  if (!match) return null;
  const date = new Date(
    Number(match[1]),
    Number(match[2]) - 1,
    Number(match[3]),
    Number(match[4] ?? 0),
    Number(match[5] ?? 0),
  );
  return Number.isNaN(date.getTime()) ? null : date;
}

/** 停滞天数：距最后一条时间轴的天数 */
export function stallDaysOf(entry, now = new Date()) {
  const last = entry.timeline?.[0]?.at ?? entry.updated;
  if (!last) return 0;
  const parsed = parseStamp(last);
  if (!parsed) return 0;
  return Math.max(0, Math.floor((now - parsed) / 86400000));
}

/** 灵感沉睡天数；已转化为 -1 */
export function dormantDaysOf(entry, now = new Date()) {
  if (entry.promotedTo) return -1;
  const base = entry.created ?? entry.updated;
  if (!base) return 0;
  const parsed = parseStamp(base);
  if (!parsed) return 0;
  return Math.max(0, Math.floor((now - parsed) / 86400000));
}

/** 一句"什么时候"：今天/明天/后天/本周内周X/下周X/MM-DD，都带时刻 */
export function whenLabel(date, now = new Date()) {
  if (!date) return null;
  const target = new Date(date);
  const days = Math.round((target.setHours(0, 0, 0, 0) - new Date(now).setHours(0, 0, 0, 0)) / 86400000);
  const clock = `${String(target.getHours()).padStart(2, '0')}:${String(target.getMinutes()).padStart(2, '0')}`;
  const weekday = '日一二三四五六'[target.getDay()];
  if (days < 0) return { days, text: `逾期 ${Math.abs(days)} 天`, clock };
  if (days === 0) return { days, text: '今天', clock };
  if (days === 1) return { days, text: '明天', clock };
  if (days === 2) return { days, text: '后天', clock };
  if (days <= 7) return { days, text: `本周内 周${weekday}`, clock };
  if (days <= 14) return { days, text: `下周${weekday}`, clock };
  return {
    days,
    text: `${String(target.getMonth() + 1).padStart(2, '0')}-${String(target.getDate()).padStart(2, '0')}`,
    clock,
  };
}

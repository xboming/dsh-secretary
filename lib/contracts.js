/**
 * 合同与回款的纯函数层：补充协议、回款期次、派生值。
 *
 * ── 为什么单独一个模块 ──
 * 这三类计算全是"由仓库里已有的标量推出来"的纯函数，不碰 IO、不碰 store，
 * 放进来可以单独测、单独验，也避免把 secretary.js 再撑大一圈。
 *
 * ── 一条铁律 ──
 * 合同总额、回款进度、回款状态、逾期，**一律现算，绝不入库**。
 * 存了就是冗余：改了金额忘改进度，两个数会静默打架，而且打架时没人报错。
 * 所以 frontmatter 里只有输入（期次金额、协议增减额），没有输出。
 *
 * ── 数据形状 ──
 * frontmatter 只能存扁平标量（见 frontmatter.js 的刻意限制），
 * 所以补充协议和期次不写进 frontmatter，而是落在正文的两个小节里，
 * 由本模块解析/生成。这样 Obsidian 里直接看就是一张表，可读可手改。
 */

/** 补充协议的四个状态。只有「已签收」才计入合同总额。 */
export const AGREEMENT_STATUS = ['起草中', '待签收', '已签收', '已作废'];

/** 计入合同总额的那一个状态 */
export const AGREEMENT_SIGNED = '已签收';

/** 合同的五个状态 */
export const CONTRACT_STATUS = ['草拟', '已签订', '履行中', '已完成', '已解除'];

/**
 * 哪些合同状态**还能再加补充协议**。
 *
 * 已完成 / 已解除一律封口：
 *   · 已完成——交付和金额都定了，质保期内要调整属于新事项，不是原合同的变更；
 *   · 已解除——合同已经终止，再往上加协议等于让它复活。
 * 这两种情况如果确实要用新金额，做法是新建一份合同，不要改旧合同。
 */
export const AGREEMENT_OPEN_STATUS = ['草拟', '已签订', '履行中'];

/** 回款状态三档：二值装不下"回了 30%" */
export const PAY_STATUS = ['未回款', '部分回款', '已回款'];

/** 数字兜底：非有限数一律当 0，避免合计算出 NaN */
function num(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

/** 金额规范化：保留两位小数，去掉浮点尾巴（0.1+0.2 这类） */
export function money(value) {
  const n = num(value);
  return Math.round(n * 100) / 100;
}

/**
 * 合同总额 = 主合同金额 + 所有**已签收**补充协议的增减额。
 *
 * 起草中和待签收的一律不算：没签的协议随时可能黄，
 * 算进去会让合同总额虚高，进而把回款进度算低。
 */
export function contractTotal(contract) {
  const base = num(contract?.amount);
  const agreements = Array.isArray(contract?.agreements) ? contract.agreements : [];
  const delta = agreements
    .filter((item) => item?.status === AGREEMENT_SIGNED)
    .reduce((sum, item) => sum + num(item.amount), 0);
  return money(base + delta);
}

/**
 * 已签收补充协议的增减额合计（单独给：合同详情要显示"主合同 + 变更"）
 */
export function agreementDelta(contract) {
  const agreements = Array.isArray(contract?.agreements) ? contract.agreements : [];
  return money(
    agreements.filter((item) => item?.status === AGREEMENT_SIGNED).reduce((sum, item) => sum + num(item.amount), 0),
  );
}

/**
 * 期次金额合计。**不含免除的期次**——免除的钱不再收，不能算进要收的总数，
 * 否则回款率永远到不了 100%。
 */
export function installmentSum(contract, { includeExempt = false } = {}) {
  const list = Array.isArray(contract?.installments) ? contract.installments : [];
  return money(
    list
      .filter((item) => includeExempt || item?.exempt !== true)
      .reduce((sum, item) => sum + num(item.amount), 0),
  );
}

/** 已回款合计：实际回款日不为空才算到账 */
export function collectedSum(contract) {
  const list = Array.isArray(contract?.installments) ? contract.installments : [];
  return money(
    list
      .filter((item) => item?.paidAt)
      .reduce((sum, item) => sum + num(item.amount), 0),
  );
}

/**
 * 回款进度 = 已回款 ÷ 合同总额。
 *
 * 分母用**变更后**的合同总额，不是主合同原始金额：
 * 补充协议一签，分母就该跟着变，否则进度会偏大。
 *
 * 返回 0-100 的整数百分比；总额为 0 时返回 null（不是 0，两者语义不同：
 * null 表示"还没有合同金额，算不了"，0 表示"一分钱没收"）。
 */
export function payProgress(contract) {
  const total = contractTotal(contract);
  if (total <= 0) return null;
  const got = collectedSum(contract);
  return Math.round((got / total) * 100);
}

/**
 * 回款状态三档。
 *
 * 判据只看钱：一笔没到＝未回款；到账但不够＝部分回款；到齐＝已回款。
 * "到齐"按**应收集**的那部分算（免除的期次不计入应收）。
 */
export function payStatus(contract) {
  const list = Array.isArray(contract?.installments) ? contract.installments : [];
  if (!list.length) return '未回款';
  const receivable = list.filter((item) => item?.exempt !== true);
  const got = collectedSum(contract);
  if (got <= 0) return '未回款';
  const expected = receivable.reduce((sum, item) => sum + num(item.amount), 0);
  return got >= money(expected) ? '已回款' : '部分回款';
}

/**
 * 期次逾期判定：计划回款日已过且实际回款日为空，且没被免除。
 *
 * 返回逾期期次数组，每条带上逾期天数。**不判断"有没有催"**——
 * 催不催是人的事，这里只回答"到期没有"。
 */
export function overdueInstallments(contract, now = new Date()) {
  const list = Array.isArray(contract?.installments) ? contract.installments : [];
  const today = startOfDay(now);
  const out = [];
  for (const item of list) {
    if (!item?.dueAt || item.paidAt || item.exempt === true) continue;
    const due = parseDay(item.dueAt);
    if (!due) continue;
    if (due.getTime() >= today.getTime()) continue;
    out.push({ ...item, overdueDays: Math.round((today.getTime() - due.getTime()) / 86400000) });
  }
  return out;
}

/** 补充协议里卡在「待签收」的（签收提醒的对象） */
export function pendingAgreements(contract) {
  const agreements = Array.isArray(contract?.agreements) ? contract.agreements : [];
  return agreements.filter((item) => item?.status === '待签收');
}

/**
 * 期次金额之和与合同总额是否对平。
 *
 * 返回 `{ ok, diff }`：ok 为 true 表示相等，diff 为差额（合同总额 − 期次之和）。
 * 差额 > 0 表示还有钱没安排到期次里；< 0 表示期次比合同多。
 *
 * 为什么必须校验：补充协议签收后合同总额变了，但期次不会自己长出来。
 * 不对平就出现"钱变多了，催款还是按老期次催"——这不是小事，是会真的少收钱。
 */
export function reconcileInstallments(contract) {
  const total = contractTotal(contract);
  const sum = installmentSum(contract);
  const diff = money(total - sum);
  // 允许 1 分钱误差：两位小数四舍五入之后可能差 0.01，不该因此报警
  return { ok: Math.abs(diff) < 0.01, diff, total, sum };
}

/** 本地零点 */
function startOfDay(date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

/** 解析 YYYY-MM-DD 为本地零点；无效返回 null */
function parseDay(value) {
  if (typeof value !== 'string') return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return Number.isNaN(d.getTime()) ? null : d;
}

/** 金额显示：元，带千分位；空值给"—"而不是 0（没谈到 ≠ 谈成 0 元） */
export function formatMoney(value) {
  if (value === null || value === undefined || value === '') return '—';
  const n = Number(value);
  if (!Number.isFinite(n)) return '—';
  return n.toLocaleString('zh-CN', { maximumFractionDigits: 2 });
}

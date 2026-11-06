/**
 * 合同正文的结构化小节：补充协议表、回款期次表。
 *
 * ── 为什么放正文而不是 frontmatter ──
 * frontmatter.js 刻意只支持扁平标量（`key: [a, b]`），不支持嵌套对象。
 * 补充协议有 6 个属性、期次有 5 个属性，塞进 frontmatter 只能拼成
 * `AG-01|2026-03-05|增加|200000|已签收|追加预算` 这种一维串，
 * 人和 Obsidian 都读不出来，改一个字段还要数竖线。
 *
 * 放进正文的 Markdown 表格则刚好：Obsidian 里直接渲染成表，可读可手改，
 * 而且和"文件是唯一真相、用户随时能打开看"的原则一致。
 *
 * ── 改坏了怎么办 ──
 * 解析是**宽容**的：认不出的行跳过，不抛错。宁可少读一行，
 * 也不能因为手工改动让整个合同读不出来（那会让记录从面板上消失）。
 */

const AGREEMENT_HEADING = '补充协议';
const INSTALLMENT_HEADING = '回款期次';

/** Markdown 表格的列定义：表头文案 ↔ 字段名 */
const AGREEMENT_COLUMNS = [
  ['编号', 'no'],
  ['签订日', 'signedAt'],
  ['变更内容', 'summary'],
  ['变更金额', 'amount'],
  ['状态', 'status'],
  ['预计签收日', 'expectAt'],
  ['卡在', 'blockedBy'],
  ['备注', 'note'],
];

const INSTALLMENT_COLUMNS = [
  ['期次', 'name'],
  ['计划回款日', 'dueAt'],
  ['实际回款日', 'paidAt'],
  ['金额', 'amount'],
  /**
   * 免除：这一期确定不再收取（对方违约结算了、协商免了）。
   *
   * 必须有独立一列，不能只写在备注里——备注是给人看的自由文字，
   * 而"免除"是**参与计算的状态**：免除的期次不再提醒、不计入回款率分母。
   * 靠解析备注里的关键词来判定，等于把计算正确性建立在措辞上。
   */
  ['免除', 'exempt'],
  ['备注', 'note'],
];

/** 表格一行拆成单元格，支持反斜杠转义竖线 */
function splitRow(line) {
  const text = line.trim().replace(/^\|/, '').replace(/\|$/, '');
  const cells = [];
  let current = '';
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (ch === '\\' && text[i + 1] === '|') {
      current += '|';
      i += 1;
      continue;
    }
    if (ch === '|') {
      cells.push(current.trim());
      current = '';
      continue;
    }
    current += ch;
  }
  cells.push(current.trim());
  return cells;
}

/** 单元格 → 写回时的安全文本：竖线转义，空值给空串 */
function cell(value) {
  const text = value === null || value === undefined ? '' : String(value);
  return text.replace(/\|/g, '\\|').replace(/\r?\n/g, ' ').trim();
}

/**
 * 从正文里读一张表。
 *
 * `columns` 是 `[表头, 字段]` 数组。表头认不出来时按**位置**对齐，
 * 这样用户手工改了表头文案也不至于整表失效。
 */
function readTable(body, heading, columns) {
  const lines = String(body ?? '').split('\n');
  let start = -1;
  for (let i = 0; i < lines.length; i += 1) {
    if (lines[i].trim() === `## ${heading}`) {
      start = i + 1;
      break;
    }
  }
  if (start < 0) return [];
  const rows = [];
  let headerSeen = false;
  for (let i = start; i < lines.length; i += 1) {
    const line = lines[i];
    if (/^##\s/.test(line)) break;
    const text = line.trim();
    if (!text.startsWith('|')) continue;
    // 分隔行 |---|---| 跳过
    if (/^\|[\s:|-]+\|?$/.test(text)) continue;
    const cells = splitRow(text);
    if (!headerSeen) {
      headerSeen = true;
      // 判断这行是不是表头：任一单元格命中列名就当表头
      const hit = cells.some((item) => columns.some(([label]) => label === item));
      if (hit) continue;
    }
    const row = {};
    columns.forEach(([, field], index) => {
      const raw = cells[index];
      if (raw === undefined || raw === '') return;
      row[field] = raw;
    });
    if (Object.keys(row).length) rows.push(row);
  }
  return rows;
}

/** 生成一张表（表头 + 分隔 + 数据行）。没有数据时给一行占位说明。 */
function table(columns, rows, emptyText) {
  const head = `| ${columns.map(([label]) => label).join(' | ')} |`;
  const sep = `| ${columns.map(() => '---').join(' | ')} |`;
  if (!rows.length) return [head, sep, `| ${emptyText}${' |'.repeat(columns.length - 1)}`];
  return [
    head,
    sep,
    ...rows.map((row) => `| ${columns.map(([, field]) => cell(row[field])).join(' | ')} |`),
  ];
}

/* ---------------- 补充协议 ---------------- */

/**
 * 读补充协议。
 *
 * 金额列带正负号：`+200000` 增加、`-50000` 减少。
 * 也能读 `200000`（不带号）——按增加处理，因为老写法没约定符号。
 * 但**不能只记一个正负号就完事**：面板要能分辨增加/减少，所以 `kind` 单独给。
 */
export function readAgreements(body) {
  return readTable(body, AGREEMENT_HEADING, AGREEMENT_COLUMNS).map((row, index) => {
    const raw = String(row.amount ?? '').replace(/[,\s]/g, '');
    const signed = raw.startsWith('-');
    const amount = Number(raw.replace(/^[+-]/, '')) || 0;
    return {
      // 编号缺失时按序号补一个，保证每条协议都有稳定标识
      no: row.no || `AG-${String(index + 1).padStart(2, '0')}`,
      signedAt: row.signedAt || '',
      summary: row.summary || '',
      // 减少记负数，增加记正数——和 contractTotal 的求和口径一致
      amount: signed ? -amount : amount,
      kind: signed ? '减少' : '增加',
      status: row.status || '起草中',
      expectAt: row.expectAt || '',
      blockedBy: row.blockedBy || '',
      note: row.note || '',
    };
  });
}

/** 写补充协议小节 */
export function writeAgreements(body, agreements, helpers) {
  const { writeSection } = helpers;
  const rows = (agreements ?? []).map((item) => ({
    ...item,
    amount: item.amount === 0 || item.amount === undefined || item.amount === null
      ? ''
      : `${item.amount > 0 ? '+' : '-'}${Math.abs(Number(item.amount))}`,
  }));
  return writeSection(body, AGREEMENT_HEADING, table(AGREEMENT_COLUMNS, rows, '（还没有补充协议）'));
}

/* ---------------- 回款期次 ---------------- */

/** 读回款期次。金额不带符号，期次是正数金额。 */
export function readInstallments(body) {
  return readTable(body, INSTALLMENT_HEADING, INSTALLMENT_COLUMNS).map((row, index) => {
    const raw = String(row.amount ?? '').replace(/[,\s]/g, '');
    return {
      name: row.name || `第${index + 1}期`,
      dueAt: row.dueAt || '',
      paidAt: row.paidAt || '',
      amount: Number(raw) || 0,
      // 表格里的"是/否"读成布尔：只有明确写"是"才算免除，
      // 空着或"否"一律按不豁免——宁可多提醒一次，也别静默少收钱
      exempt: /^(是|true|y|yes|✓|√)$/i.test(String(row.exempt ?? '').trim()),
      note: row.note || '',
    };
  });
}

/** 写回款期次小节 */
export function writeInstallments(body, installments, helpers) {
  const { writeSection } = helpers;
  const rows = (installments ?? []).map((item) => ({
    ...item,
    // 只对 true 写"是"，其余留空——表格里一片"否"是噪音
    exempt: item.exempt === true ? '是' : '',
  }));
  return writeSection(
    body,
    INSTALLMENT_HEADING,
    table(INSTALLMENT_COLUMNS, rows, '（还没有回款期次）'),
  );
}

/**
 * 从正文一次性抽取合同的结构化部分。
 * 合同域以外的域也会调用它（返回空数组），不影响。
 */
export function readContractBody(body) {
  return {
    agreements: readAgreements(body),
    installments: readInstallments(body),
  };
}

export { AGREEMENT_HEADING, INSTALLMENT_HEADING };

/**
 * frontmatter 读写。
 *
 * 只支持扁平标量：`key: value`、`key: [a, b]`、`key: true|false|数字`。
 * 不做嵌套、不做块标量——这是刻意的限制，解析器越简单越不会在真实文件上翻车。
 * 未知键原样保留，将来加字段时旧版本读写一遍不会把值吃掉。
 */

const KEY_RE = /^([A-Za-z_][\w-]*)\s*:\s*(.*)$/;

/** 拆分 frontmatter 与正文 */
export function splitDocument(text) {
  const source = String(text ?? '').replace(/^\uFEFF/, '');
  if (!source.startsWith('---\n') && !source.startsWith('---\r\n')) {
    return { data: {}, body: source };
  }
  const lines = source.split(/\r?\n/);
  let end = -1;
  for (let i = 1; i < lines.length; i += 1) {
    if (lines[i].trim() === '---') {
      end = i;
      break;
    }
  }
  if (end < 0) return { data: {}, body: source };
  const data = parseFrontmatter(lines.slice(1, end).join('\n'));
  return { data, body: lines.slice(end + 1).join('\n').replace(/^\n+/, '') };
}

export function parseFrontmatter(raw) {
  const data = {};
  for (const line of String(raw ?? '').split(/\r?\n/)) {
    const text = line.trimEnd();
    if (!text || text.trimStart().startsWith('#')) continue;
    const match = KEY_RE.exec(text);
    if (!match) continue;
    const key = match[1];
    const rest = match[2].trim();
    if (rest === '') {
      // 空值：可能是多行嵌套的开头，按文档约束忽略内容但保留空串
      data[key] = '';
      continue;
    }
    data[key] = parseScalar(rest);
  }
  return data;
}

function parseScalar(rest) {
  if (rest.startsWith('[')) {
    const inner = rest.replace(/^\[/, '').replace(/\].*$/, '');
    return splitList(inner);
  }
  if (rest === 'true') return true;
  if (rest === 'false') return false;
  if (rest === 'null' || rest === '~') return null;
  if (/^-?\d+(\.\d+)?$/.test(rest)) return Number(rest);
  return unquote(rest.replace(/\s+#.*$/, ''));
}

function unquote(value) {
  const text = value.trim();
  if (text.length >= 2) {
    const first = text[0];
    const last = text[text.length - 1];
    if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
      return text.slice(1, -1).replace(/\\n/g, '\n').replace(/''/g, "'");
    }
  }
  return text;
}

function splitList(inner) {
  const out = [];
  let current = '';
  let quote = '';
  for (const ch of inner) {
    if (quote) {
      current += ch;
      if (ch === quote) quote = '';
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      current += ch;
      continue;
    }
    if (ch === ',') {
      const value = unquote(current.trim());
      if (value !== '') out.push(value);
      current = '';
      continue;
    }
    current += ch;
  }
  const tail = unquote(current.trim());
  if (tail !== '') out.push(tail);
  return out;
}

function quoteScalar(value) {
  if (typeof value === 'string') {
    if (value === '') return '""';
    if (/^[\s]|[\s]$|[:#\[\]{}|>]|^[-?!&*]|^(true|false|null|~)$|^\d+$/.test(value)) {
      return `"${value.replace(/"/g, '\\"')}"`;
    }
    return value;
  }
  return String(value);
}

function writeValue(value) {
  if (Array.isArray(value)) {
    if (value.length === 0) return '[]';
    return `[${value.map((item) => quoteScalar(String(item))).join(', ')}]`;
  }
  if (typeof value === 'boolean' || typeof value === 'number') return String(value);
  if (value === null || value === undefined) return '';
  return quoteScalar(String(value));
}

/** 组装文件：frontmatter（保持给定顺序）+ 正文 */
export function buildDocument(data, body) {
  const lines = ['---'];
  for (const [key, value] of Object.entries(data)) {
    if (value === undefined) continue;
    lines.push(`${key}: ${writeValue(value)}`.trimEnd());
  }
  lines.push('---', '');
  return `${lines.join('\n')}\n${String(body ?? '').replace(/^\n+/, '')}`;
}

/**
 * 取某个 `## 标题` 小节的行区间（不含标题行）。
 * 找不到返回 null。
 */
export function sectionRange(body, heading) {
  const lines = String(body ?? '').split('\n');
  const target = `## ${heading}`.trim();
  let start = -1;
  for (let i = 0; i < lines.length; i += 1) {
    if (lines[i].trim() === target) {
      start = i + 1;
      break;
    }
  }
  if (start < 0) return null;
  let end = lines.length;
  for (let i = start; i < lines.length; i += 1) {
    if (/^##\s/.test(lines[i])) {
      end = i;
      break;
    }
  }
  return { start, end, lines };
}

/** 读小节正文 */
export function readSection(body, heading) {
  const range = sectionRange(body, heading);
  if (!range) return '';
  return range.lines.slice(range.start, range.end).join('\n').trim();
}

/**
 * 替换（或追加）一个小节。返回新的整篇正文。
 * 小节内容按行给出，调用方负责缩进与格式。
 */
export function writeSection(body, heading, lines) {
  const block = [`## ${heading}`, '', ...lines].join('\n').replace(/\s+$/, '');
  const range = sectionRange(body, heading);
  const source = String(body ?? '').split('\n');
  if (!range) {
    const trimmed = source.join('\n').replace(/\s+$/, '');
    return `${trimmed}\n\n${block}\n`;
  }
  const before = source.slice(0, range.start - 1);
  const after = source.slice(range.end);
  const merged = [...before, ...block.split('\n'), '', ...after];
  return `${merged.join('\n').replace(/\n{3,}/g, '\n\n').replace(/\s+$/, '')}\n`;
}

/**
 * 灵感流水：月度单文件、追加式、扁平可读。
 *
 * 块格式（刻意简单，纯文本可手改）：
 *   ### I-202610-01 标题
 *   - 记录：2026-10-27 09:58
 *   - 来源：通勤
 *   - 转化：C-2026-001        ← 可选，出现即视为已转化
 *
 *   > 原话第一行
 *   > 原话第二行
 */

import { oneLine, stamp } from './util.js';

/** 解析整月文件为条目数组 */
export function parseStreamFile(text, relative, domain, mtimeMs) {
  const source = String(text ?? '').replace(/^\uFEFF/, '');
  const lines = source.split(/\r?\n/);
  const entries = [];
  let current = null;

  const flush = () => {
    if (!current) return;
    const meta = current.meta;
    entries.push({
      id: current.id,
      title: current.title,
      domain: domain.id,
      path: relative,
      mtimeMs,
      created: (meta['记录'] ?? '').slice(0, 10) || null,
      source: meta['来源'] ?? null,
      promotedTo: meta['转化'] ?? null,
      tags: meta['标签'] ? meta['标签'].split(/[，,]/).map((t) => t.trim()).filter(Boolean) : [],
      timeline: [{ at: meta['记录'] ?? '', text: '记录', quote: current.quote || null }],
      notes: [],
      body: current.lines.join('\n'),
      shape: 'stream',
    });
    current = null;
  };

  for (const line of lines) {
    const head = /^###\s+([A-Za-z]-?\d[\w-]*)\s+(.*)$/.exec(line);
    if (head) {
      flush();
      current = { id: head[1], title: head[2].trim(), meta: {}, quote: '', lines: [line] };
      continue;
    }
    if (!current) continue;
    current.lines.push(line);
    const meta = /^-\s*([^：:]+)[：:]\s*(.*)$/.exec(line.trim());
    if (meta) {
      current.meta[meta[1].trim()] = meta[2].trim();
      continue;
    }
    const quote = /^>\s?(.*)$/.exec(line);
    if (quote) {
      current.quote = current.quote ? `${current.quote}\n${quote[1]}` : quote[1];
    }
  }
  flush();
  return entries;
}

/** 新建一个块 */
export function streamBlock({ id, title, text, source, now, tags }) {
  const lines = [`### ${id} ${oneLine(title, 60)}`, `- 记录：${stamp(now)}`];
  if (source) lines.push(`- 来源：${source}`);
  if (tags && tags.length) lines.push(`- 标签：${tags.join('，')}`);
  lines.push('');
  for (const line of String(text ?? '').replace(/\r\n?/g, '\n').split('\n')) {
    lines.push(`> ${line}`.replace(/\s+$/, ''));
  }
  return `${lines.join('\n')}\n`;
}

/** 追加到整月文件末尾，返回新全文 */
export function appendStream(text, block) {
  const base = String(text ?? '').replace(/\s+$/, '');
  if (!base) return `${block}`;
  return `${base}\n\n${block}`;
}

/** 改某个块的元信息（如 转化：C-2026-001），返回新全文 */
export function setStreamMeta(text, id, key, value) {
  const lines = String(text ?? '').split(/\r?\n/);
  let inside = false;
  let inserted = false;
  for (let i = 0; i < lines.length; i += 1) {
    const head = /^###\s+([A-Za-z]-?\d[\w-]*)\s+/.exec(lines[i]);
    if (head) {
      if (inside && !inserted) {
        lines.splice(i, 0, `- ${key}：${value}`);
        return lines.join('\n');
      }
      inside = head[1] === id;
      if (inside && new RegExp(`^-\\s*${key}[：:]`).test(lines[i + 1] ?? '')) {
        // 已有该键的原位替换
        inserted = true;
      }
      continue;
    }
    if (!inside) continue;
    const meta = new RegExp(`^-\\s*${key}[：:]\\s*(.*)$`).exec(lines[i]);
    if (meta) {
      lines[i] = `- ${key}：${value}`;
      inserted = true;
      return lines.join('\n');
    }
  }
  if (inside && !inserted) lines.push(`- ${key}：${value}`);
  return lines.join('\n');
}

/** 月度文件在哪 */
export function streamPath(domain, now = new Date()) {
  const month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  return `${domain.dir}/${month.slice(0, 4)}/${month}.md`;
}

/** 新块的 id：I-YYYYMM-NN */
export function nextStreamId(text, now = new Date()) {
  const month = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}`;
  const prefix = `I-${month}-`;
  let max = 0;
  for (const match of String(text ?? '').matchAll(/I-(\d{6})-(\d{2,})/g)) {
    if (`I-${match[1]}-` !== prefix) continue;
    max = Math.max(max, Number(match[2]));
  }
  return `${prefix}${String(max + 1).padStart(2, '0')}`;
}

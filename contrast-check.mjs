/**
 * 主题对比度核验：用真实渲染出的计算颜色，按 WCAG 公式算对比度。
 *
 *   node contrast-check.mjs
 *
 * 审查报告 6.2 要求：普通文字 ≥ 4.5:1，大号文字/控件边界/焦点 ≥ 3:1。
 * 这里不猜色值——颜色从无头 Chrome 里以 getComputedStyle 取实际渲染结果，
 * 所以"令牌没生效""浅色主题没单独校准"这类问题会直接暴露成低于阈值的数字。
 */

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const shotsDir = path.join(here, 'shots');

const CHROME_CANDIDATES = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  `${process.env.LOCALAPPDATA}\\Google\\Chrome\\Application\\chrome.exe`,
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
];
const chrome = CHROME_CANDIDATES.find((candidate) => existsSync(candidate));
if (!chrome) {
  console.error('找不到 Chrome/Edge，无法核验对比度。');
  process.exit(2);
}

const SAMPLE = `
<script>
window.addEventListener('load', function () {
  function color(selector, property) {
    var node = document.querySelector(selector);
    if (!node) return null;
    return getComputedStyle(node)[property || 'color'];
  }
  function bgOf(selector) {
    var node = document.querySelector(selector);
    if (!node) return null;
    var current = node;
    while (current) {
      var bg = getComputedStyle(current).backgroundColor;
      if (bg && bg !== 'rgba(0, 0, 0, 0)' && bg !== 'transparent') return bg;
      current = current.parentElement;
    }
    return getComputedStyle(document.body).backgroundColor;
  }
  var out = {
    bodyBg: bgOf('.sct-root'),
    text: color('.sct-task-title'),
    textBg: bgOf('.sct-task-title'),
    muted: color('.sct-task-meta'),
    mutedBg: bgOf('.sct-task-meta'),
    note: color('.sct-task-note'),
    noteBg: bgOf('.sct-task-note'),
    hero: color('.sct-hero h1'),
    heroBg: bgOf('.sct-hero h1'),
    tabSelected: color('.sct-tab[aria-selected="true"]'),
    tabSelectedBg: bgOf('.sct-tab[aria-selected="true"]'),
    tabIdle: color('.sct-tab[aria-selected="false"]'),
    tabIdleBg: bgOf('.sct-tab[aria-selected="false"]'),
    primary: color('.sct-primary-btn'),
    primaryBg: bgOf('.sct-primary-btn'),
    danger: color('.sct-status[data-kind="danger"]'),
    dangerBg: bgOf('.sct-status[data-kind="danger"]'),
    today: color('.sct-status[data-kind="today"]'),
    todayBg: bgOf('.sct-status[data-kind="today"]'),
    warn: color('.sct-status[data-kind="warn"]'),
    warnBg: bgOf('.sct-status[data-kind="warn"]'),
    titleBorder: color('.sct-check', 'borderTopColor'),
    checkBorderBg: bgOf('.sct-check'),
    sideMuted: color('.sct-side-note'),
    sideMutedBg: bgOf('.sct-side-note')
  };
  var sink = document.createElement('pre');
  sink.id = 'contrast-out';
  sink.textContent = 'CONTRAST:' + JSON.stringify(out);
  document.body.appendChild(sink);
});
</script>
`;

/* ------------------------------- WCAG 计算 ------------------------------- */
/**
 * 解析计算后的颜色。
 *
 * 必须同时支持三种写法：组件里用 `color-mix(in srgb, ...)` 生成柔和底色，
 * Chrome 对它求值后给出的是 `color(srgb 0.2 0.1 0.1)` 而不是 `rgb()`。
 * 只认 rgb() 会把所有状态标签判成"未采样"——那是测量脚本的缺陷，不是主题缺陷。
 */
function parseColor(value) {
  const text = String(value || '').trim();
  const rgba = /rgba?\(([^)]+)\)/.exec(text);
  if (rgba) {
    const parts = rgba[1].split(/[,\s/]+/).filter(Boolean).map(Number);
    return { r: parts[0], g: parts[1], b: parts[2], a: parts.length > 3 ? parts[3] : 1 };
  }
  // color(srgb r g b [/ a])，各分量是 0–1
  const srgb = /color\(srgb\s+([^)]+)\)/.exec(text);
  if (srgb) {
    const parts = srgb[1].split(/[\s/]+/).filter(Boolean).map(Number);
    return { r: parts[0] * 255, g: parts[1] * 255, b: parts[2] * 255, a: parts.length > 3 ? parts[3] : 1 };
  }
  return null;
}

function blend(foreground, background) {
  if (!foreground) return null;
  if (foreground.a >= 0.999) return foreground;
  const alpha = foreground.a;
  return {
    r: foreground.r * alpha + background.r * (1 - alpha),
    g: foreground.g * alpha + background.g * (1 - alpha),
    b: foreground.b * alpha + background.b * (1 - alpha),
    a: 1,
  };
}

function luminance(color) {
  const channel = (value) => {
    const c = value / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(color.r) + 0.7152 * channel(color.g) + 0.0722 * channel(color.b);
}

function contrast(foreground, background) {
  const fg = blend(parseColor(foreground), parseColor(background));
  const bg = parseColor(background);
  if (!fg || !bg) return null;
  const l1 = luminance(fg);
  const l2 = luminance(bg);
  const light = Math.max(l1, l2);
  const dark = Math.min(l1, l2);
  return (light + 0.05) / (dark + 0.05);
}

/* --------------------------------- 采样 --------------------------------- */
const TARGETS = [
  { key: 'text', label: '正文（条目标题）', min: 4.5 },
  { key: 'muted', label: '辅助文字（元信息）', min: 4.5 },
  { key: 'note', label: '摘要文字', min: 4.5 },
  { key: 'hero', label: '主标题（大字）', min: 3 },
  { key: 'tabSelected', label: '选中页签文字', min: 4.5 },
  { key: 'tabIdle', label: '未选中页签文字', min: 4.5 },
  { key: 'primary', label: '主按钮文字', min: 4.5 },
  { key: 'danger', label: '逾期标签', min: 4.5 },
  { key: 'today', label: '今日到期标签', min: 4.5 },
  { key: 'warn', label: '临期标签', min: 4.5 },
  { key: 'sideMuted', label: '侧栏说明文字', min: 4.5 },
  { key: 'titleBorder', label: '控件边界（完成按钮描边）', min: 3 },
];

const rows = [];
const failures = [];

for (const theme of ['dark', 'light']) {
  const pagePath = path.join(shotsDir, `${theme}-1440x900.html`);
  const sampled = path.join(shotsDir, `.contrast-${theme}.html`);
  writeFileSync(sampled, readFileSync(pagePath, 'utf8').replace('</body>', `${SAMPLE}</body>`), 'utf8');
  let dom = '';
  try {
    dom = execFileSync(
      chrome,
      [
        '--headless=new',
        '--disable-gpu',
        '--virtual-time-budget=2500',
        '--user-data-dir=' + path.join(shotsDir, '.contrast-profile'),
        '--no-first-run',
        '--no-default-browser-check',
        '--dump-dom',
        `file:///${sampled.replace(/\\/g, '/')}`,
      ],
      { stdio: 'pipe', timeout: 60000, encoding: 'utf8' },
    );
  } catch (error) {
    console.error(`采样失败 ${theme}: ${error?.message ?? error}`);
    process.exit(2);
  }
  rmSync(sampled, { force: true });
  const match = /CONTRAST:(\{[\s\S]*?\})<\/pre>/.exec(dom);
  if (!match) {
    console.error(`${theme} 主题没有拿到计算颜色`);
    process.exit(2);
  }
  const colors = JSON.parse(match[1]);

  for (const target of TARGETS) {
    const fg = colors[target.key];
    const bg = colors[`${target.key}Bg`] || colors.textBg;
    const ratio = contrast(fg, bg);
    if (ratio === null) {
      rows.push({ theme, label: target.label, ratio: '(未采样)', min: target.min, ok: false });
      failures.push(`${theme} / ${target.label}：没有取到颜色`);
      continue;
    }
    const ok = ratio >= target.min;
    rows.push({ theme, label: target.label, ratio: ratio.toFixed(2), min: target.min, ok });
    if (!ok) failures.push(`${theme} / ${target.label}：${ratio.toFixed(2)}:1 < ${target.min}:1  （${fg} on ${bg}）`);
  }
}

console.log('主题'.padEnd(6) + '对照项'.padEnd(24) + '实测'.padEnd(8) + '要求'.padEnd(6) + '结果');
for (const row of rows) {
  console.log(
    row.theme.padEnd(6) + row.label.padEnd(24) + String(row.ratio).padEnd(8) + `${row.min}:1`.padEnd(6) + (row.ok ? 'ok' : 'FAIL'),
  );
}

rmSync(path.join(shotsDir, '.contrast-profile'), { recursive: true, force: true });
writeFileSync(path.join(shotsDir, 'contrast.json'), `${JSON.stringify(rows, null, 2)}\n`, 'utf8');

console.log(`\n共 ${rows.length} 项，失败 ${failures.length} 项`);
if (failures.length) {
  for (const item of failures) console.error(`  FAIL ${item}`);
  process.exit(1);
}

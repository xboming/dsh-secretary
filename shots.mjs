/**
 * 用无头 Chrome 给每个验收页面截图，并顺带量出关键几何与计算样式。
 *
 *   node shots.mjs
 *   node shots.mjs --only dark-1440x900
 *
 * 断言的是"渲染结果"：有没有横向溢出、正文区实高多少、标题还有没有
 * 输入框式边框、完成控件是不是 24×24 的圆、页签选中态是否可见。
 * 这些正是审查报告用隔离 Chrome 复验的那几项，只是现在有了自动化的数字。
 */

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
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
  console.error('找不到 Chrome/Edge，无法截图。');
  process.exit(2);
}

const meta = JSON.parse(readFileSync(path.join(shotsDir, 'index.json'), 'utf8'));
const only = process.argv.includes('--only') ? process.argv[process.argv.indexOf('--only') + 1] : null;

/**
 * 量测脚本：在页面里跑（--dump-dom 拿不到布局，所以用 --virtual-time-budget +
 * 一段把结果写进 DOM 的脚本，再由 Node 解析）。
 */
const MEASURE = `
<script>
window.addEventListener('load', function () {
  function box(selector) {
    var node = document.querySelector(selector);
    if (!node) return null;
    var rect = node.getBoundingClientRect();
    var style = getComputedStyle(node);
    return {
      w: Math.round(rect.width),
      h: Math.round(rect.height),
      left: Math.round(rect.left),
      top: Math.round(rect.top),
      border: style.borderTopWidth,
      padding: style.paddingTop + ' ' + style.paddingLeft,
      radius: style.borderTopLeftRadius,
      fontSize: style.fontSize,
      overflowY: style.overflowY
    };
  }
  var root = document.querySelector('.sct-root');
  var rootRect = root.getBoundingClientRect();
  var drawer = document.querySelector('.sct-drawer');
  var drawerInfo = null;
  if (drawer) {
    var dRect = drawer.getBoundingClientRect();
    var body = drawer.querySelector('.sct-drawer-body');
    var foot = drawer.querySelector('.sct-drawer-foot');
    drawerInfo = {
      top: Math.round(dRect.top),
      bottom: Math.round(dRect.bottom),
      height: Math.round(dRect.height),
      width: Math.round(dRect.width),
      inViewport: dRect.top >= -1 && dRect.bottom <= window.innerHeight + 1,
      bodyScrollable: body ? getComputedStyle(body).overflowY : null,
      bodyOverflows: body ? body.scrollHeight > body.clientHeight + 1 : null,
      footVisible: foot ? foot.getBoundingClientRect().bottom <= window.innerHeight + 1 : null
    };
  }
  var result = {
    containerWidth: Math.round(rootRect.width),
    containerHeight: Math.round(rootRect.height),
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
    horizontalOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
    drawer: drawerInfo,
    list: box('#sct-tabpanel'),
    main: box('#main-col'),
    title: box('.sct-task-title'),
    check: box('.sct-check'),
    tabSelected: box('.sct-tab[aria-selected="true"]'),
    tabUnselected: box('.sct-tab[aria-selected="false"]'),
    layoutColumns: getComputedStyle(document.querySelector('.sct-layout')).gridTemplateColumns,
    scrollSurface: getComputedStyle(document.querySelector('.sct-scroll')).overflowY,
    listSurface: getComputedStyle(document.querySelector('#sct-tabpanel')).overflowY,
    bottomReachable: (function () {
      var surface = document.querySelector('.sct-scroll');
      return surface.scrollHeight <= surface.clientHeight + 1 || getComputedStyle(surface).overflowY === 'auto';
    })(),
    activeTabColor: getComputedStyle(document.querySelector('.sct-tab[aria-selected="true"]')).color,
    idleTabColor: getComputedStyle(document.querySelector('.sct-tab[aria-selected="false"]')).color,
    activeTabBorder: getComputedStyle(document.querySelector('.sct-tab[aria-selected="true"]')).borderBottomColor
  };
  var sink = document.createElement('pre');
  sink.id = 'measure-out';
  sink.textContent = 'MEASURE:' + JSON.stringify(result);
  document.body.appendChild(sink);
});
</script>
`;

const results = [];
const jobs = [];
for (const theme of meta.themes) {
  for (const size of meta.sizes) {
    jobs.push({ id: `${theme}-${size.name}`, theme, size, windowSize: size });
  }
  for (const nested of meta.nested ?? []) {
    // 窗口大于容器：验证断点跟容器走，不是跟窗口走
    jobs.push({
      id: `${theme}-${nested.name}`,
      theme,
      size: { width: nested.width, height: nested.height },
      windowSize: { width: nested.windowWidth, height: nested.windowHeight },
    });
  }
  for (const drawer of meta.drawers ?? []) {
    jobs.push({ id: `${theme}-${drawer.name}`, theme, size: drawer, windowSize: drawer, drawer: true });
  }
}

for (const job of jobs) {
  const { id, size, windowSize } = job;
  if (only && id !== only) continue;
  const pagePath = path.join(shotsDir, `${id}.html`);
  const measured = path.join(shotsDir, `.measure-${id}.html`);
  writeFileSync(measured, readFileSync(pagePath, 'utf8').replace('</body>', `${MEASURE}</body>`), 'utf8');
  const pngPath = path.join(shotsDir, `${id}.png`);

  const args = [
    '--headless=new',
    '--disable-gpu',
    '--force-device-scale-factor=1',
    `--window-size=${windowSize.width},${windowSize.height}`,
    '--virtual-time-budget=2500',
    `--screenshot=${pngPath}`,
    '--user-data-dir=' + path.join(shotsDir, '.chrome-profile'),
    '--no-first-run',
    '--no-default-browser-check',
    '--allow-file-access-from-files',
    `file:///${measured.replace(/\\/g, '/')}`,
  ];

  try {
    execFileSync(chrome, args, { stdio: 'pipe', timeout: 60000 });
  } catch (error) {
    console.error(`  截图失败 ${id}: ${error?.message ?? error}`);
    results.push({ id, ok: false, error: String(error?.message ?? error) });
    continue;
  }

  let dom = '';
  try {
    dom = execFileSync(chrome, [...args.filter((a) => !a.startsWith('--screenshot=')), '--dump-dom'], {
      stdio: 'pipe',
      timeout: 60000,
      encoding: 'utf8',
    });
  } catch (error) {
    dom = '';
    void error;
  }
  const match = /MEASURE:(\{[\s\S]*?\})<\/pre>/.exec(dom);
  const measuredData = match ? JSON.parse(match[1]) : null;
  results.push({ id, ok: true, size, windowSize, theme: job.theme, measure: measuredData });
  rmSync(measured, { force: true });
  console.log(`  ok  ${id}${measuredData ? `  容器 ${measuredData.containerWidth}px · 列表 ${measuredData.list?.h ?? '?'}px · 横向溢出 ${measuredData.horizontalOverflow}` : ''}`);
}

rmSync(path.join(shotsDir, '.chrome-profile'), { recursive: true, force: true });
writeFileSync(path.join(shotsDir, 'measure.json'), `${JSON.stringify(results, null, 2)}\n`, 'utf8');
console.log(`\n共 ${results.length} 张，量测写入 shots/measure.json`);

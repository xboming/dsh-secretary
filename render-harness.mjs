/**
 * 渲染验收页生成器：用**真实的 client.js + 真实 CSS** 生成静态 HTML，
 * 供无头 Chrome 在多种容器宽高与深浅主题下截图。
 *
 *   node render-harness.mjs
 *
 * 页面完全自包含（不连宿主、不读生产数据），主题变量用 DSH 的
 * --dsw-alias-* 令牌名给两套取值，与宿主主题机制一致。
 * 截图由 shots.mjs 调用 Chrome 完成。
 */

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const source = readFileSync(path.join(here, 'client.js'), 'utf8');

/* 取出真实的 CSS 与 MESSAGES：直接执行模块，避免复制粘贴产生第二份真相 */
const styleSink = { css: '' };
const sandbox = {
  window: { __ModuleLoader__: { load(def) { sandbox.__def = def; } }, addEventListener() {}, removeEventListener() {} },
  document: {
    createElement: () => ({
      setAttribute() {},
      remove() {},
      set textContent(value) {
        styleSink.css += value;
      },
    }),
    head: { appendChild() {} },
    documentElement: { style: { setProperty() {} } },
  },
  setInterval: () => 0,
  clearInterval: () => {},
  fetch: async () => ({ ok: true, json: async () => ({}) }),
};
sandbox.require = (name) => {
  if (name === 'react') return { createElement: () => null, Fragment: 'Fragment', useState: (v) => [v, () => {}], useRef: () => ({ current: null }), useMemo: (fn) => fn(), useCallback: (fn) => fn(), useEffect: () => {} };
  throw new Error(name);
};
vm.createContext(sandbox);
vm.runInContext(source, sandbox);

const dicts = {};
sandbox.__def.factory(sandbox.require).apply({
  effect: (fn) => fn(),
  locale: {
    register(ns, locale, dict) { dicts[locale] = dict; return () => {}; },
    bind() { return (key) => dicts.zh[key] ?? key; },
  },
  slots: { inject() {}, register() { return {}; } },
});

const CSS = styleSink.css;
const zh = dicts.zh;
const fill = (template, a, b) => {
  const args = [a, b];
  let index = 0;
  return String(template).replace(/\{[a-z]+\}/g, () => String(args[index++] ?? ''));
};

/* ---------------- 两套主题：真实 DSH 令牌名，深浅各一组取值 ---------------- */
const THEMES = {
  dark: {
    '--dsw-alias-bg-base': '#141b1a',
    '--dsw-alias-bg-layer-1': '#1b2422',
    '--dsw-alias-bg-layer-2': '#222d2b',
    '--dsw-alias-bg-overlay': '#26312f',
    '--dsw-alias-border-l1': '#2f3d3a',
    '--dsw-alias-border-l2': '#405250',
    '--dsw-alias-brand-primary': '#4fd1c5',
    '--dsw-alias-label-primary': '#e6f4f1',
    '--dsw-alias-label-secondary': '#93a8a4',
    '--dsw-alias-state-error-primary': '#f87171',
    '--dsw-alias-state-warn-primary': '#fbbf24',
    '--dsw-alias-state-success-primary': '#34d399',
    '--dsw-alias-state-idle-primary': '#6b7f7b',
  },
  light: {
    '--dsw-alias-bg-base': '#ffffff',
    '--dsw-alias-bg-layer-1': '#f7faf9',
    '--dsw-alias-bg-layer-2': '#eef4f2',
    '--dsw-alias-bg-overlay': '#ffffff',
    '--dsw-alias-border-l1': '#dbe5e2',
    '--dsw-alias-border-l2': '#c2d2ce',
    '--dsw-alias-brand-primary': '#0f766e',
    '--dsw-alias-label-primary': '#12211e',
    '--dsw-alias-label-secondary': '#5b6f6b',
    '--dsw-alias-state-error-primary': '#b91c1c',
    '--dsw-alias-state-warn-primary': '#a16207',
    '--dsw-alias-state-success-primary': '#047857',
    '--dsw-alias-state-idle-primary': '#94a3b8',
  },
};

/* ------------------------------- 模拟数据 ------------------------------- */
function item(over) {
  return {
    domain: 'work',
    domainName: '工作',
    shape: 'task',
    kind: 'open',
    status: 'todo',
    stage: null,
    deadline: null,
    due: null,
    workingDays: null,
    stallDays: 0,
    dormantDays: null,
    reason: null,
    progress: 0,
    next: null,
    tags: [],
    created: '2026-10-20',
    updated: '2026-10-26',
    completedAt: null,
    promotedTo: null,
    promotedAt: null,
    excerpt: '',
    timeline: [],
    notes: [],
    categories: [],
    ...over,
  };
}

const ROWS = [
  item({
    id: 'W-2026-001',
    title: '整理季度预算表并与财务核对明细',
    deadline: '2026-10-26',
    due: { days: -2, level: 'overdue' },
    workingDays: -2,
    stallDays: 3,
    reason: 'overdue',
    progress: 40,
    excerpt: '先把这个季度的差旅和采购拉齐，再找财务对一次口径。',
    categories: ['财务'],
  }),
  item({
    id: 'W-2026-002',
    title: '下周一的客户评审会材料',
    deadline: '2026-10-28',
    due: { days: 0, level: 'today' },
    workingDays: 0,
    stallDays: 1,
    reason: 'today',
    progress: 60,
    excerpt: 'PPT 还差最后两页，数据部分已经确认过了。',
    categories: ['会议'],
  }),
  item({
    id: 'W-2026-003',
    title: '把开发环境的数据库连接池参数调一遍并压测验证',
    deadline: '2026-10-30',
    due: { days: 2, level: 'soon' },
    workingDays: 2,
    stallDays: 1,
    reason: 'soon',
    progress: 10,
    excerpt: '压测脚本已经写好，等有空跑一遍。',
    categories: ['研发'],
  }),
  item({
    id: 'W-2026-004',
    title: '季度复盘会议纪要归档',
    deadline: '2026-11-06',
    due: { days: 7, level: 'normal' },
    workingDays: 7,
    stallDays: 12,
    reason: 'stall',
    progress: 0,
    excerpt: '纪要写完了，还没放进归档目录。',
    categories: ['文档'],
  }),
  item({
    id: 'C-2026-001',
    domain: 'creation',
    domainName: '创作',
    shape: 'project',
    title: '长篇小说第一章：把开场的雨改成雪',
    stage: 'drafting',
    deadline: '2026-11-20',
    stallDays: 6,
    reason: null,
    progress: 30,
    excerpt: '改完雪之后整段节奏都要重新调一遍。',
    categories: ['写作'],
  }),
  item({
    id: 'C-2026-002',
    domain: 'creation',
    domainName: '创作',
    shape: 'project',
    title: '播客第二期：访谈提纲',
    stage: 'revising',
    deadline: null,
    stallDays: 0,
    reason: null,
    progress: 75,
    excerpt: '提纲基本定了，还差嘉宾背景那一段。',
    categories: ['播客'],
  }),
  item({
    id: 'W-2026-005',
    title: '已完成的事项排在这里',
    kind: 'done',
    status: 'done',
    deadline: '2026-10-20',
    completedAt: '2026-10-20 17:30',
    progress: 100,
    excerpt: '收尾完成。',
    categories: ['沟通'],
  }),
];

/** 按真实比例把数据列渲染成静态 HTML（面板内部结构、类名、ARIA 与组件一致） */
function renderMain() {
  const chips = (row) => {
    if (row.kind === 'done') return { text: zh['status.done'], kind: 'info' };
    if (row.reason === 'overdue') return { text: fill(zh['status.overdue'], Math.abs(row.workingDays)), kind: 'danger' };
    if (row.reason === 'today') return { text: zh['status.today'], kind: 'today' };
    if (row.reason === 'soon') return { text: fill(zh['status.soon'], row.workingDays), kind: 'warn' };
    if (row.reason === 'stall') return { text: fill(zh['status.stale'], row.stallDays), kind: 'warn' };
    if (row.stallDays > 0) return { text: fill(zh['status.idleDays'], row.stallDays), kind: 'plain' };
    return null;
  };
  const rowHtml = (row) => {
    const chip = chips(row);
    return `
    <article class="sct-task" data-done="${row.kind === 'done'}">
      <button class="sct-check" type="button" data-shape="${row.domain === 'idea' ? 'idea' : 'task'}" data-done="${row.kind === 'done'}" aria-pressed="${row.kind === 'done'}" aria-label="${row.title}">${row.kind === 'done' ? '✓' : ''}</button>
      <div class="sct-task-body">
        <button class="sct-task-title" type="button">${row.title}</button>
        <div class="sct-task-meta">
          <span>${row.domainName}</span><span>·</span>
          <span>${row.deadline ? fill(zh['deadline.due'], row.deadline.slice(5).replace('-', ' / ')) : zh['deadline.none']}</span>
          ${chip ? `<span class="sct-status" data-kind="${chip.kind}">${chip.text}</span>` : ''}
        </div>
        ${row.excerpt ? `<p class="sct-task-note">${row.excerpt}</p>` : ''}
      </div>
      <div class="sct-task-actions">
        <button class="ghost" type="button">${zh['action.view']}</button>
        ${row.kind === 'done' ? '' : `<button class="ghost" type="button">${zh['action.reschedule']}</button>`}
      </div>
    </article>`;
  };

  const pending = ROWS.filter((row) => row.reason && row.kind !== 'done');
  const idle = ROWS.filter((row) => row.kind !== 'done' && !row.reason);
  const group = (label, rows) => `
    <div class="sct-section-label"><span>${label}</span><span>${fill(zh['group.count'], rows.length)}</span></div>
    <div class="sct-tasks">${rows.map(rowHtml).join('')}</div>`;

  return `
  <main class="sct-main" id="main-col">
    <div class="sct-main-head">
      <form class="sct-capture" onsubmit="return false">
        <select aria-label="${zh['quick.domainLabel']}"><option>工作</option><option>创作</option><option>灵感</option></select>
        <input aria-label="${zh['quick.contentLabel']}" placeholder="${zh['quick.placeholder']}" value="" />
        <button class="primary sct-primary-btn" type="submit">${zh['quick.save']}</button>
      </form>
      <div class="sct-tabs" role="tablist" aria-label="${zh['tab.list']}">
        <button type="button" role="tab" id="sct-tab-pending" class="sct-tab" aria-selected="true" aria-controls="sct-tabpanel" tabindex="0">${zh['tab.pending']}<span class="sct-count">${pending.length}</span></button>
        <button type="button" role="tab" id="sct-tab-all" class="sct-tab" aria-selected="false" aria-controls="sct-tabpanel" tabindex="-1">${zh['tab.all']}<span class="sct-count">${ROWS.length}</span></button>
      </div>
      <div class="sct-filter" role="group" aria-label="${zh['filter.label']}">
        <button type="button" aria-pressed="true">${zh['filter.user']}</button>
        <button type="button" aria-pressed="false">工作</button>
        <button type="button" aria-pressed="false">创作</button>
        <button type="button" aria-pressed="false">灵感</button>
      </div>
      <div class="sct-toolbar">
        <div class="sct-search">
          <svg viewBox="0 0 24 24" aria-hidden="true" class="sct-search-icon"><circle cx="11" cy="11" r="6.5"/><path d="m16 16 4.5 4.5"/></svg>
          <input type="search" placeholder="${zh['search.placeholder']}" aria-label="${zh['search.label']}" value="" />
        </div>
        <select class="sct-sort" aria-label="${zh['sort.label']}"><option>${zh['sort.default']}</option><option>${zh['sort.due']}</option></select>
      </div>
    </div>
    <div class="sct-list-scroll" id="sct-tabpanel" role="tabpanel" tabindex="-1" aria-labelledby="sct-tab-pending">
      ${group(zh['group.priority'], pending.filter((r) => r.reason === 'overdue'))}
      ${group(zh['group.dueToday'], pending.filter((r) => r.reason === 'today'))}
      ${group(zh['group.soon'], pending.filter((r) => r.reason === 'soon'))}
      ${group(zh['group.revisit'], pending.filter((r) => r.reason === 'stall'))}
      ${group(zh['group.idle'], idle)}
      <footer class="sct-list-end"><span>${zh['footer.note']}</span><span>${zh['footer.poll']}</span></footer>
    </div>
  </main>`;
}

function renderAside() {
  const agenda = ROWS.filter((row) => row.kind !== 'done' && row.deadline)
    .sort((a, b) => String(a.deadline).localeCompare(String(b.deadline)))
    .slice(0, 3);
  const agendaHtml = agenda
    .map((row) => {
      const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(row.deadline);
      const detail = row.reason === 'overdue' ? fill(zh['status.overdue'], Math.abs(row.workingDays)) : fill(zh['deadline.due'], row.deadline.slice(5));
      return `<div class="sct-agenda-item">
        <div class="sct-agenda-date"><b>${m[3]}</b><span>${Number(m[2])}月</span></div>
        <div class="sct-agenda-body"><div class="sct-agenda-title">${row.title}</div><small>${row.domainName} · ${detail}</small></div>
      </div>`;
    })
    .join('');

  // 2026-10 的月历（10-01 是周四）
  const cells = [];
  for (let i = 0; i < 3; i += 1) cells.push('<span></span>');
  for (let day = 1; day <= 31; day += 1) {
    const key = `2026-10-${String(day).padStart(2, '0')}`;
    const rest = [3, 4, 10, 11, 17, 18, 24, 25, 31].includes(day);
    cells.push(
      `<span class="sct-d" data-today="${key === '2026-10-28'}" data-rest="${rest}" data-due="${day === 26 || day === 28}">${day}</span>`,
    );
  }
  const week = ['一', '二', '三', '四', '五', '六', '日'].map((w) => `<span class="sct-w">${w}</span>`).join('');

  return `
  <aside class="sct-aside">
    <section class="sct-side-block">
      <div class="sct-side-title"><h2>${zh['aside.agenda']}</h2><span class="small muted">${zh['aside.agendaSub']}</span></div>
      <div class="sct-agenda">${agendaHtml}</div>
    </section>
    <section class="sct-side-block">
      <div class="sct-side-title"><h2>${zh['aside.reminders']}</h2></div>
      <div class="sct-side-line"><span class="muted">${zh['aside.remindTime']}</span><span>12:00</span></div>
      <div class="sct-conn" data-state="bound"><i></i><span>${zh['conn.reminderTo']}</span><b class="sct-conn-target">…b979</b></div>
      <div class="sct-conn" data-state="bound"><i></i><span>${zh['conn.reportTo']}</span><b class="sct-conn-target">…b979</b></div>
      <div class="sct-side-line"><span class="muted">${zh['aside.reportSchedule']}</span><span>20:00</span></div>
      <ul class="sct-report-list">
        <li>${fill(zh['aside.reportMonthly'], '20:00')}</li>
        <li>${fill(zh['aside.reportQuarterly'], '20:00')}</li>
        <li>${fill(zh['aside.reportHalf'], '20:00')}</li>
        <li>${fill(zh['aside.reportYearly'], '20:00')}</li>
      </ul>
      <p class="sct-side-note">${zh['aside.reportNote']}</p>
    </section>
    <section class="sct-side-block">
      <div class="sct-cal-head"><h2>2026 年 10 月</h2></div>
      <div class="sct-cal">${week}${cells.join('')}</div>
    </section>
  </aside>`;
}

const MAIN_PANEL = `<div class="sct-root">
  <header class="sct-topbar">
    <div class="sct-brand">
      <svg class="sct-brandmark" width="38" height="38" viewBox="0 0 40 40" aria-hidden="true"><path d="m20 4 1.8 5.3L27 11l-5.2 1.8L20 18l-1.8-5.2L13 11l5.2-1.7Z"/><path d="M5 23c5-7 10 7 15 0s10 7 15 0M5 29c5-7 10 7 15 0s10 7 15 0"/></svg>
      <div><strong>${zh['brand.name']}</strong><p>${zh['brand.sub']}</p></div>
    </div>
    <div class="sct-top-actions">
      <span class="sct-sync" role="status">${fill(zh['footer.updatedAt'], '21:30')}</span>
      <button class="ghost" type="button">${zh['action.refresh']}</button>
      <button class="ghost" type="button">${zh['action.settings']}</button>
    </div>
  </header>
  <div class="sct-scroll">
    <div class="sct-shell">
      <section class="sct-hero">
        <div>
          <div class="sct-eyebrow">2026 年 10 月 28 日 · 星期三</div>
          <h1>${zh['hero.attention']}</h1>
          <p class="sct-summary">${fill(zh['hero.attentionSub'], 4)}</p>
        </div>
        <span class="sct-hero-side">知微 / 今日</span>
      </section>
      <div class="sct-layout">${renderMain()}${renderAside()}</div>
    </div>
  </div>
</div>`;

/**
 * 详情弹层（打开状态）。
 *
 * 必须渲染在 `.sct-root` **内部**——组件里 drawers 就是 root 的子节点，
 * `--zw-*` 语义令牌都在 .sct-root 上定义。放到 root 外面会让弹层读不到
 * 变量、背景变透明（生成验收页时踩过一次，说明"变量挂在哪"确实要紧）。
 * `<dialog open>` 复刻 showModal 的定位与遮罩。
 */
const LONG_TIMELINE = Array.from({ length: 14 }, (_, index) => {
  const day = String(28 - index).padStart(2, '0');
  return `<div class="sct-tl-item"><b>2026-10-${day} 21:0${index % 10} 进展</b>${
    index % 3 === 0 ? '<blockquote>今天把剩下的差异都对了一遍，还差供应商那张发票没到，明天上午再去催一次。</blockquote>' : ''
  }</div>`;
}).join('');

const DRAWER = `<dialog open class="sct-drawer" role="dialog" aria-label="整理季度预算表并与财务核对明细">
  <div class="sct-drawer-head">
    <div style="display:flex;justify-content:space-between;align-items:center;gap:12px">
      <span class="small muted">工作 · W-2026-001</span>
      <button class="ghost" type="button">${zh['action.close']}</button>
    </div>
    <h2>整理季度预算表并与财务核对明细</h2>
    <div class="sct-task-meta">
      <span>${fill(zh['deadline.due'], '2026-10-26')}</span>
      <span class="sct-status" data-kind="today">${zh['detail.open']}</span>
      <span>40%</span>
    </div>
    <div class="sct-edit-entry"><button class="ghost" type="button">${zh['action.edit']}</button></div>
  </div>
  <div class="sct-drawer-body">
    <section><h3>${zh['detail.next']}</h3><p class="muted">把差旅与采购两张表的口径对齐，再找财务确认一次。</p></section>
    <section><h3>${zh['detail.timeline']}</h3><div class="sct-tl">${LONG_TIMELINE}</div></section>
    <section><h3>${zh['detail.notes']}</h3><p class="muted small">- 财务这周在结账，最好周三前找她。</p></section>
  </div>
  <div class="sct-drawer-foot">
    <footer style="display:flex;justify-content:flex-end;gap:8px">
      <button type="button">${zh['detail.modifyDeadline']}</button>
      <button class="primary" type="button">${zh['detail.markDone']}</button>
    </footer>
  </div>
</dialog>`;

/** 带弹层的页面：弹层嵌在 .sct-root 里，与组件结构一致 */
const PANEL_WITH_DRAWER = MAIN_PANEL.replace(/<\/div>\s*$/, `${DRAWER}</div>`);

/* ------------------------------ 生成页面 ------------------------------ */
const SIZES = [
  { name: '1440x900', width: 1440, height: 900 },
  { name: '1024x768', width: 1024, height: 768 },
  { name: '860x900', width: 860, height: 900 },
  { name: '768x600', width: 768, height: 600 },
  { name: '560x760', width: 560, height: 760 },
  { name: '390x844', width: 390, height: 844 },
  { name: '320x740', width: 320, height: 740 },
  { name: '800x900', width: 800, height: 900 },
];

const outDir = path.join(here, 'shots');
mkdirSync(outDir, { recursive: true });

/**
 * 复刻 Panel 里的 ResizeObserver：把数据列的真实几何写进 :root。
 *
 * 生产环境里这两步由 client.js 的 ResizeObserver 完成（弹层必须与数据列等宽左对齐）。
 * 静态验收页没有 React，就必须自己补上，否则弹层只能用 CSS 的兜底值，
 * 量出来的宽度不代表真实行为。
 */
const MEASURE_TOKEN_SCRIPT = `<script>
(function () {
  function apply() {
    var main = document.querySelector('#main-col');
    if (!main) return;
    var rect = main.getBoundingClientRect();
    var root = document.documentElement;
    if (rect.width > 0) root.style.setProperty('--zw-data-w', Math.round(rect.width) + 'px');
    root.style.setProperty('--zw-data-x', Math.round(rect.left) + 'px');
  }
  apply();
  window.addEventListener('resize', apply);
  window.addEventListener('load', apply);
})();
</script>`;

function page(tokens, themeName, width, height, body, innerWidth, innerHeight) {
  const inner = innerWidth
    ? `<div id="viewport" style="width:${innerWidth}px;height:${innerHeight}px;overflow:hidden;border:1px dashed ${themeName === 'dark' ? '#3c4b48' : '#c9d6d3'};margin:8px">${body}</div>`
    : `<div id="viewport" style="width:${width}px;height:${height}px;overflow:hidden">${body}</div>`;
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8" />
<title>知微观澜 · ${themeName} · ${width}x${height}</title>
<style>
:root{${tokens}color-scheme:${themeName};}
html,body{margin:0;padding:0;height:100%;background:var(--dsw-alias-bg-base);overflow:hidden;font-family:"Segoe UI","Microsoft YaHei UI","PingFang SC",sans-serif}
#viewport{background:var(--dsw-alias-bg-base)}
.sct-root{height:100%}
${CSS}
</style>
</head>
<body>${inner}${MEASURE_TOKEN_SCRIPT}</body>
</html>`;
}

for (const themeName of Object.keys(THEMES)) {
  const tokens = Object.entries(THEMES[themeName])
    .map(([key, value]) => `${key}:${value};`)
    .join('\n');
  for (const size of SIZES) {
    writeFileSync(path.join(outDir, `${themeName}-${size.name}.html`), page(tokens, themeName, size.width, size.height, MAIN_PANEL), 'utf8');
  }
  /**
   * 关键回归：**窗口 1440，插件容器只有 800**。
   * 宿主侧栏展开、面板拖动缩放、右侧栏打开时就是这种情形。
   * 断点若按窗口算，这里会硬撑双栏、把主列挤到 444px（审查报告实测）；
   * 按容器算则提前切单栏，主列 737px。
   */
  for (const [innerW, innerH] of [
    [800, 900],
    [560, 760],
  ]) {
    writeFileSync(
      path.join(outDir, `${themeName}-window1440-container${innerW}.html`),
      page(tokens, themeName, 1440, 900, MAIN_PANEL, innerW, innerH),
      'utf8',
    );
  }
  // 弹层：宽容器与窄容器各一张，验证长正文滚动、头尾固定、底部按钮可达
  for (const size of [
    { name: 'drawer1440', width: 1440, height: 900 },
    { name: 'drawer390', width: 390, height: 760 },
  ]) {
    writeFileSync(
      path.join(outDir, `${themeName}-${size.name}.html`),
      page(tokens, themeName, size.width, size.height, PANEL_WITH_DRAWER),
      'utf8',
    );
  }
}

writeFileSync(
  path.join(outDir, 'index.json'),
  `${JSON.stringify(
    {
      themes: Object.keys(THEMES),
      sizes: SIZES,
      nested: [
        { name: 'window1440-container800', windowWidth: 1440, windowHeight: 900, width: 800, height: 900 },
        { name: 'window1440-container560', windowWidth: 1440, windowHeight: 900, width: 560, height: 760 },
      ],
      drawers: [
        { name: 'drawer1440', width: 1440, height: 900 },
        { name: 'drawer390', width: 390, height: 760 },
      ],
    },
    null,
    2,
  )}\n`,
  'utf8',
);

console.log(`已生成验收页面到 ${outDir}`);

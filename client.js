window.__ModuleLoader__.load({
  id: 'dsh-secretary',
  factory(require) {
    const React = require('react');
    const h = React.createElement;
    const { useCallback, useEffect, useMemo, useRef, useState } = React;

    const NS = 'dsh-secretary';
    const API = '/dsh-secretary/api';

    const NAMES = { work: '工作', creation: '创作', idea: '灵感', assistant: '助手' };

    const TOKEN_CSS = `
.sct-root{
  --zw-surface:var(--dsw-alias-bg-layer-1);
  --zw-raised:var(--dsw-alias-bg-layer-2);
  --zw-hover:color-mix(in srgb,var(--dsw-alias-label-primary) 5%,transparent);
  --zw-line:var(--dsw-alias-border-l1);
  --zw-line-strong:var(--dsw-alias-border-l2);
  --zw-text:var(--dsw-alias-label-primary);
  --zw-muted:var(--dsw-alias-label-secondary);
  --zw-accent:var(--dsw-alias-brand-primary);
  --zw-accent-text:var(--dsw-alias-bg-base);
  --zw-accent-soft:color-mix(in srgb,var(--dsw-alias-brand-primary) 14%,var(--dsw-alias-bg-layer-1));
  --zw-danger:var(--dsw-alias-state-error-primary);
  --zw-danger-soft:color-mix(in srgb,var(--dsw-alias-state-error-primary) 13%,var(--dsw-alias-bg-layer-1));
  --zw-warning:var(--dsw-alias-state-warn-primary);
  --zw-warn-soft:color-mix(in srgb,var(--dsw-alias-state-warn-primary) 13%,var(--dsw-alias-bg-layer-1));
  --zw-success:var(--dsw-alias-state-success-primary);
  --zw-focus:var(--dsw-alias-brand-primary);
  /* ---- 状态文字在柔和底色上的强化版本（6.2 对比度） ----
     柔和底色（*-soft）会抬高背景亮度，纯品牌/警告色压在其上达不到 4.5:1
     （浅色主题实测：今日到期 4.30、临期 3.97）。把状态色向**主文字色**混一档：
     浅色主题的主文字近黑 → 状态色变深；深色主题的主文字近白 → 状态色变浅。
     同一个公式在两套主题下都提高对比度，不必写两套色值，也不靠硬编码 hex。 */
  --zw-accent-on-soft:color-mix(in srgb,var(--dsw-alias-brand-primary) 74%,var(--dsw-alias-label-primary));
  --zw-warning-on-soft:color-mix(in srgb,var(--dsw-alias-state-warn-primary) 74%,var(--dsw-alias-label-primary));
  --zw-danger-on-soft:color-mix(in srgb,var(--dsw-alias-state-error-primary) 74%,var(--dsw-alias-label-primary));
  --zw-font:"Segoe UI","Microsoft YaHei UI","PingFang SC",sans-serif;
}
`;

    const CSS = `
/* .sct-root 同时是**布局容器**：容器查询按插件真实可用宽度判定，
   而不是按浏览器窗口。宿主侧栏展开、面板拖动缩放、右侧栏打开时，
   窗口可能仍很宽，但插件只有 800px —— 断点必须跟着容器走（U02）。 */
.sct-root{display:flex;flex-direction:column;height:100%;min-height:0;background:var(--dsw-alias-bg-base);color:var(--zw-text);font:14px/1.6 var(--zw-font);container-type:inline-size;container-name:sct}
.sct-root *{box-sizing:border-box}
/* 基础控件规则用 :where() 把优先级压到 0（U04）。
   原来 .sct-root button（0,1,1）压过了 .sct-task-title（0,1,0），
   标题因此长出边框和 7px/13px 内边距、完成按钮被撑成矩形。
   现在基础规则 0,1,0，专用组件用 .sct-root .sct-x（0,2,0）稳定覆盖，
   不需要任何 !important。 */
.sct-root :where(button){font:inherit;cursor:pointer;color:inherit;background:var(--zw-surface);border:1px solid var(--zw-line);border-radius:6px;min-height:36px;padding:7px 13px;transition:background .13s,border-color .13s}
.sct-root :where(button:hover){background:var(--zw-hover)}
.sct-root :where(button:disabled){opacity:.45;cursor:not-allowed}
.sct-root .primary{background:var(--zw-accent);border-color:transparent;color:var(--zw-accent-text);font-weight:600}
.sct-root .primary:hover{filter:brightness(1.06)}
.sct-root .ghost{background:transparent;border-color:transparent;color:var(--zw-muted)}
.sct-root .ghost:hover{color:var(--zw-text);background:var(--zw-hover)}
.sct-root input,.sct-root select,.sct-root textarea{font:inherit;color:inherit;background:var(--zw-surface);border:1px solid var(--zw-line);border-radius:6px;padding:8px 12px;max-width:100%}
/* 原生日期/时间控件跟随宿主主题，避免深色页面里蹦出浅色控件（6.2） */
.sct-root input[type="date"],.sct-root input[type="time"]{color-scheme:light dark}
.sct-root :where(button:focus-visible),.sct-root input:focus-visible,.sct-root select:focus-visible,.sct-root textarea:focus-visible{outline:2px solid var(--zw-focus);outline-offset:3px}
.sct-root svg{width:20px;height:20px;fill:none;stroke:currentColor;stroke-width:1.6;stroke-linecap:round;stroke-linejoin:round;flex-shrink:0}
.sct-root h1,.sct-root h2,.sct-root h3,.sct-root p{margin:0}
.sct-root .muted{color:var(--zw-muted)}
.sct-root .small{font-size:12px;line-height:1.5}
.sct-topbar{display:flex;align-items:center;justify-content:space-between;gap:16px;min-height:88px;padding:10px 24px;border-bottom:1px solid var(--zw-line);max-width:var(--zw-shell-max,1248px);margin:0 auto;width:100%;flex:none;flex-wrap:wrap}
.sct-brand{display:flex;align-items:center;gap:12px}
.sct-brandmark{width:38px;height:38px;color:var(--zw-accent)}
.sct-brand strong{display:block;font-size:18px;font-weight:600;letter-spacing:1px}
.sct-brand p{margin:0;color:var(--zw-muted);font-size:12px}
.sct-top-actions{display:flex;align-items:center;gap:8px}
.sct-community{display:inline-flex;align-items:center;gap:5px;min-height:36px;padding:7px 12px;border:1px solid var(--zw-line);border-radius:6px;background:var(--zw-surface);color:var(--zw-text);font-size:13px;text-decoration:none;transition:background .13s,border-color .13s,color .13s}
.sct-community:hover{background:var(--zw-hover);border-color:var(--zw-line-strong);color:var(--zw-accent)}
.sct-community:focus-visible{outline:2px solid var(--zw-focus);outline-offset:3px}
.sct-community-arrow{font-size:11px;color:var(--zw-muted);line-height:1}
.sct-community:hover .sct-community-arrow{color:var(--zw-accent)}
.sct-sync{font-size:12px;color:var(--zw-muted);white-space:nowrap}
.sct-scroll{flex:1;min-height:0;overflow:hidden;display:flex;flex-direction:column}
/* ---- 宽度令牌：数据列宽度与弹层共用同一来源，避免两处各写一套数字 ----
   必须挂在 :root 上：弹层(dialog)是 body 的子节点，不在 .sct-root 内部，
   若只定义在 .sct-root 上，弹层读不到这个变量。
   --zw-data-w / --zw-data-x 由 Panel 里的 ResizeObserver 实时写入真实几何，
   所以这里的初值只在 JS 还没跑起来的第一帧起作用。 */
:root{
  --zw-shell-max:1248px;   /* 内容区最大宽度 */
  --zw-shell-pad:24px;     /* 内容区左右内边距 */
  --zw-aside-w:272px;      /* 右栏宽度 */
  --zw-layout-gap:36px;    /* 主列与右栏间距 */
  /* 数据列(主列)宽度 = 内容区 - 左右内边距 - 右栏 - 间距。弹层与它严格等宽。 */
  --zw-data-w:calc(var(--zw-shell-max) - var(--zw-shell-pad) * 2 - var(--zw-aside-w) - var(--zw-layout-gap));
}
.sct-shell{max-width:var(--zw-shell-max);margin:0 auto;padding:0 var(--zw-shell-pad);width:100%;flex:1;min-height:0;display:flex;flex-direction:column;min-width:0}
.sct-hero{display:flex;align-items:flex-end;justify-content:space-between;gap:16px;padding:36px 0 28px;flex:none}
.sct-eyebrow{font-size:12px;color:var(--zw-muted);letter-spacing:.4px;margin-bottom:10px}
.sct-hero h1{font-size:30px;line-height:1.35;font-weight:600;letter-spacing:-.6px;overflow-wrap:anywhere}
.sct-summary{margin-top:8px;color:var(--zw-muted);font-size:14px;overflow-wrap:anywhere}
.sct-hero-side{font-size:12px;color:var(--zw-muted);white-space:nowrap}
.sct-layout{display:grid;grid-template-columns:minmax(0,1fr) var(--zw-aside-w);gap:var(--zw-layout-gap);align-items:stretch;flex:1;min-height:0;min-width:0}
.sct-main{display:flex;flex-direction:column;min-height:0;min-width:0;overflow:hidden}
.sct-main-head{flex:none;display:flex;flex-direction:column;min-width:0}
.sct-list-scroll{flex:1;min-height:0;overflow-y:auto;overflow-x:hidden;overscroll-behavior:contain;padding-bottom:32px;scrollbar-gutter:stable}
.sct-aside{display:flex;flex-direction:column;gap:24px;min-height:0;min-width:0;overflow-y:auto;padding-bottom:32px;scrollbar-gutter:stable}
.sct-capture{display:flex;gap:8px;align-items:center;flex-wrap:wrap;background:var(--zw-surface);border:1px solid var(--zw-line);border-radius:10px;padding:10px;margin-bottom:26px}
.sct-capture:focus-within{border-color:var(--zw-accent)}
.sct-capture select{border-color:transparent;background:transparent;font-weight:600;min-height:36px;max-width:120px}
.sct-capture input{flex:1;min-width:160px;border-color:transparent;background:transparent;min-height:36px}
.sct-capture input:focus{background:var(--zw-raised)}
.sct-primary-btn{min-width:76px}
.sct-capture-error{flex-basis:100%;padding:8px 12px;border-radius:6px;background:var(--zw-danger-soft);color:var(--zw-danger);font-size:12.5px}
.sct-capture-confirm{flex-basis:100%;display:flex;flex-wrap:wrap;gap:8px;align-items:center;padding-top:8px;border-top:1px solid var(--zw-line)}
.sct-capture-confirm label{margin:0;font-size:12.5px;color:var(--zw-muted)}
.sct-checkline{display:flex;align-items:center;gap:8px;font-size:13px}
.sct-checkline input{width:auto;padding:0}
.sct-notch{flex-basis:100%;background:var(--zw-raised);border-radius:6px;padding:10px 12px;font-size:12.5px;color:var(--zw-muted);overflow-wrap:anywhere}
.sct-tabs{display:flex;gap:20px;border-bottom:1px solid var(--zw-line);margin-bottom:14px;overflow-x:auto;scrollbar-width:thin}
/* 页签：样式挂在 .sct-tab 上（U05）。原来只给了 role="tab" 却没给 class，
   选中下划线选择器 .sct-tab[aria-selected="true"]::after 永远命不中，
   于是当前页签在视觉上和未选中的一模一样。 */
.sct-root .sct-tab{position:relative;display:inline-flex;align-items:center;gap:2px;flex:none;height:44px;padding:0 2px;border:0;border-bottom:2px solid transparent;border-radius:0;background:transparent;color:var(--zw-muted);font-size:15px;font-weight:500;transition:color .13s,border-color .13s}
.sct-root .sct-tab:hover{background:transparent;color:var(--zw-text)}
.sct-root .sct-tab[aria-selected="true"]{color:var(--zw-text);font-weight:600;border-bottom-color:var(--zw-accent)}
.sct-root .sct-tab[aria-selected="true"] .sct-count{color:var(--zw-accent);font-weight:600}
.sct-count{font-size:12px;color:var(--zw-muted);margin-left:5px;font-weight:400;font-variant-numeric:tabular-nums}
.sct-filter{display:flex;flex-wrap:wrap;gap:3px;margin-bottom:6px}
.sct-root .sct-filter button{min-height:34px;padding:5px 11px;font-size:13px;background:transparent;border:1px solid transparent;color:var(--zw-muted)}
.sct-root .sct-filter button:hover{color:var(--zw-text);background:var(--zw-hover)}
/* 选中态不只靠颜色：加粗 + 边框，深浅主题都一眼可分（6.2） */
.sct-root .sct-filter button[aria-pressed="true"]{background:var(--zw-accent-soft);border-color:var(--zw-accent);color:var(--zw-text);font-weight:600}
.sct-section-label{display:flex;justify-content:space-between;align-items:baseline;gap:8px;margin:20px 0 10px;font-size:12px;color:var(--zw-muted);letter-spacing:.3px}
.sct-section-label:first-of-type{margin-top:8px}
.sct-tasks{display:flex;flex-direction:column;gap:10px}
/* 专用控件统一用 .sct-root .sct-x（0,2,0）压过基础规则（0,1,0）——U04。
   完成控件必须是 24×24 的圆，标题必须是**看起来像文字**的入口：
   两者都要显式清掉基础规则的 background/border/padding/min-height。 */
.sct-root .sct-check{flex:none;display:inline-flex;align-items:center;justify-content:center;width:24px;height:24px;min-height:24px;padding:0;margin-top:2px;border-radius:50%;border:1px solid var(--zw-line-strong);background:transparent;color:var(--zw-muted);font-size:12px;line-height:1;position:relative;transition:border-color .13s,background .13s,color .13s}
/* 未完成的圆圈是**可点的控件边界**，必须达到 3:1（6.2）。
   用 muted 文字色做描边而不是 border-l2：后者在深色主题下只有 1.9:1。
   仍保持"未完成 = 弱"的心智，但看得见。 */
.sct-root .sct-check{border-color:var(--zw-muted)}
/* 视觉 24px，命中区 44px（透明扩展，符合触控要求且不撑开布局） */
.sct-root .sct-check::before{content:"";position:absolute;inset:-10px;border-radius:50%}
.sct-root .sct-check:hover{border-color:var(--zw-accent);color:var(--zw-accent);background:transparent}
.sct-root .sct-check[data-done="true"]{border-color:var(--zw-success);background:var(--zw-success);color:var(--zw-accent-text)}
.sct-root .sct-check[data-shape="idea"]{border-color:var(--zw-accent);color:var(--zw-accent)}
.sct-root .sct-check:focus-visible{outline:2px solid var(--zw-focus);outline-offset:3px}
.sct-root .sct-task-title{display:block;width:100%;background:none;border:0;padding:1px 2px;margin:-1px -2px;min-height:0;border-radius:4px;text-align:left;font-size:15px;font-weight:600;line-height:1.5;color:var(--zw-text);white-space:normal;overflow-wrap:anywhere}
.sct-root .sct-task-title:hover{background:var(--zw-hover);color:var(--zw-text)}
.sct-root .sct-task-title:focus-visible{outline:2px solid var(--zw-focus);outline-offset:2px}
.sct-task{display:flex;align-items:flex-start;gap:12px;background:var(--zw-surface);border:1px solid var(--zw-line);border-radius:12px;padding:14px 18px;transition:border-color .14s;min-width:0}
.sct-task:hover{border-color:var(--zw-line-strong)}
/* 已完成行不用整体降透明度：那会让文字掉到 4.5:1 以下（6.2）。
   改用弱化底色 + 标题删除线，主文字仍是 label-primary。 */
.sct-task[data-done="true"]{background:var(--zw-raised);border-color:var(--zw-line)}
.sct-task[data-done="true"] .sct-task-title{text-decoration:line-through;text-decoration-thickness:1px;text-decoration-color:var(--zw-muted)}
.sct-task-body{flex:1;min-width:0;display:flex;flex-direction:column;gap:5px}
.sct-task-meta{display:flex;flex-wrap:wrap;align-items:center;gap:4px 8px;font-size:12px;color:var(--zw-muted)}
.sct-status{display:inline-flex;align-items:center;padding:1px 8px;border-radius:999px;font-size:11.5px;font-weight:500}
/* 状态标签的文字用"柔和底专用"色，保证在 *-soft 底色上也 ≥4.5:1（6.2） */
.sct-status[data-kind="danger"]{background:var(--zw-danger-soft);color:var(--zw-danger-on-soft)}
/* 今日到期除颜色外还有文字与加粗，不依赖单一色彩表达（6.2） */
.sct-status[data-kind="today"]{background:var(--zw-accent-soft);color:var(--zw-accent-on-soft);font-weight:600}
.sct-status[data-kind="warn"]{background:var(--zw-warn-soft);color:var(--zw-warning-on-soft)}
.sct-status[data-kind="info"]{background:var(--zw-raised);color:var(--zw-muted)}
/* 中性"距上次更新"标签：只是陈述事实，不用警示色，避免被误读为异常（U06） */
.sct-status[data-kind="plain"]{background:transparent;color:var(--zw-muted);padding-left:0;font-weight:400}
.sct-task-note{font-size:13px;color:var(--zw-muted);overflow-wrap:anywhere}
.sct-task-actions{flex:none;display:flex;gap:2px;align-self:center}
.sct-task-actions button{min-height:30px;padding:3px 10px;font-size:12.5px}
.sct-empty{background:var(--zw-surface);border:1px solid var(--zw-line);border-radius:16px;padding:48px 24px;text-align:center}
.sct-symbol{width:40px;height:40px;margin:0 auto 14px;color:var(--zw-accent)}
.sct-empty h2{font-size:20px;font-weight:600;margin-bottom:8px}
.sct-empty p{color:var(--zw-muted);max-width:420px;margin:0 auto 18px}
.sct-skeleton{background:var(--zw-surface);border:1px solid var(--zw-line);border-radius:12px;padding:20px;display:flex;flex-direction:column;gap:12px;margin-bottom:10px}
.sct-skeleton i{display:block;height:14px;border-radius:7px;background:var(--zw-raised)}
.sct-skeleton i:nth-child(2){width:55%}
.sct-skeleton i:nth-child(3){width:38%}
.sct-list-end{display:flex;justify-content:space-between;gap:12px;margin-top:20px;font-size:12px;color:var(--zw-muted)}
.sct-side-block{padding-bottom:20px;border-bottom:1px solid var(--zw-line)}
.sct-side-block:last-child{border-bottom:0}
.sct-side-title{display:flex;justify-content:space-between;align-items:baseline;margin-bottom:14px}
.sct-side-title h2{font-size:16px;font-weight:600}
.sct-agenda{display:flex;flex-direction:column;gap:12px}
.sct-agenda-item{display:grid;grid-template-columns:40px minmax(0,1fr);gap:10px;align-items:start}
.sct-agenda-date{text-align:center}
.sct-agenda-date b{display:block;font-size:17px;font-weight:600;line-height:1.2;font-variant-numeric:tabular-nums}
.sct-agenda-date span{font-size:10.5px;color:var(--zw-muted)}
.sct-agenda-body{min-width:0}
.sct-agenda-title{font-size:13px;font-weight:500;line-height:1.45;overflow:hidden;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical}
.sct-agenda-item small{font-size:11px;color:var(--zw-muted)}
.sct-side-line{display:flex;justify-content:space-between;align-items:center;font-size:13px;padding:4px 0}
.sct-conn{display:flex;align-items:center;gap:6px;font-size:12px;color:var(--zw-muted);padding:4px 0}
.sct-conn i{width:7px;height:7px;border-radius:50%;background:var(--zw-success)}
.sct-conn[data-state="lost"] i{background:var(--zw-warning)}
.sct-conn[data-state="none"] i{background:var(--zw-muted)}
.sct-conn-target{font-weight:600;color:var(--zw-text)}
.sct-conn-note{margin:4px 0 2px;font-size:12px;line-height:1.6;color:var(--zw-muted)}
.sct-conn-warn{margin:6px 0 2px;font-size:12px;line-height:1.6;color:var(--zw-warning)}
.sct-side-note{font-size:12px;color:var(--zw-muted);margin-top:12px;line-height:1.7}
.sct-report-list{margin:6px 0 0;padding-left:16px;font-size:12px;line-height:1.7;color:var(--zw-muted)}
.sct-report-list li{list-style:disc}
.sct-cal-head{margin-bottom:12px}
.sct-cal-head h2{font-size:16px;font-weight:600}
.sct-toolbar{display:flex;gap:8px;align-items:center;margin:4px 0 10px;flex-wrap:wrap}
.sct-search{position:relative;flex:1;min-width:180px;display:flex;align-items:center}
.sct-search-icon{position:absolute;left:10px;width:15px;height:15px;color:var(--zw-muted);pointer-events:none;stroke-width:1.8}
.sct-search input{width:100%;padding-left:32px;padding-right:30px;min-height:34px;font-size:13px;background:var(--zw-surface);border-color:var(--zw-line)}
.sct-search input:focus{border-color:var(--zw-accent)}
.sct-search input::-webkit-search-cancel-button{display:none}
.sct-search-clear{position:absolute;right:4px;min-height:26px;width:26px;padding:0;border:0;background:transparent;color:var(--zw-muted);font-size:16px;line-height:1;border-radius:4px}
.sct-search-clear:hover{color:var(--zw-text);background:var(--zw-hover)}
.sct-sort{min-height:34px;font-size:12.5px;padding:4px 8px;background:var(--zw-surface);border-color:var(--zw-line);color:var(--zw-text)}
.sct-load-more{width:100%;margin-top:8px;font-size:12.5px;min-height:34px;color:var(--zw-accent);border-style:dashed}
.sct-load-more:hover{background:var(--zw-accent-soft)}
.sct-edit-entry{margin:6px 0 2px}
.sct-edit{background:var(--zw-raised);border-radius:8px;padding:14px;border-top:0 !important;margin-top:12px !important}
.sct-edit label{display:block;font-size:12px;color:var(--zw-muted);margin:10px 0 5px}
.sct-edit textarea{width:100%;font:inherit;font-size:13px;color:inherit;background:var(--zw-surface);border:1px solid var(--zw-line);border-radius:6px;padding:8px 10px;resize:vertical;min-height:64px}
.sct-edit input[type="text"]{width:100%;font:inherit;font-size:13px;color:inherit;background:var(--zw-surface);border:1px solid var(--zw-line);border-radius:6px;padding:8px 10px}
.sct-edit-actions{display:flex;justify-content:flex-end;gap:8px;margin-top:14px}
.sct-cal{display:grid;grid-template-columns:repeat(7,1fr);gap:2px;margin-top:12px}
.sct-cal .sct-w{font-size:10.5px;text-align:center;color:var(--zw-muted);padding-bottom:4px}
.sct-d{position:relative;aspect-ratio:1;display:flex;align-items:center;justify-content:center;font-size:11.5px;border-radius:6px;color:var(--zw-text)}
.sct-d[data-rest="true"]{color:var(--zw-muted)}
.sct-d[data-rest="true"]::after{content:"休";position:absolute;top:0;right:1px;font-size:8px;color:var(--zw-muted)}
.sct-d[data-makeup="true"]{border:1px dashed var(--zw-accent)}
.sct-d[data-makeup="true"]::after{content:"班";position:absolute;top:0;right:1px;font-size:8px;color:var(--zw-accent)}
.sct-d[data-today="true"]{background:var(--zw-accent);color:var(--zw-accent-text);font-weight:700}
.sct-d[data-due="true"]{box-shadow:inset 0 0 0 1.5px var(--zw-danger);color:var(--zw-danger)}
.sct-d[data-due="true"][data-today="true"]{color:var(--zw-accent-text);box-shadow:0 0 0 2px var(--zw-accent-soft)}
.sct-drawer{
  /* 宽度与数据列严格一致；max-width 只在视口极窄时兜底 */
  width:var(--zw-data-w);max-width:calc(100% - 32px);
  /* 左边缘与数据列对齐：dialog 默认居中，这里改成固定定位 + 变量 x 坐标 */
  position:fixed;
  left:var(--zw-data-x, 50%);
  top:50%;
  margin:0;
  transform:translateY(-50%);
  /* 高度必须封顶，否则内容一长就溢出视口、底部看不到（时间轴常常很长） */
  max-height:min(90vh,900px);
  display:flex;flex-direction:column;overflow:hidden;
  background:var(--zw-surface);color:var(--zw-text);
  border:1px solid var(--zw-line);border-radius:16px;
  padding:0;box-shadow:0 20px 70px rgba(0,0,0,.32)
}
/* 各断点都保持"与数据列左对齐"：--zw-data-x 由 ResizeObserver 实时写入，
   窄屏下数据列本身就在容器内，左对齐同样成立（实测 16–24px 边距） */
.sct-drawer::backdrop{background:rgba(0,0,0,.5)}
/* 头部（标题/元信息/编辑入口）与底部按钮固定，中间正文独立滚动 */
.sct-drawer-head{flex:none;padding:22px 22px 0}
.sct-drawer-body{flex:1;min-height:0;overflow-y:auto;overflow-x:hidden;overscroll-behavior:contain;padding:0 22px;scrollbar-gutter:stable}
.sct-drawer-foot{flex:none;padding:14px 22px 20px;border-top:1px solid var(--zw-line);background:var(--zw-surface)}
/* 简单弹层（改期/设置/转项目）：表单自带内边距，不需要头身脚分工 */
.sct-drawer-simple{flex:1;min-height:0;overflow-y:auto;overscroll-behavior:contain;padding:22px}
.sct-drawer-simple footer{margin-top:18px}
.sct-drawer h2{font-size:20px;font-weight:600;margin:10px 0 6px}
.sct-drawer section{margin:16px 0;padding-top:14px;border-top:1px solid var(--zw-line)}
.sct-drawer-body > section:first-child{margin-top:8px;border-top:0;padding-top:0}
.sct-drawer section h3{font-size:12px;font-weight:600;color:var(--zw-muted);letter-spacing:.4px;margin-bottom:8px}
.sct-drawer footer{display:flex;justify-content:flex-end;gap:8px;flex-wrap:wrap}
.sct-drawer label{display:block;font-size:12.5px;color:var(--zw-muted);margin:12px 0 6px}
.sct-drawer input[type="date"],.sct-drawer input[type="time"]{width:100%;padding:9px 12px}
.sct-notice{background:var(--zw-raised);border-radius:6px;padding:10px 12px;font-size:12px;color:var(--zw-muted);margin-top:14px}
.sct-error{color:var(--zw-danger);font-size:12.5px;margin-top:10px}
.sct-tl{display:flex;flex-direction:column;gap:10px}
/* 单条进展可能很长：允许内部换行，不裁字 */
.sct-tl-item{padding-left:14px;border-left:2px solid var(--zw-line);font-size:13px;overflow-wrap:anywhere}
.sct-tl-item b{display:block;font-size:11.5px;color:var(--zw-muted);font-weight:500;margin-bottom:2px}
.sct-tl-item blockquote{margin:2px 0 0;padding-left:10px;border-left:2px solid var(--zw-accent);color:var(--zw-text);font-size:13px;white-space:pre-wrap;overflow-wrap:anywhere}
.sct-toast{position:fixed;bottom:28px;left:50%;transform:translateX(-50%);background:var(--zw-surface);border:1px solid var(--zw-line-strong);border-radius:10px;padding:11px 16px;font-size:13px;box-shadow:0 20px 70px rgba(0,0,0,.35);z-index:60}
@media(prefers-reduced-motion:reduce){.sct-root *{transition:none !important}}

/* ================= 自适应断点（U02） =================
   全部用 @container 而不是 @media：断点依据**插件容器的实际宽度**，
   不是浏览器窗口。宿主侧栏展开、面板拖动缩放、右侧栏打开时，
   窗口可能还有 1440px，但插件容器只剩 800px —— 用 @media 会继续
   保持双栏，把主列挤到 444px、操作按钮被裁掉（审查报告实测）。

   断点取自报告 5.2：
     ≥1060px         弹性主列 + 辅助列
     860–1059px      紧凑双栏；主区放不下操作就提前切单栏
     560–859px       主区单栏，辅助区两列跟在后面
     320–559px       全部单栏，录入/搜索/筛选换行
   ==================================================== */

/* 860–1159px：缩小辅助列与间距，给主列让出宽度，但仍是双栏 */
@container sct (max-width:1159px){
  .sct-root .sct-layout{gap:24px;grid-template-columns:minmax(0,1fr) 240px}
  .sct-root .sct-topbar{padding:10px 20px}
  .sct-root .sct-hero{padding:28px 0 22px}
  .sct-root .sct-hero h1{font-size:26px}
}

/* <860px：切单栏。辅助区不再吸在右边抢宽度，改为跟在主区之后。 */
@container sct (max-width:859px){
  .sct-root .sct-layout{grid-template-columns:minmax(0,1fr);gap:24px}
  /* 单栏时**整页一个滚动面**：主区不再是内部滚动的小格子，
     否则 768px 窗口下列表只剩 32–63px（审查报告实测的裁切来源）。
     做法：外层 .sct-scroll 变成滚动容器，主区与辅助区都自然展开。
     .sct-shell 必须 flex:none —— 留着 flex:1 会被压回容器高度，
     溢出又回到子元素身上，等于白改。 */
  .sct-root .sct-scroll{overflow-y:auto;overflow-x:hidden;overscroll-behavior:contain;scrollbar-gutter:stable}
  .sct-root .sct-shell{flex:none;min-height:0}
  .sct-root .sct-layout{flex:none;min-height:0;align-items:start}
  .sct-root .sct-main{overflow:visible;min-height:0}
  .sct-root .sct-list-scroll{overflow:visible;min-height:0;flex:none;padding-bottom:8px;scrollbar-gutter:auto}
  .sct-root .sct-aside{display:grid;grid-template-columns:1fr 1fr;gap:20px 24px;overflow:visible;padding-bottom:32px}
  .sct-root .sct-aside .sct-side-block:last-child{grid-column:1/-1}
  .sct-root .sct-side-block{padding-bottom:16px}
  .sct-root .sct-topbar{min-height:76px}
}

/* <560px：全部单栏，顶栏/录入/搜索/筛选都允许自然换行 */
@container sct (max-width:559px){
  .sct-root .sct-topbar{min-height:0;padding:14px 16px;flex-wrap:wrap;gap:10px}
  .sct-root .sct-top-actions{flex-wrap:wrap;gap:6px}
  .sct-root .sct-sync{white-space:normal}
  .sct-root .sct-shell{padding:0 16px}
  .sct-root{--zw-shell-pad:16px}
  .sct-root .sct-hero{padding:22px 0 18px;flex-direction:column;align-items:flex-start;gap:10px}
  .sct-root .sct-hero h1{font-size:23px;line-height:1.3}
  .sct-root .sct-hero-side{display:none}
  .sct-root .sct-aside{grid-template-columns:1fr}
  .sct-root .sct-brand p{display:none}
  .sct-root .sct-capture{padding:8px;gap:6px}
  .sct-root .sct-capture select{max-width:100%;flex:1 1 100%}
  .sct-root .sct-capture input{flex:1 1 100%;min-width:0}
  .sct-root .sct-primary-btn{flex:1 1 100%}
  .sct-root .sct-task{padding:12px 12px}
  .sct-root .sct-task{flex-wrap:wrap}
  .sct-root .sct-task-actions{align-self:flex-start;flex-basis:100%;justify-content:flex-end;padding-left:36px}
  .sct-root .sct-toolbar{margin:2px 0 8px}
  .sct-root .sct-search{flex:1 1 100%;min-width:0}
  .sct-root .sct-sort{flex:1 1 100%}
  .sct-root .sct-section-label{flex-wrap:wrap;gap:2px}
  .sct-root .sct-list-end{flex-direction:column;gap:4px}
  .sct-root .sct-agenda-item{grid-template-columns:34px minmax(0,1fr)}
  .sct-root .sct-drawer-head{padding:16px 16px 0}
  .sct-root .sct-drawer-body{padding:0 16px}
  .sct-root .sct-drawer-foot{padding:12px 16px 14px}
  .sct-root .sct-drawer-simple{padding:16px}
  .sct-root .sct-drawer h2{font-size:18px}
}
`;

    const MESSAGES = {
      zh: {
        'brand.name': '知微观澜',
        'brand.sub': '记录细微，回看进展',
        'sidebar.label': '知微观澜',
        'action.refresh': '刷新',
        'action.settings': '提醒设置',
        'action.close': '关闭',
        'action.cancel': '取消',
        'action.save': '保存设置',
        'action.view': '查看',
        'action.reschedule': '改期',
        'action.done': '完成',
        'action.reopen': '重新打开',
        'action.showAll': '查看全部记录',
        'action.confirmAdd': '保存记录',
        'action.confirmReschedule': '确认改期',
        'action.mergeInto': '并入这条',
        'action.createSeparate': '另建记录',
        'action.promote': '转成创作',
        'tab.pending': '待收',
        'tab.all': '全部记录',
        'tab.list': '视图切换',
        'filter.user': '用户记录',
        'filter.label': '记录范围',
        'hero.attention': '把注意力，留给眼前这一件。',
        'hero.calm': '今天，可以从容推进。',
        'hero.firstSub': '从一条记录开始，逐渐看见进展。',
        'hero.attentionSub': '当前范围有 {n} 条记录值得关注。',
        'hero.calmSub': '当前范围暂无逾期、临期、停滞或沉睡提醒。',
        'hero.errorSub': '记录暂时读取失败，请重试。',
        'empty.pendingTitle': '当前没有需要提醒的事',
        'empty.pendingBody': '这个范围仍有 {n} 条未完成或未转化记录，可以按自己的节奏继续。',
        'empty.firstTitle': '留住第一件小事',
        'empty.firstBody': '一项工作、一段创作，或一个刚冒出的想法，都可以从这里开始。',
        'empty.domainTitle': '这个域还没有记录',
        'empty.domainBody': '切换范围看看，或从这里记第一笔。',
        'error.title': '暂时无法读取记录',
        'error.body': '这不是空列表。请检查插件连接后重新加载。',
        'error.retry': '重试',
        'error.stale': '旧数据',
        'group.priority': '优先处理',
        'group.dueToday': '今天到期',
        'group.soon': '剩 2 个工作日内',
        'group.revisit': '值得重新看看',
        'group.sleep': '沉睡的灵感',
        'group.idle': '进行中',
        'group.open': '进行中',
        'group.count': '{n} 条',
        'status.overdue': '逾期 {n} 天',
        'status.today': '今天到期',
        'status.soon': '剩 {n} 个工作日',
        'status.sleep': '沉睡 {n} 天',
        'status.stale': '停滞 {n} 天',
        'status.idleDays': '距上次更新 {n} 天',
        'status.done': '已完成',
        'deadline.none': '未设期限',
        'deadline.due': '{d} 截止',
        'quick.placeholder': '记下一件事，或一个刚出现的想法…',
        'quick.domainLabel': '记录所属域',
        'quick.contentLabel': '记录内容',
        'quick.save': '记一笔',
        'quick.saving': '保存中…',
        'quick.empty': '先写下一点内容',
        'quick.saved': '已记下 {id} · {domain}',
        'quick.deadlineLabel': '截止日期',
        'quick.openEnded': '暂不设期限',
        'quick.duplicateTitle': '发现相似的记录',
        'quick.errorGeneric': '保存失败，内容已保留。',
        'detail.done': '已完成',
        'detail.open': '未完成 / 未转化',
        'detail.next': '下一步',
        'detail.timeline': '时间轴 · 原话留痕',
        'detail.notes': '备注',
        'detail.modifyDeadline': '修改截止日期',
        'detail.markDone': '标记完成',
        'detail.convertTitle': '灵感处理',
        'detail.convertBody': '灵感不使用「完成」。可将其转为创作项目继续推进。',
        'reschedule.title': '修改截止日期',
        'reschedule.newDate': '新的截止日期',
        'reschedule.notice': '将修改条目期限，不是仅延后一次提醒。',
        'reschedule.ok': '{id} 截止日期已更新',
        'reschedule.failed': '改期失败，日期已保留。',
        'promote.title': '转成创作项目',
        'promote.deadlineLabel': '计划的结束时间',
        'promote.notice': '项目需要计划结束时间，才能在到期前提醒你。用户明确说"不急"也可以暂不设期限。',
        'promote.openEnded': '暂不设期限',
        'promote.confirm': '转成项目',
        'action.edit': '编辑',
        'action.saveEdit': '保存',
        'detail.editing': '编辑这条记录',
        'detail.nextLabel': '下一步',
        'detail.nextPlaceholder': '下一步打算做什么？',
        'detail.categoryLabel': '分类',
        'detail.categoryPlaceholder': '如 沟通 / 文档 / 研发',
        'detail.saved': '已保存',
        'search.placeholder': '搜标题、原话或进展…',
        'search.label': '搜索记录',
        'search.clear': '清空搜索',
        'search.results': '搜索结果',
        'search.emptyTitle': '没有找到匹配的记录',
        'search.emptyBody': '「{q}」在标题和时间轴里都没有命中，换个词试试。',
        'sort.label': '排序方式',
        'sort.default': '默认排序',
        'sort.due': '按截止时间',
        'sort.created': '按创建时间',
        'sort.updated': '按更新时间',
        'sort.title': '按标题',
        'group.loadMore': '还有 {n} 条已完成，加载全部',
        'undo.done': '已标记完成：{t}',
        'undo.reopened': '已重新打开：{t}',
        'settings.title': '按你的节奏提醒',
        'settings.sub': '每日汇总当前值得关注的事情。',
        'settings.timeLabel': '每日提醒时间',
        'settings.saved': '已保存，下次提醒 {t}',
        'settings.failed': '保存失败，请检查时间格式。',
        'aside.agenda': '接下来',
        'aside.agendaSub': '截止安排',
        'aside.agendaEmpty': '暂无即将到期的事项。',
        'aside.reminders': '提醒与回顾',
        'aside.remindTime': '每日提醒',
        'aside.reportSchedule': '报告生成',
        'aside.reportMonthly': '月报 · 每月最后一天 {t}',
        'aside.reportQuarterly': '季报 · 季末最后一天 {t}',
        'aside.reportHalf': '半年报 · 6/12 月末 {t}',
        'aside.reportYearly': '年报 · 12 月末 {t}',
        /* B06：这里原来写"报告处理窗口 22:00—06:00"+"需要完整周报时说「帮我整理上周周报」，
           但后端只接受 month/quarter/half/year，周报根本不存在——照做一定失败。
           现在只说明真实支持的四类，并写清"错过要手动生成"。 */
        'aside.reportNote': '四类报告都在各自周期最后一天按上面时间开始生成，生成的是当期数据，不会被夜间窗口推迟。若那一刻 DSH 没开着，之后不会自动补跑——在对话里说「补一份 2026-09 月报」即可手动生成。',
        'aside.reportMissed': '有 {n} 期错过了自动生成，需要手动补：{k}',
        'aside.calendar': '{y} 年 {m} 月',
        'aside.expand': '展开月历 ＋',
        'aside.collapse': '收起月历 −',
        'aside.calendarMissing': '节假日数据缺失，按周末近似显示',
        'conn.bound': '会话已绑定',
        'conn.boundTail': '会话已绑定（…{t}）',
        'conn.bindTail': '…{t}',
        'conn.reminderTo': '提醒投递到',
        'conn.reportTo': '报告投递到',
        'conn.splitNote': '提醒与报告绑在不同会话。要合并到当前会话，说「把提醒和报告都绑到这里」。',
        'conn.reportBlocked': '报告会先攒成事实包，等你在这个会话里说一句话后自动投递。',
        'conn.lost': '绑定会话已失效（退回文件提醒）',
        'conn.none': '会话未绑定（说句话即绑定）',
        'footer.note': '原话留在时间轴，进展随时可回看。',
        'footer.poll': '每 20 秒更新',
        'footer.justNow': '刚刚更新',
        'footer.updatedAt': '{t} 更新',
        'footer.failedAt': '更新失败 · 上次成功 {t}',
      },
      en: {
        'brand.name': 'Insight Desk',
        'brand.sub': 'Notice the subtle, review the flow',
        'sidebar.label': 'Insight Desk',
        'action.refresh': 'Refresh',
        'action.settings': 'Reminders',
        'action.close': 'Close',
        'action.cancel': 'Cancel',
        'action.save': 'Save',
        'action.view': 'View',
        'action.reschedule': 'Reschedule',
        'action.done': 'Done',
        'action.reopen': 'Reopen',
        'action.showAll': 'View all records',
        'action.confirmAdd': 'Save record',
        'action.confirmReschedule': 'Confirm',
        'action.mergeInto': 'Merge into it',
        'action.createSeparate': 'Create separately',
        'action.promote': 'To creation',
        'tab.pending': 'Attention',
        'tab.all': 'All records',
        'tab.list': 'View switcher',
        'filter.user': 'My records',
        'filter.label': 'Scope',
        'hero.attention': 'Focus on the one in front of you.',
        'hero.calm': 'A calm day to move things forward.',
        'hero.firstSub': 'Start with one record and watch progress appear.',
        'hero.attentionSub': '{n} record(s) in this scope deserve attention.',
        'hero.calmSub': 'No overdue, due-soon, stalled or dormant reminders in this scope.',
        'hero.errorSub': 'Could not load records. Please retry.',
        'empty.pendingTitle': 'Nothing needs a reminder right now',
        'empty.pendingBody': '{n} open or unconverted record(s) remain in this scope.',
        'empty.firstTitle': 'Keep the first small thing',
        'empty.firstBody': 'A task, a creation, or a fresh idea can start here.',
        'empty.domainTitle': 'No records in this domain yet',
        'empty.domainBody': 'Switch the scope, or add the first one here.',
        'error.title': 'Could not load records',
        'error.body': 'This is not an empty list. Check the plugin connection and reload.',
        'error.retry': 'Retry',
        'error.stale': 'stale data',
        'group.priority': 'Priority',
        'group.dueToday': 'Due today',
        'group.soon': 'Due in 2 workdays',
        'group.revisit': 'Worth another look',
        'group.sleep': 'Dormant ideas',
        'group.idle': 'In progress',
        'group.open': 'in progress',
        'group.count': '{n} item(s)',
        'status.overdue': 'Overdue {n}d',
        'status.today': 'Due today',
        'status.soon': '{n} workdays left',
        'status.sleep': 'Dormant {n}d',
        'status.stale': 'Stalled {n}d',
        'status.idleDays': 'Last update {n}d ago',
        'status.done': 'Done',
        'deadline.none': 'No deadline',
        'deadline.due': 'Due {d}',
        'quick.placeholder': 'A task, or a just-appeared idea…',
        'quick.domainLabel': 'Record domain',
        'quick.contentLabel': 'Record content',
        'quick.save': 'Add',
        'quick.saving': 'Saving…',
        'quick.empty': 'Write something first',
        'quick.saved': 'Saved {id} · {domain}',
        'quick.deadlineLabel': 'Deadline',
        'quick.openEnded': 'No deadline for now',
        'quick.duplicateTitle': 'Similar record found',
        'quick.errorGeneric': 'Save failed. Content preserved.',
        'detail.done': 'Done',
        'detail.open': 'Open / unconverted',
        'detail.next': 'Next step',
        'detail.timeline': 'Timeline · original words',
        'detail.notes': 'Notes',
        'detail.modifyDeadline': 'Change deadline',
        'detail.markDone': 'Mark done',
        'detail.convertTitle': 'Idea handling',
        'detail.convertBody': 'Ideas do not use "done". Convert it into a creation project instead.',
        'reschedule.title': 'Change deadline',
        'reschedule.newDate': 'New deadline',
        'reschedule.notice': 'This modifies the record deadline, not just one reminder.',
        'reschedule.ok': '{id} deadline updated',
        'reschedule.failed': 'Reschedule failed. Date preserved.',
        'promote.title': 'Turn into a creation project',
        'promote.deadlineLabel': 'Planned end date',
        'promote.notice': 'A project needs an end date so it can remind you before it is due. If the user said "no rush", you may leave it open.',
        'promote.openEnded': 'No deadline',
        'promote.confirm': 'Create project',
        'action.edit': 'Edit',
        'action.saveEdit': 'Save',
        'detail.editing': 'Edit this record',
        'detail.nextLabel': 'Next step',
        'detail.nextPlaceholder': 'What is the next step?',
        'detail.categoryLabel': 'Category',
        'detail.categoryPlaceholder': 'e.g. comms / docs / dev',
        'detail.saved': 'Saved',
        'search.placeholder': 'Search titles, notes, updates…',
        'search.label': 'Search records',
        'search.clear': 'Clear search',
        'search.results': 'Search results',
        'search.emptyTitle': 'No matching records',
        'search.emptyBody': 'Nothing matched "{q}" in titles or timelines. Try another word.',
        'sort.label': 'Sort order',
        'sort.default': 'Default order',
        'sort.due': 'By deadline',
        'sort.created': 'By created',
        'sort.updated': 'By updated',
        'sort.title': 'By title',
        'group.loadMore': '{n} more completed — load all',
        'undo.done': 'Marked done: {t}',
        'undo.reopened': 'Reopened: {t}',
        'settings.title': 'Reminders at your pace',
        'settings.sub': 'A daily digest of what deserves attention.',
        'settings.timeLabel': 'Daily reminder time',
        'settings.saved': 'Saved. Next reminder {t}',
        'settings.failed': 'Save failed. Check the time format.',
        'aside.agenda': 'Upcoming',
        'aside.agendaSub': 'By deadline',
        'aside.agendaEmpty': 'Nothing due soon.',
        'aside.reminders': 'Reminders & review',
        'aside.remindTime': 'Daily reminder',
        'aside.reportSchedule': 'Report generation',
        'aside.reportMonthly': 'Monthly · last day {t}',
        'aside.reportQuarterly': 'Quarterly · quarter-end {t}',
        'aside.reportHalf': 'Half-year · Jun/Dec end {t}',
        'aside.reportYearly': 'Yearly · Dec end {t}',
        'aside.reportNote': 'All four report types start on the last day of their own period at the time shown, covering that period — they are never pushed to a night window. If DSH is closed at that moment it will not catch up later; ask in chat to regenerate one manually.',
        'aside.reportMissed': '{n} period(s) missed auto-generation; regenerate manually: {k}',
        'aside.calendar': '{y}/{m}',
        'aside.expand': 'Calendar ＋',
        'aside.collapse': 'Calendar −',
        'aside.calendarMissing': 'Holiday data missing — approximating by weekends',
        'conn.bound': 'Session bound',
        'conn.boundTail': 'Session bound (…{t})',
        'conn.bindTail': '…{t}',
        'conn.reminderTo': 'Reminders to',
        'conn.reportTo': 'Reports to',
        'conn.splitNote': 'Reminders and reports go to different sessions. Say "bind both here" to merge them.',
        'conn.reportBlocked': 'Reports accumulate as fact packs until you speak in a session; then they are delivered.',
        'conn.lost': 'Bound session lost (file reminders only)',
        'conn.none': 'Session not bound (say anything to bind)',
        'footer.note': 'Original words stay in the timeline.',
        'footer.poll': 'Updates every 20s',
        'footer.justNow': 'Updated just now',
        'footer.updatedAt': 'Updated {t}',
        'footer.failedAt': 'Update failed · last success {t}',
      },
    };

    async function request(path, options) {
      const res = await fetch(API + path, options);
      const data = await res.json().catch(function () { return {}; });
      if (!res.ok) throw new Error((data && data.error && data.error.message) || ('HTTP ' + res.status));
      return data;
    }

    function jsonBody(value) {
      return { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(value) };
    }

    function pad2(n) {
      return String(n).padStart(2, '0');
    }

    function toDay(date) {
      return date.getFullYear() + '-' + pad2(date.getMonth() + 1) + '-' + pad2(date.getDate());
    }

    function hhmm(date) {
      return pad2(date.getHours()) + ':' + pad2(date.getMinutes());
    }

    function longDate(date) {
      const week = ['日', '一', '二', '三', '四', '五', '六'][date.getDay()];
      return date.getFullYear() + ' 年 ' + (date.getMonth() + 1) + ' 月 ' + date.getDate() + ' 日 · 星期' + week;
    }

    function fill(template, a, b) {
      const args = [a, b];
      let index = 0;
      return String(template == null ? '' : template).replace(/\{[a-z]+\}/g, function () {
        const value = args[index];
        index += 1;
        return String(value == null ? '' : value);
      });
    }

    function monthLabel(month) {
      const parts = String(month || '').split('-');
      return { y: parts[0] || '', m: parts[1] ? String(Number(parts[1])) : '' };
    }

    /**
     * 待收判定：**优先用服务端给的 reason**（快照里每条都带），
     * 前端不再自己维护一份阈值——域阈值改了不用同步改前端。
     * 仅当快照没有 reason 字段时（旧宿主）才回退到本地推断。
     */
    function attentionOf(item) {
      if (!item || item.kind !== 'open') return null;
      if (item.reason !== undefined) {
        if (item.reason === 'dormant') return 'sleep';
        return item.reason; // 'overdue' | 'today' | 'soon' | 'stall' | null
      }
      if (item.due && item.due.level === 'overdue') return 'overdue';
      if (item.due && item.due.level === 'today') return 'today';
      if (item.due && item.due.level === 'soon') return 'soon';
      if (item.domain === 'idea' && (item.dormantDays || 0) >= 30) return 'sleep';
      if ((item.stallDays || 0) >= 5 && item.domain === 'work') return 'stale';
      if ((item.stallDays || 0) >= 10 && item.domain === 'creation') return 'stale';
      if ((item.stallDays || 0) >= 14 && item.domain === 'assistant') return 'stale';
      return null;
    }

    function inScope(item, scope) {
      if (scope === 'user') return item.domain !== 'assistant';
      if (scope === 'all') return true;
      return item.domain === scope;
    }

    /**
     * 快照轮询。
     *
     * `doneLimit` 由"全部记录"页签控制：默认 8 条（轻量），
     * 用户点"加载全部"后改成 all，重新拉一次快照——
     * 否则每个域第 9 条及更早的完成记录永远不会出现在界面上。
     */
    function useSnapshot(doneLimit) {
      const first = useState({ phase: 'loading', data: null, error: '', lastSuccess: null, isStale: false });
      const state = first[0];
      const setState = first[1];
      const alive = useRef(true);
      const seenVersion = useRef(null);
      const limitRef = useRef(doneLimit);
      limitRef.current = doneLimit;

      const load = useCallback(async function () {
        try {
          const query = limitRef.current === 'all' ? '?doneLimit=all' : `?doneLimit=${Number(limitRef.current) || 8}`;
          const data = await request('/snapshot' + query);
          if (!alive.current) return;
          const version = data && data.uiVersion ? data.uiVersion : null;
          if (version && seenVersion.current && seenVersion.current !== version) {
            location.reload();
            return;
          }
          if (version) seenVersion.current = version;
          setState({ phase: 'ready', data: data, error: '', lastSuccess: hhmm(new Date()), isStale: false });
        } catch (error) {
          if (!alive.current) return;
          setState(function (prev) {
            return {
              phase: prev.data ? 'stale' : 'error',
              data: prev.data,
              error: String((error && error.message) || error),
              lastSuccess: prev.lastSuccess,
              isStale: Boolean(prev.data),
            };
          });
        }
      }, []);

      useEffect(function () {
        alive.current = true;
        load();
        const timer = setInterval(function () { load(); }, 20000);
        return function () {
          alive.current = false;
          clearInterval(timer);
        };
      }, [doneLimit]);

      return {
        phase: state.phase,
        data: state.data,
        error: state.error,
        lastSuccess: state.lastSuccess,
        isStale: state.isStale,
        reload: load,
      };
    }

    function BrandMark(props) {
      const size = (props && props.size) || 38;
      const className = props && props.className != null ? props.className : 'sct-brandmark';
      return h(
        'svg',
        { className: className, width: size, height: size, viewBox: '0 0 40 40', 'aria-hidden': 'true' },
        h('path', { d: 'm20 4 1.8 5.3L27 11l-5.2 1.8L20 18l-1.8-5.2L13 11l5.2-1.7Z' }),
        h('path', { d: 'M5 23c5-7 10 7 15 0s10 7 15 0M5 29c5-7 10 7 15 0s10 7 15 0M10 35c5-5 8 4 13 0s7 0 7 0' }),
      );
    }

    function SidebarIcon(props) {
      return h(BrandMark, { className: '', size: (props && props.size) || 20 });
    }

    function Skeleton() {
      return h(
        'div',
        { role: 'status' },
        [0, 1, 2].map(function (index) {
          return h('div', { key: index, className: 'sct-skeleton' }, h('i'), h('i'), h('i'));
        }),
      );
    }

    function Calendar(props) {
      const calendar = props.calendar;
      if (!calendar || !calendar.month) return null;
      const parts = calendar.month.split('-');
      const year = Number(parts[0]);
      const month = Number(parts[1]);
      const first = new Date(year, month - 1, 1);
      const offset = (first.getDay() + 6) % 7;
      const total = new Date(year, month, 0).getDate();
      const cells = [];
      let i;
      for (i = 0; i < offset; i += 1) cells.push(null);
      for (i = 1; i <= total; i += 1) cells.push(i);
      const days = calendar.days || {};
      const head = ['一', '二', '三', '四', '五', '六', '日'].map(function (w) {
        return h('span', { key: 'w' + w, className: 'sct-w' }, w);
      });
      const body = cells.map(function (day, index) {
        if (!day) return h('span', { key: 'e' + index });
        const key = calendar.month + '-' + pad2(day);
        const info = days[key] || {};
        const rest = info.holiday || (!info.workday && !info.makeup);
        return h(
          'span',
          {
            key: key,
            className: 'sct-d',
            'data-today': key === calendar.today ? 'true' : 'false',
            'data-rest': rest ? 'true' : 'false',
            'data-makeup': info.makeup ? 'true' : 'false',
            'data-due': info.level === 'overdue' || info.level === 'soon' ? 'true' : 'false',
            title: [info.holidayName, info.makeupName].filter(Boolean).join(' · '),
          },
          String(day),
        );
      });
      return h('div', { className: 'sct-cal' }, head.concat(body));
    }

    function TaskRow(props) {
      const item = props.item;
      const t = props.t;
      const isIdea = item.domain === 'idea';
      const done = item.kind === 'done';
      /**
       * U06：行标签必须与分组、数量、详情用**同一业务含义**。
       *
       * 分组早已优先用服务端 `reason`，行标签却还写死 `stallDays >= 5`——
       * 实测创作条目停滞 6 天、服务端 reason 为 null（该域阈值 10 天），
       * 待收里不提醒，行上却打"停滞 6 天"的红标，自相矛盾。
       * 现在：只有服务端判为 `stall` 才用"停滞"警示；
       * 其余情况给中性的"距上次更新 N 天"，不暗示异常。
       */
      const attention = attentionOf(item);
      const isStalled = !done && attention === 'stall';
      const isDormant = !done && attention === 'sleep';
      const chips = [];
      if (done) {
        chips.push({ text: t('status.done'), kind: 'info' });
      } else if (item.due && item.due.level === 'overdue') {
        chips.push({ text: fill(t('status.overdue'), Math.abs(item.workingDays || 0)), kind: 'danger' });
      } else if (item.due && item.due.level === 'today') {
        chips.push({ text: t('status.today'), kind: 'today' });
      } else if (item.due && item.due.level === 'soon') {
        chips.push({ text: fill(t('status.soon'), item.workingDays), kind: 'warn' });
      } else if (isStalled) {
        chips.push({ text: fill(t('status.stale'), item.stallDays), kind: 'warn' });
      } else if (isDormant) {
        chips.push({ text: fill(t('status.sleep'), item.dormantDays), kind: 'info' });
      } else if (!done && (item.stallDays || 0) > 0) {
        // 中性叙述：只是"有段时间没动"，不构成提醒
        chips.push({ text: fill(t('status.idleDays'), item.stallDays), kind: 'plain' });
      }
      const timeline = item.timeline || [];
      const latest = timeline.length ? timeline[0] : null;
      const note = (latest && latest.quote) || item.next || '';
      const meta = [
        h('span', { key: 'domain' }, NAMES[item.domain] || item.domain),
        h('span', { key: 'sep' }, '·'),
        h('span', { key: 'due' }, item.deadline ? fill(t('deadline.due'), item.deadline.slice(5).replace('-', ' / ')) : t('deadline.none')),
      ];
      if (chips.length) {
        meta.push(h('span', { key: 'chip', className: 'sct-status', 'data-kind': chips[0].kind }, chips[0].text));
      }

      return h(
        'article',
        { className: 'sct-task', 'data-done': done ? 'true' : 'false' },
        h(
          'button',
          {
            className: 'sct-check',
            type: 'button',
            'data-shape': isIdea ? 'idea' : 'task',
            // 选中态不只靠颜色：done 时 aria-pressed 与勾选符号同时表达（6.2）
            'data-done': done ? 'true' : 'false',
            'aria-pressed': done ? 'true' : 'false',
            'aria-label': isIdea ? t('action.view') + '：' + item.title : done ? t('action.reopen') + '：' + item.title : t('action.done') + '：' + item.title,
            onClick: function () {
              if (isIdea) props.onView(item);
              else props.onToggleDone(item);
            },
          },
          done ? '✓' : isIdea ? '✧' : '',
        ),
        h(
          'div',
          { className: 'sct-task-body' },
          h(
            'button',
            { className: 'sct-task-title', type: 'button', onClick: function () { props.onView(item); } },
            item.title,
          ),
          h('div', { className: 'sct-task-meta' }, meta),
          note ? h('p', { className: 'sct-task-note' }, String(note).slice(0, 90)) : null,
        ),
        h(
          'div',
          { className: 'sct-task-actions' },
          h('button', { className: 'ghost', type: 'button', onClick: function () { props.onView(item); } }, t('action.view')),
          !done && !isIdea
            ? h('button', { className: 'ghost', type: 'button', onClick: function () { props.onReschedule(item); } }, t('action.reschedule'))
            : null,
        ),
      );
    }

    function SectionGroup(props) {
      const items = props.items || [];
      if (!items.length) return null;
      return h(
        'div',
        null,
        h(
          'div',
          { className: 'sct-section-label' },
          h('span', null, props.label),
          h('span', null, fill(props.t('group.count'), items.length)),
        ),
        h(
          'div',
          { className: 'sct-tasks' },
          items.map(function (item) {
            return h(TaskRow, {
              key: item.id,
              item: item,
              t: props.t,
              onView: props.onView,
              onReschedule: props.onReschedule,
              onToggleDone: props.onToggleDone,
            });
          }),
        ),
      );
    }

    function Drawer(props) {
      const ref = useRef(null);
      const restoreTo = useRef(null);
      useEffect(function () {
        if (!props.open || !ref.current) return undefined;
        restoreTo.current = document.activeElement;
        try {
          ref.current.showModal();
        } catch (error) {
          void error;
        }
        return function () {
          try {
            if (ref.current && ref.current.close) ref.current.close();
          } catch (error) {
            void error;
          }
          const node = restoreTo.current;
          if (node && node.focus) node.focus();
        };
      }, [props.open]);
      if (!props.open) return null;
      return h('dialog', { ref: ref, className: 'sct-drawer', onClose: props.onClose, 'aria-label': props.label }, props.children);
    }

    /**
     * 详情弹层。
     *
     * 除了展示时间轴，还支持**就地编辑**「下一步」和「分类」——
     * 否则用户想改点什么只能回到对话里说，面板就成了只读视图。
     * 编辑走同一套 /update，保存后由上层 reload 刷新。
     */
    function DetailDrawer(props) {
      const item = props.item;
      const t = props.t;
      const editState = useState(null);
      const edit = editState[0];
      const setEdit = editState[1];
      const busyState = useState(false);
      const busy = busyState[0];
      const setBusy = busyState[1];
      const errState = useState('');
      const error = errState[0];
      const setError = errState[1];
      if (!item) return null;
      const isIdea = item.domain === 'idea';
      const done = item.kind === 'done';
      const timeline = item.timeline || [];
      const notes = item.notes || [];

      const startEdit = function () {
        setEdit({ next: item.next || '', category: item.category || '' });
        setError('');
      };

      const saveEdit = async function () {
        setBusy(true);
        setError('');
        try {
          await props.onSave(item.id, {
            next: edit.next.trim(),
            // 空串表示清除分类（后端按 category === '' 删除）
            category: edit.category.trim(),
          });
          setEdit(null);
        } catch (error2) {
          setError(String((error2 && error2.message) || error2));
        } finally {
          setBusy(false);
        }
      };

      const head = h(
        'div',
        { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '12px' } },
        h('span', { className: 'small muted' }, (NAMES[item.domain] || item.domain) + ' · ' + item.id),
        h('button', { className: 'ghost', onClick: props.onClose }, t('action.close')),
      );

      const meta = [
        h('span', { key: 'due' }, item.deadline ? fill(t('deadline.due'), item.deadline) : t('deadline.none')),
        h('span', { key: 'state', className: 'sct-status', 'data-kind': done ? 'info' : 'today' }, done ? t('detail.done') : t('detail.open')),
      ];
      if (item.progress != null) meta.push(h('span', { key: 'p' }, item.progress + '%'));

      const nextSection = item.next
        ? h('section', null, h('h3', null, t('detail.next')), h('p', { className: 'muted' }, item.next))
        : null;

      // 编辑区：点「编辑」按钮后展开，保存/取消就地完成
      const editSection = edit
        ? h(
            'section',
            { className: 'sct-edit' },
            h('h3', null, t('detail.editing')),
            h('label', null, t('detail.nextLabel')),
            h('textarea', {
              rows: 3,
              value: edit.next,
              placeholder: t('detail.nextPlaceholder'),
              onChange: function (event) { setEdit({ next: event.target.value, category: edit.category }); },
            }),
            h('label', null, t('detail.categoryLabel')),
            h('input', {
              type: 'text',
              value: edit.category,
              maxLength: 20,
              placeholder: t('detail.categoryPlaceholder'),
              onChange: function (event) { setEdit({ next: edit.next, category: event.target.value }); },
            }),
            error ? h('p', { className: 'sct-error', role: 'alert' }, error) : null,
            h(
              'div',
              { className: 'sct-edit-actions' },
              h('button', { type: 'button', onClick: function () { setEdit(null); } }, t('action.cancel')),
              h('button', { className: 'primary', type: 'button', disabled: busy, onClick: function () { saveEdit(); } }, busy ? t('quick.saving') : t('action.saveEdit')),
            ),
          )
        : null;

      const timelineSection = timeline.length
        ? h(
            'section',
            null,
            h('h3', null, t('detail.timeline')),
            h(
              'div',
              { className: 'sct-tl' },
              timeline.map(function (entry, index) {
                return h(
                  'div',
                  { key: index, className: 'sct-tl-item' },
                  h('b', null, entry.at + ' ' + entry.text),
                  entry.quote ? h('blockquote', null, entry.quote) : null,
                );
              }),
            ),
          )
        : null;

      const notesSection = notes.length
        ? h(
            'section',
            null,
            h('h3', null, t('detail.notes')),
            notes.map(function (note, index) {
              return h('p', { key: index, className: 'muted small', style: { margin: '4px 0' } }, '- ' + note);
            }),
          )
        : null;

      const footer = isIdea
        ? h(
            'section',
            null,
            h('h3', null, t('detail.convertTitle')),
            h('p', { className: 'muted small' }, t('detail.convertBody')),
            h(
              'div',
              { style: { marginTop: '10px' } },
              h(
                'button',
                {
                  className: 'primary',
                  onClick: function () {
                    props.onClose();
                    props.onPromote(item);
                  },
                },
                t('action.promote'),
              ),
            ),
          )
        : h(
            'footer',
            null,
            h(
              'button',
              {
                onClick: function () {
                  props.onClose();
                  props.onReschedule(item);
                },
              },
              t('detail.modifyDeadline'),
            ),
            !done
              ? h(
                  'button',
                  {
                    className: 'primary',
                    onClick: function () {
                      props.onClose();
                      props.onToggleDone(item);
                    },
                  },
                  t('detail.markDone'),
                )
              : null,
          );

      // 三段式：头部与底部按钮固定，只有正文滚动。
      // 灵感域没有 footer 按钮（转化入口在正文里），底部就不渲染。
      const showFooter = !isIdea;

      return h(
        Drawer,
        { open: true, onClose: props.onClose, label: item.title },
        h(
          'div',
          { className: 'sct-drawer-head' },
          head,
          h('h2', null, item.title),
          h('div', { className: 'sct-task-meta' }, meta),
          edit ? null : h('div', { className: 'sct-edit-entry' }, h('button', { className: 'ghost', type: 'button', onClick: startEdit }, t('action.edit'))),
        ),
        h(
          'div',
          { className: 'sct-drawer-body' },
          nextSection,
          editSection,
          timelineSection,
          notesSection,
          isIdea ? footer : null,
        ),
        showFooter ? h('div', { className: 'sct-drawer-foot' }, footer) : null,
      );
    }

    function RescheduleDrawer(props) {
      const state = props.state;
      const t = props.t;
      if (!state || !state.item) return null;
      return h(
        Drawer,
        { open: true, onClose: props.onCancel, label: t('reschedule.title') },
        h(
          'form',
          {
            className: 'sct-drawer-simple',
            onSubmit: function (event) {
              event.preventDefault();
              props.onConfirm(state.item, state.date);
            },
          },
          h('h2', null, t('reschedule.title')),
          h('p', { className: 'muted' }, state.item.title),
          h('label', null, t('reschedule.newDate')),
          h('input', {
            type: 'date',
            value: state.date,
            required: true,
            onChange: function (event) {
              props.onDate(event.target.value);
            },
          }),
          h('p', { className: 'sct-notice' }, t('reschedule.notice')),
          state.error ? h('p', { className: 'sct-error', role: 'alert' }, state.error) : null,
          h(
            'footer',
            null,
            h('button', { type: 'button', onClick: props.onCancel }, t('action.cancel')),
            h('button', { className: 'primary', type: 'submit', disabled: state.busy }, t('action.confirmReschedule')),
          ),
        ),
      );
    }

    function SettingsDrawer(props) {
      const state = props.state;
      const t = props.t;
      if (!state || !state.open) return null;
      return h(
        Drawer,
        { open: true, onClose: props.onCancel, label: t('action.settings') },
        h(
          'form',
          {
            className: 'sct-drawer-simple',
            onSubmit: function (event) {
              event.preventDefault();
              props.onSave(state.time);
            },
          },
          h('h2', null, t('settings.title')),
          h('p', { className: 'muted' }, t('settings.sub')),
          h('label', null, t('settings.timeLabel')),
          h('input', {
            type: 'time',
            value: state.time,
            required: true,
            onChange: function (event) {
              props.onTime(event.target.value);
            },
          }),
          state.error ? h('p', { className: 'sct-error', role: 'alert' }, state.error) : null,
          h(
            'footer',
            null,
            h('button', { type: 'button', onClick: props.onCancel }, t('action.cancel')),
            h('button', { className: 'primary', type: 'submit', disabled: state.busy }, t('action.save')),
          ),
        ),
      );
    }

    /**
     * 灵感转创作时的期限补齐。
     * 转成项目等于新建一条创作记录，没有计划结束时间就无法到期提醒，
     * 所以后端会返回 need_deadline，这里就地让用户选日期（或明确"暂不设期限"）。
     */
    function PromoteDrawer(props) {
      const state = props.state;
      const t = props.t;
      if (!state || !state.item) return null;
      return h(
        Drawer,
        { open: true, onClose: props.onCancel, label: t('action.promote') },
        h(
          'form',
          {
            className: 'sct-drawer-simple',
            onSubmit: function (event) {
              event.preventDefault();
              props.onConfirm(state.item, state.date, false);
            },
          },
          h('h2', null, t('promote.title')),
          h('p', { className: 'muted' }, state.title),
          h('label', null, t('promote.deadlineLabel')),
          h('input', {
            type: 'date',
            value: state.date,
            required: true,
            onChange: function (event) {
              props.onDate(event.target.value);
            },
          }),
          h('p', { className: 'sct-notice' }, t('promote.notice')),
          state.error ? h('p', { className: 'sct-error', role: 'alert' }, state.error) : null,
          h(
            'footer',
            null,
            h('button', { type: 'button', onClick: props.onCancel }, t('action.cancel')),
            h(
              'button',
              { type: 'button', onClick: function () { props.onConfirm(state.item, null, true); } },
              t('promote.openEnded'),
            ),
            h('button', { className: 'primary', type: 'submit', disabled: state.busy }, t('promote.confirm')),
          ),
        ),
      );
    }

    function Agenda(props) {
      const items = props.items || [];
      const t = props.t;
      if (!items.length) return h('p', { className: 'small muted' }, t('aside.agendaEmpty'));
      return h(
        'div',
        { className: 'sct-agenda' },
        items.map(function (item) {
          const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(item.deadline || ''));
          if (!match) return null;
          const detail = item.due && item.due.level === 'overdue'
            ? fill(t('status.overdue'), Math.abs(item.workingDays || 0))
            : fill(t('deadline.due'), String(item.deadline).slice(5));
          return h(
            'div',
            { key: item.id, className: 'sct-agenda-item' },
            h('div', { className: 'sct-agenda-date' }, h('b', null, match[3]), h('span', null, String(Number(match[2])) + '月')),
            h(
              'div',
              { className: 'sct-agenda-body' },
              h('div', { className: 'sct-agenda-title' }, item.title),
              h('small', null, (NAMES[item.domain] || item.domain) + ' · ' + detail),
            ),
          );
        }),
      );
    }

    function Panel() {
      // doneLimit 必须先声明再传给 useSnapshot（"全部记录"页可切到 all）
      const doneLimitState = useState(8);
      const doneLimit = doneLimitState[0];
      const setDoneLimit = doneLimitState[1];
      const snap = useSnapshot(doneLimit);
      const tabState = useState('pending');
      const tab = tabState[0];
      const setTab = tabState[1];
      const scopeState = useState('user');
      const scope = scopeState[0];
      const setScope = scopeState[1];
      const domainState = useState('work');
      const domain = domainState[0];
      const setDomain = domainState[1];
      const searchState = useState('');
      const search = searchState[0];
      const setSearch = searchState[1];
      const searchResultState = useState(null);
      const searchResult = searchResultState[0];
      const setSearchResult = searchResultState[1];
      const orderingState = useState('default');
      const ordering = orderingState[0];
      const setOrdering = orderingState[1];
      const draftState = useState('');
      const draft = draftState[0];
      const setDraft = draftState[1];
      const busyState = useState(false);
      const quickBusy = busyState[0];
      const setQuickBusy = busyState[1];
      const errState = useState('');
      const quickError = errState[0];
      const setQuickError = errState[1];
      const confirmState = useState(null);
      const confirm = confirmState[0];
      const setConfirm = confirmState[1];
      const detailState = useState(null);
      const detailItem = detailState[0];
      const setDetailItem = detailState[1];
      const resState = useState({ item: null, date: '', error: '', busy: false });
      const reschedule = resState[0];
      const setReschedule = resState[1];
      const promoteState = useState({ item: null, title: '', date: '', error: '', busy: false });
      const promote = promoteState[0];
      const setPromote = promoteState[1];
      const settingsState = useState({ open: false, time: '12:00', busy: false, error: '' });
      const settings = settingsState[0];
      const setSettings = settingsState[1];
      const toastState = useState('');
      const toast = toastState[0];
      const setToast = toastState[1];
      const toastTimer = useRef(null);
      const mainRef = useRef(null);
      /**
       * 提交闸门（U01）。useRef 而不是 useState：它只在事件回调里读写，
       * 不需要触发重渲染；用 state 反而会因为闭包捕获旧值而漏拦。
       * 按钮 disabled 挡不住 Ctrl/Cmd+Enter 与表单回车，所以三种入口都过这里。
       */
      const submittingRef = useRef(false);

      /**
       * 把数据列的真实几何写进 CSS 变量，让弹层与它**宽度一致且左边缘对齐**。
       *
       * 为什么不能只用 CSS calc：数据列是 `minmax(0,1fr)`，它会被容器宽度、
       * 媒体查询、滚动条等因素共同决定，纯算术在窄屏下必然对不上（实测差 16–172px）。
       * 这里用 ResizeObserver 跟随真实布局，任何断点都准确。
       */
      useEffect(function () {
        const node = mainRef.current;
        if (!node) return undefined;
        // 变量必须写在 documentElement（:root）上：dialog 挂在 body 下，
        // 不在 .sct-root 内部，写局部变量弹层读不到。
        const root = document.documentElement;
        const apply = function () {
          const rect = node.getBoundingClientRect();
          const width = Math.round(rect.width);
          const left = Math.round(rect.left);
          if (width > 0) root.style.setProperty('--zw-data-w', width + 'px');
          // 左边缘对齐：dialog 是 fixed 定位，用视口坐标的 left 直接对齐数据列
          root.style.setProperty('--zw-data-x', left + 'px');
        };
        apply();
        let observer = null;
        if (typeof ResizeObserver === 'function') {
          observer = new ResizeObserver(apply);
          observer.observe(node);
        } else {
          window.addEventListener('resize', apply);
        }
        // 窗口滚动时数据列的水平位置不变（面板内部滚动），但侧栏折叠等仍会触发 resize
        window.addEventListener('resize', apply);
        return function () {
          if (observer) observer.disconnect();
          window.removeEventListener('resize', apply);
        };
      }, []);

      const t = useCallback(function (key) {
        const value = MESSAGES.zh[key];
        return value == null ? key : value;
      }, []);

      const showToast = useCallback(function (text) {
        setToast(text);
        if (toastTimer.current) clearTimeout(toastTimer.current);
        toastTimer.current = setTimeout(function () { setToast(''); }, 5000);
      }, []);

      const reload = snap.reload;

      /**
       * 搜索：走服务端 /search（复用核心 query，覆盖标题 + 时间轴原话）。
       * 输入 250ms 防抖；清空即退出搜索态。
       */
      useEffect(
        function () {
          const keyword = search.trim();
          if (!keyword) {
            setSearchResult(null);
            return undefined;
          }
          let cancelled = false;
          const timer = setTimeout(function () {
            const params = new URLSearchParams({ q: keyword, limit: '50' });
            if (scope !== 'user' && scope !== 'all') params.set('domain', scope);
            request('/search?' + params.toString())
              .then(function (data) {
                if (cancelled) return;
                const items = (data && data.items) || [];
                // 助手域在"用户记录"范围下不显示（与列表筛选口径一致）
                const filtered = scope === 'user' ? items.filter(function (x) { return x.domain !== 'assistant'; }) : items;
                setSearchResult({ keyword: keyword, items: filtered });
              })
              .catch(function (error) {
                if (cancelled) return;
                setSearchResult({ keyword: keyword, items: [], error: String((error && error.message) || error) });
              });
          }, 250);
          return function () {
            cancelled = true;
            clearTimeout(timer);
          };
        },
        [search, scope],
      );

      /** 切换排序：只影响前端展示顺序，不改数据 */
      const sortItems = useCallback(function (list) {
        const copy = list.slice();
        if (ordering === 'due') {
          copy.sort(function (a, b) {
            const da = a.deadline || '9999-12-31';
            const db = b.deadline || '9999-12-31';
            return String(da).localeCompare(String(db));
          });
        } else if (ordering === 'created') {
          copy.sort(function (a, b) { return String(b.created ?? '').localeCompare(String(a.created ?? '')); });
        } else if (ordering === 'updated') {
          copy.sort(function (a, b) { return String(b.updated ?? '').localeCompare(String(a.updated ?? '')); });
        } else if (ordering === 'title') {
          copy.sort(function (a, b) { return String(a.title ?? '').localeCompare(String(b.title ?? ''), 'zh'); });
        }
        return copy;
      }, [ordering]);

      const toggleDone = useCallback(
        async function (item) {
          const wasDone = item.kind === 'done';
          const body = { id: item.id };
          // 重开必须落到非完成状态：item.status 此刻就是 'done'，回填它会再提交一次 done
          if (item.shape === 'project') body.stage = wasDone ? 'revising' : 'done';
          else body.status = wasDone ? 'doing' : 'done';
          if (!wasDone) body.note = '面板标记完成';
          try {
            await request('/update', jsonBody(body));
            showToast(fill(t(wasDone ? 'undo.reopened' : 'undo.done'), item.title));
            await reload();
          } catch (error) {
            showToast(t('quick.errorGeneric') + ' ' + ((error && error.message) || error));
          }
        },
        [reload, showToast, t],
      );

      const doReschedule = useCallback(
        async function (item, date) {
          if (!item || !date) return;
          setReschedule(function (prev) {
            return { item: prev.item, date: prev.date, error: '', busy: true };
          });
          try {
            await request('/update', jsonBody({ id: item.id, deadline: date, note: '面板改期' }));
            showToast(fill(t('reschedule.ok'), item.id));
            setReschedule({ item: null, date: '', error: '', busy: false });
            await reload();
          } catch (error) {
            setReschedule(function (prev) {
              return { item: prev.item, date: prev.date, error: t('reschedule.failed') + ' ' + ((error && error.message) || error), busy: false };
            });
          }
        },
        [reload, showToast, t],
      );

      const onReschedule = useCallback(function (item) {
        setReschedule({ item: item, date: item.deadline || toDay(new Date()), error: '', busy: false });
      }, []);

      const doPromote = useCallback(
        async function (item, deadline, openEnded) {
          try {
            const body = { id: item.id, action: 'promote' };
            if (deadline) body.deadline = deadline;
            if (openEnded) body.openEnded = true;
            const data = await request('/link', jsonBody(body));
            const result = (data && data.result) || {};
            // 转成项目也是新建记录：没有期限时后端会拒绝，面板要就地补日期
            if (result.action === 'need_deadline') {
              setDetailItem(null);
              setPromote({ item: item, title: result.title || item.title, date: toDay(new Date()), error: '', busy: false });
              return;
            }
            showToast(t('action.promote') + '：' + (result.id || ''));
            setPromote({ item: null, title: '', date: '', error: '', busy: false });
            await reload();
          } catch (error) {
            showToast(String((error && error.message) || error));
          }
        },
        [reload, showToast, t],
      );

      /**
       * 快速录入提交。
       *
       * U01：保存请求必须**记住提交时的草稿**，成功回调只能清掉"还是那份草稿"
       * 的内容。原实现无条件 `setDraft('')`，于是慢响应下用户在等待期间
       * 输入的第二条会被第一条的成功回调抹掉（复验实测复现）。
       *
       * 防重复：`submittingRef` 在请求期间为 true。按钮 disabled 只能挡住点击，
       * 挡不住 Ctrl/Cmd+Enter 与表单回车，所以三种入口统一在这里拦。
       */
      const submitQuick = useCallback(
        async function (extraFields, updateExisting, options) {
          const opts = options || {};
          if (submittingRef.current) return;
          /**
           * 确认面板（重复/期限）提交时，正文用**发起那次请求时的原文**，
           * 不用输入框当前内容：用户在确认期间可能已经改了框里的字，
           * 那时"并入这条/另建"应该针对当初那条，而不是半截新内容。
           */
          const text = String(opts.text !== undefined ? opts.text : draft).trim();
          const submitDomain = opts.domain || domain;
          if (!text) {
            setQuickError(t('quick.empty'));
            return;
          }
          // 提交瞬间的草稿与域：成功回调据此判断"现在还是不是那一份"
          const submitted = { text: text, domain: submitDomain };
          const clearsInput = opts.text === undefined;
          submittingRef.current = true;
          setQuickBusy(true);
          setQuickError('');
          try {
            const body = {
              domain: submitted.domain,
              text: text,
              fields: extraFields || {},
              updateExisting: updateExisting === true,
            };
            // 用户已确认"另建一条"：只跳过去重，不改任何字段（U03）
            if (opts.createSeparate === true) body.createSeparate = true;
            const data = await request('/add', jsonBody(body));
            const result = (data && data.result) || {};
            if (result.action === 'need_deadline') {
              setConfirm({ kind: 'deadline', date: toDay(new Date()), text: submitted.text, domain: submitted.domain, fields: extraFields || {} });
              return;
            }
            if (result.action === 'duplicate') {
              // 记住这份草稿与已选字段，后面"并入/另建"都复用它，不再读当前输入框
              setConfirm({
                kind: 'duplicate',
                id: result.id,
                title: result.title,
                reason: result.reason,
                text: submitted.text,
                domain: submitted.domain,
                fields: extraFields || {},
              });
              return;
            }
            // 只有当前草稿仍是提交时那份（且域没切走）才清空；
            // 否则说明用户已经在写第二条，绝不能动它。
            if (clearsInput) {
              setDraft(function (current) {
                return current === submitted.text ? '' : current;
              });
            }
            setConfirm(null);
            showToast(fill(t('quick.saved'), result.id || '', NAMES[result.domain || submitted.domain] || ''));
            await reload();
          } catch (error) {
            // 失败保留原文：草稿一个字都不动
            setQuickError(t('quick.errorGeneric') + ' ' + ((error && error.message) || error));
          } finally {
            submittingRef.current = false;
            setQuickBusy(false);
          }
        },
        [draft, domain, reload, showToast, t],
      );

      const saveSettings = useCallback(
        async function (time) {
          if (!/^\d{2}:\d{2}$/.test(time)) {
            setSettings(function (prev) { return { open: true, time: prev.time, busy: false, error: t('settings.failed') }; });
            return;
          }
          setSettings(function (prev) { return { open: true, time: prev.time, busy: true, error: '' }; });
          try {
            const data = await request('/schedule', jsonBody({ reminderAt: time }));
            const next = data && data.result && data.result.schedule ? data.result.schedule.reminderAt : time;
            showToast(fill(t('settings.saved'), next));
            setSettings({ open: false, time: time, busy: false, error: '' });
            await reload();
          } catch (error) {
            setSettings(function (prev) {
              return { open: true, time: prev.time, busy: false, error: t('settings.failed') + ' ' + ((error && error.message) || error) };
            });
          }
        },
        [reload, showToast, t],
      );

      const data = snap.data;
      const domains = (data && data.domains) || [];

      const all = useMemo(
        function () {
          const items = [];
          domains.forEach(function (d) {
            (d.open || []).forEach(function (item) { items.push(item); });
            (d.recentDone || []).forEach(function (item) { items.push(item); });
          });
          return items;
        },
        [data],
      );

      const scoped = useMemo(function () {
        return all.filter(function (item) { return inScope(item, scope); });
      }, [all, scope]);

      const pendingItems = useMemo(function () {
        return scoped.filter(function (item) { return attentionOf(item) !== null; });
      }, [scoped]);

      const openInScope = useMemo(function () {
        return scoped.filter(function (item) { return item.kind === 'open'; }).length;
      }, [scoped]);

      // "待收"页在没有任何到期/停滞/沉睡时，若该范围还有在办记录，
      // 就**直接把这些记录展示出来**（用户要求：有记录就展示记录），
      // 而不是用一句空态把已有内容挡在"全部记录"页签后面。
      const idleOpen = useMemo(function () {
        return scoped
          .filter(function (item) { return item.kind === 'open'; })
          .sort(function (a, b) {
            const da = a.deadline || '9999-12-31';
            const db = b.deadline || '9999-12-31';
            return String(da).localeCompare(String(db));
          });
      }, [scoped]);

      const groups = useMemo(
        function () {
          function by(level) {
            return pendingItems.filter(function (item) {
              const reason = attentionOf(item);
              // 服务端 reason 用 'stall'，面板分组沿用 'stale'；沉睡用 'dormant'→'sleep'
              if (level === 'stale') return reason === 'stall' || reason === 'stale';
              if (level === 'sleep') return reason === 'dormant' || reason === 'sleep';
              return reason === level;
            });
          }
          return [
            { key: 'priority', label: t('group.priority'), items: by('overdue') },
            { key: 'dueToday', label: t('group.dueToday'), items: by('today') },
            { key: 'soon', label: t('group.soon'), items: by('soon') },
            { key: 'revisit', label: t('group.revisit'), items: by('stale') },
            { key: 'sleep', label: t('group.sleep'), items: by('sleep') },
          ];
        },
        [pendingItems, t],
      );

      const allGroups = useMemo(
        function () {
          const list = scope === 'user'
            ? domains.filter(function (d) { return d.id !== 'assistant'; })
            : scope === 'all'
              ? domains
              : domains.filter(function (d) { return d.id === scope; });
          return list
            .map(function (d) { return { domain: d, open: d.open || [], done: d.recentDone || [] }; })
            .filter(function (g) { return g.open.length || g.done.length; });
        },
        [domains, scope],
      );

      const agenda = useMemo(
        function () {
          return scoped
            .filter(function (item) { return item.kind === 'open' && item.deadline; })
            .sort(function (a, b) { return String(a.deadline).localeCompare(String(b.deadline)); })
            .slice(0, 3);
        },
        [scoped],
      );

      const onView = useCallback(function (item) { setDetailItem(item); }, []);

      /** 详情弹层内联保存：只发改动过的字段，避免覆盖别的属性 */
      const onSaveDetail = useCallback(
        async function (id, patch) {
          const body = { id: id };
          if (patch.next !== undefined) body.next = patch.next;
          if (patch.category !== undefined) body.category = patch.category;
          await request('/update', jsonBody(body));
          showToast(t('detail.saved'));
          await reload();
          // 刷新后弹层里的对象是旧的，关掉让用户从列表重新点开
          setDetailItem(null);
        },
        [reload, showToast, t],
      );
      const onToggleDone = useCallback(function (item) { toggleDone(item); }, [toggleDone]);
      const onPromote = useCallback(function (item) { doPromote(item); }, [doPromote]);

      const firstUse = all.length === 0;
      const pendingCount = pendingItems.length;
      const totalCount = scoped.length;
      const failed = !data && snap.phase === 'error';
      const headline = failed ? t('brand.name') : firstUse ? t('hero.calm') : pendingCount ? t('hero.attention') : t('hero.calm');
      const summary = failed
        ? t('hero.errorSub')
        : firstUse
          ? t('hero.firstSub')
          : pendingCount
            ? fill(t('hero.attentionSub'), pendingCount)
            : t('hero.calmSub');
      const syncText = snap.phase === 'error'
        ? fill(t('footer.failedAt'), snap.lastSuccess || '--:--')
        : snap.isStale
          ? t('error.stale') + ' · ' + fill(t('footer.updatedAt'), snap.lastSuccess || '')
          : snap.lastSuccess
            ? fill(t('footer.updatedAt'), snap.lastSuccess)
            : t('footer.justNow');
      // 提醒与报告各自独立判定：两个投递目标可以绑在不同会话
      const connectionState = data && data.state
        ? (data.state.scheduleLost ? 'lost' : data.state.reminder && data.state.reminder.bound ? 'bound' : 'none')
        : 'none';
      const reportConnState = data && data.state ? (data.state.report && data.state.report.bound ? 'bound' : 'none') : 'none';
      /** 把绑定信息渲染成一句短标签：已绑定给尾号，否则给"未绑定" */
      const connectTarget = function (snapData, which) {
        const info = snapData && snapData.state ? snapData.state[which] : null;
        if (!info || !info.bound) return t('conn.none');
        return fill(t('conn.bindTail'), info.tail || '');
      };

      const topbar = h(
        'header',
        { className: 'sct-topbar' },
        h(
          'div',
          { className: 'sct-brand' },
          h(BrandMark, null),
          h('div', null, h('strong', null, t('brand.name')), h('p', null, t('brand.sub'))),
        ),
        h(
          'div',
          { className: 'sct-top-actions' },
          h('span', { className: 'sct-sync', role: 'status' }, syncText),
          // 社区入口：只有 系统/社区.json 配了 http(s) 地址才出现，没配就不占位
          data && data.community
            ? h(
                'a',
                {
                  className: 'sct-community',
                  href: data.community.url,
                  target: '_blank',
                  rel: 'noopener noreferrer',
                  title: data.community.url,
                },
                h('span', null, data.community.label),
                h('span', { className: 'sct-community-arrow', 'aria-hidden': 'true' }, '↗'),
              )
            : null,
          h('button', { className: 'ghost', onClick: function () { reload(); } }, t('action.refresh')),
          h(
            'button',
            {
              className: 'ghost',
              onClick: function () {
                setSettings({
                  open: true,
                  time: (data && data.schedule && data.schedule.reminderAt) || '12:00',
                  busy: false,
                  error: '',
                });
              },
            },
            t('action.settings'),
          ),
        ),
      );

      const hero = h(
        'section',
        { className: 'sct-hero' },
        h(
          'div',
          null,
          h('div', { className: 'sct-eyebrow' }, longDate(new Date())),
          h('h1', null, headline),
          h('p', { className: 'sct-summary' }, summary),
        ),
        h('span', { className: 'sct-hero-side' }, '知微 / 今日'),
      );

      const captureChildren = [
        h(
          'select',
          {
            key: 'domain',
            'aria-label': t('quick.domainLabel'),
            value: domain,
            onChange: function (event) { setDomain(event.target.value); },
          },
          domains.map(function (d) { return h('option', { key: d.id, value: d.id }, d.name); }),
        ),
        h('input', {
          key: 'text',
          'aria-label': t('quick.contentLabel'),
          value: draft,
          placeholder: t('quick.placeholder'),
          maxLength: 500,
          onChange: function (event) { setDraft(event.target.value); },
          onKeyDown: function (event) {
            if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
              event.preventDefault();
              submitQuick();
            }
          },
        }),
        h(
          'button',
          { key: 'save', className: 'primary sct-primary-btn', type: 'submit', disabled: quickBusy },
          quickBusy ? t('quick.saving') : t('quick.save'),
        ),
      ];

      if (quickError) {
        captureChildren.push(h('div', { key: 'err', className: 'sct-capture-error', role: 'alert' }, quickError));
      }

      if (confirm && confirm.kind === 'deadline') {
        const keep = { text: confirm.text, domain: confirm.domain, fields: confirm.fields || {} };
        captureChildren.push(
          h(
            'div',
            { key: 'deadline', className: 'sct-capture-confirm' },
            h('label', null, t('quick.deadlineLabel')),
            h('input', {
              type: 'date',
              value: confirm.date,
              onChange: function (event) {
                const value = event.target.value;
                setConfirm(function (prev) {
                  return { ...prev, kind: 'deadline', date: value };
                });
              },
            }),
            h(
              'button',
              {
                className: 'primary',
                type: 'button',
                disabled: quickBusy,
                onClick: function () {
                  submitQuick({ ...keep.fields, deadline: confirm.date || toDay(new Date()) }, false, keep);
                },
              },
              t('action.confirmAdd'),
            ),
            h(
              'label',
              { className: 'sct-checkline' },
              h('input', {
                type: 'checkbox',
                onChange: function (event) {
                  // 明确选择"无期限"：openEnded 只表达期限，不参与去重
                  if (event.target.checked) submitQuick({ ...keep.fields, openEnded: true }, false, keep);
                },
              }),
              t('quick.openEnded'),
            ),
            h('button', { type: 'button', className: 'ghost', onClick: function () { setConfirm(null); } }, t('action.cancel')),
          ),
        );
      }

      if (confirm && confirm.kind === 'duplicate') {
        const keep = { text: confirm.text, domain: confirm.domain, fields: confirm.fields || {} };
        captureChildren.push(
          h(
            'div',
            { key: 'dup', className: 'sct-capture-confirm' },
            h('div', { style: { flexBasis: '100%' } }, h('div', { className: 'sct-notch' }, t('quick.duplicateTitle') + '：' + confirm.title + (confirm.reason ? '（' + confirm.reason + '）' : ''))),
            // 并入：把这次内容追加到已有条目的时间轴
            h(
              'button',
              {
                type: 'button',
                className: 'primary',
                disabled: quickBusy,
                onClick: function () { submitQuick(keep.fields, true, keep); },
              },
              t('action.mergeInto'),
            ),
            /**
             * 另建：用 createSeparate 跳过重复判断（U03）。
             * 原来这里传的是 `{ openEnded: true }`——既绕不过去重（后端照样返回 duplicate），
             * 又顺手把用户已选的期限抹成"无期限"。现在显式表达"这是另一件事"，
             * 且**保留原来的 fields**（含 deadline）。
             */
            h(
              'button',
              {
                type: 'button',
                disabled: quickBusy,
                onClick: function () { submitQuick(keep.fields, false, { ...keep, createSeparate: true }); },
              },
              t('action.createSeparate'),
            ),
            h('button', { type: 'button', className: 'ghost', onClick: function () { setConfirm(null); } }, t('action.cancel')),
          ),
        );
      }

      const capture = h(
        'form',
        {
          className: 'sct-capture',
          onSubmit: function (event) {
            event.preventDefault();
            submitQuick();
          },
        },
        captureChildren,
      );

      /**
       * 搜索 + 排序工具条。
       * 搜索图标在左，清空按钮在右；排序用文字按钮循环或下拉。
       * 只在有数据时展示——空库时它没有意义。
       */
      const toolbar = h(
        'div',
        { className: 'sct-toolbar' },
        h(
          'div',
          { className: 'sct-search' },
          h(
            'svg',
            { viewBox: '0 0 24 24', 'aria-hidden': 'true', className: 'sct-search-icon' },
            h('circle', { cx: '11', cy: '11', r: '6.5' }),
            h('path', { d: 'm16 16 4.5 4.5' }),
          ),
          h('input', {
            type: 'search',
            value: search,
            placeholder: t('search.placeholder'),
            'aria-label': t('search.label'),
            onChange: function (event) { setSearch(event.target.value); },
            onKeyDown: function (event) {
              if (event.key === 'Escape') setSearch('');
            },
          }),
          search
            ? h('button', { className: 'sct-search-clear', 'aria-label': t('search.clear'), onClick: function () { setSearch(''); } }, '×')
            : null,
        ),
        h(
          'select',
          {
            className: 'sct-sort',
            'aria-label': t('sort.label'),
            value: ordering,
            onChange: function (event) { setOrdering(event.target.value); },
          },
          h('option', { value: 'default' }, t('sort.default')),
          h('option', { value: 'due' }, t('sort.due')),
          h('option', { value: 'created' }, t('sort.created')),
          h('option', { value: 'updated' }, t('sort.updated')),
          h('option', { value: 'title' }, t('sort.title')),
        ),
      );

      /**
       * 页签（U05）：补齐 role 之外的完整语义。
       *
       * 原实现只加了 `role="tab"` 而没有 `.sct-tab` 类，选中下划线选择器
       * `.sct-tab[aria-selected="true"]::after` 永远命不中——当前页签在视觉上
       * 和未选中的完全一样；也没有 tab/tabpanel 关联、焦点管理与左右键操作。
       *
       * 现在（WAI-ARIA Tabs 手动激活变体）：
       *   - 每个 tab 有 id 与 aria-controls，列表容器有 id 与 aria-labelledby
       *   - 只有活动 tab 的 tabIndex 为 0（roving tabindex）
       *   - ←/→ 移动焦点，Home/End 跳到首尾，Enter/Space 或点击才切换
       */
      const TAB_IDS = { pending: 'sct-tab-pending', all: 'sct-tab-all' };
      const TAB_ORDER = ['pending', 'all'];
      const tabRefs = useRef({});

      const focusTab = function (key) {
        const node = tabRefs.current[key];
        if (node && node.focus) node.focus();
      };

      const onTabKeyDown = function (event) {
        const index = TAB_ORDER.indexOf(tab);
        let nextIndex = null;
        if (event.key === 'ArrowRight') nextIndex = (index + 1) % TAB_ORDER.length;
        else if (event.key === 'ArrowLeft') nextIndex = (index - 1 + TAB_ORDER.length) % TAB_ORDER.length;
        else if (event.key === 'Home') nextIndex = 0;
        else if (event.key === 'End') nextIndex = TAB_ORDER.length - 1;
        else if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          return;
        }
        if (nextIndex === null) return;
        event.preventDefault();
        const key = TAB_ORDER[nextIndex];
        setTab(key);
        focusTab(key);
      };

      const makeTab = function (key, label, count) {
        const selected = tab === key;
        return h(
          'button',
          {
            key: key,
            ref: function (node) { tabRefs.current[key] = node; },
            type: 'button',
            role: 'tab',
            id: TAB_IDS[key],
            className: 'sct-tab',
            'aria-selected': selected ? 'true' : 'false',
            'aria-controls': 'sct-tabpanel',
            tabIndex: selected ? 0 : -1,
            onKeyDown: onTabKeyDown,
            onClick: function () { setTab(key); },
          },
          label,
          h('span', { className: 'sct-count' }, String(count)),
        );
      };

      const tabs = h(
        'div',
        { className: 'sct-tabs', role: 'tablist', 'aria-label': t('tab.list') },
        makeTab('pending', t('tab.pending'), pendingCount),
        makeTab('all', t('tab.all'), totalCount),
      );

      const filter = h(
        'div',
        { className: 'sct-filter', role: 'group', 'aria-label': t('filter.label') },
        h(
          'button',
          { type: 'button', 'aria-pressed': scope === 'user' ? 'true' : 'false', onClick: function () { setScope('user'); } },
          t('filter.user'),
        ),
        domains.map(function (d) {
          return h(
            'button',
            { key: d.id, type: 'button', 'aria-pressed': scope === d.id ? 'true' : 'false', onClick: function () { setScope(d.id); } },
            d.name,
          );
        }),
      );

      let listContent;

      if (!data && snap.phase === 'error') {
        listContent = h(
          'div',
          { className: 'sct-empty', role: 'alert' },
          h('h2', null, t('error.title')),
          h('p', null, t('error.body') + ' ' + snap.error),
          h('button', { className: 'primary', onClick: function () { reload(); } }, t('error.retry')),
        );
      } else if (!data) {
        listContent = h(Skeleton, null);
      } else if (search.trim()) {
        // 搜索态：直接展示命中结果，不分页签/分组——找东西时不该被层级打断
        const hits = searchResult && searchResult.keyword === search.trim() ? searchResult.items : null;
        if (!hits) {
          listContent = h(Skeleton, null);
        } else if (searchResult && searchResult.error) {
          listContent = h(
            'div',
            { className: 'sct-empty', role: 'alert' },
            h('h2', null, t('error.title')),
            h('p', null, searchResult.error),
          );
        } else if (!hits.length) {
          listContent = h(
            'div',
            { className: 'sct-empty' },
            h('h2', null, t('search.emptyTitle')),
            h('p', null, fill(t('search.emptyBody'), search.trim())),
            h('button', { className: 'primary', onClick: function () { setSearch(''); } }, t('search.clear')),
          );
        } else {
          listContent = h(
            'div',
            null,
            h(
              'div',
              { className: 'sct-section-label' },
              h('span', null, t('search.results')),
              h('span', null, fill(t('group.count'), hits.length)),
            ),
            h(
              'div',
              { className: 'sct-tasks' },
              sortItems(hits).map(function (item) {
                return h(TaskRow, {
                  key: item.id,
                  item: item,
                  t: t,
                  onView: onView,
                  onReschedule: onReschedule,
                  onToggleDone: onToggleDone,
                });
              }),
            ),
          );
        }
      } else if (tab === 'pending') {
        // 优先级：有需要提醒的 → 分组列出；否则有在办记录 → 直接列出；都没有 → 空态
        if (pendingCount) {
          listContent = groups.map(function (group) {
            return h(SectionGroup, {
              key: group.key,
              label: group.label,
              items: group.items,
              t: t,
              onView: onView,
              onReschedule: onReschedule,
              onToggleDone: onToggleDone,
            });
          });
        } else if (idleOpen.length) {
          listContent = h(
            'div',
            null,
            h(
              'div',
              { className: 'sct-section-label' },
              h('span', null, t('group.idle')),
              h('span', null, fill(t('group.count'), idleOpen.length)),
            ),
            h(
              'div',
              { className: 'sct-tasks' },
              idleOpen.map(function (item) {
                return h(TaskRow, {
                  key: item.id,
                  item: item,
                  t: t,
                  onView: onView,
                  onReschedule: onReschedule,
                  onToggleDone: onToggleDone,
                });
              }),
            ),
          );
        } else {
          listContent = h(
              'div',
              { className: 'sct-empty' },
              h('div', { className: 'sct-symbol' }, h('svg', { viewBox: '0 0 40 40' }, h('path', { d: 'm10 20 7 7 14-15M5 33h30' }))),
              h('h2', null, firstUse ? t('empty.firstTitle') : t('empty.pendingTitle')),
              h('p', null, firstUse ? t('empty.firstBody') : fill(t('empty.pendingBody'), openInScope)),
              firstUse ? null : h('button', { className: 'primary', onClick: function () { setTab('all'); } }, t('action.showAll')),
            );
        }
      } else {
        listContent = allGroups.length
          ? allGroups.map(function (group) {
              const hidden = Math.max(0, (group.domain.doneCount ?? 0) - (group.done ?? []).length);
              const head = h(
                'div',
                { className: 'sct-section-label' },
                h('span', null, (group.domain.icon || '') + ' ' + group.domain.name),
                h('span', null, group.open.length + ' ' + t('group.open') + ' · ' + t('misc.total') + ' ' + group.domain.total),
              );
              const rows = sortItems(group.open).concat(sortItems(group.done)).map(function (item) {
                return h(TaskRow, {
                  key: item.id,
                  item: item,
                  t: t,
                  onView: onView,
                  onReschedule: onReschedule,
                  onToggleDone: onToggleDone,
                });
              });
              const more =
                hidden > 0
                  ? h(
                      'button',
                      { className: 'sct-load-more', onClick: function () { setDoneLimit('all'); } },
                      fill(t('group.loadMore'), hidden),
                    )
                  : null;
              return h('div', { key: group.domain.id }, head, h('div', { className: 'sct-tasks' }, rows), more);
            })
          : h(
              'div',
              { className: 'sct-empty' },
              h('div', { className: 'sct-symbol' }, h('svg', { viewBox: '0 0 40 40' }, h('path', { d: 'M20 6v13M13 12l7 7 7-7' }))),
              h('h2', null, firstUse ? t('empty.firstTitle') : t('empty.domainTitle')),
              h('p', null, firstUse ? t('empty.firstBody') : t('empty.domainBody')),
            );
      }

      const main = h(
        'main',
        { className: 'sct-main', ref: mainRef },
        h('div', { className: 'sct-main-head' }, capture, tabs, filter, toolbar),
        h(
          'div',
          {
            className: 'sct-list-scroll',
            // tabpanel：与活动页签通过 aria-labelledby 关联（U05）
            id: 'sct-tabpanel',
            role: 'tabpanel',
            tabIndex: -1,
            'aria-labelledby': TAB_IDS[tab],
          },
          listContent,
          h(
            'footer',
            { className: 'sct-list-end' },
            h('span', null, t('footer.note')),
            h('span', null, snap.isStale ? t('error.stale') : t('footer.poll')),
          ),
        ),
      );

      const month = data && data.calendar && data.calendar.month ? monthLabel(data.calendar.month) : null;

      const aside = h(
        'aside',
        { className: 'sct-aside' },
        h(
          'section',
          { className: 'sct-side-block' },
          h(
            'div',
            { className: 'sct-side-title' },
            h('h2', null, t('aside.agenda')),
            h('span', { className: 'small muted' }, t('aside.agendaSub')),
          ),
          h(Agenda, { items: agenda, t: t }),
        ),
        h(
          'section',
          { className: 'sct-side-block' },
          h('div', { className: 'sct-side-title' }, h('h2', null, t('aside.reminders'))),
          h(
            'div',
            { className: 'sct-side-line' },
            h('span', { className: 'muted' }, t('aside.remindTime')),
            h('span', null, (data && data.schedule && data.schedule.reminderAt) || '12:00'),
          ),
          // 两个投递目标分别展示：提醒与报告可以各自绑在不同会话
          h(
            'div',
            { className: 'sct-conn', 'data-state': connectionState },
            h('i', null),
            h('span', null, t('conn.reminderTo')),
            h('b', { className: 'sct-conn-target' }, connectTarget(data, 'reminder')),
          ),
          h(
            'div',
            { className: 'sct-conn', 'data-state': reportConnState },
            h('i', null),
            h('span', null, t('conn.reportTo')),
            h('b', { className: 'sct-conn-target' }, connectTarget(data, 'report')),
          ),
          data && data.state && data.state.sameSession ? null : h('p', { className: 'sct-conn-note' }, t('conn.splitNote')),
          // 未绑定/失效时明确告诉用户：报告会停在这里等绑定
          connectionState !== 'bound' || reportConnState !== 'bound' ? h('p', { className: 'sct-conn-warn' }, t('conn.reportBlocked')) : null,
          /**
           * B06：这里原来显示"报告处理窗口 22:00—06:00"，与真实调度不符——
           * 四类报告都在各自周期最后一天的设定时刻直接投递，**不受**夜间窗口推迟。
           * 现在改为逐条列出真实生成时间，与 系统/调度.json 完全一致。
           */
          h(
            'div',
            { className: 'sct-side-line' },
            h('span', { className: 'muted' }, t('aside.reportSchedule')),
            h('span', null, (data && data.schedule && data.schedule.monthlyAt) || '20:00'),
          ),
          h(
            'ul',
            { className: 'sct-report-list' },
            h('li', null, fill(t('aside.reportMonthly'), (data && data.schedule && data.schedule.monthlyAt) || '20:00')),
            h('li', null, fill(t('aside.reportQuarterly'), (data && data.schedule && data.schedule.quarterlyAt) || '20:00')),
            h('li', null, fill(t('aside.reportHalf'), (data && data.schedule && data.schedule.halfAt) || '20:00')),
            h('li', null, fill(t('aside.reportYearly'), (data && data.schedule && data.schedule.yearlyAt) || '20:00')),
          ),
          /* 错过的周期必须说出来：不自动补执行是规则，但"错过"不能悄悄消失。
             B06 同时要求"任务已提交"不能显示成"报告已生成"，这里只报事实。 */
          data && data.state && data.state.missedReports
            ? h('p', { className: 'sct-conn-warn' }, fill(t('aside.reportMissed'), data.state.missedReports, (data.state.missedKeys || []).join('、')))
            : null,
          h('p', { className: 'sct-side-note' }, t('aside.reportNote')),
        ),
        h(
          'section',
          { className: 'sct-side-block' },
          // 日历常驻展开：不做折叠开关，用户明确要求"直接展开，不需要收起"
          h(
            'div',
            { className: 'sct-cal-head' },
            h('h2', null, month ? fill(t('aside.calendar'), month.y, month.m) : t('aside.calendarTitle')),
          ),
          h(Calendar, { calendar: data && data.calendar }),
          data && data.calendar && data.calendar.holidayDataMissing
            ? h('p', { className: 'sct-side-note' }, t('aside.calendarMissing'))
            : null,
        ),
      );

      const drawers = [
        h(DetailDrawer, {
          key: 'detail',
          item: detailItem,
          t: t,
          onClose: function () { setDetailItem(null); },
          onReschedule: onReschedule,
          onToggleDone: onToggleDone,
          onPromote: onPromote,
          onSave: onSaveDetail,
        }),
        h(RescheduleDrawer, {
          key: 'reschedule',
          state: reschedule,
          t: t,
          onCancel: function () { setReschedule({ item: null, date: '', error: '', busy: false }); },
          onConfirm: doReschedule,
          onDate: function (value) {
            setReschedule(function (prev) { return { item: prev.item, date: value, error: '', busy: false }; });
          },
        }),
        h(PromoteDrawer, {
          key: 'promote',
          state: promote,
          t: t,
          onCancel: function () { setPromote({ item: null, title: '', date: '', error: '', busy: false }); },
          onConfirm: doPromote,
          onDate: function (value) {
            setPromote(function (prev) { return { item: prev.item, title: prev.title, date: value, error: '', busy: false }; });
          },
        }),
        h(SettingsDrawer, {
          key: 'settings',
          state: settings,
          t: t,
          onCancel: function () { setSettings({ open: false, time: settings.time, busy: false, error: '' }); },
          onSave: saveSettings,
          onTime: function (value) {
            setSettings(function (prev) { return { open: true, time: value, busy: false, error: '' }; });
          },
        }),
      ];

      const toastNode = toast
        ? h('div', { className: 'sct-toast', role: 'status', 'aria-live': 'polite' }, h('span', null, toast))
        : null;

      return h(
        'div',
        { className: 'sct-root' },
        topbar,
        h('div', { className: 'sct-scroll' }, h('div', { className: 'sct-shell' }, hero, h('div', { className: 'sct-layout' }, main, aside))),
        drawers,
        toastNode,
      );
    }

    return {
      inject: ['slots', 'locale'],
      apply(ctx) {
        ctx.effect(function () {
          const offZh = ctx.locale.register(NS, 'zh', MESSAGES.zh);
          const offEn = ctx.locale.register(NS, 'en', MESSAGES.en);
          return function () {
            offZh();
            offEn();
          };
        }, 'dsh-secretary: locale');

        ctx.effect(function () {
          const style = document.createElement('style');
          style.setAttribute('data-dsh-secretary', '');
          style.textContent = TOKEN_CSS + CSS;
          document.head.appendChild(style);
          return function () {
            style.remove();
          };
        }, 'dsh-secretary: style');

        const t = ctx.locale.bind(NS);

        ctx.slots.inject('sidebar.panellist', function () {
          return ctx.slots.register(
            { name: 'sidebar.panellist', id: 'secretary', order: 40, label: function () { return t('sidebar.label'); } },
            SidebarIcon,
          );
        });

        ctx.slots.inject('main', function () {
          return ctx.slots.register({ name: 'main', key: 'secretary' }, Panel);
        });
      },
    };
  },
});

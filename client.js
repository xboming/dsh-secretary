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
  --zw-font:"Segoe UI","Microsoft YaHei UI","PingFang SC",sans-serif;
}
`;

    const CSS = `
.sct-root{display:flex;flex-direction:column;height:100%;min-height:0;background:var(--dsw-alias-bg-base);color:var(--zw-text);font:14px/1.6 var(--zw-font)}
.sct-root *{box-sizing:border-box}
.sct-root button{font:inherit;cursor:pointer;color:inherit;background:var(--zw-surface);border:1px solid var(--zw-line);border-radius:6px;min-height:36px;padding:7px 13px;transition:background .13s,border-color .13s}
.sct-root button:hover{background:var(--zw-hover)}
.sct-root button:disabled{opacity:.45;cursor:not-allowed}
.sct-root button.primary{background:var(--zw-accent);border-color:transparent;color:var(--zw-accent-text);font-weight:600}
.sct-root button.ghost{background:transparent;border-color:transparent;color:var(--zw-muted)}
.sct-root button.ghost:hover{color:var(--zw-text);background:var(--zw-hover)}
.sct-root input,.sct-root select{font:inherit;color:inherit;background:var(--zw-surface);border:1px solid var(--zw-line);border-radius:6px;padding:8px 12px;max-width:100%}
.sct-root button:focus-visible,.sct-root input:focus-visible,.sct-root select:focus-visible{outline:2px solid var(--zw-focus);outline-offset:3px}
.sct-root svg{width:20px;height:20px;fill:none;stroke:currentColor;stroke-width:1.6;stroke-linecap:round;stroke-linejoin:round;flex-shrink:0}
.sct-root h1,.sct-root h2,.sct-root h3,.sct-root p{margin:0}
.sct-root .muted{color:var(--zw-muted)}
.sct-root .small{font-size:12px;line-height:1.5}
.sct-topbar{display:flex;align-items:center;justify-content:space-between;gap:16px;height:88px;padding:0 24px;border-bottom:1px solid var(--zw-line);max-width:1248px;margin:0 auto;width:100%;flex:none}
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
.sct-shell{max-width:1248px;margin:0 auto;padding:0 24px;width:100%;flex:1;min-height:0;display:flex;flex-direction:column}
.sct-hero{display:flex;align-items:flex-end;justify-content:space-between;gap:16px;padding:36px 0 28px;flex:none}
.sct-eyebrow{font-size:12px;color:var(--zw-muted);letter-spacing:.4px;margin-bottom:10px}
.sct-hero h1{font-size:30px;line-height:1.35;font-weight:600;letter-spacing:-.6px}
.sct-summary{margin-top:8px;color:var(--zw-muted);font-size:14px}
.sct-hero-side{font-size:12px;color:var(--zw-muted);white-space:nowrap}
.sct-layout{display:grid;grid-template-columns:minmax(0,1fr) 272px;gap:36px;align-items:stretch;flex:1;min-height:0}
.sct-main{display:flex;flex-direction:column;min-height:0;overflow:hidden}
.sct-main-head{flex:none;display:flex;flex-direction:column;min-width:0}
.sct-list-scroll{flex:1;min-height:0;overflow-y:auto;overflow-x:hidden;overscroll-behavior:contain;padding-bottom:32px;scrollbar-gutter:stable}
.sct-aside{display:flex;flex-direction:column;gap:24px;min-height:0;overflow-y:auto;padding-bottom:32px;scrollbar-gutter:stable}
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
.sct-notch{flex-basis:100%;background:var(--zw-raised);border-radius:6px;padding:10px 12px;font-size:12.5px;color:var(--zw-muted)}
.sct-tabs{display:flex;gap:20px;border-bottom:1px solid var(--zw-line);margin-bottom:14px}
.sct-tab{height:44px;padding:0 2px;border:0;border-radius:0;background:transparent;color:var(--zw-muted);font-size:15px;font-weight:500;position:relative}
.sct-tab:hover{background:transparent;color:var(--zw-text)}
.sct-tab[aria-selected="true"]{color:var(--zw-text);font-weight:600}
.sct-tab[aria-selected="true"]::after{content:"";position:absolute;left:0;right:0;bottom:-1px;height:2px;background:var(--zw-accent)}
.sct-count{font-size:12px;color:var(--zw-muted);margin-left:5px;font-weight:400;font-variant-numeric:tabular-nums}
.sct-filter{display:flex;flex-wrap:wrap;gap:3px;margin-bottom:6px}
.sct-filter button{min-height:34px;padding:5px 11px;font-size:13px;background:transparent;border-color:transparent;color:var(--zw-muted)}
.sct-filter button:hover{color:var(--zw-text);background:var(--zw-hover)}
.sct-filter button[aria-pressed="true"]{background:var(--zw-accent-soft);border-color:transparent;color:var(--zw-accent);font-weight:600}
.sct-section-label{display:flex;justify-content:space-between;align-items:baseline;margin:20px 0 10px;font-size:12px;color:var(--zw-muted);letter-spacing:.3px}
.sct-section-label:first-of-type{margin-top:8px}
.sct-tasks{display:flex;flex-direction:column;gap:10px}
.sct-task{display:flex;align-items:flex-start;gap:12px;background:var(--zw-surface);border:1px solid var(--zw-line);border-radius:12px;padding:14px 18px;transition:border-color .14s}
.sct-task:hover{border-color:var(--zw-line-strong)}
.sct-task[data-done="true"]{opacity:.6}
.sct-check{flex:none;width:24px;height:24px;min-height:24px;padding:0;margin-top:2px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:12px;position:relative}
.sct-check::before{content:"";position:absolute;inset:-8px}
.sct-check[data-shape="idea"]{color:var(--zw-accent)}
.sct-task-body{flex:1;min-width:0;display:flex;flex-direction:column;gap:5px}
.sct-task-title{background:none;border:0;padding:0;min-height:0;text-align:left;font-size:15px;font-weight:600;line-height:1.5;color:var(--zw-text);white-space:normal;overflow-wrap:anywhere;border-radius:4px}
.sct-task-title:hover{background:var(--zw-hover)}
.sct-task-meta{display:flex;flex-wrap:wrap;align-items:center;gap:4px 8px;font-size:12px;color:var(--zw-muted)}
.sct-status{display:inline-flex;align-items:center;padding:1px 8px;border-radius:999px;font-size:11.5px;font-weight:500}
.sct-status[data-kind="danger"]{background:var(--zw-danger-soft);color:var(--zw-danger)}
.sct-status[data-kind="today"]{background:var(--zw-accent-soft);color:var(--zw-accent);font-weight:600}
.sct-status[data-kind="warn"]{background:var(--zw-warn-soft);color:var(--zw-warning)}
.sct-status[data-kind="info"]{background:var(--zw-raised);color:var(--zw-muted)}
.sct-task-note{font-size:13px;color:var(--zw-muted)}
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
.sct-side-note{font-size:12px;color:var(--zw-muted);margin-top:12px;line-height:1.7}
.sct-cal-head{margin-bottom:12px}
.sct-cal-head h2{font-size:16px;font-weight:600}
.sct-quiet-note{margin-top:14px;font-size:12px;color:var(--zw-muted)}
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
.sct-drawer{width:520px;max-width:calc(100% - 32px);background:var(--zw-surface);color:var(--zw-text);border:1px solid var(--zw-line);border-radius:16px;padding:22px;box-shadow:0 20px 70px rgba(0,0,0,.32)}
.sct-drawer::backdrop{background:rgba(0,0,0,.5)}
.sct-drawer h2{font-size:20px;font-weight:600;margin:10px 0 6px}
.sct-drawer section{margin:16px 0;padding-top:14px;border-top:1px solid var(--zw-line)}
.sct-drawer section h3{font-size:12px;font-weight:600;color:var(--zw-muted);letter-spacing:.4px;margin-bottom:8px}
.sct-drawer footer{display:flex;justify-content:flex-end;gap:8px;margin-top:18px}
.sct-drawer label{display:block;font-size:12.5px;color:var(--zw-muted);margin:12px 0 6px}
.sct-drawer input[type="date"],.sct-drawer input[type="time"]{width:100%;padding:9px 12px}
.sct-notice{background:var(--zw-raised);border-radius:6px;padding:10px 12px;font-size:12px;color:var(--zw-muted);margin-top:14px}
.sct-error{color:var(--zw-danger);font-size:12.5px;margin-top:10px}
.sct-tl{display:flex;flex-direction:column;gap:10px}
.sct-tl-item{padding-left:14px;border-left:2px solid var(--zw-line);font-size:13px}
.sct-tl-item b{display:block;font-size:11.5px;color:var(--zw-muted);font-weight:500;margin-bottom:2px}
.sct-tl-item blockquote{margin:2px 0 0;padding-left:10px;border-left:2px solid var(--zw-accent);color:var(--zw-text);font-size:13px}
.sct-toast{position:fixed;bottom:28px;left:50%;transform:translateX(-50%);background:var(--zw-surface);border:1px solid var(--zw-line-strong);border-radius:10px;padding:11px 16px;font-size:13px;box-shadow:0 20px 70px rgba(0,0,0,.35);z-index:60}
@media(prefers-reduced-motion:reduce){.sct-root *{transition:none !important}}
@media(max-width:1059px){
  .sct-layout{grid-template-columns:minmax(0,1fr);gap:24px;flex:1;min-height:0}
  .sct-main{overflow:hidden}
  .sct-aside{display:grid;grid-template-columns:1fr 1fr;gap:24px;overflow:visible;padding-bottom:0}
  .sct-aside .sct-side-block:last-child{grid-column:1/-1}
  .sct-topbar{height:76px}
}
@media(max-width:720px){
  .sct-topbar{height:auto;padding:14px 16px;flex-wrap:wrap;gap:8px}
  .sct-shell{padding:0 16px}
  .sct-hero{padding:24px 0 20px;flex-direction:column;align-items:flex-start;gap:10px}
  .sct-hero h1{font-size:24px}
  .sct-aside{grid-template-columns:1fr}
  .sct-brand p{display:none}
  .sct-task{padding:14px 12px}
  .sct-task-actions{align-self:flex-end}
  .sct-drawer{padding:18px}
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
        'filter.user': '用户记录',
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
        'group.idleNote': '当前没有逾期、临期、停滞或沉睡提醒，以上是这一范围全部在办记录。',
        'group.open': '进行中',
        'group.count': '{n} 条',
        'status.overdue': '逾期 {n} 天',
        'status.today': '今天到期',
        'status.soon': '剩 {n} 个工作日',
        'status.sleep': '沉睡 {n} 天',
        'status.stale': '停滞 {n} 天',
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
        'aside.reportWindow': '报告处理窗口',
        'aside.reportNote': '需要完整周报时，在对话中说「帮我整理上周周报」。',
        'aside.calendar': '{y} 年 {m} 月',
        'aside.expand': '展开月历 ＋',
        'aside.collapse': '收起月历 −',
        'aside.calendarMissing': '节假日数据缺失，按周末近似显示',
        'conn.bound': '会话已绑定',
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
        'filter.user': 'My records',
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
        'group.idleNote': 'Nothing overdue, due soon, stalled or dormant. These are all open records in this scope.',
        'group.open': 'in progress',
        'group.count': '{n} item(s)',
        'status.overdue': 'Overdue {n}d',
        'status.today': 'Due today',
        'status.soon': '{n} workdays left',
        'status.sleep': 'Dormant {n}d',
        'status.stale': 'Stalled {n}d',
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
        'aside.reportWindow': 'Report window',
        'aside.reportNote': 'For a full weekly report, ask in chat: "summarize last week".',
        'aside.calendar': '{y}/{m}',
        'aside.expand': 'Calendar ＋',
        'aside.collapse': 'Calendar −',
        'aside.calendarMissing': 'Holiday data missing — approximating by weekends',
        'conn.bound': 'Session bound',
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
      const chips = [];
      if (done) {
        chips.push({ text: t('status.done'), kind: 'info' });
      } else if (item.due && item.due.level === 'overdue') {
        chips.push({ text: fill(t('status.overdue'), Math.abs(item.workingDays || 0)), kind: 'danger' });
      } else if (item.due && item.due.level === 'today') {
        chips.push({ text: t('status.today'), kind: 'today' });
      } else if (item.due && item.due.level === 'soon') {
        chips.push({ text: fill(t('status.soon'), item.workingDays), kind: 'warn' });
      }
      if (!done && (item.stallDays || 0) >= 5) {
        chips.push({ text: fill(t('status.stale'), item.stallDays), kind: 'warn' });
      }
      if (isIdea && !item.promotedTo && (item.dormantDays || 0) >= 1) {
        chips.push({ text: fill(t('status.sleep'), item.dormantDays), kind: 'info' });
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
            'data-shape': isIdea ? 'idea' : 'task',
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
          h('button', { className: 'sct-task-title', onClick: function () { props.onView(item); } }, item.title),
          h('div', { className: 'sct-task-meta' }, meta),
          note ? h('p', { className: 'sct-task-note' }, String(note).slice(0, 90)) : null,
        ),
        h(
          'div',
          { className: 'sct-task-actions' },
          h('button', { className: 'ghost', onClick: function () { props.onView(item); } }, t('action.view')),
          !done && !isIdea
            ? h('button', { className: 'ghost', onClick: function () { props.onReschedule(item); } }, t('action.reschedule'))
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

      return h(
        Drawer,
        { open: true, onClose: props.onClose, label: item.title },
        h(
          'div',
          null,
          head,
          h('h2', null, item.title),
          h('div', { className: 'sct-task-meta' }, meta),
          // 编辑入口：放在 meta 下方，随时可改「下一步 / 分类」
          edit
            ? null
            : h(
                'div',
                { className: 'sct-edit-entry' },
                h('button', { className: 'ghost', type: 'button', onClick: startEdit }, t('action.edit')),
              ),
          nextSection,
          editSection,
          timelineSection,
          notesSection,
          footer,
        ),
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

      const submitQuick = useCallback(
        async function (extraFields, updateExisting) {
          const text = draft.trim();
          if (!text) {
            setQuickError(t('quick.empty'));
            return;
          }
          setQuickBusy(true);
          setQuickError('');
          try {
            const data = await request('/add', jsonBody({ domain: domain, text: text, fields: extraFields || {}, updateExisting: updateExisting === true }));
            const result = (data && data.result) || {};
            if (result.action === 'need_deadline') {
              setConfirm({ kind: 'deadline', date: toDay(new Date()) });
              setQuickBusy(false);
              return;
            }
            if (result.action === 'duplicate') {
              setConfirm({ kind: 'duplicate', id: result.id, title: result.title, reason: result.reason });
              setQuickBusy(false);
              return;
            }
            setDraft('');
            setConfirm(null);
            setQuickBusy(false);
            showToast(fill(t('quick.saved'), result.id || '', NAMES[result.domain || domain] || ''));
            await reload();
          } catch (error) {
            setQuickBusy(false);
            setQuickError(t('quick.errorGeneric') + ' ' + ((error && error.message) || error));
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
      const connectionState = data && data.state
        ? (data.state.scheduleLost ? 'lost' : data.state.reminderSession ? 'bound' : 'none')
        : 'none';

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
                setConfirm(function (prev) { return { kind: 'deadline', date: value }; });
              },
            }),
            h(
              'button',
              {
                className: 'primary',
                type: 'button',
                disabled: quickBusy,
                onClick: function () { submitQuick({ deadline: confirm.date || toDay(new Date()) }); },
              },
              t('action.confirmAdd'),
            ),
            h(
              'label',
              { className: 'sct-checkline' },
              h('input', {
                type: 'checkbox',
                onChange: function (event) {
                  if (event.target.checked) submitQuick({ openEnded: true });
                },
              }),
              t('quick.openEnded'),
            ),
            h('button', { type: 'button', className: 'ghost', onClick: function () { setConfirm(null); } }, t('action.cancel')),
          ),
        );
      }

      if (confirm && confirm.kind === 'duplicate') {
        captureChildren.push(
          h(
            'div',
            { key: 'dup', className: 'sct-capture-confirm' },
            h('div', { style: { flexBasis: '100%' } }, h('div', { className: 'sct-notch' }, t('quick.duplicateTitle') + '：' + confirm.title + (confirm.reason ? '（' + confirm.reason + '）' : ''))),
            h('button', { type: 'button', className: 'primary', disabled: quickBusy, onClick: function () { submitQuick({}, true); } }, t('action.mergeInto')),
            h('button', { type: 'button', onClick: function () { submitQuick({ openEnded: true }); } }, t('action.createSeparate')),
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

      const tabs = h(
        'div',
        { className: 'sct-tabs', role: 'tablist' },
        h(
          'button',
          { role: 'tab', 'aria-selected': tab === 'pending' ? 'true' : 'false', onClick: function () { setTab('pending'); } },
          t('tab.pending'),
          h('span', { className: 'sct-count' }, String(pendingCount)),
        ),
        h(
          'button',
          { role: 'tab', 'aria-selected': tab === 'all' ? 'true' : 'false', onClick: function () { setTab('all'); } },
          t('tab.all'),
          h('span', { className: 'sct-count' }, String(totalCount)),
        ),
      );

      const filter = h(
        'div',
        { className: 'sct-filter' },
        h(
          'button',
          { 'aria-pressed': scope === 'user' ? 'true' : 'false', onClick: function () { setScope('user'); } },
          t('filter.user'),
        ),
        domains.map(function (d) {
          return h(
            'button',
            { key: d.id, 'aria-pressed': scope === d.id ? 'true' : 'false', onClick: function () { setScope(d.id); } },
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
            h('p', { className: 'sct-quiet-note' }, t('group.idleNote')),
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
        { className: 'sct-main' },
        h('div', { className: 'sct-main-head' }, capture, tabs, filter, toolbar),
        h(
          'div',
          { className: 'sct-list-scroll' },
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
          h(
            'div',
            { className: 'sct-conn', 'data-state': connectionState },
            h('i', null),
            h(
              'span',
              null,
              connectionState === 'bound' ? t('conn.bound') : connectionState === 'lost' ? t('conn.lost') : t('conn.none'),
            ),
          ),
          h(
            'div',
            { className: 'sct-side-line' },
            h('span', { className: 'muted' }, t('aside.reportWindow')),
            h(
              'span',
              null,
              data && data.schedule && data.schedule.reportWindow
                ? data.schedule.reportWindow.start + '—' + data.schedule.reportWindow.end
                : '—',
            ),
          ),
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

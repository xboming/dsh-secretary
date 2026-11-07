window.__ModuleLoader__.load({
  id: 'dsh-secretary',
  factory(require) {
    const React = require('react');
    const h = React.createElement;
    const { useCallback, useEffect, useMemo, useRef, useState } = React;

    const NS = 'dsh-secretary';
    const API = '/dsh-secretary/api';
    const THEME_KEY = NS + ':theme';
    const validTheme = (value) => ['light', 'dark', 'system'].includes(value) ? value : 'system';

    /**
     * 金额缩写（前端版）。
     *
     * 后端 lib/board.js 有一份同样的实现，但客户端跑在浏览器里，
     * 引不到后端模块——两边各留一份是必然的。
     * 口径必须一致（万以下给原数、超过 100 万取整），所以这里照抄，
     * 改的时候两边一起改。测试 review-board.mjs 会锁住后端那份的行为。
     */
    function compactMoney(value) {
      const n = Number(value);
      if (!Number.isFinite(n)) return '0';
      const abs = Math.abs(n);
      if (abs === 0) return '0';
      if (abs < 10000) return String(Math.round(n));
      const wan = n / 10000;
      const shown = Math.abs(wan) >= 100 ? Math.round(wan) : Math.round(wan * 10) / 10;
      return shown + '万';
    }

    function useTheme() {
      const [theme, setTheme] = useState(function () {
        try { return validTheme(window.localStorage.getItem(THEME_KEY)); } catch { return 'system'; }
      });
      const [systemDark, setSystemDark] = useState(function () {
        return Boolean(window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches);
      });
      useEffect(function () {
        if (!window.matchMedia) return;
        const media = window.matchMedia('(prefers-color-scheme: dark)');
        const update = () => setSystemDark(media.matches);
        update();
        media.addEventListener('change', update);
        return () => media.removeEventListener('change', update);
      }, []);
      useEffect(function () {
        const sync = (event) => {
          if (event.key === THEME_KEY || event.key === null) setTheme(validTheme(event.newValue));
        };
        window.addEventListener('storage', sync);
        return () => window.removeEventListener('storage', sync);
      }, []);
      function choose(value) {
        const next = validTheme(value);
        setTheme(next);
        try { window.localStorage.setItem(THEME_KEY, next); } catch { /* Session-only when storage is unavailable. */ }
      }
      return { theme, choose, resolved: theme === 'system' ? (systemDark ? 'dark' : 'light') : theme };
    }

    /**
     * 域中文名兜底表。
     *
     * **加新域必须同步这里**：它写死了域 id → 中文名，
     * 快照里的 `domainName` 只在条目视图里有，列表行的域标签用的是这张表。
     * 漏了的表现是面板上直接显示英文 id（`sales · S-2026-001`），
     * 不报错、不影响功能，但界面看着像没做完。
     *
     * ── 这张表必须是**兜底**，不能是真相 ──
     * 真相在 lib/domains.js 的 name（后端随快照下发 domainName）。
     * 这里只在拿不到下发值时用。两者不一致时以外部给的为准——
     * 之前它落后过一次（缺 opportunity/contract，visit 还叫旧名），
     * 面板上就出现了和域表对不上的标签。
     *
     * 统一四字：面板按钮宽度一致，也不会被截断。
     */
    const NAMES = {
      // work 显示为「日常事务」：它是"不是商机的事"，不是"所有工作"。
      // 之前叫"工作"时，用户实际的工作八成落在销售域，记东西要反复纠结放哪。
      work: '日常事务',
      opportunity: '商机管理',
      sales: '项目销售',
      implement: '实施交付',
      contract: '合同管理',
      visit: '客户交流',
      creation: '创作管理',
      idea: '灵感记录',
      assistant: '助手备忘',
    };

    const TOKEN_CSS = `
.sct-root{
  color-scheme:light;
  --dsw-alias-bg-base:#f3f5f9;
  --dsw-alias-bg-layer-1:#ffffff;
  --dsw-alias-bg-layer-2:#eef2f8;
  --dsw-alias-border-l1:#dfe5ee;
  --dsw-alias-border-l2:#aab7ca;
  --dsw-alias-label-primary:#202e46;
  --dsw-alias-label-secondary:#5d6b81;
  --dsw-alias-brand-primary:#345fc4;
  --dsw-alias-state-error-primary:#b3303c;
  --dsw-alias-state-warn-primary:#876015;
  --dsw-alias-state-success-primary:#287454;
  --zw-surface:var(--dsw-alias-bg-layer-1);
  --zw-raised:var(--dsw-alias-bg-layer-2);
  --zw-hover:color-mix(in srgb,var(--dsw-alias-label-primary) 5%,transparent);
  --zw-line:var(--dsw-alias-border-l1);
  --zw-line-strong:var(--dsw-alias-border-l2);
  --zw-text:var(--dsw-alias-label-primary);
  --zw-muted:var(--dsw-alias-label-secondary);
  --zw-accent:var(--dsw-alias-brand-primary);
  --zw-accent-text:#ffffff;
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
.sct-root[data-theme="dark"]{
  color-scheme:dark;
  --dsw-alias-bg-base:#141b29;
  --dsw-alias-bg-layer-1:#1c2637;
  --dsw-alias-bg-layer-2:#273348;
  --dsw-alias-border-l1:#35435a;
  --dsw-alias-border-l2:#60728c;
  --dsw-alias-label-primary:#e8eef9;
  --dsw-alias-label-secondary:#aab9ce;
  --dsw-alias-brand-primary:#a9c3ff;
  --dsw-alias-state-error-primary:#ff9a9e;
  --dsw-alias-state-warn-primary:#e6c477;
  --dsw-alias-state-success-primary:#8ed5b1;
  --zw-accent-text:#172b52;
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
.sct-root input[type="date"],.sct-root input[type="time"]{color-scheme:inherit}
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
/*
 * 看板页：**固定一屏，不滚动**。
 *
 * ── 为什么必须改布局而不是缩字号 ──
 * 实测竖排一层：顶部切换条 32 + 四个数字 89 + 四个区块 686 = 921px。
 * 笔记本视口扣掉面板顶栏后约 470px，差得太远。
 *
 * ── 三列，按"内容需要多宽"分配 ──
 *   左   各项工作表        窄：领域名 + 四个数字列
 *   中   回款 + 风险       窄：两列小表 / 一行一条
 *   右   漏斗 + 趋势       宽：漏斗要横排四段，趋势要放 12 根柱子
 *
 * 漏斗**必须放宽列**：它天然是横向的"商机 → 项目销售 → 合同 → 实施"，
 * 挤进窄列会变成竖排一堆方块，看上面的箭头就完全断掉了。
 *
 * ── 为什么用 minmax(0,1fr) 而不是 1fr ──
 * grid 的 1fr 默认不收缩到内容以下，长文本会把列撑宽、
 * 进而把整个网格挤出容器。minmax(0,1fr) 才允许真正压缩。
 */

/* ── 数据看板：五个标签 + 五张图 ── */

/*
 * 看板页：**固定一屏不滚动**。
 *
 * 3 行结构：
 *   1. 时间窗口切换条
 *   2. 五个数据标签（横排）
 *   3. 五张图（网格：上排三张，下排两张）
 *
 * 为什么不滚动：这页是"扫一眼看整体"的，需要滚动就意味着
 * 第一屏看到的东西不完整，用户还得往下找。
 */
.sct-board-page{
  display:flex;
  flex-direction:column;
  gap:12px;
  height:100%;
  min-height:0;
  overflow:hidden;
  padding-top:2px;
}

/* ── 时间窗口切换 ── */
.sct-boardbar{display:flex;align-items:center;gap:12px;flex-wrap:wrap;flex:none}
.sct-boardbar-tabs{display:inline-flex;border:1px solid var(--zw-line);border-radius:8px;overflow:hidden}
.sct-winbtn{border:0;background:transparent;color:var(--zw-muted);font-size:12.5px;padding:6px 13px;cursor:pointer;font-family:inherit}
.sct-winbtn:hover{background:var(--zw-hover)}
.sct-winbtn.is-active{background:var(--zw-accent-soft);color:var(--zw-text);font-weight:600}
.sct-winbtn+.sct-winbtn{border-left:1px solid var(--zw-line)}
.sct-boardbar-dates{display:flex;align-items:center;gap:7px}
.sct-boardbar-dates input{border:1px solid var(--zw-line);background:var(--zw-raised);color:var(--zw-text);border-radius:7px;padding:5px 9px;font-size:12.5px;font-family:inherit}
.sct-boardbar-sep{color:var(--zw-muted);font-size:12px}
.sct-boardbar-label{font-size:12.5px;color:var(--zw-muted);margin-left:auto}

/* ── 五个数据标签 ── */
/*
 * 等分五列。第一张（签订合同额）用强调色：
 * 它是唯一的金额，也是最先被看的数字。
 * 数值用 tabular-nums，位数变化时不会左右跳。
 */
.sct-stats{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:10px;flex:none}
.sct-stat{display:flex;flex-direction:column;gap:2px;padding:11px 14px;border:1px solid var(--zw-line);border-radius:9px;background:var(--zw-raised);min-width:0}
.sct-stat.is-accent{border-color:var(--zw-accent);background:var(--zw-accent-soft)}
.sct-stat-key{font-size:11.5px;color:var(--zw-muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.sct-stat-val{font-size:23px;font-weight:600;letter-spacing:-.5px;line-height:1.15;font-variant-numeric:tabular-nums;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.sct-stat.is-accent .sct-stat-val{color:var(--zw-accent)}
.sct-stat-note{font-size:10.5px;color:var(--zw-muted);opacity:.85;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}

/* ── 图表网格：上排三张、下排两张 ── */
/*
 * 用 6 列网格让上下两排对齐：上排每张占 2 列、下排每张占 3 列。
 * 直接写 grid-template-columns:repeat(3,1fr) 时下排两张会各占 1/3、
 * 右边空一大块，看着像少画了一张。
 */
.sct-board-grid{
  display:grid;
  grid-template-columns:repeat(6,minmax(0,1fr));
  gap:12px;
  flex:1;
  min-height:0;
  overflow:hidden;
}
.sct-panel{
  display:flex;
  flex-direction:column;
  min-width:0;
  min-height:0;
  border:1px solid var(--zw-line);
  border-radius:10px;
  background:var(--zw-surface);
  padding:10px 12px;
  overflow:hidden;
}
/* 前三个面板各占 2 列（上排三张） */
.sct-panel:nth-child(1),
.sct-panel:nth-child(2),
.sct-panel:nth-child(3){grid-column:span 2}
/* 后两个各占 3 列（下排两张） */
.sct-panel:nth-child(4),
.sct-panel:nth-child(5){grid-column:span 3}

.sct-panel-head{display:flex;align-items:baseline;justify-content:space-between;gap:8px;flex:none;padding-bottom:7px}
.sct-panel-head h3{font-size:12.5px;font-weight:600;color:var(--zw-text);margin:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.sct-panel-extra{font-size:11px;color:var(--zw-muted);white-space:nowrap;font-variant-numeric:tabular-nums}
.sct-panel-body{flex:1;min-height:0;display:flex;flex-direction:column;justify-content:flex-end;overflow:hidden}

/* ── 横向条形（销售项目跟踪状态） ── */
.sct-chart-hbar{display:flex;flex-direction:column;justify-content:center;gap:8px;height:100%;min-height:0}
.sct-chart-hbar.sct-chart-compact{gap:9px}
.sct-hbar-row{display:grid;grid-template-columns:minmax(52px,auto) minmax(0,1fr) 28px;align-items:center;gap:9px;min-width:0}
.sct-hbar-name{font-size:12px;color:var(--zw-text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.sct-hbar-track{height:12px;border-radius:3px;background:var(--zw-raised);overflow:hidden;min-width:0;display:flex}
.sct-hbar-fill{height:100%;border-radius:2px;min-width:2px}
.sct-hbar-open{background:var(--zw-accent)}
.sct-hbar-ok{background:var(--zw-success)}
.sct-hbar-bad{background:var(--zw-danger)}
/* 数据标签：每行右侧直接写数量 */
.sct-hbar-value{font-size:12.5px;font-variant-numeric:tabular-nums;text-align:right;white-space:nowrap}
.sct-hbar-value strong{font-weight:600}

/* ── 竖向柱状（三张月度图） ── */
/*
 * 高度交给容器：面板 body 是 flex:1，柱状图撑满。
 * 数值行和标签行 flex:none，柱子段 flex:1——柱子被压缩时
 * **数字永远还在**，不会跟着消失。
 */
.sct-chart-bar{display:flex;align-items:stretch;gap:5px;flex:1;min-height:0;overflow:hidden}
.sct-chart-bar-tall{min-height:72px}
.sct-cbar-col{flex:1;min-width:0;height:100%;display:flex;flex-direction:column;align-items:center;justify-content:flex-end;gap:2px;overflow:hidden}
.sct-cbar-value{font-size:10.5px;font-weight:600;font-variant-numeric:tabular-nums;color:var(--zw-text);line-height:1;white-space:nowrap;flex:none;height:12px;display:flex;align-items:flex-end}
.sct-cbar-track{width:100%;flex:1 1 auto;min-height:0;display:flex;align-items:flex-end;justify-content:center}
.sct-cbar-fill{width:min(100%,22px);border-radius:3px 3px 0 0;background:var(--zw-accent)}
/* 三张图各用一个颜色，方便区分（同一页里三张柱状图，同色会看串） */
.sct-cbar-blue{background:#58a6ff}
.sct-cbar-green{background:var(--zw-success)}
.sct-cbar-purple{background:#bc8cff}
/* 窗口外的月份：留形状不留势，且不标数值 */
.sct-cbar-fill.is-muted{background:var(--zw-line-strong);opacity:.5}
.sct-cbar-label{font-size:9.5px;color:var(--zw-muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:100%;flex:none;height:12px;display:flex;align-items:flex-end}
.sct-cbar-label.is-active{color:var(--zw-text);font-weight:600}

/* ── 环形 + 图例（合同状态分布） ── */
.sct-donut-wrap{display:flex;align-items:center;gap:18px;height:100%;min-height:0;padding:2px 0}
.sct-donut{position:relative;flex:none}
.sct-donut-label{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:1px}
.sct-donut-label strong{font-size:19px;font-weight:600;font-variant-numeric:tabular-nums;line-height:1}
.sct-donut-label span{font-size:9.5px;color:var(--zw-muted)}
.sct-legend{display:grid;grid-template-columns:repeat(auto-fit,minmax(84px,1fr));gap:5px 14px;flex:1;min-width:0}
.sct-legend-item{display:inline-flex;align-items:center;gap:6px;font-size:11.5px;color:var(--zw-muted);white-space:nowrap;min-width:0}
.sct-legend-item i{width:8px;height:8px;border-radius:2px;flex:none}
.sct-legend-item em{font-style:normal;color:var(--zw-text);overflow:hidden;text-overflow:ellipsis}
/* 图例里的数量也是数据标签，用粗体让它比状态名更醒目 */
.sct-legend-item b{margin-left:auto;font-weight:600;color:var(--zw-text);font-variant-numeric:tabular-nums}



.sct-hero{display:flex;align-items:flex-end;justify-content:space-between;gap:16px;padding:36px 0 28px;flex:none}
/* 数据看板：顶部常驻摘要条。数值用等宽数字，位数变化时不会左右跳 */
.sct-board{display:flex;gap:0;flex:none;margin:0 0 18px;border:1px solid var(--zw-line);border-radius:10px;overflow:hidden;background:var(--dsw-alias-bg-layer-1)}
/*
 * 格子**按内容宽度**排，不占比整行。
 *
 * 原来写 flex:1，四个格子等分整行——宽屏下每格 780px 却只放"在办 5"两个字，
 * 中间大片空白，看着像没加载完。摘要是"扫一眼"的东西，挤在左边更好读。
 */
.sct-board-cell{display:flex;align-items:baseline;gap:7px;flex:0 0 auto;padding:11px 18px;border-right:1px solid var(--zw-line);white-space:nowrap}
.sct-board-cell:last-child{border-right:0}
.sct-board-key{font-size:11.5px;color:var(--zw-muted);flex:none;letter-spacing:.2px}
.sct-board-cell strong{font-size:15px;font-weight:600;font-variant-numeric:tabular-nums;letter-spacing:-.2px}
/* 数值缺失（如逾期"—"）时弱化，不要和真实数字一样黑 */
.sct-board-cell strong:only-child{margin-left:0}
.sct-board-alert strong{color:var(--zw-danger)}
.sct-board-warn strong{color:var(--zw-warning)}
/* 空值破折号：弱化，别和真实数字一样黑 */
.sct-board-empty{color:var(--zw-muted);font-weight:400}
/* 右侧留白：摘要靠左，右边空着是刻意的，不要把格子拉开去填 */
.sct-board::after{content:'';flex:1 1 auto}
/*
 * 窄屏：改成 2×2 网格。
 *
 * 用 grid 而不是 flex，是因为 flex 的「flex:1 1 50%」在内容超宽时
 * 会被 min-content 顶开成各自一行（"在办 12" 只有四个字也会被顶开），
 * 结果变成四行单列。grid 的 1fr 是硬约束，两列就是两列。
 */
@media (max-width:620px){
  .sct-board{display:grid;grid-template-columns:1fr 1fr}
  .sct-board-cell{border-right:1px solid var(--zw-line);padding:10px 12px;min-width:0}
  .sct-board-cell:nth-child(2n){border-right:0}
  .sct-board-cell:nth-child(-n+2){border-bottom:1px solid var(--zw-line)}
  .sct-board-cell strong{font-size:14px}
  /* 两列布局下右侧不留白，占位条不需要 */
  .sct-board::after{display:none}
}.sct-eyebrow{font-size:12px;color:var(--zw-muted);letter-spacing:.4px;margin-bottom:10px}
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
/* 经验库按钮：虚线边框 + 更弱的默认色，与"待办范围"在视觉上分开 */
.sct-root .sct-filter .sct-filter-sep{color:var(--zw-muted);padding:0 2px;align-self:center;font-size:12px}
.sct-root .sct-filter .sct-filter-journal{border-style:dashed;border-color:var(--zw-line)}
.sct-root .sct-filter .sct-filter-journal[aria-pressed="true"]{border-style:solid}
.sct-section-label{display:flex;justify-content:space-between;align-items:baseline;gap:8px;margin:20px 0 10px;font-size:12px;color:var(--zw-muted);letter-spacing:.3px}
.sct-section-label:first-of-type{margin-top:8px}
.sct-tasks{display:flex;flex-direction:column;gap:10px}
/* 专用控件统一用 .sct-root .sct-x（0,2,0）压过基础规则（0,1,0）——U04。
   完成控件使用独立样式，标题必须是**看起来像文字**的入口：
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
/* 经验教训库：方形入口 + 中性色，与"可勾选的圆"明确区分，暗示它不是动作 */
.sct-root .sct-check[data-shape="archive"]{border-radius:6px;border-color:var(--zw-line-strong);color:var(--zw-muted);font-size:13px}
.sct-root .sct-check:focus-visible{outline:2px solid var(--zw-focus);outline-offset:3px}
/* 完成操作：紧凑圆角方框；悬停预览勾，完成后实心勾。 */
.sct-root .sct-check[data-shape="task"]{width:22px;height:22px;min-height:22px;margin-top:1px;border:1.5px solid var(--zw-muted);border-radius:6px;background:var(--zw-surface);color:var(--zw-accent);appearance:none;transition:background .15s,border-color .15s,color .15s}
.sct-root .sct-check[data-shape="task"]::before{inset:-11px;border-radius:10px}
.sct-root .sct-check .sct-check-mark{width:14px;height:14px;stroke-width:2.4;opacity:0;transition:opacity .15s;pointer-events:none}
.sct-root .sct-check[data-shape="task"]:is(:hover,:focus-visible){border-color:var(--zw-accent);background:var(--zw-accent-soft)}
.sct-root .sct-check[data-shape="task"]:is(:hover,:focus-visible) .sct-check-mark{opacity:.65}
.sct-root .sct-check[data-shape="task"][data-done="true"]{background:var(--zw-accent);border-color:var(--zw-accent);color:var(--zw-accent-text)}
.sct-root .sct-check[data-shape="task"][data-done="true"] .sct-check-mark{opacity:1}

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
.sct-stage-row{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-top:6px}
.sct-stage-row select{flex:0 0 auto;min-width:120px}
.sct-customers{display:flex;flex-direction:column;gap:10px}
.sct-customer{background:var(--zw-raised);border-radius:8px;padding:12px 14px}
.sct-customer-head{display:flex;justify-content:space-between;align-items:baseline;gap:10px;margin-bottom:5px}
.sct-customer-head b{font-size:14px}
.sct-customer-contact{font-size:11.5px;color:var(--zw-muted)}
.sct-customer-counts{font-size:12px;color:var(--zw-muted);margin-bottom:4px}
.sct-customer-money{font-size:12.5px;color:var(--zw-accent-on-soft);margin-bottom:5px}
.sct-customer-list{display:flex;flex-wrap:wrap;gap:6px;align-items:center;margin-top:5px}
.sct-customer-label{font-size:11px;color:var(--zw-muted);margin-right:2px}
.sct-chip{font-size:11.5px;background:var(--zw-surface);border:1px solid var(--zw-line);border-radius:999px;padding:2px 9px}
.sct-customer-note{font-size:11px;color:var(--zw-muted);margin-top:6px}
.sct-edit label{display:block;font-size:12px;color:var(--zw-muted);margin:10px 0 5px}
.sct-edit textarea{width:100%;font:inherit;font-size:13px;color:inherit;background:var(--zw-surface);border:1px solid var(--zw-line);border-radius:6px;padding:8px 10px;resize:vertical;min-height:64px}
.sct-edit input[type="text"]{width:100%;font:inherit;font-size:13px;color:inherit;background:var(--zw-surface);border:1px solid var(--zw-line);border-radius:6px;padding:8px 10px}
.sct-edit-actions{display:flex;justify-content:flex-end;gap:8px;margin-top:14px}
/* ---- 「记一条跟踪」输入框 ----
   这是详情弹层里最高频的输入：提示词要求写"今天见了谁、对方说了什么、
   下一步什么时候再联系"，两行塞不下，用户一边写一边滚动。
   给它一个能看全四五行的高度，并允许手动拉高（长跟踪很常见）。
   宽度撑满弹层正文（正文本身有 22px 内边距，这里不再加左右 margin）。 */
.sct-root .sct-track-box{display:block;width:100%;min-height:112px;font:inherit;font-size:13.5px;line-height:1.65;color:var(--zw-text);background:var(--zw-surface);border:1px solid var(--zw-line);border-radius:8px;padding:11px 13px;resize:vertical;transition:border-color .15s,box-shadow .15s}
.sct-root .sct-track-box:focus{border-color:var(--zw-accent);box-shadow:0 0 0 3px var(--zw-accent-soft);outline:none}
.sct-root .sct-track-box::placeholder{color:var(--zw-muted);opacity:1}
/* 按钮与说明各占一行，避免「记下」按钮被挤在输入框右侧显得局促 */
.sct-track-actions{display:flex;justify-content:flex-end;gap:8px;margin-top:10px}
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

/* Focus workspace: one capture lane, a task sheet and a quiet reference column. */
.sct-root{--zw-shell-max:none;--zw-layout-gap:28px;--zw-aside-w:clamp(320px,24cqw,480px);--zw-shell-pad:32px;scrollbar-color:var(--zw-line-strong) transparent;caret-color:var(--zw-accent)}
.sct-root ::selection{background:var(--zw-accent-soft);color:var(--zw-text)}
.sct-topbar{min-height:76px;padding:14px 32px;background:var(--zw-surface);max-width:none;gap:12px}
.sct-brand{gap:10px;flex-shrink:0}
.sct-root .sct-brandmark{width:38px;height:38px;padding:3px;color:var(--zw-accent);stroke-width:1.8}
.sct-brand strong{font-size:17px;letter-spacing:1px;line-height:1.5}
.sct-brand p{font-size:11px}
.sct-top-actions{gap:8px;flex-wrap:wrap;justify-content:flex-end}
.sct-root .sct-action-btn,.sct-community{display:inline-flex;align-items:center;justify-content:center;gap:7px;min-height:36px;padding:7px 10px;border-radius:8px;background:transparent;border:1px solid transparent;font-size:12px}
.sct-root .sct-action-btn:hover,.sct-community:hover{background:var(--zw-raised);border-color:var(--zw-line)}
.sct-root .sct-control-icon{width:16px;height:16px}
.sct-theme-switch{display:flex;align-items:center;gap:2px;background:var(--zw-raised);border:1px solid var(--zw-line);border-radius:9px;padding:3px}
.sct-root .sct-theme-switch button{display:flex;align-items:center;justify-content:center;gap:5px;min-height:32px;border:1px solid transparent;background:transparent;border-radius:6px;padding:5px 8px;font-size:12px;color:var(--zw-muted)}
.sct-root .sct-theme-switch button[aria-pressed="true"]{background:var(--zw-surface);border-color:var(--zw-line-strong);color:var(--zw-accent-on-soft);font-weight:600}
.sct-sync{display:inline-flex;align-items:center;gap:5px;font-variant-numeric:tabular-nums;font-size:11px}
.sct-shell{padding:0 var(--zw-shell-pad) 24px;max-width:var(--zw-shell-max)}
.sct-hero{padding:25px 0 20px;align-items:center}
.sct-hero h1{font-size:25px;font-weight:650;letter-spacing:-.5px;line-height:1.4}
.sct-root .sct-summary{font-size:13px;margin-top:6px}
.sct-hero-date{display:flex;align-items:center;gap:7px;font-size:12px;color:var(--zw-muted);white-space:nowrap}
.sct-capture{flex:none;padding:10px 12px;margin:0 0 24px;gap:10px;border-radius:12px;background:var(--zw-surface);border:1px solid var(--zw-line-strong)}
.sct-capture:focus-within{border-color:var(--zw-accent)}
.sct-root .sct-capture select{min-height:42px;border-radius:7px;background:var(--zw-raised);border-color:transparent;max-width:160px;padding:8px 12px}
.sct-root .sct-capture input{min-height:42px;font-size:14px;padding:9px 12px}
.sct-root .sct-primary-btn{display:inline-flex;align-items:center;justify-content:center;gap:7px;min-height:42px;padding:9px 22px;border-radius:8px}
.sct-root :where(input,textarea)::placeholder{color:var(--zw-muted);opacity:1}
.sct-root select option{background:var(--zw-surface);color:var(--zw-text)}
.sct-main{background:var(--zw-surface);border:1px solid var(--zw-line);border-radius:14px;padding:0 22px}
.sct-tabs{gap:24px;margin-bottom:16px;padding-top:6px}
.sct-root .sct-tab{height:52px;font-size:15px;gap:6px}
.sct-root .sct-tab[aria-selected="true"]{color:var(--zw-accent-on-soft)}
.sct-count{display:inline-flex;align-items:center;justify-content:center;min-width:22px;padding:0 6px;height:20px;border-radius:5px;background:var(--zw-raised);font-size:11px;margin-left:2px}
.sct-list-controls{display:flex;flex-direction:column;gap:12px;padding-bottom:14px;border-bottom:1px solid var(--zw-line)}
.sct-filter{gap:4px;margin:0}
.sct-root .sct-filter button{border-radius:6px;padding:5px 10px;min-height:32px}
.sct-root .sct-filter button[aria-pressed="true"]{border-color:transparent;background:var(--zw-accent-soft);color:var(--zw-accent-on-soft);font-weight:600}
.sct-toolbar{margin:0;gap:8px;width:100%;min-width:0}
.sct-search{min-width:0}
.sct-root .sct-search input{background:var(--zw-raised);min-height:36px;border-color:transparent}
.sct-root .sct-sort{min-height:36px;font-size:12px;border-color:var(--zw-line)}
.sct-root .sct-search-clear{display:flex;align-items:center;justify-content:center;min-height:26px;width:26px;padding:0;border:0;background:transparent}
.sct-section-label{margin:20px 0 8px;font-size:12px;font-weight:600;letter-spacing:0}
.sct-tasks{gap:0}
.sct-task{padding:16px 2px;gap:14px;border:0;border-bottom:1px solid var(--zw-line);border-radius:0;background:transparent}
.sct-task:last-child{border-bottom:0}
.sct-task:hover{background:var(--zw-hover)}
.sct-root .sct-task-title{font-size:14px;line-height:1.6;font-weight:600}
.sct-task-body{gap:6px}
.sct-task-actions{gap:4px}
.sct-root .sct-task-actions button{min-height:32px;font-size:12px;padding:4px 8px;border-radius:6px}
.sct-root .sct-task-actions button:hover{background:var(--zw-accent-soft);color:var(--zw-accent-on-soft)}
.sct-list-scroll{padding-bottom:20px}
.sct-aside{display:flex;flex-direction:column;gap:24px;padding:4px 0 24px;overflow-y:auto;scrollbar-gutter:stable}
.sct-side-block{flex:none;overflow:visible;padding:0 0 24px;border:0;border-bottom:1px solid var(--zw-line);border-radius:0;background:transparent}
.sct-side-block:last-child{border-bottom:0}
.sct-side-title h2,.sct-cal-head h2{font-size:14px;font-weight:650}
.sct-agenda{gap:0}
.sct-agenda-item{padding:10px 0;border-bottom:1px solid var(--zw-line)}
.sct-agenda-item:last-child{border:0;padding-bottom:0}
.sct-agenda-date{background:var(--zw-surface);border:1px solid var(--zw-line);border-radius:7px;padding:6px 0;color:var(--zw-text)}
.sct-reminder-time{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:10px 0;color:var(--zw-text)}
.sct-reminder-time-label{display:flex;align-items:center;gap:7px;font-size:12px;color:var(--zw-muted)}
.sct-reminder-time time{font-size:22px;font-weight:600;font-variant-numeric:tabular-nums}
.sct-delivery{margin:6px 0 16px}
.sct-reminder-card .sct-side-title{margin-bottom:12px}
.sct-reminder-time{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:10px 14px;background:var(--zw-accent-soft);border:1px solid var(--zw-line);border-radius:12px;color:var(--zw-accent-on-soft)}
.sct-reminder-time-label{display:flex;align-items:center;gap:8px;font-size:13px;font-weight:500}
.sct-reminder-time time{font-size:24px;font-weight:600;line-height:1.2;font-variant-numeric:tabular-nums;letter-spacing:1px}
.sct-delivery{margin:10px 0 12px;padding-bottom:10px;border-bottom:1px solid var(--zw-line)}
.sct-reminder-card .sct-conn{display:grid;grid-template-columns:7px auto minmax(0,1fr);gap:8px;padding:5px 0;align-items:baseline}
.sct-reminder-card .sct-conn i{align-self:center}
.sct-reminder-card .sct-conn-target{text-align:right;overflow-wrap:anywhere;font-weight:500}
.sct-root .sct-reminder-card .sct-conn-warn{background:var(--zw-warn-soft);color:var(--zw-warning-on-soft);border-radius:8px;padding:8px 10px;margin:8px 0;font-size:12px}
.sct-report-heading{font-size:12px;font-weight:600;color:var(--zw-muted);margin-bottom:6px;letter-spacing:.5px}
.sct-reminder-card .sct-report-list{list-style:none;padding:0;margin:0;font-size:12px}
.sct-reminder-card .sct-report-list li{list-style:none;display:grid;grid-template-columns:minmax(0,1fr) auto;align-items:center;gap:10px;padding:6px 0;border-bottom:1px solid var(--zw-line)}
.sct-reminder-card .sct-report-list li:last-child{border-bottom:0}
.sct-report-list time{font-size:12px;line-height:1.5;font-weight:500;font-variant-numeric:tabular-nums;color:var(--zw-text);background:var(--zw-raised);border-radius:5px;padding:2px 8px}
.sct-report-help{margin-top:10px;border-top:1px solid var(--zw-line);padding-top:10px;color:var(--zw-muted);font-size:12px}
.sct-report-help summary{display:flex;justify-content:space-between;align-items:center;gap:12px;list-style:none;cursor:pointer;min-height:24px;border-radius:4px}
.sct-report-help summary::-webkit-details-marker{display:none}
.sct-report-help summary::after{content:'';width:6px;height:6px;border-right:1.5px solid currentColor;border-bottom:1.5px solid currentColor;transform:rotate(45deg);margin-right:4px}
.sct-report-help[open] summary::after{transform:rotate(225deg)}
.sct-report-help summary:hover{color:var(--zw-text)}
.sct-report-help summary:focus-visible{outline:2px solid var(--zw-focus);outline-offset:3px}
.sct-root .sct-report-help .sct-side-note{margin-top:10px;line-height:1.8}
.sct-root .sct-drawer{border-radius:18px;box-shadow:0 24px 90px #00000040}
.sct-drawer::backdrop{background:#09171080;backdrop-filter:blur(4px)}
.sct-root .sct-empty{border-style:dashed;background:var(--zw-surface);padding:40px 24px}
@container sct (max-width:859px){
  .sct-root .sct-main{border-radius:16px;padding:16px}
  .sct-root .sct-shell{padding:0 20px 20px}
  .sct-root .sct-toolbar{flex-basis:100%;min-width:0}
  .sct-root .sct-search{max-width:none}
}
@container sct (max-width:559px){
  .sct-root .sct-main{padding:12px}
  .sct-root .sct-side-block{padding:16px}
  .sct-root .sct-tab{padding:0 12px;font-size:14px}
  .sct-root .sct-filter{gap:4px}
  .sct-root .sct-filter button{padding:6px 10px}
  .sct-root .sct-list-controls{gap:12px}
}

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
  .sct-root .sct-main{overflow:visible;min-height:0;order:-1}
  .sct-root .sct-list-scroll{overflow:visible;min-height:0;flex:none;padding-bottom:8px;scrollbar-gutter:auto}
  .sct-root .sct-aside{display:grid;grid-template-columns:1fr 1fr;grid-template-rows:auto;gap:20px 24px;overflow:visible;padding-bottom:32px}
  .sct-root .sct-aside .sct-side-block:last-child{grid-column:1/-1}
  .sct-root .sct-side-block{padding-bottom:16px;overflow:visible}
  .sct-root .sct-aside .sct-cal{flex:none;grid-auto-rows:auto}
  .sct-root .sct-aside .sct-d{aspect-ratio:1}
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
@container sct (max-width:1159px){
 .sct-root .sct-shell{padding:0 22px 22px}
 .sct-root .sct-hero{padding:20px 0 18px}
 .sct-root .sct-hero h1{font-size:23px}
 .sct-root .sct-sync{display:none}
 .sct-root .sct-theme-switch button span{display:none}
 .sct-root .sct-theme-switch button{width:34px}
}
@container sct (max-width:859px){
 .sct-root .sct-main{padding:0 18px}
 .sct-root .sct-aside{padding:4px 0 24px}
 .sct-root .sct-side-block{padding:0 0 20px}
 .sct-root .sct-hero-date{white-space:normal}
}
@container sct (max-width:559px){
 .sct-root .sct-shell{padding:0 14px 20px}
 .sct-root .sct-topbar{padding:12px 14px}
 .sct-root .sct-top-actions{display:flex;width:100%;justify-content:flex-start;gap:4px}
 .sct-root .sct-theme-switch{margin-left:auto}
 .sct-root .sct-hero{gap:8px;padding:20px 0 16px}
 .sct-root .sct-hero h1{font-size:22px}
 .sct-root .sct-capture{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:8px;padding:10px;margin-bottom:18px}
 .sct-root .sct-capture select{grid-column:1;grid-row:2;width:100%;max-width:none}
 .sct-root .sct-capture input{grid-column:1/-1;grid-row:1;width:100%}
 .sct-root .sct-primary-btn{grid-column:2;grid-row:2}
 .sct-root .sct-capture-error,.sct-root .sct-capture-confirm,.sct-root .sct-notch{grid-column:1/-1}
 .sct-root .sct-main{padding:0 12px;border-radius:12px}
 .sct-root .sct-tabs{gap:18px;margin-bottom:12px}
 .sct-root .sct-tab{padding:0 2px}
 .sct-root .sct-toolbar{margin:0;min-width:0}
 .sct-root .sct-sort{flex:0 1 auto;max-width:100%}
 .sct-root .sct-task{padding:14px 2px}
 .sct-root .sct-task-actions{padding-left:38px}
}
@media (max-height:650px){
 .sct-root .sct-scroll{overflow-y:auto}
 .sct-root .sct-shell{flex:none}
 .sct-root .sct-layout{flex:none;align-items:start}
 .sct-root .sct-main,.sct-root .sct-list-scroll,.sct-root .sct-aside{overflow:visible;flex:none}
}

/* Task dialogs have their own reading widths instead of stretching with the task sheet. */
.sct-root .sct-dialog-detail,.sct-root .sct-dialog-done{left:50%;transform:translate(-50%,-50%);max-width:calc(100vw - 32px);max-height:min(88dvh,900px);border-radius:16px}
.sct-root .sct-dialog-detail{width:1000px;container-type:inline-size;container-name:sct-detail}
.sct-root .sct-dialog-done{width:560px}
.sct-dialog-detail .sct-drawer-head{padding:20px 28px 22px;border-bottom:1px solid var(--zw-line)}
.sct-detail-head-actions{display:flex;gap:8px;align-items:center;flex:none}
.sct-detail-head-actions button{font-size:12px;min-height:32px;padding:5px 12px}
.sct-dialog-detail .sct-drawer-head h2{margin:14px 0 12px;font-size:22px;line-height:1.45;max-width:40em;overflow-wrap:anywhere}
.sct-dialog-detail .sct-task-meta{gap:8px 14px}
.sct-dialog-detail .sct-drawer-body{padding:0 28px;scrollbar-gutter:auto}
.sct-detail-grid{display:grid;grid-template-columns:minmax(0,1.65fr) minmax(240px,1fr);gap:28px}
.sct-detail-grid:not(:has(.sct-detail-context)){grid-template-columns:minmax(0,1fr)}
.sct-detail-activity,.sct-detail-context{min-width:0;padding:24px 0}
.sct-detail-context{border-left:1px solid var(--zw-line);padding-left:24px}
.sct-dialog-detail .sct-detail-grid section{margin:0 0 24px;padding:0;border:0}
.sct-dialog-detail .sct-detail-grid section:last-child{margin-bottom:0}
.sct-dialog-detail section h3,.sct-dialog-detail .sct-field-title{font-size:13px;font-weight:600;color:var(--zw-text);margin:0 0 12px;letter-spacing:0}
.sct-dialog-detail .sct-track-box{min-height:144px;background:var(--zw-raised);border-color:var(--zw-line-strong);font-size:14px}
.sct-track-actions{align-items:flex-start;gap:16px}
.sct-track-actions button{flex:none;min-width:72px}
.sct-inline-hint{font-size:12px;line-height:1.7;color:var(--zw-muted);overflow-wrap:anywhere}
.sct-track-actions .sct-inline-hint{flex:1}
.sct-dialog-detail .sct-notice{background:transparent;padding:0;margin:10px 0;color:var(--zw-muted)}
.sct-dialog-detail .sct-tl{gap:0;padding-left:5px}
.sct-dialog-detail .sct-tl-item{position:relative;padding:0 0 22px 20px;border-left:1px solid var(--zw-line-strong)}
.sct-dialog-detail .sct-tl-item::before{content:"";position:absolute;left:-4px;top:5px;width:7px;height:7px;border-radius:50%;background:var(--zw-muted)}
.sct-dialog-detail .sct-tl-item:first-child::before{background:var(--zw-accent)}
.sct-dialog-detail .sct-tl-item:last-child{padding-bottom:0}
.sct-dialog-detail .sct-tl-item b{font-size:12px;font-weight:400;line-height:1.7;margin-bottom:6px}
.sct-dialog-detail .sct-tl-item blockquote{border:0;padding:0;margin:0;line-height:1.75;font-size:14px}
.sct-dialog-detail .sct-drawer-foot{padding:16px 28px;background:var(--zw-raised)}
.sct-dialog-detail .sct-edit{margin:20px 0!important;padding:20px}
.sct-dialog-detail .sct-edit :is(input,textarea){width:100%}
.sct-done-form{display:flex;flex-direction:column;min-height:0}
.sct-done-body{overflow-y:auto;padding:28px;min-height:0}
.sct-dialog-done h2{margin:0 0 18px;font-size:22px}
.sct-done-subject{font-size:14px;line-height:1.75;padding:12px 16px;background:var(--zw-raised);border-radius:8px;overflow-wrap:anywhere}
.sct-dialog-done label{margin:22px 0 10px;font-size:13px;font-weight:600}
.sct-root .sct-dialog-done textarea{display:block;width:100%;min-height:144px;resize:vertical;border-color:var(--zw-line-strong);font-size:14px;line-height:1.75;padding:12px 14px}
.sct-dialog-done .sct-inline-hint{margin-top:12px}
.sct-dialog-done .sct-done-footer{flex:none;margin:0;padding:16px 28px;border-top:1px solid var(--zw-line);background:var(--zw-raised);gap:8px}
.sct-done-footer button:first-child{margin-right:auto}
@container sct-detail (max-width:700px){
 .sct-detail-grid{grid-template-columns:minmax(0,1fr);gap:0}
 .sct-detail-context{padding:20px 0;border-left:0;border-top:1px solid var(--zw-line)}
 .sct-dialog-detail .sct-drawer-head{padding:16px 20px}
 .sct-dialog-detail .sct-drawer-head h2{font-size:19px}
 .sct-dialog-detail .sct-drawer-body{padding:0 20px}
 .sct-dialog-detail .sct-drawer-foot{padding:14px 20px}
}
/**
 * 窄屏下抽屉弹层的尺寸微调。
 *
 * 这里原本用了视口宽度媒体查询（max-width 断点），**违反 U02**：
 * 断点必须跟随**插件容器的实际宽度**，不能用视口宽度。
 * 后果：窗口 1440px、但插件容器只有 560px 时（侧栏展开、分栏布局），
 * 视口查询不触发，弹层不会收窄，会溢出容器。
 *
 * 同文件其它窄屏断点全是 @container，只有这一处漏了。
 */
@container sct (max-width:559px){
 .sct-root .sct-dialog-detail,.sct-root .sct-dialog-done{max-width:calc(100vw - 20px);max-height:92dvh;border-radius:12px}
 .sct-done-body{padding:22px 18px}
 .sct-dialog-done .sct-done-footer{padding:14px 18px}
 .sct-done-footer button{padding:7px 9px;font-size:12px}
 .sct-track-actions{flex-wrap:wrap;gap:10px}
 .sct-track-actions .sct-inline-hint{flex-basis:100%}
 .sct-track-actions button{margin-left:auto}
}

/* Sidebar: stable calendar height and compact sections at every desktop width. */
.sct-root .sct-aside{gap:16px;padding-bottom:0;scrollbar-width:none;scrollbar-gutter:auto}
.sct-root .sct-aside::-webkit-scrollbar{display:none}
.sct-root .sct-aside .sct-side-block{padding-bottom:16px}
.sct-root .sct-aside .sct-side-block:last-child{padding-bottom:0}
.sct-root .sct-aside .sct-side-title{margin-bottom:10px}
.sct-root .sct-aside .sct-agenda-item{padding:7px 0}
.sct-root .sct-aside .sct-agenda-date{padding:4px 0}
.sct-root .sct-aside .sct-cal-head{margin-bottom:8px}
.sct-root .sct-aside .sct-cal{margin-top:0;grid-auto-rows:30px;row-gap:2px}
.sct-root .sct-aside .sct-d{aspect-ratio:auto;min-height:0;height:30px}
.sct-root .sct-aside .sct-w{display:flex;align-items:center;justify-content:center;padding:0}
.sct-root .sct-aside .sct-report-list li{padding:4px 0}
.sct-root .sct-aside .sct-delivery{margin:8px 0;padding-bottom:8px}
.sct-root .sct-aside .sct-report-help{margin-top:8px;padding-top:8px}

/* On wide, shorter windows, put reminders and the calendar next to each other. */
@container sct (min-width:1800px){
 @media(max-height:1100px){
  .sct-root .sct-layout{grid-template-columns:minmax(0,1fr) 480px}
  .sct-root .sct-aside{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);grid-template-rows:auto 1fr;gap:20px;align-items:start}
  .sct-root .sct-aside .sct-side-block:first-child{grid-column:1/-1}
  .sct-root .sct-aside .sct-reminder-card{border-bottom:0;padding-bottom:0}
  .sct-root .sct-aside .sct-side-block:last-child{grid-column:auto}
 }
}

/* The dashboard and record tabs share the full available workspace. */
.sct-root[data-workspace="true"] .sct-scroll{overflow:hidden;scrollbar-gutter:auto}
.sct-root[data-workspace="true"] .sct-shell{flex:1;min-height:0;padding:16px 24px 20px}
.sct-root[data-workspace="true"] .sct-layout{display:flex;flex:1;min-height:0;align-items:stretch}
.sct-root[data-workspace="true"] .sct-main{flex:1;min-height:0;overflow:hidden;padding:0 20px 16px}
.sct-root[data-workspace="true"] .sct-board-host{display:flex;flex:1;min-height:0;overflow:hidden;padding:0;scrollbar-gutter:auto}
.sct-root[data-workspace="true"] .sct-tabs{margin-bottom:12px;overflow:hidden;flex-wrap:wrap;gap:16px}
.sct-root[data-workspace="true"] .sct-tab{height:40px}
.sct-root .sct-board-page{width:100%;height:auto;flex:1;min-height:0;gap:12px;overflow:hidden}
.sct-root .sct-board-grid{grid-template-rows:repeat(2,minmax(0,1fr));gap:14px}
.sct-root .sct-board-page[data-overview="false"] .sct-board-grid{grid-template-columns:minmax(0,1fr);grid-template-rows:minmax(0,1fr)}
.sct-root .sct-board-page[data-overview="false"] .sct-panel{grid-column:1;min-height:0}
.sct-root .sct-panel[hidden]{display:none}
.sct-root .sct-panel{padding:16px 18px;border-radius:12px;background:var(--zw-surface)}
.sct-root .sct-panel-head h3{font-size:14px}
.sct-root .sct-panel-head{padding-bottom:14px}
.sct-root .sct-stats{gap:0;border-block:1px solid var(--zw-line)}
.sct-root .sct-stat{padding:12px 16px;background:transparent;border:0;border-right:1px solid var(--zw-line);border-radius:0}
.sct-root .sct-stat:last-child{border-right:0}
.sct-root .sct-stat.is-accent{background:var(--zw-accent-soft)}
.sct-root .sct-stat-val{font-size:28px;line-height:1.3}
.sct-root .sct-stat-key{font-size:12px}
.sct-root .sct-donut svg{display:block;width:100%;height:100%;stroke:none;fill:none;stroke-linecap:butt}
.sct-root .sct-donut-wrap{justify-content:center}
.sct-root .sct-legend{max-width:360px}
.sct-root .sct-chart-hbar{gap:10px}
.sct-root .sct-hbar-row{grid-template-columns:80px minmax(0,1fr) 36px}
.sct-root .sct-cbar-fill{width:min(70%,36px)}
.sct-root .sct-cbar-value,.sct-root .sct-cbar-label{font-size:11px;height:15px;line-height:15px}
.sct-board-navigation{display:flex;align-items:center;justify-content:space-between;gap:10px;flex:none}
.sct-board-navigation select{max-width:100%;min-width:0;font-size:13px}
@container sct (max-width:700px){
 .sct-root[data-workspace="true"] .sct-shell{padding:8px}
 .sct-root[data-workspace="true"] .sct-main{padding:0 10px 10px}
 .sct-root[data-workspace="true"] .sct-topbar{padding:8px 12px;min-height:0}
 .sct-root[data-workspace="true"] .sct-brand p,.sct-root[data-workspace="true"] .sct-community{display:none}
 .sct-root[data-workspace="true"] .sct-tabs{gap:12px;margin-bottom:8px}
 .sct-root[data-workspace="true"] .sct-tab{font-size:12px;height:32px}
 .sct-root .sct-board-page{gap:8px}
 .sct-root .sct-stats{grid-template-columns:repeat(3,minmax(0,1fr))}
 .sct-root .sct-stat{padding:6px 8px}
 .sct-root .sct-stat-val{font-size:20px}
 .sct-root .sct-stat-note{display:none}
 .sct-root .sct-stat-key{font-size:11px}
 .sct-root .sct-boardbar{gap:6px}
 .sct-root .sct-boardbar-label{display:none}
 .sct-root .sct-boardbar-dates{width:100%;gap:4px}
 .sct-root .sct-boardbar-dates input{min-width:0;flex:1;width:0;padding:4px}
 .sct-board-navigation{flex-wrap:wrap;gap:4px}
 .sct-board-navigation>span{font-size:10px}
 .sct-board-navigation select{width:100%;padding:5px 8px}
 .sct-root .sct-panel{padding:10px}
 .sct-root .sct-panel-head{padding-bottom:8px}
 .sct-root .sct-panel-head h3{font-size:12px}
 .sct-root .sct-chart-hbar{gap:6px}
 .sct-root .sct-hbar-row{grid-template-columns:60px minmax(0,1fr) 26px;gap:6px}
 .sct-root .sct-donut-wrap{gap:12px}
 .sct-root .sct-legend{grid-template-columns:1fr}
}

/* Business views share the plugin palette and reserve space for every chart's explanation. */
.sct-insight-toolbar{display:flex;align-items:center;justify-content:space-between;gap:8px 16px;flex:none;flex-wrap:wrap}
.sct-insight-toolbar .sct-boardbar{margin-left:auto}
.sct-insight-toolbar .sct-boardbar-label{display:none}
.sct-insight-views{display:flex;gap:4px;flex:none}
.sct-insight-views button{border:0;border-radius:6px;padding:7px 14px;font:inherit;font-size:14px;color:var(--zw-muted);background:transparent;cursor:pointer}
.sct-insight-views button:hover{background:var(--zw-hover);color:var(--zw-text)}
.sct-insight-views button[aria-pressed="true"]{background:var(--zw-accent-soft);color:var(--zw-accent-on-soft);font-weight:600}
.sct-insight-description{font-size:12px;color:var(--zw-muted)}
.sct-insights .sct-stat-val small{font-size:12px;font-weight:400;margin-left:4px;color:var(--zw-muted)}
.sct-insights .sct-panel-head{padding-bottom:10px}
.sct-insight-note{font-size:11px;color:var(--zw-muted);line-height:1.5;flex:none;margin:10px 0 0;max-width:none}
.sct-insight-pager{display:flex;align-items:center;justify-content:flex-end;gap:8px;font-size:11px;color:var(--zw-muted)}
.sct-insight-pager button{min-height:26px;padding:3px 7px;border:1px solid var(--zw-line);background:transparent;color:var(--zw-text);border-radius:4px;font:inherit;cursor:pointer}
.sct-insight-pager button:disabled{opacity:.45;cursor:default}
.sct-category-chart{display:flex;flex-direction:column;flex:1;min-height:0;gap:6px}
.sct-category-plot{position:relative;flex:1;min-height:0;margin:24px 4px 0 48px}
.sct-category-grid{position:absolute;inset:0;pointer-events:none}
.sct-category-tick{position:absolute;left:0;right:0;border-bottom:1px solid var(--zw-line)}
.sct-category-tick>span{position:absolute;right:calc(100% + 9px);top:0;transform:translateY(-50%);font-size:11px;line-height:14px;color:var(--zw-muted);white-space:nowrap;font-variant-numeric:tabular-nums}
.sct-category-columns{position:absolute;inset:0;display:flex;gap:12px}
.sct-category-column{position:relative;flex:1;min-width:0;border-radius:3px;outline-offset:3px}
.sct-category-column:hover{background:var(--zw-hover)}
.sct-category-bar{position:absolute;bottom:0;left:50%;transform:translateX(-50%);width:min(55%,64px);border-radius:4px 4px 0 0}
.sct-category-value{position:absolute;left:0;right:0;text-align:center;font-size:12px;line-height:18px;font-weight:600;font-variant-numeric:tabular-nums;white-space:nowrap}
.sct-category-labels{display:flex;gap:12px;margin:0 4px 0 48px;flex:none}
.sct-category-labels>span{flex:1;min-width:0;text-align:center;font-size:11px;line-height:16px;overflow-wrap:anywhere;min-height:32px}
.sct-category-zero{position:absolute;inset:0 0 25px;display:flex;justify-content:center;align-items:center;font-size:12px;color:var(--zw-muted);pointer-events:none}
.sct-outcome-switch{display:flex;gap:2px;flex:none}
.sct-root .sct-outcome-switch button{min-height:26px;padding:3px 6px;font-size:11px;line-height:18px;border:1px solid transparent;background:transparent;color:var(--zw-muted);border-radius:4px}
.sct-root .sct-outcome-switch button[aria-pressed="true"]{background:var(--zw-accent-soft);color:var(--zw-accent-on-soft);font-weight:600}
@container sct (max-width:700px){
 .sct-category-plot{margin-left:36px;margin-top:22px}
 .sct-category-labels{margin-left:36px;gap:6px}
 .sct-category-columns{gap:6px}
 .sct-category-labels>span{font-size:10px;line-height:13px;min-height:39px}
 .sct-category-tick>span{font-size:10px;right:calc(100% + 5px)}
 .sct-category-value{font-size:11px;line-height:16px}
 .sct-category-chart{gap:4px}
}
.sct-insight-trend{display:flex;flex-direction:column;flex:1;min-height:0;gap:12px}
.sct-insight-series{display:flex;flex-wrap:wrap;gap:6px 16px;flex:none;color:var(--zw-muted);font-size:11px}
.sct-insight-series>span{display:flex;align-items:center;gap:5px}
.sct-insight-series strong{color:var(--zw-text);font-weight:600;font-variant-numeric:tabular-nums}
.sct-insight-series i,.sct-insight-legend i{width:7px;height:7px;border-radius:2px;display:block;flex:none}
.sct-insight-plot{position:relative;display:flex;align-items:stretch;gap:8px;min-height:0;flex:1}
.sct-insight-bucket{flex:1;min-width:0;display:flex;flex-direction:column;gap:6px;outline-offset:1px;border-radius:3px}
.sct-insight-bucket:hover{background:var(--zw-hover)}
.sct-insight-columns{flex:1;min-height:0;display:flex;gap:3px;justify-content:center}
.sct-insight-column{display:flex;flex-direction:column;min-width:0;flex:1;max-width:32px;gap:3px}
.sct-insight-column-track{flex:1;min-height:0;display:flex;align-items:flex-end}
.sct-insight-column-track>span{display:block;width:100%;border-radius:3px 3px 0 0}
.sct-insight-point-value{font-size:11px;line-height:14px;height:14px;flex:none;text-align:center;font-variant-numeric:tabular-nums}
.sct-insight-bucket-label{height:16px;line-height:16px;font-size:10px;text-align:center;white-space:nowrap;color:var(--zw-muted)}
.sct-insight-point-detail{display:none;position:absolute;z-index:1;bottom:24px;left:0;right:0;padding:8px 10px;border:1px solid var(--zw-line-strong);border-radius:6px;background:var(--zw-surface);color:var(--zw-text);font-size:11px;line-height:1.5;pointer-events:none}
.sct-insight-bucket:hover .sct-insight-point-detail,.sct-insight-bucket:focus-visible .sct-insight-point-detail{display:block}
.sct-insight-zero{position:absolute;inset:0 0 22px;display:flex;align-items:center;justify-content:center;color:var(--zw-muted);font-size:12px;pointer-events:none}
.sct-insight-distribution{display:flex;align-items:center;justify-content:center;gap:24px;flex:1;min-height:0}
.sct-insight-ring{position:relative;width:112px;height:112px;flex:none}
.sct-root .sct-insight-ring svg{display:block;width:100%;height:100%;fill:none;stroke:none;stroke-linecap:butt}
.sct-insight-ring>div{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center}
.sct-insight-ring strong{font-size:24px;line-height:1.2;font-weight:600}
.sct-insight-ring span{font-size:10px;color:var(--zw-muted)}
.sct-insight-legend{display:flex;flex-direction:column;gap:8px;min-width:0;max-width:280px;flex:1;font-size:12px}
.sct-insight-distribution[data-dense="true"] .sct-insight-legend{gap:4px;font-size:11px}
.sct-insight-legend>div{display:flex;align-items:center;gap:8px}
.sct-insight-legend strong{margin-left:auto;font-weight:600}
.sct-insight-legend small{width:35px;text-align:right;color:var(--zw-muted);font-variant-numeric:tabular-nums}
@container sct (max-width:1100px){
 .sct-insight-description{display:none}
}
.sct-root[data-workspace="true"][data-board-short="true"] .sct-shell{padding:8px 12px}
@container sct (min-width:701px){
 .sct-root[data-board-short="true"] .sct-insights .sct-stat{padding:6px 12px}
 .sct-root[data-board-short="true"] .sct-insights .sct-stat-val{font-size:22px}
}
@container sct (max-width:700px){
 .sct-root[data-workspace="true"] .sct-brand{display:none}
 .sct-root[data-workspace="true"] .sct-topbar{padding:6px 10px}
 .sct-insight-toolbar{gap:6px}
 .sct-insight-toolbar .sct-boardbar{width:100%}
 .sct-insight-views{width:100%;gap:2px}
 .sct-insight-views button{flex:1;font-size:12px;padding:6px 4px}
 .sct-root[data-workspace="true"][data-board-short="true"] .sct-shell{padding:8px}
 .sct-root .sct-insights .sct-stat{padding:6px}
 .sct-root .sct-insights .sct-stat-val{font-size:18px;line-height:1.2}
 .sct-insights .sct-stat-val small{font-size:10px;margin-left:2px}
 .sct-insight-note{font-size:10px;margin-top:6px;line-height:1.4}
 .sct-insight-trend{gap:6px}
 .sct-insight-series{gap:3px 8px;font-size:10px}
 .sct-insight-plot{gap:3px}
 .sct-insight-bucket-label{font-size:9px}
 .sct-insight-distribution{gap:12px}
 .sct-insight-ring{width:90px;height:90px}
 .sct-insight-legend{font-size:11px;gap:6px}
 .sct-insight-legend>div{gap:5px}
}


/* Record tabs use the same full-size frame as the dashboard. */
.sct-root[data-records="true"] .sct-scroll{position:relative}
.sct-root[data-records="true"] .sct-main-head{max-height:72%;overflow:auto;scrollbar-width:thin}
.sct-root[data-records="true"] .sct-list-scroll{flex:1;min-height:0;overflow:auto;padding-bottom:0;scrollbar-gutter:auto}
.sct-workspace-nav{display:flex;align-items:center;gap:20px;border-bottom:1px solid var(--zw-line);margin-bottom:12px;flex:none}
.sct-root[data-records="true"] .sct-workspace-nav .sct-tabs{flex:1;min-width:0;margin:0;border:0;padding:0}
.sct-workspace-actions{display:flex;align-items:center;gap:6px;flex:none}
.sct-root .sct-workspace-actions button{display:inline-flex;align-items:center;gap:6px;min-height:30px;padding:4px 10px;font-size:12px;background:transparent;border-color:transparent;color:var(--zw-muted)}
.sct-root .sct-workspace-actions button[aria-expanded="true"]{background:var(--zw-accent-soft);color:var(--zw-accent-on-soft)}
.sct-record-capture[hidden]{display:none}
.sct-root .sct-record-capture .sct-capture{margin:0 0 12px;padding:8px}
.sct-agenda-panel{position:absolute;z-index:10;top:64px;right:24px;bottom:20px;width:min(480px,calc(100% - 48px));display:flex;flex-direction:column;border:1px solid var(--zw-line-strong);border-radius:12px;background:var(--zw-surface);overflow:hidden}
.sct-agenda-panel-head{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:12px 18px;border-bottom:1px solid var(--zw-line);flex:none}
.sct-agenda-panel-head h2{margin:0;font-size:15px}
.sct-root .sct-agenda-panel .sct-aside{display:flex;flex-direction:column;flex:1;min-height:0;overflow:auto;padding:16px 18px;gap:18px;width:auto;scrollbar-gutter:auto}
.sct-root .sct-agenda-panel .sct-side-block{margin:0;width:100%;max-height:none;overflow:visible}
@container sct (max-width:700px){
 .sct-workspace-nav{flex-wrap:wrap;gap:2px;margin-bottom:8px;padding-bottom:6px}
 .sct-root[data-records="true"] .sct-workspace-nav .sct-tabs{flex-basis:100%}
 .sct-workspace-actions{width:100%;justify-content:flex-end}
 .sct-root .sct-workspace-actions button{font-size:11px;padding:3px 8px}
 .sct-agenda-panel{top:90px;right:8px;bottom:8px;width:calc(100% - 16px)}
 .sct-root .sct-agenda-panel .sct-aside{padding:12px}
}

`;

    const MESSAGES = {
      zh: {
        'brand.name': '知微观澜',
        'brand.sub': '记录细微，回看进展',
        'sidebar.label': '知微观澜',
        'action.refresh': '刷新',
        'workspace.quick': '快速记录',
        'workspace.agenda': '日程与提醒',
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
        'action.promote': '转入',
        'action.promoteTo': '转入{name}',
        'theme.label': '外观',
        'theme.system': '跟随系统',
        'theme.light': '浅色',
        'theme.dark': '深色',
        // ── 功能名称统一四字：按钮/页签宽度一致，也不会被截断 ──
        'tab.pending': '待办事项',
        'tab.all': '全部记录',
        'tab.customers': '客户台账',
        'tab.board': '数据看板',
        // ── 数据看板页：五个标签 + 五张图 ──
        'board.windowLabel': '统计时间范围',
        'board.winMonth': '本月',
        'board.winQuarter': '本季',
        'board.winYear': '今年',
        'board.winCustom': '自定义',
        'board.from': '开始日期',
        'board.to': '结束日期',
        'board.loadError': '看板加载失败',
        // 五个数据标签
        'board.statSignedAmount': '签订合同额',
        'board.statSignedAmountNote': '按签订日归期',
        'board.statSignedCount': '签订合同数量',
        'board.statSignedCountNote': '按签订日归期',
        'board.statSalesCount': '销售项目数量',
        'board.statSalesCountNote': '期内新建',
        'board.statVisitCount': '客户交流数量',
        'board.statVisitCountNote': '按拜访日归期',
        'board.statOpportunityCount': '商机数量',
        'board.statOpportunityCountNote': '期内新建',
        'board.contractTotal': '合同总数',
        'cust.title': '客户台账',
        'cust.won': '中标 {n}',
        'cust.lost': '未中标 {n}',
        'cust.running': '在跟 {n}',
        'cust.visits': '拜访 {n}',
        'cust.amount': '中标 {name}',
        'cust.margin': '利润率 {name}%',
        'cust.runningList': '在跟项目',
        'cust.visitList': '拜访记录',
        'cust.lastVisit': '最近拜访：{name}',
        'cust.none': '暂无记录',
        'cust.emptyTitle': '没有客户数据',
        'cust.emptyBody': '录一条商机线索或一次客户交流，填上客户单位，这里就会按客户自动聚起来。中标、未中标、拜访都算在同一名下。',
        'tab.list': '视图切换',
        // "全部"而不是"用户记录"：它本来是"排除助手域后的全部"，
        // 但"用户记录"看着像一个域，容易和第 2 行的事务/销售/创作并排误读。
        'filter.user': '全部',
        'filter.label': '记录范围',
        'filter.journalHint': '经验教训库：给模型查的踩坑记录，不是待办',
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
        'group.soon': '临期提醒',
        'group.revisit': '值得重看',
        'group.followup': '今日跟进',
        'group.sleep': '沉睡灵感',
        'group.idle': '进行中',
        'group.open': '进行中',
        'group.count': '{n} 条',
        'status.overdue': '逾期 {n} 天',
        'status.today': '今天到期',
        'status.soon': '剩 {n} 个工作日',
        'status.sleep': '沉睡 {n} 天',
        // 跟进中：措辞刻意不同于"停滞"——那是你忘了，这是它本来就要天天推
        'status.followup': '跟进中 · {n} 天未更新',
        'status.stale': '停滞 {n} 天',
        'status.idleDays': '距上次更新 {n} 天',
        'status.promoted': '已转 {name}',
        'status.from': '源自 {name}',
        'status.archived': '经验',
        'status.done': '已完成',
        'deadline.none': '未设期限',
        'deadline.due': '{d} 截止',
        'deadline.recorded': '记于 {d}',
        /* 经验教训库：说明它能做什么，替代不存在的"完成/改期"按钮 */
        'detail.archivedNote': '经验教训库的条目没有「完成」和「改期」——它记的是踩过的坑与对应的约束，不是待办。要补充后续，用「编辑」写进下一步或备注。',
        'group.journalCount': '共 {n} 条经验',
        // 分组标题里的"共 N 条"（如「进行中 · 共 5」）
        'misc.total': '共',
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
        'detail.timeline': '时间轴',
        'detail.noTimeline': '还没有进展记录。新的跟踪内容会保存在这里。',
        'detail.notes': '备注',
        'detail.modifyDeadline': '修改截止日期',
        'detail.markDone': '标记完成',
        'detail.markAs': '标记为{name}',
        'stage.title': '推进阶段',
        'stage.update': '更新阶段',
        'stage.notice': '换成这一步的实际状态就更新，时间轴会自动记一条。可以跳步，也可以退回（比如报价退回立项重算）。',
        'stage.current': '当前截止：{name}',
        'stage.same': '已经是这个阶段了。',
        'stage.done': '已更新为「{name}」',
        'track.title': '记一条跟踪',
        'track.placeholder': '今天见了谁、对方说了什么、下一步什么时候再联系…',
        'track.add': '记下',
        'track.notice': '原话一字不改追加进时间轴；不会新建条目，商机始终是这一条。',
        'track.done': '已记下这条跟踪。',
        'detail.convertTitle': '转入其他域',
        'detail.convertBody': '这条记录可以转成另一条更具体的记录：原记录保留并标注去向，历史进展一并带过去。',
        'reschedule.title': '修改截止日期',
        'reschedule.newDate': '新的截止日期',
        'reschedule.notice': '将修改条目期限，不是仅延后一次提醒。',
        'reschedule.ok': '{id} 截止日期已更新',
        'reschedule.failed': '改期失败，日期已保留。',
        'promote.title': '转入{name}',
        'promote.targetLine': '将转入：{name}（原记录保留，历史进展一并带过去）',
        'promote.nameLabel': '{name}名称',
        'promote.namePlaceholder': '如：滨海新区污水处理厂设备采购',
        'promote.nameNotice': '换个能长期跟踪的名字：带上客户、标的和年份，几个月后翻台账才认得出是哪个项目。',
        'promote.deadlineLabel': '计划的结束时间',
        'promote.notice': '新记录需要计划结束时间，才能在到期前提醒你。确实"不急"也可以暂不设期限。',
        'promote.openEnded': '暂不设期限',
        'promote.confirm': '确认转入',
        'promote.confirmTo': '确认转入{name}',
        'promote.doneTo': '已转入{name}：',
        'action.edit': '编辑',
        'action.saveEdit': '保存',
        'detail.editing': '编辑这条记录',
        'detail.nextLabel': '下一步',
        'detail.nextPlaceholder': '下一步打算做什么？',
        'detail.categoryLabel': '分类',
        'detail.categoryPlaceholder': '如 沟通 / 文档 / 研发',
        'detail.saved': '已保存',
        'sales.customerLabel': '客户 / 招标单位',
        'sales.customerPlaceholder': '如 滨海新区水务局',
        'sales.bidNoLabel': '招标编号',
        'sales.bidNoPlaceholder': '立项依据，如 BH-2026-0731',
        'sales.amountLabel': '中标金额（元）',
        'sales.amountPlaceholder': '未开标留空',
        'sales.profitLabel': '中标利润（元）',
        'sales.profitPlaceholder': '利润率由金额与利润现算',
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
        /* 「完成并记录」小框 */
        'done.title': '完成并记录',
        'done.quoteLabel': '这次是什么情况？',
        'done.quotePlaceholder': '例：客户方回复今年不做，明年再议',
        'done.notice': '写的内容会作为原话记进时间轴，最上面一条。不写也可以直接完成。',
        'done.silent': '只标完成',
        'done.confirm': '完成并记录',
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
        'aside.reportHelp': '生成规则与补报说明',
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
        // 月历标题：没有具体月份时显示（month 为空的分支）
        'aside.calendarTitle': '月历',
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
        'workspace.quick': 'Quick capture',
        'workspace.agenda': 'Agenda & reminders',
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
        'action.promote': 'Move in',
        'action.promoteTo': 'Move to {name}',
        'theme.label': 'Appearance',
        'theme.system': 'System',
        'theme.light': 'Light',
        'theme.dark': 'Dark',
        'tab.pending': 'To-do',
        'tab.all': 'All records',
        'tab.customers': 'Customers',
        'tab.board': 'Data board',
        'board.windowLabel': 'Period',
        'board.winMonth': 'This month',
        'board.winQuarter': 'This quarter',
        'board.winYear': 'This year',
        'board.winCustom': 'Custom',
        'board.from': 'From',
        'board.to': 'To',
        'board.loadError': 'Could not load the board',
        'board.statSignedAmount': 'Contract value',
        'board.statSignedAmountNote': 'by signing date',
        'board.statSignedCount': 'Contracts signed',
        'board.statSignedCountNote': 'by signing date',
        'board.statSalesCount': 'Sales projects',
        'board.statSalesCountNote': 'created in period',
        'board.statVisitCount': 'Customer visits',
        'board.statVisitCountNote': 'by visit date',
        'board.statOpportunityCount': 'Opportunities',
        'board.statOpportunityCountNote': 'created in period',
        'board.contractTotal': 'contracts',
        'cust.title': 'Customer ledger',
        'cust.won': 'Won {n}',
        'cust.lost': 'Lost {n}',
        'cust.running': 'Open {n}',
        'cust.visits': 'Visits {n}',
        'cust.amount': 'Won {name}',
        'cust.margin': 'margin {name}%',
        'cust.runningList': 'Open',
        'cust.visitList': 'Recent visits',
        'cust.lastVisit': 'Last visit: {name}',
        'cust.none': 'No records yet',
        'cust.emptyTitle': 'No customer data yet',
        'cust.emptyBody': 'Record an opportunity or a visit with a customer name and it will be grouped here automatically.',
        'tab.list': 'View switcher',
        'filter.user': 'All',
        'filter.label': 'Scope',
        'filter.journalHint': 'Lesson library: pitfalls for the model to look up, not to-dos',
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
        'group.followup': 'Follow up today',
        'group.sleep': 'Dormant ideas',
        'group.idle': 'In progress',
        'group.open': 'in progress',
        'group.count': '{n} item(s)',
        'status.overdue': 'Overdue {n}d',
        'status.today': 'Due today',
        'status.soon': '{n} workdays left',
        'status.sleep': 'Dormant {n}d',
        'status.followup': 'Following up · {n}d since update',
        'status.stale': 'Stalled {n}d',
        'status.idleDays': 'Last update {n}d ago',
        'status.promoted': 'Moved to {name}',
        'status.from': 'From {name}',
        'status.archived': 'Lesson',
        'status.done': 'Done',
        'deadline.none': 'No deadline',
        'deadline.due': 'Due {d}',
        'deadline.recorded': 'Recorded {d}',
        'detail.archivedNote':
          'Lessons have no "done" or "reschedule" — they record a pitfall and its constraint, not a to-do. Use Edit to add follow-ups to the next step or notes.',
        'group.journalCount': '{n} lesson(s)',
        'misc.total': 'total',
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
        'detail.timeline': 'Timeline',
        'detail.noTimeline': 'No activity yet. New follow-ups will appear here.',
        'detail.notes': 'Notes',
        'detail.modifyDeadline': 'Change deadline',
        'detail.markDone': 'Mark done',
        'detail.markAs': 'Mark as {name}',
        'stage.title': 'Advance stage',
        'stage.update': 'Update stage',
        'stage.notice': 'Set the actual status and update. A timeline entry is recorded automatically. You can skip or step back.',
        'stage.current': 'Current deadline: {name}',
        'stage.same': 'It is already at this stage.',
        'stage.done': 'Updated to "{name}"',
        'track.title': 'Log a follow-up',
        'track.placeholder': 'Who you met, what they said, when to follow up…',
        'track.add': 'Log it',
        'track.notice': 'Your words are appended to the timeline verbatim. No new record is created — the opportunity stays one record.',
        'track.done': 'Follow-up logged.',
        'detail.convertTitle': 'Move to another domain',
        'detail.convertBody': 'This record can become a more specific record. The original is kept and marked with its destination; its history is carried over.',
        'reschedule.title': 'Change deadline',
        'reschedule.newDate': 'New deadline',
        'reschedule.notice': 'This modifies the record deadline, not just one reminder.',
        'reschedule.ok': '{id} deadline updated',
        'reschedule.failed': 'Reschedule failed. Date preserved.',
        'promote.title': 'Move to {name}',
        'promote.targetLine': 'Destination: {name} (the original record is kept; its history is carried over)',
        'promote.nameLabel': '{name} name',
        'promote.namePlaceholder': 'e.g. Binhai WWTP equipment procurement',
        'promote.nameNotice': 'Use a name you can track for months: include the customer, the subject and the year.',
        'promote.deadlineLabel': 'Planned end date',
        'promote.notice': 'The new record needs an end date so it can remind you before it is due. If it is really "no rush", you may leave it open.',
        'promote.openEnded': 'No deadline',
        'promote.confirm': 'Move it in',
        'promote.confirmTo': 'Move to {name}',
        'promote.doneTo': 'Moved to {name}: ',
        'action.edit': 'Edit',
        'action.saveEdit': 'Save',
        'detail.editing': 'Edit this record',
        'detail.nextLabel': 'Next step',
        'detail.nextPlaceholder': 'What is the next step?',
        'detail.categoryLabel': 'Category',
        'detail.categoryPlaceholder': 'e.g. comms / docs / dev',
        'detail.saved': 'Saved',
        'sales.customerLabel': 'Customer / Tenderer',
        'sales.customerPlaceholder': 'e.g. Binhai Water Authority',
        'sales.bidNoLabel': 'Tender No.',
        'sales.bidNoPlaceholder': 'e.g. BH-2026-0731',
        'sales.amountLabel': 'Award amount (CNY)',
        'sales.amountPlaceholder': 'Leave empty before bid opening',
        'sales.profitLabel': 'Award profit (CNY)',
        'sales.profitPlaceholder': 'Margin is derived from amount and profit',
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
        'done.title': 'Complete and record',
        'done.quoteLabel': 'What happened this time?',
        'done.quotePlaceholder': 'e.g. Client said no for this year, revisit next year',
        'done.notice': 'What you write is kept as your original words on the timeline. You can also finish without writing anything.',
        'done.silent': 'Just mark done',
        'done.confirm': 'Done and record',
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
        'aside.reportHelp': 'Generation rules & missed reports',
        'aside.reportMonthly': 'Monthly · last day {t}',
        'aside.reportQuarterly': 'Quarterly · quarter-end {t}',
        'aside.reportHalf': 'Half-year · Jun/Dec end {t}',
        'aside.reportYearly': 'Yearly · Dec end {t}',
        'aside.reportNote': 'All four report types start on the last day of their own period at the time shown, covering that period — they are never pushed to a night window. If DSH is closed at that moment it will not catch up later; ask in chat to regenerate one manually.',
        'aside.reportMissed': '{n} period(s) missed auto-generation; regenerate manually: {k}',
        'aside.calendar': '{y}/{m}',
        'aside.calendarTitle': 'Calendar',
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

    /**
     * 金额显示：万为单位，保留一位小数。
     *
     * 3200000 → "320 万"。不显示千分位完整数字：
     * 客户台账是横向扫一眼的场景，一列 "3,200,000" 读起来比 "320 万" 慢得多。
     * 不足 1 万的原样显示，避免变成 "0.0 万"。
     */
    function formatMoney(value) {
      const num = Number(value);
      if (!Number.isFinite(num) || num === 0) return '0 元';
      if (Math.abs(num) < 10000) return `${Math.round(num)} 元`;
      const wan = num / 10000;
      // 整数就不带小数点，省得出现"320.0 万"
      return `${Number.isInteger(wan) ? wan : wan.toFixed(1)} 万`;
    }

    function fill(template, a, b) {      const args = [a, b];
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
     * 待办判定：**优先用服务端给的 reason**（快照里每条都带），
     * 前端不再自己维护一份阈值——域阈值改了不用同步改前端。
     * 仅当快照没有 reason 字段时（旧宿主）才回退到本地推断。
     */
    function attentionOf(item) {
      if (!item || item.kind !== 'open') return null;
      /**
       * 已转出的记录不进待办。
       *
       * 服务端已经返回 reason=null（见 secretary.js 的 reminderReason），
       * 但下面几行是**前端兜底**：service 没给 reason 时按 stallDays 自己判。
       * 不在这里也挡一道的话，转出的那条照样会以"距上次更新 N 天"挂回待办里，
       * 两条标题一模一样的行就还是都在——用户看到的仍然是"重复记录"。
       */
      if (item.promotedTo) return null;
      if (item.reason !== undefined) {
        if (item.reason === 'dormant') return 'sleep';
        // daily：销售商机的"今日跟进"，每个工作日都出现
        if (item.reason === 'daily') return 'followup';
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

    /**
     * 范围过滤。
     *
     * 助手域是**经验教训库**（lifecycle=journal），条目没有完成/改期，
     * 也永远不会有 reason——所以它在「待办」页签下**永远是空的**。
     * 空分组比不显示更糟：用户会以为漏加载了。
     * 因此待办页把 journal 域整个排除，它们只在「全部记录」里出现。
     *
     * 判断依据用条目自带的 `lifecycle`（服务端随每条下发），
     * 不按 domain id 硬编码——将来别的域也能声明成 journal。
     */
    function isJournalItem(item) {
      return item && item.lifecycle === 'journal';
    }

    function inScope(item, scope) {
      if (scope === 'user') return !isJournalItem(item);
      if (scope === 'all') return true;
      return item.domain === scope;
    }

    /** 待办页：在 inScope 基础上再排除经验库（它们不构成待办） */
    function inPendingScope(item, scope) {
      if (isJournalItem(item)) return false;
      return inScope(item, scope);
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

    // 与 icon.svg 共用 24px 几何；侧栏继承宿主文字色，页头继承主题操作色。
    function BrandMark(props) {
      const size = (props && props.size) || 38;
      const className = props && props.className != null ? props.className : 'sct-brandmark';
      return h(
        'svg',
        { className, width: size, height: size, viewBox: '0 0 24 24',
          fill: 'none', stroke: 'currentColor', strokeWidth: 1.8,
          strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': 'true' },
        h('path', { d: 'M11.5 3.5H6A2.5 2.5 0 0 0 3.5 6v12A2.5 2.5 0 0 0 6 20.5h11a2.5 2.5 0 0 0 2.5-2.5v-4.5' }),
        h('path', { d: 'M7.5 8.5H9M7.5 12.5H11M7.5 16.5H15' }),
        h('path', { d: 'm13.5 6.5 3 3 5-5.5' }),
      );
    }

    function ControlIcon(props) {
      const paths = {
        light: 'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8M12 2v2M12 20v2M2 12h2M20 12h2M5 5l1.5 1.5M17.5 17.5 19 19M5 19l1.5-1.5M17.5 6.5 19 5',
        dark: 'M20.5 14A9 9 0 0 1 10 3.5 9 9 0 1 0 20.5 14Z',
        system: 'M4 4h16v12H4ZM8 21h8M12 16v5',
        calendar: 'M5 5h14v15H5ZM8 3v4M16 3v4M5 10h14',
        clock: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18M12 7v5l3 2',
        add: 'M12 5v14M5 12h14',
        refresh: 'M20 7v5h-5M4 17v-5h5M6.1 7a7 7 0 0 1 11.6-1L20 9M4 15l2.3 3A7 7 0 0 0 18 17',
        settings: 'M4 7h16M4 17h16M8 4v6M16 14v6',
      };
      return h('svg', { viewBox: '0 0 24 24', className: 'sct-control-icon', 'aria-hidden': 'true' },
        h('path', { d: paths[props.name] }));
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
       * 待办里不提醒，行上却打"停滞 6 天"的红标，自相矛盾。
       * 现在：只有服务端判为 `stall` 才用"停滞"警示；
       * 其余情况给中性的"距上次更新 N 天"，不暗示异常。
       */
      const attention = attentionOf(item);
      const isStalled = !done && attention === 'stall';
      const isDormant = !done && attention === 'sleep';
      const isFollowup = !done && attention === 'followup';
      const chips = [];
      if (done) {
        chips.push({ text: t('status.done'), kind: 'info' });
      } else if (item.due && item.due.level === 'overdue') {
        chips.push({ text: fill(t('status.overdue'), Math.abs(item.workingDays || 0)), kind: 'danger' });
      } else if (item.due && item.due.level === 'today') {
        chips.push({ text: t('status.today'), kind: 'today' });
      } else if (item.due && item.due.level === 'soon') {
        chips.push({ text: fill(t('status.soon'), item.workingDays), kind: 'warn' });
      } else if (isFollowup) {
        // 跟进中：中性偏积极，不用警示色——这单没出问题，只是要天天推
        chips.push({ text: fill(t('status.followup'), item.stallDays || 0), kind: 'today' });
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
      /**
       * 经验教训库条目不显示"未设期限"。
       * 它本来就不该有期限，写"未设期限"等于暗示这是个没填的漏项。
       * 换成记录日期——对经验库来说"什么时候踩的坑"才是有用的信息。
       */
      const archived = item.kind === 'archived';
      const meta = [
        h('span', { key: 'domain' }, NAMES[item.domain] || item.domain),
        h('span', { key: 'sep' }, '·'),
        archived
          ? h('span', { key: 'at' }, fill(t('deadline.recorded'), String(item.created ?? '').slice(5).replace('-', ' / ')))
          : h('span', { key: 'due' }, item.deadline ? fill(t('deadline.due'), item.deadline.slice(5).replace('-', ' / ')) : t('deadline.none')),
      ];
      if (chips.length) {
        meta.push(h('span', { key: 'chip', className: 'sct-status', 'data-kind': chips[0].kind }, chips[0].text));
      }
      /**
       * 转化标识：这是"同一条线索的两个阶段"还是两条不同的活，必须一眼能分。
       *
       * 不加这个的话，工作事项转成商机后两行标题完全一样、都挂在待办里，
       * 用户只会看到"重复的记录"——而实际上一条是源头、一条是去处，
       * 源头那条点进去还能看到"已转成销售 S-2026-001"。
       *
       * 两个方向都标：
       *   promotedTo  已转出 → 这条不再需要跟，去两条里标了去向的那条
       *   origin      转来的 → 上一步在哪
       */
      if (item.promotedTo) {
        meta.push(
          h('span', { key: 'promoted', className: 'sct-status', 'data-kind': 'plain' }, fill(t('status.promoted'), item.promotedTo)),
        );
      }
      if (item.origin) {
        meta.push(h('span', { key: 'origin', className: 'sct-status', 'data-kind': 'plain' }, fill(t('status.from'), item.origin)));
      }

      /**
       * 经验教训库（lifecycle=journal）的条目没有"完成/重开/改期"这些动作。
       * 不能只把按钮藏起来——完成按钮本身也得换成查看入口符号，
       * 否则用户点下去什么都不会发生，比不显示更糟。
       * `archived` 已在上方随 meta 一起算好，这里直接复用。
       */
      const canComplete = !isIdea && !archived;

      return h(
        'article',
        { className: 'sct-task', 'data-done': done ? 'true' : 'false', 'data-archived': archived ? 'true' : 'false' },
        canComplete
          ? h(
              'button',
              {
                className: 'sct-check',
                type: 'button',
                'data-shape': 'task',
                // 选中态不只靠颜色：done 时 aria-pressed 与勾选符号同时表达（6.2）
                'data-done': done ? 'true' : 'false',
                'aria-pressed': done ? 'true' : 'false',
                'aria-label': done ? t('action.reopen') + '：' + item.title : t('action.done') + '：' + item.title,
                onClick: function () { props.onToggleDone(item); },
              },
              h('svg', { className: 'sct-check-mark', viewBox: '0 0 20 20', 'aria-hidden': 'true' },
                h('path', { d: 'm4 10 4 4 8-8' })),
            )
          : h(
              // 非动作元素：经验条目/Idea 用符号标记，点击等同"查看"
              'button',
              {
                className: 'sct-check',
                type: 'button',
                'data-shape': archived ? 'archive' : 'idea',
                'aria-label': t('action.view') + '：' + item.title,
                onClick: function () { props.onView(item); },
              },
              archived ? '≡' : '✧',
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
          // 只有"有完成动作"的域才给改期入口；经验条目没有截止日期可改
          !done && !isIdea && !archived
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
      return h('dialog', { ref: ref, className: 'sct-drawer' + (props.variant ? ' sct-dialog-' + props.variant : ''), onClose: props.onClose, 'aria-label': props.label }, props.children);
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
        setEdit({
          next: item.next || '',
          category: item.category || '',
          // 销售域字段：从快照下发值回填，没有就空串（后端空串表示清除）
          customer: item.customer || '',
          bidNo: item.bidNo || '',
          amount: item.amount == null ? '' : String(item.amount),
          profit: item.profit == null ? '' : String(item.profit),
        });
        setError('');
      };

      const saveEdit = async function () {
        setBusy(true);
        setError('');
        try {
          const patch = {
            next: edit.next.trim(),
            // 空串表示清除分类（后端按 category === '' 删除）
            category: edit.category.trim(),
          };
          // 销售域字段只在有这个字段时才提交，避免把别的域的 undefined 也发过去
          if (item.domain === 'sales') {
            patch.customer = String(edit.customer || '').trim();
            patch.bidNo = String(edit.bidNo || '').trim();
            // 金额留空表示"还没开标"，要传空串让它清掉；有值就转成数字
            const amountText = String(edit.amount || '').trim();
            patch.amount = amountText === '' ? '' : Number(amountText);
            const profitText = String(edit.profit || '').trim();
            patch.profit = profitText === '' ? '' : Number(profitText);
            // 前端先挡一道：非数字就别发请求，否则后端抛错也只看到一句英文堆栈
            if (amountText !== '' && !Number.isFinite(patch.amount)) throw new Error('中标金额必须是数字');
            if (profitText !== '' && !Number.isFinite(patch.profit)) throw new Error('中标利润必须是数字');
          }
          await props.onSave(item.id, patch);
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
        h('div', { className: 'sct-detail-head-actions' },
          edit ? null : h('button', { type: 'button', onClick: startEdit }, t('action.edit')),
          h('button', { className: 'ghost', type: 'button', onClick: props.onClose }, t('action.close'))),
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
              onChange: function (event) { setEdit({ ...edit, next: event.target.value }); },
            }),
            h('label', null, t('detail.categoryLabel')),
            h('input', {
              type: 'text',
              value: edit.category,
              maxLength: 20,
              placeholder: t('detail.categoryPlaceholder'),
              onChange: function (event) { setEdit({ ...edit, category: event.target.value }); },
            }),
            // 销售域专属：客户 / 招标编号 / 中标金额 / 中标利润
            // 其他域不渲染这些框，免得用户在创作项目里看到"中标金额"
            item.domain === 'sales' ? h('label', null, t('sales.customerLabel')) : null,
            item.domain === 'sales'
              ? h('input', {
                  type: 'text',
                  value: edit.customer,
                  maxLength: 40,
                  placeholder: t('sales.customerPlaceholder'),
                  onChange: function (event) { setEdit({ ...edit, customer: event.target.value }); },
                })
              : null,
            item.domain === 'sales' ? h('label', null, t('sales.bidNoLabel')) : null,
            item.domain === 'sales'
              ? h('input', {
                  type: 'text',
                  value: edit.bidNo,
                  maxLength: 40,
                  placeholder: t('sales.bidNoPlaceholder'),
                  onChange: function (event) { setEdit({ ...edit, bidNo: event.target.value }); },
                })
              : null,
            item.domain === 'sales' ? h('label', null, t('sales.amountLabel')) : null,
            item.domain === 'sales'
              ? h('input', {
                  type: 'number',
                  value: edit.amount,
                  min: '0',
                  placeholder: t('sales.amountPlaceholder'),
                  onChange: function (event) { setEdit({ ...edit, amount: event.target.value }); },
                })
              : null,
            item.domain === 'sales' ? h('label', null, t('sales.profitLabel')) : null,
            item.domain === 'sales'
              ? h('input', {
                  type: 'number',
                  value: edit.profit,
                  placeholder: t('sales.profitPlaceholder'),
                  onChange: function (event) { setEdit({ ...edit, profit: event.target.value }); },
                })
              : null,
            error ? h('p', { className: 'sct-error', role: 'alert' }, error) : null,
            h(
              'div',
              { className: 'sct-edit-actions' },
              h('button', { type: 'button', onClick: function () { setEdit(null); } }, t('action.cancel')),
              h('button', { className: 'primary', type: 'button', disabled: busy, onClick: function () { saveEdit(); } }, busy ? t('quick.saving') : t('action.saveEdit')),
            ),
          )
        : null;

      /**
       * 时间轴。
       *
       * 详情弹层拿到的是**全量**（经 /entry），列表里那条只带 8 条——
       * 所以这里不截断，用户记了多少就显示多少。
       *
       * 原话是多行的（「记一条跟踪」里换行写，落盘时每行一个 `>`）：
       * 靠 CSS 的 whitespace:pre-wrap 保留换行，不要在这里 split 再拼 <br>，
       * 那会把连续的空白也一起吃掉。
       */
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

      /**
       * 经验教训库（kind=archived）的底部只留"编辑"。
       * 它没有可改的截止日期，也没有"完成"这个动作——
       * 报告要求"对暂不支持的交互明确说明，不显示无效按钮"，
       * 所以这里不是禁用按钮，而是**不渲染**，并在正文里说明它能做什么。
       */
      const archived = item.kind === 'archived';

      /**
       * 阶段推进：销售商机的核心操作，也是"后续流程怎么走"的答案。
       *
       * 只对 task 形态、且域声明了**多个**状态值的域显示（销售六档、工作四档都算）。
       * 下拉里列的是这个域的全部状态值，当前值预选中——
       * 用户选一个点「更新」，就完成一次阶段推进，时间轴会自动记一条。
       *
       * 为什么不做成"下一步"自动跳转：实际业务里会跳步、会退回（报价退回立项重算），
       * 只允许单向走一格反而碍事。
       */
      const statusValues = Array.isArray(item.statusValues) ? item.statusValues : [];
      /**
       * 项目形态（创作）也有多个阶段值，快照已经把它下发的就是 stage 那套
       * （见 secretary.js 的 statusValues 分支），所以这里不必排除 project——
       * 早先只放行 task，导致创作详情里根本没有"推进阶段"，只能靠完成按钮跳两格。
       */
      const canAdvance = !archived && (item.shape === 'task' || item.shape === 'project') && statusValues.length > 1;
      const stageSection = canAdvance
        ? h(
            'section',
            null,
            h('h3', null, t('stage.title')),
            h(
              'div',
              { className: 'sct-stage-row' },
              h(
                'select',
                {
                  value: props.stagePick == null ? (item.status || statusValues[0]) : props.stagePick,
                  onChange: function (event) { props.onStagePick(event.target.value); },
                },
                statusValues.map(function (value) {
                  return h('option', { key: value, value: value }, value);
                }),
              ),
              h(
                'button',
                {
                  type: 'button',
                  className: 'primary',
                  disabled: props.stageBusy || (props.stagePick && props.stagePick === item.status),
                  onClick: function () { props.onStageCommit(item, props.stagePick); },
                },
                props.stageBusy ? t('quick.saving') : t('stage.update'),
              ),
            ),
            h('p', { className: 'sct-notice' }, t('stage.notice')),
            // 当前阶段截止：推进到新阶段时通常也要改，放在这里省一次进出
            h('p', { className: 'small muted' }, fill(t('stage.current'), item.deadline || t('deadline.none'))),
          )
        : null;

      /**
       * 跟踪记录：销售用得多，但所有 task 条目都用得上。
       *
       * 直接调 /update 传 quote，原话进时间轴。**不新建条目**——
       * 新建会被去重算法判重（标题相似度够高就自动并入），等于在赌算法。
       * 这是整个销售流程里最高频的操作，必须能在面板上一步完成。
       */
      const trackSection = !archived && item.shape === 'task'
        ? h(
            'section',
            null,
            h('label', { htmlFor: 'sct-track-input', className: 'sct-field-title' }, t('track.title')),
            h('textarea', {
              className: 'sct-track-box', id: 'sct-track-input', 'aria-describedby': 'sct-track-hint',
              // rows 只是首屏估算，真正的高度由 .sct-track-box 的 min-height 决定；
              // 两行塞不下"见了谁 + 说了什么 + 下一步"，用户会边写边滚。
              rows: 5,
              value: props.trackText || '',
              placeholder: t('track.placeholder'),
              onChange: function (event) { props.onTrackText(event.target.value); },
              onKeyDown: function (event) {
                // Ctrl/Cmd+Enter 直接记下，与页面其他输入框保持一致
                if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
                  event.preventDefault();
                  if (!props.trackBusy && String(props.trackText || '').trim()) {
                    props.onTrackCommit(item, props.trackText);
                  }
                }
              },
            }),
            h(
              'div',
              { className: 'sct-track-actions' },
              h('p', { className: 'sct-inline-hint', id: 'sct-track-hint' }, t('track.notice')),
              h(
                'button',
                {
                  type: 'button',
                  className: 'primary',
                  disabled: props.trackBusy || !String(props.trackText || '').trim(),
                  onClick: function () { props.onTrackCommit(item, props.trackText); },
                },
                props.trackBusy ? t('quick.saving') : t('track.add'),
              ),
            ),
          )
        : null;

      /**
       * 这个条目能转成什么：**由域的能力决定，不写死域 id**。
       *
       * 原先只有 `isIdea` 才有转化入口，于是加了销售域之后，
       * 工作事项在面板上根本没有"转入商机"的按钮——后端早就支持了，
       * 前端却按 `domain === 'idea'` 判断。现在快照把 promotesTo 下发了，
       * 有这个能力就渲染，没有就不渲染。
       */
      const promoteTargets = (Array.isArray(item.promotesTo) ? item.promotesTo : []).filter(function (target) {
        // 已经转过的就别再显示按钮，免得用户重复点
        return !item.promotedTo;
      });

      /**
       * 「标记完成」按域声明的完成值走。
       *
       * 事务域 doneValues=['已完成'] → 目标值 已完成
       * 销售域 doneValues=['中标']   → 目标值 中标
       * 已经是完成态就不显示这个按钮。
       */
      const doneValues = Array.isArray(item.doneValues) && item.doneValues.length ? item.doneValues : ['已完成'];
      const doneButtonTarget = !done && item.shape === 'task' ? doneValues[0] : null;
      const convertSection = promoteTargets.length
        ? h(
            'section',
            null,
            h('h3', null, t('detail.convertTitle')),
            h('p', { className: 'muted small' }, t('detail.convertBody')),
            h(
              'div',
              { style: { marginTop: '10px', display: 'flex', gap: '8px', flexWrap: 'wrap' } },
              promoteTargets.map(function (target) {
                return h(
                  'button',
                  {
                    key: target.id,
                    className: 'primary',
                    onClick: function () {
                      props.onClose();
                      props.onPromote(item, target.id);
                    },
                  },
                  /**
                   * **目标域名一律写出来**。
                   *
                   * 早先只有一个去向时用了通用文案「转入」，结果工作域（唯一去向是销售）
                   * 的按钮就只写着"转入"两个字——点下去会去哪，用户完全看不出来。
                   * 目标名一次都不能省：去向数量是数据决定的，用户不该靠猜。
                   */
                  fill(t('action.promoteTo'), target.name),
                );
              }),
            ),
          )
        : null;

      // 灵感域的底部什么都没有（转化入口在正文里）；能转化的其他域，按钮放底部更顺手
      const footer = archived
        ? null
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
            /**
             * 「标记完成」现在按**域声明的完成值**写，不再硬编码 done。
             *
             * 原实现无脑写 status: 'done'，而销售域没有这个值——
             * 点一下直接 500，用户还以为是坏了。现在：
             *   - 事务域：doneValues=['已完成'] → 按钮写「标记完成」
             *   - 销售域：doneValues=['中标']   → 按钮写「标记中标」
             * 按钮文案也按目标值走，用户点之前就知道会发生什么。
             * `action.done`（完成）只在完成值恰好就是通用说法时用，
             * 其余一律「标记为 X」，免得同一个按钮在域之间说法不一。
             */
            doneButtonTarget
              ? h(
                  'button',
                  {
                    className: 'primary',
                    onClick: function () {
                      props.onClose();
                      props.onToggleDone(item);
                    },
                  },
                  fill(t('detail.markAs'), doneButtonTarget),
                )
              : null,
          );

      // 灵感没有 footer 按钮（转化入口在正文里），经验条目也没有——底部就不渲染。
      const showFooter = !isIdea && !archived;

      return h(
        Drawer,
        { open: true, onClose: props.onClose, label: item.title, variant: 'detail' },
        h(
          'div',
          { className: 'sct-drawer-head' },
          head,
          h('h2', null, item.title),
          h('div', { className: 'sct-task-meta' }, meta),
        ),
        h(
          'div',
          { className: 'sct-drawer-body' },
          editSection,
          archived ? h('p', { className: 'sct-notice' }, t('detail.archivedNote')) : null,
          h('div', { className: 'sct-detail-grid' },
            h('div', { className: 'sct-detail-activity' },
              trackSection,
              timelineSection || h('section', { className: 'sct-timeline-empty' },
                h('h3', null, t('detail.timeline')),
                h('p', { className: 'muted small' }, t('detail.noTimeline')))),
            nextSection || stageSection || notesSection || convertSection
              ? h('div', { className: 'sct-detail-context' }, stageSection, nextSection, notesSection, convertSection)
              : null),
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
     * 「完成并记录」小框。
     *
     * 一件事做完时，最有价值的往往是那一刻的具体情况：
     * "客户方说今年不做，明年再议"。这个框给一次低成本的机会把它留下，
     * 同时保留"什么都不写，直接标完成"的快捷路径。
     *
     * 用 Drawer（dialog）而不是行内展开：小框要能承接较长文字，
     * 行内展开会把列表挤变形。
     */
    function DoneDrawer(props) {
      const state = props.state;
      const t = props.t;
      if (!state || !state.item) return null;
      const submit = function (event) {
        if (event) event.preventDefault();
        props.onConfirm();
      };
      return h(
        Drawer,
        { open: true, onClose: props.onCancel, label: t('done.title'), variant: 'done' },
        h(
          'form',
          { className: 'sct-done-form', onSubmit: submit },
          h('div', { className: 'sct-done-body' },
          h('h2', null, t('done.title')),
          h('p', { className: 'sct-done-subject' }, state.item.title),
          h('label', { htmlFor: 'sct-done-input' }, t('done.quoteLabel')),
          h('textarea', {
            id: 'sct-done-input', 'aria-describedby': 'sct-done-hint',
            rows: 5,
            value: state.text,
            placeholder: t('done.quotePlaceholder'),
            autoFocus: true,
            onChange: function (event) { props.onText(event.target.value); },
            onKeyDown: function (event) {
              // Ctrl/Cmd+Enter 提交，与录入框保持一致
              if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
                event.preventDefault();
                props.onConfirm();
              }
            },
          }),
          h('p', { className: 'sct-inline-hint', id: 'sct-done-hint' }, t('done.notice')),
          state.error ? h('p', { className: 'sct-error', role: 'alert' }, state.error) : null,
          ),
          h(
            'footer',
            { className: 'sct-done-footer' },
            h('button', { type: 'button', onClick: props.onCancel, disabled: state.busy }, t('action.cancel')),
            h('button', { type: 'button', onClick: props.onSilent, disabled: state.busy }, t('done.silent')),
            h('button', { className: 'primary', type: 'submit', disabled: state.busy }, state.busy ? t('quick.saving') : t('done.confirm')),
          ),
        ),
      );
    }

    /**
     * 转化时的期限补齐。
     *
     * 转成新记录等于新建一条，没有计划结束时间就无法到期提醒，
     * 所以后端会返回 need_deadline，这里就地让用户选日期（或明确"暂不设期限"）。
     *
     * 文案不写死目标域：工作→商机、商机→工作、灵感→创作都走这里，
     * 目标名由 state.targetName 带进来并**在标题和确认按钮上都写出来**——
     * 用户点开这个弹窗的时候，必须一眼知道自己在往哪儿转。
     *
     * **名称必须重填**：工作事项的标题是"去摸一下这个项目做不做"这种动作描述，
     * 而商机名要能在后续几个月里作为整体跟踪的锚点（客户、标的、年份）。
     * 沿用原标题会得到一个"摸一下"的商机，之后翻台账根本认不出来是哪个项目。
     * 所以默认值给原标题（省得完全从零打），但要求用户确认后再提交。
     */
    function PromoteDrawer(props) {
      const state = props.state;
      const t = props.t;
      if (!state || !state.item) return null;
      const targetName = state.targetName || '';
      return h(
        Drawer,
        { open: true, onClose: props.onCancel, label: fill(t('promote.title'), targetName) },
        h(
          'form',
          {
            className: 'sct-drawer-simple',
            onSubmit: function (event) {
              event.preventDefault();
              props.onConfirm(state.item, state.targetDomain, state.date, false, state.targetTitle);
            },
          },
          h('h2', null, fill(t('promote.title'), targetName)),
          h('p', { className: 'muted' }, state.title),
          // 明确写出"去处"：这一行是用户判断自己点对了没有的唯一依据
          targetName ? h('p', { className: 'small' }, fill(t('promote.targetLine'), targetName)) : null,
          h('label', null, fill(t('promote.nameLabel'), targetName)),
          h('input', {
            type: 'text',
            value: state.targetTitle || '',
            required: true,
            maxLength: 60,
            placeholder: t('promote.namePlaceholder'),
            onChange: function (event) {
              props.onTitle(event.target.value);
            },
          }),
          h('p', { className: 'sct-notice' }, t('promote.nameNotice')),
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
              { type: 'button', onClick: function () { props.onConfirm(state.item, state.targetDomain, null, true, state.targetTitle); } },
              t('promote.openEnded'),
            ),
            h(
              'button',
              { className: 'primary', type: 'submit', disabled: state.busy },
              targetName ? fill(t('promote.confirmTo'), targetName) : t('promote.confirm'),
            ),
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
      const appearance = useTheme();
      const boardFrame = useRef(null);
      const [boardSize, setBoardSize] = useState({ width: 1200, height: 800 });
      const [boardChart, setBoardChart] = useState('');
      const [boardView, setBoardView] = useState('overview');
      const [boardPages, setBoardPages] = useState({});
      const [boardOutcomeMetric, setBoardOutcomeMetric] = useState('count');
      const [boardRevision, setBoardRevision] = useState(0);
      const boardOverview = boardSize.width >= 1100 && boardSize.height >= 900;
      useEffect(function () {
        const node = boardFrame.current;
        if (!node || typeof ResizeObserver === 'undefined') return;
        const observer = new ResizeObserver(function () {
          setBoardSize({ width: node.clientWidth, height: node.clientHeight });
        });
        observer.observe(node);
        return () => observer.disconnect();
      }, []);

      // doneLimit 必须先声明再传给 useSnapshot（"全部记录"页可切到 all）
      const doneLimitState = useState(8);
      const doneLimit = doneLimitState[0];
      const setDoneLimit = doneLimitState[1];
      const snap = useSnapshot(doneLimit);
      const tabState = useState('pending');
      const tab = tabState[0];
      const setTab = tabState[1];
      const recordView = tab === 'pending' || tab === 'all';
      const [captureOpen, setCaptureOpen] = useState(false);
      const [agendaOpen, setAgendaOpen] = useState(false);
      const captureRegionRef = useRef(null);
      const agendaPanelRef = useRef(null);
      const agendaToggleRef = useRef(null);
      const captureToggleRef = useRef(null);
      const closeAgenda = () => { setAgendaOpen(false); agendaToggleRef.current?.focus(); };
      useEffect(() => {
        if (captureOpen && recordView) captureRegionRef.current?.querySelector('input')?.focus();
      }, [captureOpen, recordView]);
      useEffect(() => { setAgendaOpen(false); }, [tab]);
      useEffect(() => {
        if (!agendaOpen) return;
        agendaPanelRef.current?.querySelector('button')?.focus();
        const key = e => { if (e.key === 'Escape') { e.preventDefault(); closeAgenda(); } };
        const outside = e => {
          if (!agendaPanelRef.current?.contains(e.target) && !agendaToggleRef.current?.contains(e.target)) setAgendaOpen(false);
        };
        document.addEventListener('keydown', key);
        document.addEventListener('pointerdown', outside);
        return () => { document.removeEventListener('keydown', key); document.removeEventListener('pointerdown', outside); };
      }, [agendaOpen]);
      /**
       * 数据看板的时间窗口与数据。
       *
       * ── 为什么窗口状态放在组件里，不放进快照 ──
       * 快照是所有页签共用的、每次轮询都会刷新的。把"我看的是哪个月"
       * 放进去，会导致切一下窗口就触发整个面板重算，而且刷新后选择会丢。
       * 放在组件状态里，切页签回来还是原来看的那个月。
       *
       * ── 为什么单独请求而不复用 snapshot.board ──
       * snapshot 里的 board 只能是"当前月"（它不带参数）。
       * 要支持任意区间，必须有独立的带参请求。
       */
      const boardWindowState = useState({ kind: 'month', from: '', to: '' });
      const boardWindow = boardWindowState[0];
      const setBoardWindow = boardWindowState[1];
      const boardDataState = useState(null);
      const boardData = boardDataState[0];
      const setBoardData = boardDataState[1];
      const boardLoadingState = useState(false);
      const boardLoading = boardLoadingState[0];
      const setBoardLoading = boardLoadingState[1];
      const boardErrorState = useState(null);
      const boardError = boardErrorState[0];
      const setBoardError = boardErrorState[1];
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
      /**
       * 「完成并记录」小框。
       *
       * 场景：一件事做完了，但完成那一刻往往有值得留下的具体信息——
       * "客户方说今年不做，明年再议"。原来的实现点圆圈就直接 `status: done`，
       * 并写一句硬编码的"面板标记完成"，等于把最有价值的内容丢掉了。
       *
       * `item` 非空即表示小框打开；`text` 是用户输入的内容（可为空）。
       */
      const doneState = useState({ item: null, text: '', error: '', busy: false });
      const donePrompt = doneState[0];
      const setDonePrompt = doneState[1];
      const promoteState = useState({ item: null, targetDomain: '', targetName: '', title: '', targetTitle: '', date: '', error: '', busy: false });
      const promote = promoteState[0];
      const setPromote = promoteState[1];

      /**
       * 详情弹层里的两个就地操作：推进阶段、写跟踪记录。
       *
       * 状态放这里而不是弹层内部：弹层每次 reload 都会重挂，
       * 状态若放在弹层里，保存过程中的忙碌态和用户已输入的跟踪文字会被清掉。
       */
      const stagePickState = useState('');
      const stagePick = stagePickState[0];
      const setStagePick = stagePickState[1];
      const stageBusyState = useState(false);
      const stageBusy = stageBusyState[0];
      const setStageBusy = stageBusyState[1];
      const trackTextState = useState('');
      const trackText = trackTextState[0];
      const setTrackText = trackTextState[1];
      const trackBusyState = useState(false);
      const trackBusy = trackBusyState[0];
      const setTrackBusy = trackBusyState[1];
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
          const selectedDomain = ((snap.data && snap.data.domains) || []).find((d) => d.id === scope);
          const searchScope = tab === 'pending' && selectedDomain?.lifecycle === 'journal' ? 'user' : scope;
          const timer = setTimeout(function () {
            const params = new URLSearchParams({ q: keyword, limit: '50' });
            if (searchScope !== 'user' && searchScope !== 'all') params.set('domain', searchScope);
            request('/search?' + params.toString())
              .then(function (data) {
                if (cancelled) return;
                const items = (data && data.items) || [];
                /**
                 * 搜索结果的范围过滤，口径与列表一致：
                 * 「用户记录」排除经验库，但不按 domain id 硬编码——
                 * 用条目自带的 lifecycle 判断，自定义 journal 域也适用。
                 */
                const filtered = searchScope === 'user' ? items.filter(function (x) { return x.lifecycle !== 'journal'; }) : items;
                setSearchResult({ keyword: keyword, scope: searchScope, items: filtered });
              })
              .catch(function (error) {
                if (cancelled) return;
                setSearchResult({ keyword: keyword, scope: searchScope, items: [], error: String((error && error.message) || error) });
              });
          }, 250);
          return function () {
            cancelled = true;
            clearTimeout(timer);
          };
        },
        [search, scope, tab, snap.data],
      );

      /**
       * 看板取数。
       *
       * 只在**看板页签可见时**请求：其他页签用不到这份数据，
       * 每次轮询都去算一遍是白费（它要扫全部记录做聚合）。
       */
      useEffect(
        function () {
          if (tab !== 'board') return undefined;
          let cancelled = false;
          setBoardLoading(true);
          setBoardError(null);
          const params = new URLSearchParams({ window: boardWindow.kind });
          if (boardWindow.kind === 'custom') {
            if (boardWindow.from) params.set('from', boardWindow.from);
            if (boardWindow.to) params.set('to', boardWindow.to);
          }
          request('/board?' + params.toString())
            .then(function (data) {
              if (cancelled) return;
              setBoardData(data && data.board ? data.board : data);
              setBoardLoading(false);
            })
            .catch(function (error) {
              if (cancelled) return;
              setBoardError(String((error && error.message) || error));
              setBoardLoading(false);
            });
          return function () {
            cancelled = true;
          };
        },
        [tab, boardWindow.kind, boardWindow.from, boardWindow.to, boardRevision],
      );

      /**
     * ── 统计图组件 ──
     *
     * 全部用内联 SVG 手写，不引图表库。理由：
     *   · 插件跑在宿主页面里，引一个 200KB 的图表库只为四张图不值；
     *   · 图表库的默认样式和面板的设计令牌对不上，还得覆写一遍；
     *   · 这四张图结构固定（柱/条/环），手写反而更好控。
     *
     * ── 数据标签直接写在图上，不靠悬浮 ──
     * 用户明确要求"图表上直接标数值"。悬浮提示是补充，不是替代——
     * 一屏看板扫过去就要能读出数，不该要求鼠标停在每根柱子上。
     */

    /** 柱状图：给漏斗和趋势共用。values 是 [{ label, value, sub, alert }] */
    function BarChart(props) {
      const items = props.items || [];
      const unit = props.unit || '';
      const max = Math.max(1, ...items.map((d) => Number(d.value) || 0));
      /**
       * 高度**不由 JS 定**，交给 CSS 的 .sct-chart-bar 用 clamp 控制。
       *
       * 写死 px 会跟"一屏放下"打架：矮屏撑爆、宽屏又浪费。
       * CSS 里用 vh 跟着窗口走，这里只负责结构。
       */
      return h(
        'div',
        { className: 'sct-chart-bar' + (props.size === 'sm' ? ' is-sm' : '') },
        items.map(function (d) {
          const v = Number(d.value) || 0;
          // 有值时至少给 4% 高度，否则 1 和 0 看起来一样
          const pct = v > 0 ? Math.max(4, (v / max) * 100) : 0;
          return h(
            'div',
            { key: d.key || d.label, className: 'sct-cbar-col', title: (d.sub ? d.sub + '　' : '') + v + unit },
            /**
             * 数值标签：**窗口外或 0 值时留空**。
             *
             * 窗口外的柱子是灰的（is-muted），意思是"这个月不在你选的范围内"。
             * 灰柱子上还顶着个黑色数字，看起来像"这个月的数也统计进来了"——
             * 实测就会被误读成"怎么这个月的数也显示了"。
             * 所以灰柱只留形状，数值去悬浮提示看。
             *
             * 为什么给空串而不是不渲染这个节点：保留它，柱子和标签的行高
             * 才能对齐（否则有值的列会被顶高一截，整张图看着歪）。
             */
            h(
              'span',
              { className: 'sct-cbar-value' + (d.alert ? ' is-alert' : '') },
              d.muted || (v === 0 && d.hideZero) ? '' : v > 0 ? String(v) + unit : '—',
            ),
            h(
              'div',
              { className: 'sct-cbar-track' },
              h('span', {
                className: 'sct-cbar-fill' + (d.alert ? ' is-alert' : '') + (d.muted ? ' is-muted' : ''),
                style: { height: pct + '%' },
              }),
            ),
            h('span', { className: 'sct-cbar-label' }, d.label),
          );
        }),
      );
    }

    /** 横向条形图：各领域对比。items 是 [{ label, value }]，可多条 */
    function HBarChart(props) {
      const rows = props.rows || [];
      const max = Math.max(1, ...rows.flatMap((r) => r.series.map((s) => Number(s.value) || 0)));
      return h(
        'div',
        { className: 'sct-chart-hbar' },
        rows.map(function (r) {
          return h(
            'div',
            { key: r.key, className: 'sct-hbar-row' },
            h('span', { className: 'sct-hbar-name' }, r.label),
            h(
              'div',
              { className: 'sct-hbar-track' },
              r.series.map(function (s) {
                const v = Number(s.value) || 0;
                const pct = v > 0 ? Math.max(2, (v / max) * 100) : 0;
                return v > 0
                  ? h('span', {
                      key: s.key,
                      className: 'sct-hbar-fill sct-hbar-' + s.key,
                      style: { width: pct + '%' },
                      title: s.label + ' ' + v,
                    })
                  : null;
              }),
            ),
            h(
              'span',
              { className: 'sct-hbar-value' },
              // 在办是主数，后面的分项用小字跟在旁边
              h('strong', null, String(r.total)),
              r.detail ? h('em', null, r.detail) : null,
            ),
          );
        }),
      );
    }

    /** 环形进度：回款。单一比例，标签写百分比 + 金额 */
    function DonutChart(props) {
      const pct = Math.max(0, Math.min(100, Number(props.percent) || 0));
      const size = props.size || 88;
      const stroke = props.stroke || 9;
      const r = (size - stroke) / 2;
      const c = 2 * Math.PI * r;
      const dash = (pct / 100) * c;
      return h(
        'div',
        { className: 'sct-donut', style: { width: size + 'px', height: size + 'px' } },
        h(
          'svg',
          { width: size, height: size, viewBox: '0 0 ' + size + ' ' + size, 'aria-hidden': 'true' },
          h('circle', {
            cx: size / 2,
            cy: size / 2,
            r: r,
            fill: 'none',
            stroke: 'var(--zw-line)',
            'stroke-width': stroke,
          }),
          h('circle', {
            cx: size / 2,
            cy: size / 2,
            r: r,
            fill: 'none',
            stroke: props.alert ? 'var(--zw-danger)' : 'var(--zw-success)',
            'stroke-width': stroke,
            'stroke-linecap': 'round',
            'stroke-dasharray': dash + ' ' + (c - dash),
            // 从 12 点方向开始顺时针
            transform: 'rotate(-90 ' + size / 2 + ' ' + size / 2 + ')',
          }),
        ),
        h(
          'div',
          { className: 'sct-donut-label' },
          h('strong', null, props.percentLabel ?? pct + '%'),
          h('span', null, props.caption || ''),
        ),
      );
    }

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

      /**
       * 完成 / 重开。
       *
       * 完成时**先弹小框**（可写可不写），由 `confirmDone` 真正提交；
       * 重开没有"要记什么"的问题，直接提交。
       *
       * 为什么不在完成时直接提交、把记录当可选后续：
       * 完成那一刻正是信息最新鲜的时候，弹框问一句成本极低；
       * 等用户回到详情页再补，多半就不会补了。
       */
      const toggleDone = useCallback(
        function (item) {
          const wasDone = item.kind === 'done';
          if (wasDone) {
            void submitDone(item, '');
            return;
          }
          setDonePrompt({ item: item, text: '', error: '', busy: false });
        },
        [reload, showToast, t],
      );

      /** 真正提交完成/重开；`text` 非空时写进时间轴作为这次的原话 */
      const submitDone = useCallback(
        async function (item, text) {
          const wasDone = item.kind === 'done';
          const body = { id: item.id };
          // 重开必须落到非完成状态：item.status 此刻就是完成值，回填它会再提交一次完成
          if (item.shape === 'project') {
            /**
             * 创作（project 形态）阶段现在是汉字，且完成/终止值同样由域声明给出
             * （完成 / 搁置）。这里原来写死 'revising' / 'done'：
             *   - 重开回填 'revising' 是**创作专属的英文值**，改中文后不再合法；
             *   - 完成写 'done' 在汉字枚举里同样非法。
             * 现在一并用快照下发的默认阶段与完成值，域改词面板不用跟着改。
             */
            const stageDefaults = Array.isArray(item.statusValues) ? item.statusValues : [];
            const stageDone = Array.isArray(item.doneValues) && item.doneValues.length ? item.doneValues[0] : null;
            const stageReopen = item.statusDefault || stageDefaults[0] || '';
            body.stage = wasDone ? stageReopen : stageDone;
            if (!body.stage) delete body.stage;
          } else {
            /**
             * 完成值**按域声明**取，不再硬编码。
             *
             * 原实现无脑写 'done'，但销售域的完成值是「中标」——
             * 点一下直接 500（后端校验会拒），用户以为是坏了。
             * 现在：
             *   完成 → 域声明的第一个完成值（事务 已完成 / 项目销售 已中标）
             *   重开 → 域声明的默认值（事务 待办 / 项目销售 初期阶段）
             * 后者不写死 '进行中'：销售域没有这个值，写了同样报错。
             *
             * ── 两轴的域必须写到 doneField ──
             * 项目销售有两头轴：status 装阶段、awardStatus 装是否中标。
             * 完成值（已中标）在**第二条轴**上，写进 status 会被后端拒
             * （阶段枚举里没有这个值）。所以这里按 item.doneField 决定写哪个键。
             * 重开同理：完成轴回默认值，阶段不动——阶段是它自己的进度，不该被重开重置。
             */
            const doneValues = Array.isArray(item.doneValues) && item.doneValues.length ? item.doneValues : ['已完成'];
            const doneField = typeof item.doneField === 'string' && item.doneField ? item.doneField : 'status';
            if (doneField === 'status') {
              const defaultValue = item.statusDefault || '待办';
              body.status = wasDone ? defaultValue : doneValues[0];
            } else {
              // 第二条轴：完成 → 完成值；重开 → 这条轴的默认值（未定）
              body[doneField] = wasDone ? (item.doneDefault || '未定') : doneValues[0];
            }
          }
          /**
           * 只有用户真的写了内容才传 quote。
           * 以前这里硬编码 `note: '面板标记完成'`——每条完成记录都被盖上
           * 同一句废话，时间轴里全是噪音。现在：
           *   - 写了内容 → quote（原话进时间轴，最上面）
           *   - 没写内容 → 什么都不传，时间轴保持干净
           */
          const trimmed = String(text ?? '').trim();
          if (!wasDone && trimmed) body.quote = trimmed;
          try {
            await request('/update', jsonBody(body));
            showToast(fill(t(wasDone ? 'undo.reopened' : 'undo.done'), item.title));
            await reload();
            return true;
          } catch (error) {
            return { error: String((error && error.message) || error) };
          }
        },
        [reload, showToast, t],
      );

      /** 小框里点「完成」/回车：先写内容再关框 */
      const confirmDone = useCallback(
        async function () {
          const item = donePrompt.item;
          if (!item) return;
          setDonePrompt(function (prev) { return { ...prev, busy: true, error: '' }; });
          const result = await submitDone(item, donePrompt.text);
          if (result === true) {
            setDonePrompt({ item: null, text: '', error: '', busy: false });
            return;
          }
          setDonePrompt(function (prev) {
            return { ...prev, busy: false, error: (result && result.error) || t('quick.errorGeneric') };
          });
        },
        [donePrompt, submitDone, t],
      );

      /** 小框里点「只标完成」：不写内容，直接完成 */
      const confirmDoneSilent = useCallback(
        async function () {
          const item = donePrompt.item;
          if (!item) return;
          setDonePrompt(function (prev) { return { ...prev, busy: true, error: '' }; });
          const result = await submitDone(item, '');
          if (result === true) {
            setDonePrompt({ item: null, text: '', error: '', busy: false });
            return;
          }
          setDonePrompt(function (prev) {
            return { ...prev, busy: false, error: (result && result.error) || t('quick.errorGeneric') };
          });
        },
        [donePrompt, submitDone, t],
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

      /**
       * 目标域 id → 中文名。弹窗标题、确认按钮、成功提示都要用它。
       *
       * 从快照的域视图取，取不到就退回 id 本身（至少能显示"sales"而不是空白）。
       */
      const domainNameOf = useCallback(
        function (domainId) {
          if (!domainId) return '';
          const list = (snap && snap.domains) || [];
          const found = list.find(function (d) {
            return d.id === domainId;
          });
          return (found && found.name) || String(domainId);
        },
        [snap],
      );

      /**
       * 推进阶段：task 形态写 status，project 形态（创作）写 stage。
       *
       * 不新建条目——这几个阶段始终是**同一条记录**在往前走。
       * 成功后关掉详情：记录变了，旧对象是陈的，让用户从列表重新点开。
       *
       * 字段名按形态选，不能一律发 status：创作的阶段存在 stage 里，
       * 把「起草」当 status 发过去会被后端当作非法状态值拒掉。
       */
      const doStageCommit = useCallback(
        async function (item, value) {
          const target = String(value || '').trim();
          if (!target) return;
          if (target === item.status) {
            showToast(t('stage.same'));
            return;
          }
          setStageBusy(true);
          try {
            const body = { id: item.id };
            if (item.shape === 'project') body.stage = target;
            else body.status = target;
            await request('/update', jsonBody(body));
            showToast(fill(t('stage.done'), target));
            setStagePick('');
            setDetailItem(null);
            await reload();
          } catch (error) {
            showToast(String((error && error.message) || error));
          } finally {
            setStageBusy(false);
          }
        },
        [reload, showToast, t],
      );

      /**
       * 跟踪记录：原话进时间轴，**不新建条目**。
       *
       * 这里必须是 quote 而不是 note：quote 会以引用块形式在原话下面留痕，
       * note 只进「备注」。用户说"今天见了甲方"，那句话本身就是要留的证据。
       */
      const doTrackCommit = useCallback(
        async function (item, text) {
          const trimmed = String(text || '').trim();
          if (!trimmed) return;
          setTrackBusy(true);
          try {
            await request('/update', jsonBody({ id: item.id, quote: trimmed }));
            setTrackText('');
            showToast(t('track.done'));
            setDetailItem(null);
            await reload();
          } catch (error) {
            showToast(String((error && error.message) || error));
          } finally {
            setTrackBusy(false);
          }
        },
        [reload, showToast, t],
      );

      const doPromote = useCallback(
        async function (item, targetDomain, deadline, openEnded, targetTitle) {
          try {
            const body = { id: item.id, action: 'promote' };
            // 目标域必须显式传：一个域可能有多个去向（工作→销售、销售→工作），
            // 不传的话后端只能猜，猜错了用户要删掉重建
            if (targetDomain) body.targetDomain = targetDomain;
            // 新名称：用户在弹窗里填的商机名。空着就不传，后端沿用原标题。
            const trimmedTitle = String(targetTitle == null ? '' : targetTitle).trim();
            if (trimmedTitle) body.title = trimmedTitle;
            if (deadline) body.deadline = deadline;
            if (openEnded) body.openEnded = true;
            const data = await request('/link', jsonBody(body));
            const result = (data && data.result) || {};
            // 转成新记录也是新建：没有期限时后端会拒绝，面板要就地补日期
            if (result.action === 'need_deadline') {
              const targetId = result.targetDomain || targetDomain || '';
              setDetailItem(null);
              setPromote({
                item: item,
                targetDomain: targetId,
                // 目标名一起带进弹窗：标题和确认按钮都要写清楚"转去哪儿"
                targetName: domainNameOf(targetId),
                title: result.title || item.title,
                // 名称输入框的初值：用户没填过就给原标题，让他至少有个起点可改
                targetTitle: trimmedTitle || result.title || item.title,
                date: toDay(new Date()),
                error: '',
                busy: false,
              });
              return;
            }
            // 有多个去向又没指定：让用户在弹层里选，别在后端猜
            if (result.action === 'need_target') {
              setDetailItem(null);
              setPromote({
                item: item,
                targetDomain: '',
                targetName: '',
                title: result.title || item.title,
                targetTitle: trimmedTitle || result.title || item.title,
                date: toDay(new Date()),
                error: '',
                busy: false,
              });
              return;
            }
            const targetName = domainNameOf(result.targetDomain || targetDomain);
            showToast((targetName ? fill(t('promote.doneTo'), targetName) : t('action.promote')) + ' ' + (result.id || ''));
            setPromote({ item: null, targetDomain: '', targetName: '', title: '', targetTitle: '', date: '', error: '', busy: false });
            await reload();
          } catch (error) {
            showToast(String((error && error.message) || error));
          }
        },
        [reload, showToast, t, domainNameOf],
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
      /**
       * 客户台账：服务端已按客户聚合好（中标/未中标/在跟/拜访 + 金额合计）。
       * 前端只负责渲染，不再自己算一遍——两处算法一定会漂移。
       */
      const customers = (data && data.customers) || [];

      const all = useMemo(
        function () {
          const items = [];
          domains.forEach(function (d) {
            (d.open || []).forEach(function (item) { items.push(item); });
            (d.recentDone || []).forEach(function (item) { items.push(item); });
            // 经验教训库条目也进总集合，否则"全部记录"里看不到助手域
            (d.archived || []).forEach(function (item) { items.push(item); });
          });
          return items;
        },
        [data],
      );

      /**
       * 「全部记录」页签的计数。
       *
       * 不能用 `scoped.length`——那是**当前已经渲染出来的行数**，
       * 而快照只带回每个域最近 8 条已完成（doneLimit 默认 8）。
       * 于是助手域 11 条已完成只回 8 条、工作/创作也各少几条，
       * 页签显示 16 而实际有 24 条：**计数比真实少，且用户点开看不到差额**。
       *
       * 正确口径是服务端给的 `total`（不随截断变化）。各域 total 之和
       * 本身就是权威数字，前端不该自己再数一遍。
       *
       * 范围判断同样走 lifecycle，不硬编码域 id。
       *
       * ── 范围兜底 ──
       * 待办页不显示经验库按钮，但如果用户原本停在某个 journal 域的范围上
       * 再切回待办页，那个范围在待办页已不可选——继续用它只会得到一片空白，
       * 而按钮栏里没有任何一项是选中态，用户不知道自己在哪。
       * 这里把它回落到「用户记录」。只影响渲染时的有效范围，不改用户的 state：
       * 切回「全部记录」页时原来的选择还在。
       */
      const scopeJournalBlocked = useMemo(
        function () {
          if (tab !== 'pending' || scope === 'user' || scope === 'all') return false;
          const target = domains.find(function (d) { return d.id === scope; });
          return Boolean(target && target.lifecycle === 'journal');
        },
        [domains, scope, tab],
      );
      const effectiveScope = scopeJournalBlocked ? 'user' : scope;

      const scopeDomains = useMemo(
        function () {
          if (effectiveScope === 'all') return domains;
          if (effectiveScope === 'user') return domains.filter(function (d) { return d.lifecycle !== 'journal'; });
          return domains.filter(function (d) { return d.id === effectiveScope; });
        },
        [domains, effectiveScope],
      );

      const totalCount = useMemo(
        function () {
          return scopeDomains.reduce(function (sum, d) { return sum + (d.total ?? 0); }, 0);
        },
        [scopeDomains],
      );

      /** 全部记录页的集合：按有效范围过滤 */
      const scoped = useMemo(function () {
        return all.filter(function (item) { return inScope(item, effectiveScope); });
      }, [all, effectiveScope]);

      /** 待办页的集合：排除经验库（它们不构成待办，在该页永远为空） */
      const pendingScoped = useMemo(function () {
        return all.filter(function (item) { return inPendingScope(item, effectiveScope); });
      }, [all, effectiveScope]);

      const pendingItems = useMemo(function () {
        return pendingScoped.filter(function (item) { return attentionOf(item) !== null; });
      }, [pendingScoped]);

      /**
       * 「待办」页签的计数：只数**有 reason 的**，不数全部未完成。
       * 原来用 `scoped.filter(kind === 'open').length`，把经验库条目
       * 和没有提醒的在办事项都算了进去；而待办页实际只展示有提醒的分组。
       */
      const pendingCount = useMemo(
        function () {
          return pendingScoped.filter(function (item) { return attentionOf(item) !== null; }).length;
        },
        [pendingScoped],
      );

      const openInScope = useMemo(function () {
        return pendingScoped.filter(function (item) { return item.kind === 'open'; }).length;
      }, [pendingScoped]);

      // "待办"页在没有任何到期/停滞/沉睡时，若该范围还有在办记录，
      // 就**直接把这些记录展示出来**（用户要求：有记录就展示记录），
      // 而不是用一句空态把已有内容挡在"全部记录"页签后面。
      const idleOpen = useMemo(function () {
        return pendingScoped
          .filter(function (item) { return item.kind === 'open'; })
          .sort(function (a, b) {
            const da = a.deadline || '9999-12-31';
            const db = b.deadline || '9999-12-31';
            return String(da).localeCompare(String(db));
          });
      }, [pendingScoped]);

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
            /**
             * 今日跟进：销售商机每个工作日都出现在这里。
             * 位置在"值得重新看看"之前——这些是**主动要推进**的，
             * 比"你忘了动它"更该先处理。
             */
            { key: 'followup', label: t('group.followup'), items: by('followup') },
            { key: 'revisit', label: t('group.revisit'), items: by('stale') },
            { key: 'sleep', label: t('group.sleep'), items: by('sleep') },
          ];
        },
        [pendingItems, t],
      );

      /**
       * 「全部记录」页的分组。
       *
       * 与 scopeDomains 同一套口径（都走 lifecycle，不硬编码域 id），
       * 所以直接复用，避免两处判断漂移。
       */
      const allGroups = useMemo(
        function () {
          return scopeDomains
            .map(function (d) {
              return { domain: d, open: d.open || [], done: d.recentDone || [], archived: d.archived || [] };
            })
            .filter(function (g) { return g.open.length || g.done.length || g.archived.length; });
        },
        [scopeDomains],
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

      /**
       * 打开详情时，把**所属域的声明**挂到条目上。
       *
       * 条目本身只有值（status: 中标），不知道"这个域还有哪些值、完成值是哪个、
       * 重开该退回什么"。这些都在域视图里，而详情弹层拿不到 self.snap，
       * 所以在这里一次性拼好再传进去——否则弹层里要再查一遍域表，
       * 每加一个用到域能力的功能就得改一处查找逻辑。
       */
      const onView = useCallback(
        async function (item) {
          const list = (snap.data && snap.data.domains) || [];
          const domain = list.find(function (d) {
            return d.id === item.domain;
          }) || {};
          const withDomain = function (base) {
            return {
              ...base,
              // 域能力随条目一起带上，弹层直接用 item.xxx
              statusValues: domain.statusValues || [],
              statusDefault: domain.statusDefault || '',
              // 第二条轴（项目销售的 awardStatus）：默认值与完成值分开给，
              // "重开"要写回默认值，不能沿用完成值
              doneDefault: domain.doneDefault || '',
              doneValues: domain.doneValues || ['已完成'],
              droppedValues: domain.droppedValues || ['已放弃'],
              promotesTo: domain.promotesTo || [],
            };
          };
          // 先用快照那条把弹层打开（秒开，不闪空白）
          setDetailItem(withDomain(item));
          /**
           * 再向服务端要**全量时间轴**。
           *
           * 快照为了体积每条只带 8 条时间轴，用户在详情页翻自己记过的内容时，
           * 第 9 条以后就看不到了——文件里明明有。这里补一次单条拉取。
           *
           * 失败就不动：弹层继续显示快照那版（有 8 条总比空白强），
           * 不要把已经打开的详情关掉。
           */
          try {
            const data = await request('/entry?id=' + encodeURIComponent(item.id));
            if (data && data.item) setDetailItem(withDomain(data.item));
          } catch {
            /* 保留快照版本即可 */
          }
        },
        [snap],
      );

      /** 详情弹层内联保存：只发改动过的字段，避免覆盖别的属性 */
      const onSaveDetail = useCallback(
        async function (id, patch) {
          const body = { id: id };
          // 逐个白名单透传：面板能改的字段都在这里列一遍。
          // 漏一个的表现是"编辑框能打字、点保存提示已保存、重新打开还是旧值"。
          for (const key of ['next', 'category', 'customer', 'bidNo', 'amount', 'profit']) {
            if (patch[key] !== undefined) body[key] = patch[key];
          }
          await request('/update', jsonBody(body));
          showToast(t('detail.saved'));
          await reload();
          // 刷新后弹层里的对象是旧的，关掉让用户从列表重新点开
          setDetailItem(null);
        },
        [reload, showToast, t],
      );
      const onToggleDone = useCallback(function (item) { toggleDone(item); }, [toggleDone]);
      const onPromote = useCallback(function (item, targetDomain) { doPromote(item, targetDomain); }, [doPromote]);

      const firstUse = all.length === 0;
      // pendingCount / totalCount 已在上面的 useMemo 里按正确口径算好，这里不再重复赋值
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
          h(
            'button',
            {
              className: 'sct-action-btn',
              type: 'button',
              onClick: function () {
                setSettings({
                  open: true,
                  time: (data && data.schedule && data.schedule.reminderAt) || '12:00',
                  busy: false,
                  error: '',
                });
              },
            },
            h(ControlIcon, { name: 'settings' }), t('action.settings'),
          ),
          h('button', { className: 'sct-action-btn', type: 'button', onClick: function () { reload(); setBoardRevision(n => n + 1); } }, h(ControlIcon, { name: 'refresh' }), t('action.refresh')),
          h('div', { className: 'sct-theme-switch', role: 'group', 'aria-label': t('theme.label') },
            ['light', 'dark', 'system'].map((value) => h('button', {
              key: value, type: 'button', 'aria-pressed': appearance.theme === value,
              title: t('theme.' + value), 'aria-label': t('theme.' + value),
              onClick: () => appearance.choose(value),
            }, h(ControlIcon, { name: value }), h('span', null, t('theme.' + value))))),
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
          h('span', { className: 'sct-sync', role: 'status' }, h(ControlIcon, { name: 'clock' }), syncText),
        ),
      );

      const hero = h(
        'section',
        { className: 'sct-hero' },
        h(
          'div',
          null,

          h('h1', null, headline),
          h('p', { className: 'sct-summary' }, summary),
        ),
        h('time', { className: 'sct-hero-date' }, h(ControlIcon, { name: 'calendar' }), longDate(new Date())),
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
          h(ControlIcon, { name: 'add' }),
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
      /**
       * 页签顺序与 id。
       *
       * 这里的顺序就是键盘左右键的移动顺序，必须和渲染顺序一致，
       * 否则用方向键会在"看着相邻"和"实际相邻"之间产生错位。
       * customers 是条件显示的，按"存在时排最后"处理。
       */
      const TAB_IDS = { pending: 'sct-tab-pending', all: 'sct-tab-all', board: 'sct-tab-board', customers: 'sct-tab-customers' };
      const TAB_ORDER = ['pending', 'all', 'board'];
      // 客户台账存在时才进键盘序列
      if (customers.length) TAB_ORDER.push('customers');
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
          // count 为 null 时不显示角标（数据看板不需要计数，它本身就是汇总）
          count === null || count === undefined ? null : h('span', { className: 'sct-count' }, String(count)),
        );
      };

      const tabs = h(
        'div',
        { className: 'sct-tabs', role: 'tablist', 'aria-label': t('tab.list') },
        makeTab('pending', t('tab.pending'), pendingCount),
        makeTab('all', t('tab.all'), totalCount),
        /**
         * 数据看板页签：**始终显示**，和客户台账不同。
         *
         * 看板是"这段时间各项工作怎么样"，即使一条记录都没有，
         * 它也回答了"这段时间我什么都没干"——那是有意义的信息，
         * 不该藏起来让用户以为功能不存在。空态由页面内的空提示承担。
         */
        makeTab('board', t('tab.board'), null),
        /**
         * 客户台账页签：只在**确实有客户数据**时才出现。
         * 一条客户都没有时显示一个空页签，用户会以为功能坏了。
         */
        customers.length ? makeTab('customers', t('tab.customers'), customers.length) : null,
      );

      /**
       * 范围按钮。
       *
       * **随页签变化**：
       *   待办页   → 只有待办型域（task/project/stream），**没有经验库**
       *   全部记录 → 全部域，经验库单独归组（虚线框 + 分隔点）
       *
       * 为什么待办页要整个去掉经验库按钮，而不是留着显示 0 条：
       * 用户要的是"待办里没有助手域"。留一个点进去永远为空的按钮，
       * 等于把"这个范围没有内容"的困惑留给用户。经验库的入口在全部记录页。
       */
      const isJournalDomain = function (d) { return d.lifecycle === 'journal'; };
      const visibleDomains = tab === 'pending'
        ? domains.filter(function (d) { return !isJournalDomain(d); })
        : domains;

      /**
       * 范围筛选栏：**只有域按钮，没有"全部"**。
       *
       * 用户要求删掉那个按钮：它和旁边的域按钮并排，看着像一个域，
       * 实际语义是"排除经验库之后的全部"，容易误读。
       *
       * 但 `'user'` 这个范围值本身**必须保留**：
       *   · 它是初始默认值（useState('user')）——按钮删了，页面默认仍落在它上面
       *   · 经验库范围被挡回时（切到待办页）也回落到它
       * 所以现在它是**隐式默认范围**：没有任何按钮选中，代表"全看，但不含经验库"。
       * 想只看某个域，点对应域按钮即可。
       */
      /**
       * 范围筛选栏：**只有域按钮，没有"全部"**。
       *
       * 用户要求删掉那个按钮：它和旁边的域按钮并排，看着像一个域，
       * 实际语义是"排除经验库之后的全部"，容易误读。
       *
       * 但 `'user'` 这个范围值本身**必须保留**：
       *   · 它是初始默认值（useState('user')）——按钮删了，页面默认仍落在它上面
       *   · 经验库范围被挡回时（切到待办页）也回落到它
       * 所以现在它是**隐式默认范围**：没有任何按钮选中，代表"全看，但不含经验库"。
       * 想只看某个域，点对应域按钮即可。
       *
       * ── 看板页与客户台账页**不显示这排按钮** ──
       * 看板是**全库汇总**：它的"各项工作"区块已经把每个域列成一行了，
       * 上面再挂一排"只看某域"的按钮会让人以为看板可以按域过滤——
       * 而它其实不看 scope。两套筛选同时在屏幕上，是纯粹的误导。
       * 客户台账同理：它按客户聚合，也不是按域筛的。
       *
       * 这是用户直接指出来的：域导航和看板没有关系。
       */
      const showScopeFilter = tab !== 'board' && tab !== 'customers';

      const filter = showScopeFilter
        ? h(
            'div',
            { className: 'sct-filter', role: 'group', 'aria-label': t('filter.label') },
            /**
             * 域按钮分两组渲染：待办型域与经验库。
             * 视觉上分开是因为两者性质不同——左边是"要做什么"，右边是"以前踩过什么"。
             * 用 lifecycle 判断而不是硬编码 id，自定义的 journal 域也自动归组。
             */
            (function () {
              const todoDomains = visibleDomains.filter(function (d) { return !isJournalDomain(d); });
              const journalDomains = visibleDomains.filter(isJournalDomain);
              const makeBtn = function (d) {
                return h(
                  'button',
                  { key: d.id, type: 'button', 'aria-pressed': effectiveScope === d.id ? 'true' : 'false', onClick: function () { setScope(d.id); } },
                  d.name,
                );
              };
              const nodes = [];
              todoDomains.forEach(function (d) { nodes.push(makeBtn(d)); });
              if (journalDomains.length) {
                nodes.push(h('span', { key: 'sep', className: 'sct-filter-sep', 'aria-hidden': 'true' }, '·'));
                journalDomains.forEach(function (d) {
                  nodes.push(
                    h(
                      'button',
                      {
                        key: d.id,
                        type: 'button',
                        className: 'sct-filter-journal',
                        'aria-pressed': effectiveScope === d.id ? 'true' : 'false',
                        title: t('filter.journalHint'),
                        onClick: function () { setScope(d.id); },
                      },
                      d.name,
                    ),
                  );
                });
              }
              return nodes;
            })(),
          )
        : null;

      let listContent;

      /**
       * 客户台账渲染：一张客户一张卡。
       *
       * 刻意**不显示成待办行**：台账不是待办，是回顾用的横向视图。
       * 三个数字分开给（中标/未中标/在跟），因为它们回答不同的问题：
       * 中标看业绩，未中标看投入，在跟看手头还有什么。
       */
      function customerCard(c) {
        const bits = [];
        if (c.wonCount) bits.push(fill(t('cust.won'), c.wonCount));
        if (c.lostCount) bits.push(fill(t('cust.lost'), c.lostCount));
        if (c.runningCount) bits.push(fill(t('cust.running'), c.runningCount));
        if (c.visitCount) bits.push(fill(t('cust.visits'), c.visitCount));

        return h(
          'article',
          { key: c.name, className: 'sct-customer' },
          h(
            'div',
            { className: 'sct-customer-head' },
            h('b', null, c.name),
            c.contact ? h('span', { className: 'sct-customer-contact' }, c.contact) : null,
          ),
          h('div', { className: 'sct-customer-counts' }, bits.length ? bits.join(' · ') : t('cust.none')),
          // 中标金额与利润率只在真的中过标时才显示，避免一排 0
          c.wonCount
            ? h(
                'div',
                { className: 'sct-customer-money' },
                fill(t('cust.amount'), formatMoney(c.wonAmount)),
                c.wonMargin != null ? ' · ' + fill(t('cust.margin'), c.wonMargin) : '',
              )
            : null,
          c.running.length
            ? h(
                'div',
                { className: 'sct-customer-list' },
                h('span', { className: 'sct-customer-label' }, t('cust.runningList')),
                c.running.map(function (r) {
                  return h('span', { key: r.id, className: 'sct-chip' }, r.title);
                }),
              )
            : null,
          c.visits.length
            ? h(
                'div',
                { className: 'sct-customer-list' },
                h('span', { className: 'sct-customer-label' }, t('cust.visitList')),
                c.visits.map(function (v) {
                  return h('span', { key: v.id, className: 'sct-chip', title: v.excerpt || '' }, String(v.at || '').slice(5) + ' ' + v.title);
                }),
              )
            : null,
          c.lastVisitAt ? h('div', { className: 'sct-customer-note' }, fill(t('cust.lastVisit'), String(c.lastVisitAt).slice(0, 10))) : null,
        );
      }

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
      } else if (search.trim() && tab !== 'board' && tab !== 'customers') {
        /**
         * 搜索态：直接展示命中结果，不分页签/分组——找东西时不该被层级打断。
         *
         * 看板与客户台账页**不参与搜索**：这两页的搜索框已经隐藏，
         * 但如果用户在记录页搜过东西再切过来，`search` 状态还留着，
         * 不加这个判断的话看板会被搜索结果顶掉——页面看起来像坏了。
         */
        const hits = searchResult && searchResult.keyword === search.trim() && searchResult.scope === effectiveScope ? searchResult.items : null;
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
      } else if (tab === 'board') {
        listContent = renderBoard();
      /**
       * 数据看板页面。
       *
       * 四个区块，从上到下按"先看结果、再看过程"排：
       *   ① 本期概况：几个关键数字（在办/新增/完成/完成率）
       *   ② 各领域汇总：每行一个域，在办/新增/完成/逾期
       *   ③ 销售链条 + 回款：横向的业务分布与钱
       *   ④ 月度趋势：近 12 个月的新建与完成，窗口内的月份高亮
       *
       * ── 为什么"在办"要标成余额 ──
       * 它是"当前还没收口的条数"，**不受时间窗口影响**；
       * 而"新增""完成"是期内流量。两类数放一起，不标清楚用户会乱比
       * （比如拿"本月新增 3"去和"在办 12"较劲）。所以行内用小字标了"期末"。
       */
      /**
       * 数据看板页面。
       *
       * ── 布局：五个标签 + 五张图，不增不减 ──
       * 用户明确给了规格，就按规格做，不要自己加"在办""风险"这类东西。
       * 多加了东西用户会问"这是什么"，少做了会问"我要的呢"。
       *
       * 标签（横排五个）：
       *   签订合同额 · 签订合同数量 · 销售项目数量 · 客户交流数量 · 商机数量
       *
       * 图表（上排三张按月，下排两张分布）：
       *   销售项目跟踪状态统计 · 合同签订数量统计 · 客户交流数量统计
       *   商机数量统计 · 合同状态分布统计
       *
       * ── 为什么图表分两行 ──
       * 五张图一行放不下（每张至少 200px 才看得清），
       * 两行 3+2 在 1440 宽下刚好，且不用滚动。
       */
      function renderBoard() {
        const retry = () => setBoardRevision(n => n + 1);
        if (boardError) return h('div', { className: 'sct-empty', role: 'alert' },
          h('h2', null, t('board.loadError')), h('p', null, boardError),
          h('button', { type: 'button', className: 'sct-btn', onClick: retry }, '重新加载'));
        if (!boardData) return h('div', { className: 'sct-empty', role: 'status' }, '正在读取看板数据…');
        const board = boardData;
        if (!board.insights?.views?.length) return h('div', { className: 'sct-empty', role: 'status' },
          h('p', null, '统计服务正在更新，请重新加载。'), h('button', { type: 'button', className: 'sct-btn', onClick: retry }, '重新加载'));
        const view = board.insights.views.find(v => v.id === boardView) || board.insights.views[0];
        const selectedChart = view.charts.some(c => c.id === boardChart) ? boardChart : view.charts[0].id;
        const format = (value, unit) => value === null ? '—' : unit === '元' ? compactMoney(value) : Number(value).toLocaleString('zh-CN', { maximumFractionDigits: 1 });
        const exact = (value, unit) => value === null ? '暂无可计算数据' : `${Number(value).toLocaleString('zh-CN', { maximumFractionDigits: 2 })}${unit}`;
        const comparison = m => {
          if (!m.change) return m.note;
          const change = m.change;
          if (m.unit === '%') return `较上期 ${change.delta > 0 ? '+' : ''}${change.delta} 个百分点`;
          if (change.previous === 0) return change.delta === 0 ? '与上期持平' : '上期为 0';
          return change.percent === 0 ? '与上期持平' : `较上期 ${change.percent > 0 ? '+' : ''}${change.percent}%`;
        };
        const tone = (key) => `var(--zw-${['success', 'danger', 'warning', 'muted'].includes(key) ? key : 'accent'})`;
        const windowBar = h(
          'div',
          { className: 'sct-boardbar' },
          h(
            'div',
            { className: 'sct-boardbar-tabs', role: 'group', 'aria-label': t('board.windowLabel') },
            ...[
              ['month', t('board.winMonth')],
              ['quarter', t('board.winQuarter')],
              ['year', t('board.winYear')],
              ['custom', t('board.winCustom')],
            ].map(function (pair) {
              const key = pair[0];
              const label = pair[1];
              const active = boardWindow.kind === key;
              return h(
                'button',
                {
                  key: key,
                  type: 'button',
                  className: active ? 'sct-winbtn is-active' : 'sct-winbtn',
                  'aria-pressed': active ? 'true' : 'false',
                  onClick: function () {
                    setBoardWindow(key === 'custom'
                      ? { kind: key, from: boardWindow.from || board.window.from, to: boardWindow.to || board.window.to }
                      : { kind: key, from: '', to: '' });
                  },
                },
                label,
              );
            }),
          ),
          boardWindow.kind === 'custom'
            ? h(
                'div',
                { className: 'sct-boardbar-dates' },
                h('input', {
                  type: 'date',
                  'aria-label': t('board.from'),
                  value: boardWindow.from || board.window.from,
                  onChange: function (e) {
                    setBoardWindow({ kind: 'custom', from: e.target.value, to: boardWindow.to || board.window.to });
                  },
                }),
                h('span', { className: 'sct-boardbar-sep' }, '~'),
                h('input', {
                  type: 'date',
                  'aria-label': t('board.to'),
                  value: boardWindow.to || board.window.to,
                  onChange: function (e) {
                    setBoardWindow({ kind: 'custom', from: boardWindow.from || board.window.from, to: e.target.value });
                  },
                }),
              )
            : null,
          h('span', { className: 'sct-boardbar-label' }, board.window.label),
        );



        const renderCategoryChart = (chart) => {
          const size = boardSize.width < 700 ? 3 : Math.max(1, chart.rows.length);
          const pages = Math.max(1, Math.ceil(chart.rows.length / size));
          const pageKey = view.id + ':' + chart.id;
          const page = Math.min(boardPages[pageKey] || 0, pages - 1);
          const rows = chart.rows.slice(page * size, (page + 1) * size);
          // One scale for every page; integer axes for counts, readable rounded axes for amounts.
          const max = Math.max(0, ...chart.rows.map(row => row.value));
          const magnitude = Math.pow(10, Math.floor(Math.log10(Math.max(1, max / 4))));
          const step = Math.max(1, Math.ceil(max / 4 / magnitude) * magnitude);
          const ceiling = max ? Math.ceil(max / step) * step : 1;
          const tickCount = Math.max(1, Math.round(ceiling / step));
          return h('div', { className: 'sct-category-chart' },
            h('div', { className: 'sct-category-plot' },
              h('div', { className: 'sct-category-grid', 'aria-hidden': 'true' }, Array.from({ length: tickCount + 1 }, (_, i) =>
                h('div', { key: i, className: 'sct-category-tick', style: { bottom: `${i / tickCount * 100}%` } }, h('span', null, format(ceiling * i / tickCount, chart.unit))))),
              chart.rows.every(row => row.value === 0) ? h('span', { className: 'sct-category-zero' }, '各分类当前均为 0') : chart.rows.every(row => row.value === null) ? h('span', { className: 'sct-category-zero' }, '暂无可计算数据') : null,
              h('div', { className: 'sct-category-columns' }, rows.map(row => {
                const height = Math.max(0, row.value) / ceiling * 100;
                const detail = `${row.label}：${exact(row.value, chart.unit)}${row.detail ? `；${row.detail}` : ''}`;
                return h('div', { key: row.label, className: 'sct-category-column', tabIndex: 0, title: detail, 'aria-label': detail },
                  h('span', { className: 'sct-category-bar', style: { height: `${height}%`, background: tone(row.tone) }, 'aria-hidden': 'true' }),
                  h('strong', { className: 'sct-category-value', style: { bottom: `calc(${height}% + 4px)` } }, format(row.value, chart.unit)));
              }))),
            h('div', { className: 'sct-category-labels', 'aria-hidden': 'true' }, rows.map(row => h('span', { key: row.label }, row.label))),
            pages > 1 ? h('div', { className: 'sct-insight-pager', 'aria-label': `${chart.title}分页` },
              h('span', null, `${page + 1} / ${pages}`),
              h('button', { type: 'button', disabled: page === 0, 'aria-label': `${chart.title}上一组`, onClick: () => setBoardPages(p => ({ ...p, [pageKey]: page - 1 })) }, '上一组'),
              h('button', { type: 'button', disabled: page === pages - 1, 'aria-label': `${chart.title}下一组`, onClick: () => setBoardPages(p => ({ ...p, [pageKey]: page + 1 })) }, '下一组')) : null);
        };
        const renderTrend = (chart) => {
          if (boardSize.width < 700 && chart.buckets.length > 6) {
            const step = Math.ceil(chart.buckets.length / 6);
            const grouped = [];
            for (let i = 0; i < chart.buckets.length; i += step) {
              grouped.push({ ...chart.buckets[i], to: chart.buckets[Math.min(i + step - 1, chart.buckets.length - 1)].to });
            }
            chart = { ...chart, buckets: grouped, series: chart.series.map(s => ({ ...s, values: grouped.map((_, i) => s.values.slice(i * step, (i + 1) * step).reduce((a, b) => a + b, 0)) })) };
          }
          const max = Math.max(1, ...chart.series.flatMap(s => s.values));
          const hasData = chart.series.some(s => s.values.some(v => v !== 0));
          return h('div', { className: 'sct-insight-trend' },
            h('div', { className: 'sct-insight-series' }, chart.series.map(s => h('span', { key: s.label },
              h('i', { style: { background: tone(s.tone) } }), s.label,
              h('strong', { title: exact(s.values.reduce((a, b) => a + b, 0), chart.unit) }, format(s.values.reduce((a, b) => a + b, 0), chart.unit), chart.unit === '元' ? '元' : chart.unit)))),
            h('div', { className: 'sct-insight-plot' },
              !hasData ? h('span', { className: 'sct-insight-zero' }, '所选周期暂无记录') : null,
              chart.buckets.map((bucket, i) => {
                const detail = `${bucket.from} 至 ${bucket.to}：${chart.series.map(s => `${s.label} ${exact(s.values[i], chart.unit)}`).join('；')}`;
                return h('div', { key: bucket.key, className: 'sct-insight-bucket', tabIndex: 0, 'aria-label': detail },
                  h('div', { className: 'sct-insight-columns', 'aria-hidden': 'true' }, chart.series.map(s =>
                    h('div', { key: s.label, className: 'sct-insight-column' },
                      chart.series.length === 1 ? h('span', { className: 'sct-insight-point-value' }, s.values[i] ? format(s.values[i], chart.unit) : '') : null,
                      h('div', { className: 'sct-insight-column-track' }, h('span', { style: { height: `${Math.max(0, s.values[i]) / max * 100}%`, background: tone(s.tone) } }))))),
                  h('span', { className: 'sct-insight-bucket-label' }, bucket.label),
                  h('span', { className: 'sct-insight-point-detail', 'aria-hidden': 'true' }, detail));
              })));
        };
        const renderDistribution = (chart) => {
          const total = chart.rows.reduce((n, r) => n + r.value, 0);
          const colors = ['var(--zw-muted)', 'var(--zw-accent)', 'var(--zw-success)', 'var(--zw-warning)', 'var(--zw-danger)'];
          let offset = 0;
          return h('div', { className: 'sct-insight-distribution', 'data-dense': chart.rows.length > 5 },
            h('div', { className: 'sct-insight-ring' },
              h('svg', { viewBox: '0 0 100 100', 'aria-hidden': 'true' },
                h('circle', { cx: 50, cy: 50, r: 40, fill: 'none', stroke: 'var(--zw-line)', strokeWidth: 12 }),
                chart.rows.map((row, i) => {
                  const length = total ? row.value / total * 251.327 : 0;
                  const circle = h('circle', { key: row.label, cx: 50, cy: 50, r: 40, fill: 'none', stroke: colors[i % colors.length], strokeWidth: 12, strokeDasharray: `${length} ${251.327 - length}`, strokeDashoffset: -offset, transform: 'rotate(-90 50 50)' });
                  offset += length;
                  return circle;
                })),
              h('div', null, h('strong', null, total), h('span', null, '合同总数'))),
            h('div', { className: 'sct-insight-legend' }, chart.rows.map((row, i) => h('div', { key: row.label },
              h('i', { style: { background: colors[i % colors.length] } }), h('span', null, row.label), h('strong', null, row.value), h('small', null, total ? `${Math.round(row.value / total * 100)}%` : '—')))));
        };
        const renderOutcomes = (chart) => renderCategoryChart({
          ...chart, unit: boardOutcomeMetric === 'amount' ? '元' : '个',
          rows: chart.rows.map((row, i) => ({
            label: row.label, value: boardOutcomeMetric === 'amount' ? row.amount : row.count,
            tone: ['success', 'danger', 'accent'][i],
            detail: `${row.count} 个；成交金额 ${exact(row.amount, '元')}${row.missing ? `；${row.missing} 项金额待补` : ''}`,
          })),
        });
        const panel = chart => {
          const missing = chart.kind === 'outcomes' ? chart.rows.reduce((n, row) => n + row.missing, 0) : 0;
          const note = chart.kind === 'outcomes' && boardOutcomeMetric === 'amount'
            ? `按成交日 · ${missing ? `${missing} 项金额待补，仅汇总已知金额；` : ''}— 为不适用或尚未录入`
            : chart.note;
          return h('section', { key: chart.id, className: 'sct-panel sct-insight-panel', hidden: !boardOverview && chart.id !== selectedChart, 'aria-label': chart.title },
            h('header', { className: 'sct-panel-head' }, h('h3', null, chart.title),
              chart.kind === 'outcomes' ? h('div', { className: 'sct-outcome-switch', role: 'group', 'aria-label': '成交结果统计指标' },
                [['count', '数量 / 个', '按数量展示成交结果'], ['amount', '金额 / 元', '按金额展示成交结果']].map(([key, label, name]) => h('button', { key, type: 'button', 'aria-label': name, 'aria-pressed': boardOutcomeMetric === key, onClick: () => setBoardOutcomeMetric(key) }, label)))
                : chart.unit ? h('span', { className: 'sct-panel-extra' }, chart.unit === '元' ? '金额 / 元' : `单位 / ${chart.unit}`) : null),
            h('div', { className: 'sct-panel-body' }, chart.kind === 'trend' ? renderTrend(chart) : chart.kind === 'distribution' ? renderDistribution(chart) : chart.kind === 'outcomes' ? renderOutcomes(chart) : renderCategoryChart(chart)),
            h('p', { className: 'sct-insight-note', title: note }, note));
        };

        return h('div', { className: 'sct-board-page sct-insights', 'data-overview': boardOverview, 'aria-busy': boardLoading },
          h('div', { className: 'sct-insight-toolbar' },
            h('div', { className: 'sct-insight-views', role: 'group', 'aria-label': '看板视图' }, board.insights.views.map(v =>
              h('button', { key: v.id, type: 'button', 'aria-pressed': view.id === v.id, onClick: () => { setBoardView(v.id); setBoardChart(''); } }, v.title))),
            windowBar),
          h('div', { className: 'sct-stats' }, view.metrics.map((m, i) => h('div', { key: m.label, className: i === 0 ? 'sct-stat is-accent' : 'sct-stat', tabIndex: 0, title: `${m.label}：${exact(m.value, m.unit)}。${m.note}${m.change ? `。对比 ${board.insights.comparison.from} 至 ${board.insights.comparison.to}：${exact(m.change.previous, m.unit)}` : ''}`, 'aria-label': `${m.label} ${exact(m.value, m.unit)}，${m.note}，${comparison(m)}` },
            h('span', { className: 'sct-stat-key' }, m.label),
            h('strong', { className: 'sct-stat-val', style: m.tone ? { color: tone(m.tone) } : undefined }, format(m.value, m.unit), m.value !== null ? h('small', null, m.unit === '%' ? '%' : m.unit === '元' ? '元' : m.unit) : null),
            h('span', { className: 'sct-stat-note' }, comparison(m))))),
          h('div', { className: 'sct-board-navigation' },
            h('span', { className: 'muted small', role: 'status' }, boardLoading ? '正在更新统计…' : `${board.window.label} · ${board.insights.qualityCount ? `${board.insights.qualityCount} 项数据待补充` : '数据已更新'}`),
            !boardOverview ? h('select', { 'aria-label': '选择统计图', value: selectedChart, onChange: e => setBoardChart(e.target.value) }, view.charts.map(c => h('option', { key: c.id, value: c.id }, c.title))) : null),
          h('div', { className: 'sct-board-grid' }, view.charts.map(panel)));
      }


      } else if (tab === 'customers') {
        listContent = customers.length
          ? h(
              'div',
              null,
              h(
                'div',
                { className: 'sct-section-label' },
                h('span', null, t('cust.title')),
                h('span', null, fill(t('group.count'), customers.length)),
              ),
              h('div', { className: 'sct-customers' }, customers.map(customerCard)),
            )
          : h(
              'div',
              { className: 'sct-empty' },
              h('h2', null, t('cust.emptyTitle')),
              h('p', null, t('cust.emptyBody')),
            );
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
              const archivedHidden = Math.max(
                0,
                (group.domain.archivedCount ?? 0) - (group.archived ?? []).length,
              );
              /**
               * 经验教训库的域：标题行不能写"N 进行中 · 共 M"。
               * 它没有"进行中"可言，讲条数与最近记录时间才是有用的信息。
               */
              const isJournal = group.domain.lifecycle === 'journal';
              const head = h(
                'div',
                { className: 'sct-section-label' },
                h('span', null, (group.domain.icon || '') + ' ' + group.domain.name),
                h(
                  'span',
                  null,
                  isJournal
                    ? fill(t('group.journalCount'), group.domain.total)
                    : group.open.length + ' ' + t('group.open') + ' · ' + t('misc.total') + ' ' + group.domain.total,
                ),
              );
              /**
               * 经验库按时间倒序（最近踩的坑在最上面），其余按用户选的排序。
               *
               * 经验库不能只渲染 `archived`：万一某条 journal 条目的 kind 是
               * `open`（历史上按 task 形态建的、或将来 shape 变化），
               * 只取 archived 会把它**静静丢掉**——用户在全部记录里也找不到。
               * 所以 open + archived 合并渲染，archived 排在前面。
               */
              const journalRows = group.open.concat(group.archived);
              const rows = isJournal
                ? journalRows.map(function (item) {
                    return h(TaskRow, {
                      key: item.id, item: item, t: t,
                      onView: onView, onReschedule: onReschedule, onToggleDone: onToggleDone,
                    });
                  })
                : sortItems(group.open).concat(sortItems(group.done)).map(function (item) {
                    return h(TaskRow, {
                      key: item.id, item: item, t: t,
                      onView: onView, onReschedule: onReschedule, onToggleDone: onToggleDone,
                    });
                  });
              const more =
                hidden > 0 || archivedHidden > 0
                  ? h(
                      'button',
                      { className: 'sct-load-more', type: 'button', onClick: function () { setDoneLimit('all'); } },
                      fill(t('group.loadMore'), hidden + archivedHidden),
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
        /**
         * 顶栏：页签 + 控制区。
         *
         * 控制区（域筛选 + 搜索 + 排序）**只对记录列表页有意义**。
         * 看板是汇总视图，不按域筛、不搜记录；客户台账按客户聚合，也不按域筛。
         * 在这两页上摆一排"只看某域"的按钮，会让人以为看板可以按域过滤——
         * 而它其实不看 scope。两套筛选同时在屏幕上就是误导。
         */
        h(
          'div',
          { className: 'sct-main-head' },
          recordView ? h('div', { className: 'sct-workspace-nav' }, tabs,
            h('div', { className: 'sct-workspace-actions' },
              h('button', { ref: captureToggleRef, type: 'button', 'aria-expanded': captureOpen, 'aria-controls': 'sct-record-capture', onClick: () => setCaptureOpen(open => !open) }, t('workspace.quick')),
              h('button', { ref: agendaToggleRef, type: 'button', 'aria-expanded': agendaOpen, 'aria-controls': 'sct-agenda-panel', onClick: () => setAgendaOpen(open => !open) }, h(ControlIcon, { name: 'calendar' }), t('workspace.agenda')))) : tabs,
          recordView ? h('div', { id: 'sct-record-capture', className: 'sct-record-capture', ref: captureRegionRef, hidden: !captureOpen,
            onKeyDown: e => { if (e.key === 'Escape') { setCaptureOpen(false); captureToggleRef.current?.focus(); } } }, capture) : null,
          showScopeFilter ? h('div', { className: 'sct-list-controls' }, filter, toolbar) : null,
        ),
        h(
          'div',
          {
            className: tab === 'board' ? 'sct-list-scroll sct-board-host' : 'sct-list-scroll',
            // tabpanel：与活动页签通过 aria-labelledby 关联（U05）
            id: 'sct-tabpanel',
            role: 'tabpanel',
            tabIndex: -1,
            'aria-labelledby': TAB_IDS[tab],
          },
          listContent,
          tab === 'board' ? null : h(
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
          { className: 'sct-side-block sct-reminder-card' },
          h('div', { className: 'sct-side-title' }, h('h2', null, t('aside.reminders'))),
          h(
            'div',
            { className: 'sct-reminder-time' },
            h('span', { className: 'sct-reminder-time-label' }, h(ControlIcon, { name: 'clock' }), t('aside.remindTime')),
            h('time', null, (data && data.schedule && data.schedule.reminderAt) || '12:00'),
          ),
          // 两个投递目标分别展示：提醒与报告可以各自绑在不同会话
          h('div', { className: 'sct-delivery' },
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
          ),
          /**
           * B06：这里原来显示"报告处理窗口 22:00—06:00"，与真实调度不符——
           * 四类报告都在各自周期最后一天的设定时刻直接投递，**不受**夜间窗口推迟。
           * 现在改为逐条列出真实生成时间，与 系统/调度.json 完全一致。
           */
          h('h3', { className: 'sct-report-heading' }, t('aside.reportSchedule')),
          h(
            'ul',
            { className: 'sct-report-list' },
            [['reportMonthly', 'monthlyAt'], ['reportQuarterly', 'quarterlyAt'], ['reportHalf', 'halfAt'], ['reportYearly', 'yearlyAt']].map(function ([label, field]) {
              return h('li', { key: field },
                h('span', null, t('aside.' + label).replace('{t}', '')),
                h('time', null, (data && data.schedule && data.schedule[field]) || '20:00'));
            }),
          ),
          /* 错过的周期必须说出来：不自动补执行是规则，但"错过"不能悄悄消失。
             B06 同时要求"任务已提交"不能显示成"报告已生成"，这里只报事实。 */
          data && data.state && data.state.missedReports
            ? h('p', { className: 'sct-conn-warn' }, fill(t('aside.reportMissed'), data.state.missedReports, (data.state.missedKeys || []).join('、')))
            : null,
          h('details', { className: 'sct-report-help' },
            h('summary', null, t('aside.reportHelp')),
            h('p', { className: 'sct-side-note' }, t('aside.reportNote'))),
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
          // 域能力已经在 onView 里挂到 item 上了（statusValues/doneValues/promotesTo），
          // 这里只传交互用的状态与回调
          stagePick: stagePick,
          stageBusy: stageBusy,
          onStagePick: setStagePick,
          onStageCommit: doStageCommit,
          trackText: trackText,
          trackBusy: trackBusy,
          onTrackText: setTrackText,
          onTrackCommit: doTrackCommit,
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
          onCancel: function () {
            setPromote({ item: null, targetDomain: '', targetName: '', title: '', targetTitle: '', date: '', error: '', busy: false });
          },
          onConfirm: doPromote,
          // 改日期/改名称都用整份展开再覆盖那一项。
          // 早先是手写全部字段，漏一个（targetName、targetTitle）就会在交互中途被清空，
          // 而且是静默的——用户只看到标题里的目标名突然没了。
          onDate: function (value) {
            setPromote(function (prev) {
              return { ...prev, date: value, error: '', busy: false };
            });
          },
          onTitle: function (value) {
            setPromote(function (prev) {
              return { ...prev, targetTitle: value, error: '', busy: false };
            });
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
        // 「完成并记录」小框：item 非空才渲染
        h(DoneDrawer, {
          key: 'done',
          state: donePrompt,
          t: t,
          onCancel: function () {
            setDonePrompt({ item: null, text: '', error: '', busy: false });
          },
          onConfirm: confirmDone,
          onSilent: confirmDoneSilent,
          onText: function (value) {
            setDonePrompt(function (prev) { return { ...prev, text: value, error: '' }; });
          },
        }),
      ];

      const toastNode = toast
        ? h('div', { className: 'sct-toast', role: 'status', 'aria-live': 'polite' }, h('span', null, toast))
        : null;

      return h(
        'div',
        { className: 'sct-root', ref: boardFrame, 'data-view': tab, 'data-workspace': recordView || tab === 'board', 'data-records': recordView, 'data-board-short': boardSize.height < 700, 'data-theme': appearance.resolved, 'data-theme-mode': appearance.theme },
        topbar,
        /**
         * 顺序必须是 **main 在前、aside 在后**。
         *
         * CSS 里 `grid-template-columns: minmax(0,1fr) var(--zw-aside-w)`
         * 把第一列给主区、第二列给辅助区；DOM 顺序若反过来，
         * 辅助区会占据主列（实测表现为：左边一大块空白 + 内容挤到右侧一窄条），
         * 而且窄屏单栏时辅助区会跑到主区**上面**。
         */
        h('div', { className: 'sct-scroll' },
          h('div', { className: 'sct-shell' }, tab === 'board' || recordView ? null : hero, tab === 'board' || recordView ? null : capture,
            h('div', { className: 'sct-layout' }, main, tab === 'board' || recordView ? null : aside)),
          recordView && agendaOpen ? h('section', { id: 'sct-agenda-panel', className: 'sct-agenda-panel', ref: agendaPanelRef, 'aria-label': t('workspace.agenda') },
            h('header', { className: 'sct-agenda-panel-head' }, h('h2', null, t('workspace.agenda')), h('button', { type: 'button', onClick: closeAgenda }, t('action.close'))), aside) : null),
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

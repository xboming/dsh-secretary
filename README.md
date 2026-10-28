# 知微观澜（dsh-secretary）

记录 → 分析 → 提醒，四个域共用一套引擎：

| 域 | 形态 | 存储 | 提醒 |
|---|---|---|---|
| 工作 `work` | 事项 | `工作/YYYY/MM/W-YYYY-NNN-标题.md` | 到期 / 停滞 |
| 创作 `creation` | 项目 + 里程碑 | `创作/C-YYYY-NNN-名称/项目.md` | 到期 / 停滞 |
| 灵感 `idea` | 月度流水 | `灵感/YYYY/YYYY-MM.md` | 沉睡 |
| 助手 `assistant` | 事项（助手专用） | `助手/YYYY/MM/A-YYYY-NNN-标题.md` | 停滞（14 天） |

名字取"见微知著、观水之澜"：知微是记录与提醒（盯着停滞、沉睡这些细微处），观澜是分析报告（看三域的周期波澜）。

## 它做什么

- **记录**：一句话落成一条记录，原话一字不改留痕；工作/创作自动判重，灵感只累加不合并。
- **分析**：代码算事实（新增/完成/逾期/停滞/分布/同期对比/趋势/重点回顾），模型写解读。
- **提醒**：每天 12:00 一条，说"接下来该收哪件"，不做回顾。

## 报告

四类周期，**没有周报**：

| 周期 | type | key | 自动生成时刻 |
|---|---|---|---|
| 月度报告 | `month` | `2026-10` | 每月最后一天 20:00，统计当月 |
| 季度报告 | `quarter` | `2026-Q4` | 季末最后一天（3/6/9/12 月）20:00 |
| 半年度报告 | `half` | `2026-H2` | 6 月末 / 12 月末 20:00 |
| 年度报告 | `year` | `2026` | 12 月末 20:00 |

规则：

- 月末按**实际日历**判断，大小月、平年二月、闰年二月都正确（2027-02-28、2028-02-29 都是月末）。
- 到点就投递，**不受"夜间窗口"推迟**。`reportWindow` 只描述后台空闲时段，不参与报告投递门禁。
- **错过不补**：计划时刻 DSH 没开着，之后启动**不会**自动补执行，只记一条 `missedReports` 并显示在面板上；要补就在对话里说「补一份 2026-09 月报」，手动生成。
- 各域报告**分别存放**，不混域、不共用正文：`报告/<域名>/<月报|季报|半年报|年报>/<id>-<key>-<域名><类型>.md`。
- 助手域默认不参与汇总。
- 报告分两个口径，不混用：
  - **本期历史回顾**：只统计报告期内**已存在**的事项。9 月报告不会引用 10 月才创建的事项。
  - **当前风险附录**：生成时刻仍逾期/停滞的事项，独立命名并标注快照时间，不计入本期统计。

## 数据在哪

默认 `%USERPROFILE%\.dsh\plugin-data\dsh-secretary`（设了 `DSH_HOME` 则用它）。
在插件行 `config.dataDir` 指定绝对路径可换到 Obsidian 库：

```yaml
- insert:
    - id: secretary
      name: dsh-secretary
      config:
        dataDir: 'E:\笔记\秘书'
```

## 作息

`系统/调度.json`，或让助手改（`secretary_schedule`）：

```json
{
  "timeZone": "Asia/Shanghai",
  "reminderAt": "12:00",
  "reportWindow": { "start": "20:00", "end": "06:00" },
  "monthlyAt": "20:00",
  "quarterlyAt": "20:00",
  "halfAt": "20:00",
  "yearlyAt": "20:00"
}
```

`reportWindow` 只是"后台空闲窗口"的描述，**不会**推迟报告生成；四类报告到达各自
`*At` 时刻就投递（见上文"报告"）。

改完立即重排，不用重启。

## 会话绑定

每日提醒和报告**可以绑到不同会话**——报告是"要坐下来写一篇"的重活，很适合单独放一个会话。

| 你说 | 效果 |
|---|---|
| 「把报告绑到这里」 | 只改报告会话 |
| 「把提醒绑到这里」 | 只改提醒会话 |
| 「提醒和报告都绑到这里」 | 两者都改（默认） |

写操作（记一条、改一条、改作息）会自动把**两个**目标都绑到当前会话；只读操作
（查询、提醒、报告）不会改绑，但检测到你在别的会话时会附一句提示。也可直接调
`secretary_bind`，`target` 取 `both` / `reminder` / `report`。

## 加一个域

编辑 `系统/域.json`（与内置合并，同 id 覆盖）：

```json
{
  "domains": [
    {
      "id": "health",
      "name": "健康",
      "shape": "task",
      "dir": "健康",
      "fields": { "deadline": { "type": "date" } }
    }
  ]
}
```

`shape` 只能是 `task` / `project` / `stream`。加域不改代码、不改工具、不改面板。

## 接口

- `GET /dsh-secretary/api/snapshot?doneLimit=8|all` — 面板快照
- `GET /dsh-secretary/api/search?q=&domain=&limit=` — 面板搜索
- `POST /dsh-secretary/api/add` — 面板"快速记一笔"（`createSeparate: true` = 用户已确认独立新建，只跳过去重，不改任何字段）
- `POST /dsh-secretary/api/update` — 面板上的完成/改期/内联编辑
- `POST /dsh-secretary/api/link` — 灵感转创作 / 记录互相关联
- `POST /dsh-secretary/api/schedule` — 改作息
- 只接受本机回环地址，`cache-control: no-store`；写操作必须 `application/json` 且同源

## 界面

- **自适应**：断点用容器查询（`@container`）按**插件容器真实宽度**判定，不看浏览器窗口。宿主侧栏展开、面板拖动缩放、右侧栏打开都会正确重排。
  - ≥860px：弹性主列 + 辅助列
  - <860px：单栏，整页一个滚动面，主列表不再被挤压
  - <560px：全部单栏，录入/搜索/筛选自然换行
- **主题**：默认跟随 DSH，颜色全部走 `--zw-*` → `--dsw-alias-*` 语义令牌；深浅两套均按 WCAG 校准（正文 ≥4.5:1、控件边界 ≥3:1）。
- **键盘**：页签 `←/→/Home/End` 切换并移动焦点，`aria-selected` / `aria-controls` / tabpanel 关联完整；完成控件视觉 24px、命中区 44px。

## 社区入口

顶栏会显示一个社区链接，地址来自 `系统/社区.json`（改完下次快照即生效，不用重启）：

```json
{
  "label": "GitHub 社区",
  "url": "https://github.com/你的用户名/仓库/discussions"
}
```

没这个文件、或 `url` 不是 http(s)，入口就不显示。带账号密码的 URL 也会被拒。

## 改了代码怎么生效（重要）

DSH 宿主对插件 JS 有**进程级 require 缓存**。本插件自己绕开了它，所以只有入口需要重启：

| 改了什么 | 怎么生效 |
|---|---|
| `lib/*.js`（宿主逻辑、工具、路由、调度） | **`dev-reload.cmd hot`**，不用重启 |
| `client.js`（面板 UI） | **按 Ctrl+R 刷新页面**（浏览器端模块，宿主从不 import 它） |
| `index.js`（插件入口） | **重启宿主**（由宿主 import，改不了） |
| `系统/*.json`（域/调度/节假日/社区） | **立即生效**，什么都不用做 |

### 热重载怎么做到的

Node 的 ESM 缓存以**模块 URL** 为键。给 URL 加 `?v=<版本>` 就是另一个模块，会重新求值。

坑在于**子模块不会自动继承**：父模块带 `?v=2` 时，它的 `import './x.js'` 仍解析成不带
query 的 URL，于是子模块永远命中旧缓存（实测确认，别指望"改父就够"）。

所以 `lib/*.js` 的内部相对导入全部改成动态形式，并用 `rel()` 把当前模块的版本号往下传：

```js
// lib/secretary.js
const { rel } = await import(new URL('./reloadable.js', import.meta.url).href);
const { splitDocument } = await import(rel('./frontmatter.js', import.meta.url));
```

`POST /dsh-secretary/api/reload` 会用新版本号重新 import 整棵 lib 树，
再整套重建工具、路由、定时器、提示词。

**顺序是先拆旧的、再建新的**。反直觉，但有原因：工具用固定名字注册
（`secretary_add` 等），旧代还挂着时注册同名工具会直接抛
`tool "secretary_add" is already registered`，整个重载就失败了。
代价是拆与建之间有几毫秒没有工具和路由，比彻底失败划算。
新代建失败时会自动回滚重建旧版本，不会把插件留在没有工具的状态。

`set_bundle` 关-开、`remove_bundle` + `install_bundle` **都不会**让宿主重新 import 插件 JS——
这些操作只改链接与 patch，模块注册表里的旧实例继续服务（实测确认，勿再绕路）。

### 关于宿主自带的 HMR

profile 的 `cordis.patch.yml` 里给 `hmr` 条目配了 `root` 指向本插件源码目录，
**实测未触发模块替换**（5 次实验：改 lib、改 index、touch patch、改 hmr 段、写探针文件，
`loadedAt` 均未变化）。原因未查明，可能与 `link:` 包的 realpath 匹配或 Windows 路径有关。
插件自己的 reload 接口不依赖它。

开发脚本在工作区根目录：

```
dev-reload.cmd           查看宿主状态与 GUI 地址
dev-reload.cmd hot       热重载 lib/*.js
dev-reload.cmd browser   只开页面（改 client.js 用）
dev-reload.cmd restart   重启宿主（改 index.js 用）
```

## 当前版本的范围

v0.14.0：记录 + 查询 + 提醒 + 面板 + 调度 + 四类报告（含趋势与重点回顾）+ 提醒/报告分会话绑定。

## 回归测试

全部使用临时目录与模拟宿主，不碰真实记录：

```
node smoke.mjs                  # 工具 schema / 核心契约（28）
node smoke-client.mjs           # 客户端加载与主题令牌契约
node review-regression.mjs      # 13
node review-http.mjs            # 8
node review-ui-api.mjs          # 8
node review-v090.mjs            # 月末 20:00 / 错过不补 / 幂等（12）
node review-periods.mjs         # 9
node review-period-schedule.mjs # 10
node review-trend.mjs           # 6
node review-binding.mjs         # 6
node review-bind-split.mjs      # 13
node review-report-domain.mjs   # 6
node review-scheduler.mjs       # 2
node review-v013.mjs            # B01–B07 / U03 / T13（19）
node review-ui-behavior.mjs     # T01 / T08 / T09 / T10 / T11（12）
node design-check.cjs           # 静态设计检查（13）
node check-wiring.cjs           # 静态接线（12）
node check-package.cjs          # 发布清单
```

渲染与主题验收（需要本机 Chrome 或 Edge）：

```
node render-harness.mjs   # 生成验收页面
node shots.mjs            # 无头 Chrome 截图并量测几何
node review-render.mjs    # 断言无裁切/无横向溢出/控件尺寸/页签选中态
node contrast-check.mjs   # WCAG 对比度核验（深浅各 12 项）
```

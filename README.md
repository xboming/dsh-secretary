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
- **分析**：代码算事实（新增/完成/逾期/停滞/分布/同期对比），模型写解读，周报/月报分开。
- **提醒**：每天 12:00 一条，说"接下来该收哪件"，不做回顾。

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
  "reportWindow": { "start": "22:00", "end": "06:00" },
  "weekly": { "weekday": 1 },
  "monthly": { "day": 1 }
}
```

改完立即重排，不用重启。

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

- `GET /dsh-secretary/api/snapshot` — 面板快照
- `POST /dsh-secretary/api/add` — 面板"快速记一笔"
- `POST /dsh-secretary/api/update` — 面板上的完成/推后
- 只接受本机回环地址，`cache-control: no-store`

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

v0.1.0 先做：记录 + 查询 + 提醒 + 面板 + 调度配置。
报告的事实层已就绪（`secretary_report` 返回事实并落 `facts.json`），模型写解读的流程在下一个里程碑接上。

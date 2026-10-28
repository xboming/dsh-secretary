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

DSH 宿主对插件 JS 有**进程级 require 缓存**：

| 改了什么 | 怎么生效 |
|---|---|
| `client.js`（面板 UI） | **完全退出桌面端再打开** |
| `lib/*.js`、`index.js`（宿主逻辑、工具） | **重启宿主**（退出重开；会话可从列表接续） |
| `系统/域.json`、`系统/调度.json`、`系统/节假日.json` | **立即生效**，什么都不用做 |

`set_bundle` 关-开、`remove_bundle` + `install_bundle` **都不会**让宿主重新 import 插件 JS——
这些操作只改链接与 patch，模块注册表里的旧实例继续服务（实测确认，勿再绕路）。

面板的 `uiVersion` 自动刷新只在**宿主重启后**触发一次：新模块带来新版本号，已打开的面板自动重载成新 UI，不用手动找刷新。

## 当前版本的范围

v0.1.0 先做：记录 + 查询 + 提醒 + 面板 + 调度配置。
报告的事实层已就绪（`secretary_report` 返回事实并落 `facts.json`），模型写解读的流程在下一个里程碑接上。

# dsh-fish-monitor

给 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 用的一个监控插件：在左侧栏实时看「大肥鱼」（[dsh-aurabot-qq](https://github.com/accomplish07zrh-eng/dsh-aurabot-qq)）的 token 消耗和当前心情。

> 这是一个个人向插件，为「让 AI 住进 QQ」的玩法配的仪表盘。

## 功能

- **实时 token 监控**：今日输入/输出 tokens、估算花费、每分钟速率、最高上下文占用
- **按会话明细**：每个 QQ 会话（私聊/群聊/系统任务）分别用了多少
- **心理状况**：当前心情值、标签、彩色进度条，以及最近 6 次情绪变化的起因
- **每 5 秒自动刷新**，数据只读，不写任何会话内容

## 数据来源

| 数据 | 来源 |
|---|---|
| token 用量 / 上下文占用 | DSH 的 `storages/session_projcache/sessions/*.json`（只读） |
| 心情 | Aurabot 的 `/aurabot/api/state` |

插件只统计属于 QQ 工作区（`qq-chats`）或标题以 `QQ ·` 开头的会话，不会把普通编码会话算进去。

## 安装

```bash
# 桌面应用（Electron）
"<DSH 安装目录>\resources\runtime\cli\bin\dsh.cmd" plugin --profile desktop add <本仓库>
```

或者用官方 CLI：

```bash
dsh plugin --profile desktop add github:<你的用户名>/dsh-fish-monitor
```

装完**完全重启 DSH**（托盘退出再开），左侧栏会出现「肥鱼监控」。

## 前置条件

- DSH 0.2.x（在 0.2.1-rc.3 上开发）
- 已安装 [dsh-aurabot-qq](https://github.com/accomplish07zrh-eng/dsh-aurabot-qq)，否则心情面板会显示「读不到心情」

## 费用估算

默认按 DeepSeek flash 的量级估算，**仅供参考**：

| 项目 | 空闲时段 | 高峰时段 |
|---|---|---|
| 输入（缓存命中） | 0.02 | 0.04 |
| 输入（缓存未命中） | 1 | 2 |
| 输出 | 4 | 8 |

**高峰时段**：北京时间，周一至周五（不含法定节假日）9:00–12:00、14:00–18:00。
其余时段——夜间、周末、法定节假日——都是空闲时段，价格减半。

**计费方式**：每 30 秒采样一次各会话的累计用量，把增量按采样时刻所属时段的价格计入，累计值持久化在
`$DSH_HOME/fish-monitor/cost.json`，重启 DSH 不清零。

节假日列表可用 `$DSH_HOME/fish-monitor/holidays.json` 覆盖：

```json
{ "days": ["2026-01-01", "2026-02-17"] }
```

局限：采样间隔内的用量按采样时刻计价，正好跨过 12:00 / 18:00 边界的那一分钟可能有个别 token 计到相邻档位。

## 已知限制

- 只能看到**插件安装之后**的会话数据（之前的会话不在投影缓存里）
- 心情变化记录来自 Aurabot，最多保留它自己配置的条数
- 没有鉴权，只在本机 `127.0.0.1` 上使用

## License

MIT

---

## English

A small DSH plugin: a sidebar dashboard for the token usage and mood of an
Aurabot (`dsh-aurabot-qq`) QQ persona. It reads DSH session projection files
(read-only) plus Aurabot's local API, refreshes every 5 seconds, and shows
today's tokens, estimated cost, live rate, per-chat breakdown and her current
mood with its recent triggers.

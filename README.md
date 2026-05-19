<div align="center">

# x-spam-sentinel 🛡️

**AI 驱动的公益、半公开、开源 X(Twitter) 反垃圾/色情机器人系统**

Browse X normally — get passively warned about spam & porn-ad bots,
with one-click block and one-click report. Community-curated, transparent,
forkable blocklist.

[![License: AGPL-3.0](https://img.shields.io/badge/License-AGPL--3.0-blue.svg)](./LICENSE)
[![Status: alpha](https://img.shields.io/badge/status-alpha-orange.svg)](#项目状态)
[![PRs welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](./CONTRIBUTING.md)

[什么是这个](#是什么) · [怎么工作](#怎么工作) · [快速开始](#快速开始) · [架构](./docs/ARCHITECTURE.md) · [治理](./GOVERNANCE.md) · [贡献](./CONTRIBUTING.md)

</div>

---

## 是什么

X 上大量新注册的垃圾广告 / 色情广告机器人刷评论和留言，严重影响正常交流。
官方 API 太贵。本项目用 **浏览器扩展 + 本地/服务端 AI 分析 + 社区共享黑名单**
提供一个不依赖官方 API 的解法：

- 🧩 **浏览器扩展**：被动检测你正在浏览页面上的可疑账号，弹窗提醒"本页发现 N 个 spam"
- 🛑 **一键拉黑**（用户手动触发，绝不静默自动）/ 🚩 **一键上报**
- 🧠 **AI 分类**：综合账号年龄、头像、社交图谱、内容/导流话术；新注册账号尤其严格
- 🌐 **半公开黑名单**：中心服务库为性能真源，确认后的条目**同步到 GitHub**，
  公开、可 fork、可审计
- ⚖️ **治理优先**：AI 判定永不自动公开，必经人工复核；有申诉/移除通道

> 公益、开源（AGPL-3.0）。范围**严格限定** spam / 色情广告机器人，**不碰观点立场**。

## 怎么工作

```
你浏览 X → 扩展被动读取可见账号 → 本地启发式预筛
   → 黑名单查询（本地 bloom / 中心 API） → 弹窗：本页 N 个可疑
   → 你点：一键拉黑(手动手势) / 一键上报
        → 中心服务：去重 → LLM 分类 → 人工复核闸门
        → 同步到 GitHub 公开分片名单（版本化、CDN、可 fork）
        → 各扩展拉取更新
```

完整机制见 **[docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md)**。

## 快速开始

### 普通用户（即将提供）

安装上架后的 Chrome 扩展即可，无需配置。当前为 alpha，请见下方开发者方式。

### 开发者 / 本地 MVP

本地即可跑通"扩展 + 本地服务"闭环：

```bash
cp .env.example .env      # 填 LLM_BASE_URL / LLM_API_KEY / LLM_MODEL
pnpm install
pnpm serve                # 本地服务 http://127.0.0.1:8787
```

然后 `chrome://extensions` → 开发者模式 → 加载已解压 → 选 `extension/` →
刷新 x.com。详见 **[docs/MVP.md](./docs/MVP.md)**。

校验：`pnpm typecheck && pnpm test && pnpm lint`

## 项目状态

🟠 **Alpha** — 本地 MVP 已在真实 X 上验证（被动数字 ID 提取、自动启发式预筛、
账号特征入模、真实色情广告 bot 命中无误杀）。中心服务 + GitHub 同步 + 公开
扩展为规划/进行中（见 [架构](./docs/ARCHITECTURE.md) 与下方路线）。

| 模块 | 状态 |
|---|---|
| 本地 AI 分类器 + 私有策展库 | ✅ 已验证 |
| MV3 扩展（被动 + 自动预筛 + 一键隐藏） | ✅ 本地可用 |
| Cloudflare 服务 (Workers + D1 + R2 + Cron) | 🚧 规划 |
| 报告/申诉 + 人工复核闸门 | 🚧 规划 |
| GitHub 公开名单同步 + CDN | 🚧 规划 |

## 仓库结构

```
src/            本地/服务端分类器、策展库、本地服务
extension/      MV3 浏览器扩展（被动 content-script）
docs/           ARCHITECTURE.md（机制设计）· MVP.md（本地跑法）
GOVERNANCE.md   治理红线、范围、申诉与移除
CONTRIBUTING.md 如何参与 · SECURITY.md 安全报告
```

公开**名单数据**将放在**独立仓库**，与代码解耦（数据 feed 独立版本/CI）。

## 治理与隐私（重要）

这是一份对真实账号的公开指控列表。请先读 **[GOVERNANCE.md](./GOVERNANCE.md)**：
置信度阈值 + 公开前人工复核、申诉/可审计移除、除公开数字 ID 外不存 PII、
范围严格限定、透明版本化变更。误判申诉见
[问题模板](./.github/ISSUE_TEMPLATE/)。

## 贡献

欢迎 PR。请先读 [CONTRIBUTING.md](./CONTRIBUTING.md) 与 [GOVERNANCE.md](./GOVERNANCE.md)。
安全问题请走 [SECURITY.md](./SECURITY.md)，不要开公开 issue。

## License

[AGPL-3.0](./LICENSE) — 公益开源，防止闭源商用派生。

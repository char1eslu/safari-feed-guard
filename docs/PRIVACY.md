# MXGA 隐私声明

最后更新：2026-05-25

> 一句话概括：MXGA 不收集任何用户身份信息。所有本地数据都存在你的浏览器里。
> 上报给我们 Cloudflare Worker 的内容只有「X 平台公开数字 ID + GitHub 数字 ID」，
> 没有邮箱、姓名、设备指纹、IP 解析。

---

## 1. 我们 **不** 收集的

- **个人身份信息（PII）**：姓名、邮箱、电话、地址、生日 —— 全部不读、不存、不传
- **设备指纹**：浏览器 UA、屏幕分辨率、字体列表、Canvas 指纹 —— 全部不收集
- **你的 X cookie / token**：扩展读不到、不会读、不会传
- **你的浏览历史 / 其它 tab 内容**：扩展只对 `https://x.com/*` 和 `https://twitter.com/*` 生效
- **任何能跨服务追踪你的 ID**：我们不嵌入 Google Analytics、Sentry、Mixpanel 等

## 2. 我们 **本地** 存的（不上传）

存于你浏览器自己的 `chrome.storage.local`，清空浏览器数据即清空：

- 本地"已隐藏"账号列表（你点过"隐藏"的 X 账号 ID）
- AI 判定缓存（短期复用，避免重复调 LLM）
- 你自己的本地处理统计（扫了多少 / 拉黑了多少 / 命中公榜多少 —— **纯计数器，不上传**）
- GitHub 登录态（如果你登录了）：只存 GitHub access token + 你的 GitHub 用户名
- 维护者白名单的本地镜像（每 6 小时从我们服务端拉取，本身无 PII）

可以随时去 `chrome://extensions` → MXGA → "扩展程序详情" → "存储" 或扩展的 设置 → "数据与隐私" → "清除本地数据" 一键清掉。

## 3. 我们 **上传** 的（仅当你触发）

只在以下三种动作发生时，扩展会向我们的 Cloudflare Worker（`https://x.zuoluo.tv/v1/*`）发请求：

### 3.1 公榜命中检查 `GET /v1/check?ids=<X 数字 ID>`
- 上传的内容：你浏览过程中遇到的 X 账号的**公开数字 ID**
- 用途：查询该 ID 是否已被维护者公开拉黑
- 关联：**无**身份。这个请求不带任何标识你的信息

### 3.2 AI 判定 `POST /v1/classify`
- 上传的内容：你看到的 X 账号的**公开**信息 —— handle、display name、bio、最近的几条公开推文文本（≤20 条）、是否默认头像、账号年龄、粉丝数
- 上述都是 X 自己已经渲染给你看的公开数据；我们不从 X 后台抓任何东西
- 这些字段会被传给 OpenAI 兼容 LLM 进行 spam / 色情广告 bot 分类
- 关联：如果你**登录了 GitHub**，请求会带 GitHub access token；后端只用它读你的 GitHub 数字 ID（`/user` 端点的 `id` 字段），不读邮箱、姓名、仓库列表

### 3.3 举报 / 一键拉黑 `POST /v1/confirm` / `POST /v1/report`
- 上传的内容：你举报或拉黑的目标 X 账号 + 你的 GitHub 数字 ID（用作 reporter 指纹）
- 用途：增加该账号的"独立举报人计数"，给维护者做参考。**绝不**自动公开
- 关联：你的 GitHub 数字 ID。**不会**关联你的 X 身份（我们也不知道你的 X 账号是哪个）

## 4. 我们 **不可能** 关联的

- 我们看不到你的 X 账号是谁，因为扩展不上传你的 X 身份
- 你的 GitHub 数字 ID 在我们的库里就是一串数字（如 `gh:1234567`），没有反查你 X 身份的途径
- 我们没有 IP 日志策略 / 不与第三方分享数据 / 不卖广告

## 5. AI 供应商

后端调用的是 OpenAI 兼容的 `/chat/completions` 端点，具体供应商坐标作为 Cloudflare Worker secret 保存，不出现在源码或日志中。供应商按其自身条款短期保留请求内容（通常 ≤30 天），用于滥用检测。**我们不会主动把你的请求归档到任何长期存储。**

## 6. GitHub OAuth App 范围

扩展使用 GitHub Device Flow 登录，唯一申请的 scope 是 `read:user`：
- 读取的字段：你的 GitHub 数字 ID + 公开用户名 + 注册时间
- 不读：邮箱、私有仓库、组织成员、SSH key、token、付款信息

你可以随时在 https://github.com/settings/applications 撤销授权。

## 7. 数据删除

- **本地数据**：扩展 → 设置 → "清除本地数据"，或卸载扩展
- **服务端举报**：去 https://github.com/foru17/make-x-great-again/issues 开 issue，附带你的 GitHub 用户名，要求删除全部 reporter 记录
- **被误判的目标账号**：同样开 issue，附带 X handle，维护者人工复核

## 8. 安全披露

发现漏洞请走 [SECURITY.md](../SECURITY.md) 的非公开通道，不要开公开 issue。

## 9. 协议变更

本声明的变更会写到这个 Markdown 文件的 git 历史里，可在 [commit log](https://github.com/foru17/make-x-great-again/commits/main/docs/PRIVACY.md) 公开查询。

---

不放心？读源码：https://github.com/foru17/make-x-great-again 全部 AGPL-3.0。

# Product flow (as-built) + de-dup / cost strategy

Current flow notes for MXGA's detection pipeline and LLM cost controls.
Cloudflare deployment details live in [ARCHITECTURE.md](./ARCHITECTURE.md).

## A. Current end-to-end flow (what runs today)

```
你浏览 X
  │  WXT content script (passive, MutationObserver debounced 600ms)
  ▼
scan(): 收集 ① 资料页头部(若在 profile) ② 所有 article[data-testid=tweet]
        —— 注意：打开某条推文时，下面的"回复/评论"也是 article[tweet]，
           所以评论区作者本来就在扫描范围内
  ▼
逐账号 提取信号(被动): 数字userId(头像URL) · handle · 昵称 · 推文/回复正文
        profile 页额外: bio · 注册时间→天数 · 粉丝/关注 · 是否默认头像
  ▼
L1 会话内去重: seen Set(按 userId|handle) —— 本页本会话内不重复处理
  ▼
L3 名单优先: 有 userId → /lookup(本地策展库) —— 命中即出判定, 0 次 LLM
  ▼
L4 启发式预筛(本地零成本): 默认头像/新号/低粉/导流话术/可疑外链/机器handle → 0..1
  ▼
  分数 ≥ 0.5 ─► 自动 POST /classify (LLM, 外部 OpenAI 兼容供应商)
  分数 <  0.5 ─► 只挂"检查"幽灵按钮(手动触发)
  ▼
本地服务 /classify: L5 signalsHash 缓存(同信号不重复 LLM)
        → 调 LLM → 结构化判定 → 写私有 JSONL 策展库(auto_pending_review,
          治理红线: 永不自动公开) → 返回
  ▼
扩展渲染: 内联徽标(+悬停 popover 理由/操作); 若为 spam 加入右上角气泡计数
弹窗: 服务状态 + 策展库
```

未来（已设计未实现）：localhost 服务 → Cloudflare Workers+D1+R2；扩展改为
CDN bloom 名单优先；新增 上报/申诉/人工复核闸门。

## B. 当前缺口

1. **评论区作者**技术上已被扫描（同样是 `article[tweet]`），但只有启发式
   ≥0.5 才自动判；很多回复型 spam 账号信号较隐蔽 → 落到"手动按钮"，体验上
   像"没自动检查"。
2. **去重只在会话内**（内存 Set），刷新/重开同一推文/换页 → 同一账号被
   **重复送 LLM**，这是最大的浪费源。
3. 没有**跨会话持久缓存**：同一批高频出现的账号每次都重算。

## C. 去重 / 省钱策略（分层，键 = 不可变 userId，handle 兜底）

| 层 | 机制 | 现状 | 作用 |
|---|---|---|---|
| L0 | **在途去重** pending Map：同账号请求未回前不重复发 | 新增 | 防同页多条回复同时触发同账号 |
| L1 | 会话内 seen Set | 已有 | 本页不重复 |
| L2 | **持久账号判定缓存**(chrome.storage/IndexedDB) 按 userId 存 {verdict,signalsHash,ts,model}；spam 判定 TTL 长(30d)，legit/uncertain 短(7d) | **新增（最关键）** | 跨会话/跨推文复现 = 0 次 LLM |
| L3 | 名单优先 /lookup（未来 CDN bloom） | 已有 | 命中即免 LLM |
| L4 | 启发式门槛（仅可疑才花 LLM） | 已有 | 干净老号永不计费 |
| L5 | 服务端 signalsHash 缓存 | 已有 | 同信号不重复；未来跨用户共享 |

核心原则：**判定是账号级，不是评论级**。某账号在某条推文的发言只是"额外
证据"，不该为每条评论各发一次 LLM。只有当 ① 无既往结论 ② 新证据使
signalsHash 实质变化 ③ 缓存过期 三者同时满足才重判。

补充：
- **预算/限速**：每页 / 每分钟 LLM 调用上限；按启发式分数优先级排队，超额
  的退回"手动按钮"而非自动 —— 防被刷屏的评论区瞬间打爆接口。
- **负缓存**：legit/uncertain 也缓存，高频干净账号不反复计费。
- **未来中心化**：服务端按 userId+signalsHash 去重后，全网"第一个看到新账号
  的人"才付费，其余命中缓存/bloom —— 边际成本趋近 0（与 Cloudflare 成本模型
  一致）。

## D. 评论区作者"自动检查"增强方案

1. 识别会话页（`/<user>/status/<id>`）：其 reply articles 即评论者，已在
   扫描范围；把回复正文作为 `triggeringComment` 一并送（已实现）。
2. 走同一管线，但叠加 L0–L2：重开该推文/翻评论 = 命中持久缓存，0 次 LLM。
3. 评论区上下文可用**略激进**的自动策略（新号+外链/导流在回复里 spam 基率
   极高），但仍受启发式门槛 + 预算上限约束以控成本。
4. 多个回复属于同一账号 → L0 在途去重 + L1/L2 → 全程对该账号只 1 次判定。

## 实现优先级

P0 **L2 持久账号缓存 + L0 在途去重**（最大省钱项，且让评论区"自动"体验
成立）· P1 预算/限速 + 负缓存 · P2 评论区上下文自动策略微调。

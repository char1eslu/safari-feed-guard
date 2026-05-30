// ==UserScript==
// @name         Safari Feed Guard
// @namespace    https://github.com/char1eslu/safari-feed-guard
// @version      0.4.0-safari.7
// @description  Safari/Tampermonkey userscript with bilingual UI, inline labels, local cache, remote checks, and a paced action queue.
// @author       char1eslu
// @license      AGPL-3.0-only
// @homepageURL  https://github.com/char1eslu/safari-feed-guard
// @supportURL   https://github.com/char1eslu/safari-feed-guard/issues
// @downloadURL  https://raw.githubusercontent.com/char1eslu/safari-feed-guard/main/safari-feed-guard.user.js
// @updateURL    https://raw.githubusercontent.com/char1eslu/safari-feed-guard/main/safari-feed-guard.user.js
// @match        https://x.com/*
// @match        https://twitter.com/*
// @run-at       document-start
// @noframes
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_deleteValue
// @grant        GM_listValues
// @grant        GM_registerMenuCommand
// @grant        GM_xmlhttpRequest
// @grant        unsafeWindow
// @connect      x.zuoluo.tv
// @connect      x-spam-sentinel-edge.zuoluotv.workers.dev
// @connect      github.com
// @connect      api.github.com
// ==/UserScript==

/*
 * AGPL-3.0-only userscript distribution.
 */

(function feedGuardUserscript() {
  "use strict";

  const BRAND = {
    name: "Safari Feed Guard",
    acronym: "SFG",
    edgeBase: "https://x.zuoluo.tv",
    repo: "https://github.com/char1eslu/safari-feed-guard",
    governance: "https://github.com/char1eslu/safari-feed-guard",
    privacy: "https://github.com/char1eslu/safari-feed-guard",
    appealNewIssue: "https://github.com/char1eslu/safari-feed-guard/issues/new",
  };

  const GH_CLIENT_ID = "Ov23liP2AbdNePTyKUEA";
  const STORAGE_PREFIX = "mxga:safari:";
  const SETTINGS_KEY = "settings";
  const BLOCK_KEY = "xss:blocked";
  const BLOCK_RECORD_KEY = "xss:blocklist:v2";
  const STATS_KEY = "xss:stats";
  const LOCAL_USAGE_STATS_KEY = "mxga_stats_v1";
  const CACHE_PREFIX = "xss:v1:";
  const WHITELIST_KEY = "mxga_whitelist_v1";
  const QUEUE_KEY = "xss:blockQueue";
  const GH_TOKEN_KEY = "xss:ghToken";
  const GH_LOGIN_KEY = "xss:ghLogin";
  const GH_CLIENT_KEY = "xss:ghClientId";
  const GRAPHQL_EVENT = "mxga:x-users";

  const DEFAULT_SETTINGS = {
    enabled: true,
    bubble: true,
    bubblePos: "tr",
    replyAuto: true,
    edgeBase: "",
    autoExpandOnFinding: true,
    autoBlockListHits: false,
    language: "auto",
  };

  let currentSettings;

  const DAY = 86_400_000;
  const REFRESH_MS = 6 * 3600_000;
  const AUTO_THRESHOLD = 0.5;

  const LABEL = {
    spam: { zh: "垃圾", en: "Spam", color: "#ef4444", short: "垃圾", shortEn: "Spam" },
    porn_bot: { zh: "色情bot", en: "Porn bot", color: "#ef4444", short: "色情", shortEn: "Porn" },
    likely_spam: { zh: "疑似垃圾", en: "Likely spam", color: "#f59e0b", short: "疑似", shortEn: "Likely" },
    uncertain: { zh: "不确定", en: "Uncertain", color: "#64748b", short: "存疑", shortEn: "Maybe" },
    legit: { zh: "正常", en: "Legit", color: "#16a34a", short: "正常", shortEn: "Legit" },
  };

  const I18N = {
    "zh-CN": {
      auto: "自动",
      simplifiedChinese: "简中",
      english: "English",
      off: "已关闭",
      blockingProgress: "拉黑中 {done}/{total}",
      hits: "命中 {count}",
      scanning: "扫描 {count}",
      scanned: "已扫 {count}",
      guard: "守护",
      enabledTitle: "{brand} 已启用",
      metricScanned: "已扫",
      metricAnalyzing: "分析",
      metricPublic: "公榜",
      metricConfirmed: "确认",
      metricHits: "命中",
      metricActive: "正在",
      metricQueued: "待拉",
      metricBlocked: "已拉",
      emptyPanel: "正在被动检查本页账号。发现可疑垃圾号时会显示在这里，并可一键拉黑。",
      refreshWhitelist: "刷新白名单",
      governanceRules: "治理规则",
      pageHitsTitle: "本页命中 {count} 个账号",
      blockAllPending: "一键拉黑未处理 {count}",
      jumpFirst: "跳到第一个",
      ignorePage: "忽略本页",
      blockedWithSource: "已拉黑{source}",
      blockingWithSource: "正在后台拉黑{source}",
      queuedWithSource: "待后台拉黑{source}",
      blockFailed: "拉黑失败，可重试或手动处理",
      blocked: "已拉黑",
      retry: "重试",
      block: "拉黑",
      sourceManual: "手动",
      sourceBatch: "批量",
      sourcePublicAuto: "公榜自动",
      sourceCacheAuto: "缓存自动",
      syncing: "同步中",
      synced: "已同步",
      settingsTitle: "{brand} 设置",
      language: "语言",
      languageHint: "选择界面语言。",
      enabledDetection: "启用检测",
      enabledDetectionHint: "关闭后不扫描页面。",
      bubbleVisible: "显示右上角气泡",
      bubbleVisibleHint: "隐藏后仍可从油猴菜单打开设置。",
      replyAuto: "回复区自动检查",
      replyAutoHint: "在回复页降低启发式阈值，覆盖更隐蔽的账号。",
      autoExpand: "命中后自动展开",
      autoExpandHint: "发现可疑账号时自动弹出处理面板。",
      autoBlockHits: "自动拉黑公榜/缓存命中",
      autoBlockHitsHint: "危险选项：命中公榜或本机历史垃圾缓存时静默加入拉黑队列。",
      bubblePosition: "气泡位置",
      bubblePositionHint: "右上或右下。",
      topRight: "右上",
      bottomRight: "右下",
      edgeApi: "Edge API 地址",
      edgeApiHint: "留空使用 {url}",
      githubLogin: "GitHub 登录",
      githubCurrent: "当前：{login}",
      githubLoginHint: "登录后可上报和确认垃圾账号。",
      login: "登录",
      logout: "退出",
      whitelistCache: "白名单缓存",
      whitelistStatus: "{count} 条，{time}",
      neverSynced: "尚未同步",
      localStats: "本地统计",
      localStatsLine: "AI {ai} · 公榜 {public} · 确认 {confirmed} · 拉黑 {blocks}",
      clear: "清空",
      privacy: "隐私说明",
      safariNote: "Safari 油猴版是单文件脚本；目标页面结构变动时可能需要更新。",
      refreshing: "刷新中",
      clearConfirm: "清空 SFG 的本地缓存、队列、登录态和统计？",
      githubLoginStartFailed: "GitHub 登录启动失败：{error}",
      githubDeviceFlow: "GitHub Device Flow",
      githubDeviceHint: "打开 GitHub 输入验证码：{code}",
      openVerification: "打开验证页",
      waitingAuth: "等待授权...",
      loggedInAs: "已登录：{login}",
      waitingAuthDetail: "等待授权... {detail}",
      statusBlocking: "屏蔽中",
      statusAnalyzing: "分析",
      statusQueued: "排队",
      whitelist: "白名单",
      handle: "处理",
      check: "检查",
      badgePublic: "公榜",
      badgeCache: "缓存",
      manualTitle: "手动处理",
      manualHint: "未命中时可主动检查、上报或拉黑并上报。",
      report: "上报",
      blockAndReport: "拉黑并上报",
      reporting: "上报中",
      reported: "已上报",
      failed: "失败",
      sourcePublicConfirmed: "公榜确认",
      sourceLocalCache: "本地缓存",
      sourceAiLive: "AI 现场判定",
      noDetailedReason: "无详细理由",
      hide: "隐藏",
      appeal: "误判?",
      reportFailed: "上报失败",
      classifyFailed: "分类失败",
      idFallback: "数字ID未解析，handle 兜底",
      menuSettings: "SFG 设置",
      menuToggle: "SFG 切换启用/关闭",
      menuRefreshWhitelist: "SFG 刷新白名单",
      reasonReplyTemplate: "导流模板：短中文回复 + @mention + (emoji|性暗示)",
      reasonDefaultAvatar: "默认头像",
      reasonNewAccount30: "新注册账号(<30天)",
      reasonNewAccount90: "较新账号(<90天)",
      reasonOldAccount: "老账号(>2年)",
      reasonNoFollowers: "几乎无粉丝",
      reasonPromoText: "导流/性广告话术",
      reasonSuspiciousLink: "外链/可疑域名",
      reasonRandomHandle: "机器生成式 handle",
    },
    en: {
      auto: "Auto",
      simplifiedChinese: "简中",
      english: "English",
      off: "Off",
      blockingProgress: "Blocking {done}/{total}",
      hits: "{count} hits",
      scanning: "Scanning {count}",
      scanned: "Scanned {count}",
      guard: "Guard",
      enabledTitle: "{brand} enabled",
      metricScanned: "Scanned",
      metricAnalyzing: "Analysis",
      metricPublic: "Public",
      metricConfirmed: "Confirmed",
      metricHits: "Hits",
      metricActive: "Active",
      metricQueued: "Queued",
      metricBlocked: "Blocked",
      emptyPanel: "Passively checking accounts on this page. Suspicious accounts will appear here for one-click blocking.",
      refreshWhitelist: "Refresh whitelist",
      governanceRules: "Rules",
      pageHitsTitle: "{count} accounts flagged",
      blockAllPending: "Block pending {count}",
      jumpFirst: "First hit",
      ignorePage: "Ignore page",
      blockedWithSource: "Blocked{source}",
      blockingWithSource: "Blocking in background{source}",
      queuedWithSource: "Queued for blocking{source}",
      blockFailed: "Block failed. Retry or handle manually.",
      blocked: "Blocked",
      retry: "Retry",
      block: "Block",
      sourceManual: "manual",
      sourceBatch: "batch",
      sourcePublicAuto: "public auto",
      sourceCacheAuto: "cache auto",
      syncing: "Syncing",
      synced: "Synced",
      settingsTitle: "{brand} Settings",
      language: "Language",
      languageHint: "Choose the interface language.",
      enabledDetection: "Enable detection",
      enabledDetectionHint: "Stops scanning when disabled.",
      bubbleVisible: "Show floating bubble",
      bubbleVisibleHint: "When hidden, settings remain available from the Tampermonkey menu.",
      replyAuto: "Auto-check replies",
      replyAutoHint: "Lowers the heuristic threshold on reply pages to catch subtler accounts.",
      autoExpand: "Auto-open on hit",
      autoExpandHint: "Opens the action panel when a suspicious account is found.",
      autoBlockHits: "Auto-block public/cache hits",
      autoBlockHitsHint: "Risky option: silently queues public-list or local-cache hits for blocking.",
      bubblePosition: "Bubble position",
      bubblePositionHint: "Top right or bottom right.",
      topRight: "Top right",
      bottomRight: "Bottom right",
      edgeApi: "Edge API URL",
      edgeApiHint: "Leave blank to use {url}",
      githubLogin: "GitHub login",
      githubCurrent: "Current: {login}",
      githubLoginHint: "Log in to report and confirm spam accounts.",
      login: "Log in",
      logout: "Log out",
      whitelistCache: "Whitelist cache",
      whitelistStatus: "{count} entries, {time}",
      neverSynced: "never synced",
      localStats: "Local stats",
      localStatsLine: "AI {ai} · public {public} · confirmed {confirmed} · blocked {blocks}",
      clear: "Clear",
      privacy: "Privacy",
      safariNote: "The Safari userscript is a single-file port; page structure changes may require an update.",
      refreshing: "Refreshing",
      clearConfirm: "Clear SFG local cache, queue, login state, and stats?",
      githubLoginStartFailed: "GitHub login failed to start: {error}",
      githubDeviceFlow: "GitHub Device Flow",
      githubDeviceHint: "Open GitHub and enter this code: {code}",
      openVerification: "Open verification",
      waitingAuth: "Waiting for authorization...",
      loggedInAs: "Logged in as {login}",
      waitingAuthDetail: "Waiting for authorization... {detail}",
      statusBlocking: "Blocking",
      statusAnalyzing: "Analyzing",
      statusQueued: "Queued",
      whitelist: "Whitelist",
      handle: "Handle",
      check: "Check",
      badgePublic: "Public",
      badgeCache: "Cache",
      manualTitle: "Manual action",
      manualHint: "When there is no hit, you can check, report, or block and report manually.",
      report: "Report",
      blockAndReport: "Block and report",
      reporting: "Reporting",
      reported: "Reported",
      failed: "Failed",
      sourcePublicConfirmed: "Public list",
      sourceLocalCache: "Local cache",
      sourceAiLive: "AI live verdict",
      noDetailedReason: "No detailed reason",
      hide: "Hide",
      appeal: "False positive?",
      reportFailed: "Report failed",
      classifyFailed: "Classification failed",
      idFallback: "Numeric ID not resolved; falling back to handle.",
      menuSettings: "SFG Settings",
      menuToggle: "SFG Toggle on/off",
      menuRefreshWhitelist: "SFG Refresh whitelist",
      reasonReplyTemplate: "Traffic pattern: short Chinese reply + @mention + (emoji or innuendo)",
      reasonDefaultAvatar: "Default avatar",
      reasonNewAccount30: "New account (<30 days)",
      reasonNewAccount90: "Recent account (<90 days)",
      reasonOldAccount: "Established account (>2 years)",
      reasonNoFollowers: "Almost no followers",
      reasonPromoText: "Promotional or sexual-ad wording",
      reasonSuspiciousLink: "External link or suspicious domain",
      reasonRandomHandle: "Machine-generated handle",
    },
  };

  const REASON_KEYS = {
    "导流模板：短中文回复 + @mention + (emoji|性暗示)": "reasonReplyTemplate",
    默认头像: "reasonDefaultAvatar",
    "新注册账号(<30天)": "reasonNewAccount30",
    "较新账号(<90天)": "reasonNewAccount90",
    "老账号(>2年)": "reasonOldAccount",
    几乎无粉丝: "reasonNoFollowers",
    "导流/性广告话术": "reasonPromoText",
    "外链/可疑域名": "reasonSuspiciousLink",
    "机器生成式 handle": "reasonRandomHandle",
    reasonReplyTemplate: "reasonReplyTemplate",
    reasonDefaultAvatar: "reasonDefaultAvatar",
    reasonNewAccount30: "reasonNewAccount30",
    reasonNewAccount90: "reasonNewAccount90",
    reasonOldAccount: "reasonOldAccount",
    reasonNoFollowers: "reasonNoFollowers",
    reasonPromoText: "reasonPromoText",
    reasonSuspiciousLink: "reasonSuspiciousLink",
    reasonRandomHandle: "reasonRandomHandle",
  };

  function uiLang() {
    const raw = currentSettings?.language || DEFAULT_SETTINGS.language;
    if (raw === "zh-CN" || raw === "en") return raw;
    const nav = typeof navigator === "object" ? navigator.language || "" : "";
    return /^zh(?:-|_|$)/i.test(nav) ? "zh-CN" : "en";
  }

  function t(key, vars = {}) {
    const dict = I18N[uiLang()] || I18N["zh-CN"];
    const template = dict[key] || I18N["zh-CN"][key] || key;
    return template.replace(/\{(\w+)\}/g, (_, name) => String(vars[name] ?? ""));
  }

  function labelMeta(label) {
    return LABEL[label] || LABEL.uncertain;
  }

  function labelText(label) {
    const meta = labelMeta(label);
    return uiLang() === "en" ? meta.en : meta.zh;
  }

  function labelShort(label) {
    const meta = labelMeta(label);
    return uiLang() === "en" ? meta.shortEn : meta.short;
  }

  function reasonText(reason) {
    const key = REASON_KEYS[reason];
    return key ? t(key) : String(reason || "");
  }

  function formatDateTime(ts) {
    if (!ts) return t("neverSynced");
    return new Date(ts).toLocaleString(uiLang() === "en" ? "en-US" : "zh-CN");
  }

  const PROMO_RE =
    /(约见|约炮|附近|同城|牵线|线下|对接|资源|上车|看我主页|入驻|女主播|安全可靠|大号|解锁|福利|楼凤|一夜|加微|私聊|私信|包养|外围|18\+|🔞|🍑|💋|💦|👇|👉)/;
  const LINK_RE =
    /(https?:\/\/|\b[\w-]+\.(top|xyz|vip|club|icu|cn|cc|live|link|shop)\b|t\.co\/)/i;
  const RANDOM_HANDLE_RE = /^[a-z]{2,}\d{4,}$|^[A-Za-z]+[A-Z][a-z]+\d{4,}$|^[a-z]{1,3}\d{4,}$/;
  const EMOJI_RE = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{1F1E6}-\u{1F1FF}]/u;
  const HAS_CJK_RE = /[一-鿿]/;
  const HAS_MENTION_RE = /@[A-Za-z0-9_]{2,15}/;
  const NON_PROFILE = new Set([
    "home",
    "explore",
    "notifications",
    "messages",
    "i",
    "search",
    "settings",
    "compose",
    "hashtag",
    "bookmarks",
    "lists",
    "communities",
    "jobs",
    "tos",
    "privacy",
    "login",
    "signup",
  ]);
  const AD_LABEL = /^(广告|推广|Promoted|Ad|プロモーション|광고)$/;
  const TWITTER_SNOWFLAKE_EPOCH_MS = 1_288_834_974_657n;
  const UID_CREATED_AT_TOLERANCE_MS = 2 * 86_400_000;

  const FALLBACK_X_BEARER =
    "Bearer AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs%3D1Zv7ttfk8LF81IUq16cHjhLTvJu4FA33AGWWjCpTnA";
  const BLOCK_DELAY_MS = 1200;
  const BLOCK_JITTER_MS = 700;
  const BLOCK_SUCCESS_SETTLE_MS = 180;
  const BLOCK_SHORT_COOLDOWN_EVERY = 45;
  const BLOCK_SHORT_COOLDOWN_MS = 8_000;
  const BLOCK_LONG_COOLDOWN_EVERY = 120;
  const BLOCK_LONG_COOLDOWN_MS = 60_000;
  const BLOCK_RATE_LIMIT_COOLDOWN_MS = 45_000;
  const BLOCK_TRANSIENT_COOLDOWN_MS = 8_000;
  const LS_LAST_BLOCK = "mxga:last-x-block-api";
  const LS_BLOCK_ROUND = "mxga:x-block-round";
  const BLOCK_LOCK_NAME = "mxga-x-block-api";

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const pageWindow = typeof unsafeWindow !== "undefined" ? unsafeWindow : window;

  function storageKey(key) {
    return `${STORAGE_PREFIX}${key}`;
  }

  function gmGet(key, fallback) {
    try {
      const value = GM_getValue(storageKey(key));
      return value === undefined ? fallback : value;
    } catch {
      return fallback;
    }
  }

  function gmSet(key, value) {
    try {
      GM_setValue(storageKey(key), value);
    } catch {
      /* non-fatal */
    }
  }

  function gmDelete(key) {
    try {
      GM_deleteValue(storageKey(key));
    } catch {
      /* non-fatal */
    }
  }

  function gmList() {
    try {
      return GM_listValues().filter((key) => key.startsWith(STORAGE_PREFIX));
    } catch {
      return [];
    }
  }

  function gmClearAll() {
    for (const key of gmList()) {
      try {
        GM_deleteValue(key);
      } catch {
        /* non-fatal */
      }
    }
  }

  function escHtml(s) {
    return String(s ?? "").replace(
      /[<>&"']/g,
      (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&#39;" })[c] || c,
    );
  }

  function normalizeHandle(handle) {
    return String(handle ?? "").trim().replace(/^@+/, "").toLowerCase() || undefined;
  }

  function displayHandle(handle) {
    return String(handle ?? "").trim().replace(/^@+/, "");
  }

  function numericId(v) {
    return typeof v === "string" && /^\d+$/.test(v) ? v : undefined;
  }

  function text(v) {
    return typeof v === "string" ? v : undefined;
  }

  function number(v) {
    return typeof v === "number" && Number.isFinite(v) ? v : undefined;
  }

  function trueFlag(v) {
    return v === true ? true : undefined;
  }

  function object(v) {
    return v && typeof v === "object" ? v : undefined;
  }

  function getSettings() {
    return { ...DEFAULT_SETTINGS, ...(gmGet(SETTINGS_KEY, {}) || {}) };
  }

  function setSetting(k, v) {
    const settings = getSettings();
    gmSet(SETTINGS_KEY, { ...settings, [k]: v });
    currentSettings = getSettings();
    if (bubbleShadow) renderBubble();
    updateBubbleVisibility();
    renderSettingsIfOpen();
    scanSoon(0);
  }

  function edgeBase() {
    return getSettings().edgeBase || BRAND.edgeBase;
  }

  function gmRequest({ method = "GET", url, headers = {}, data, timeout = 30_000 }) {
    return new Promise((resolve, reject) => {
      try {
        GM_xmlhttpRequest({
          method,
          url,
          headers,
          data,
          timeout,
          responseType: "text",
          onload: (res) => resolve(res),
          onerror: () => reject(new Error(`Network error: ${url}`)),
          ontimeout: () => reject(new Error(`Timeout: ${url}`)),
        });
      } catch (e) {
        reject(e);
      }
    });
  }

  async function gmJson({ method = "GET", url, headers = {}, body, timeout }) {
    const data = body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body);
    const res = await gmRequest({
      method,
      url,
      headers,
      data,
      timeout,
    });
    let json = {};
    try {
      json = res.responseText ? JSON.parse(res.responseText) : {};
    } catch {
      json = {};
    }
    if (res.status < 200 || res.status >= 300) {
      throw new Error(json.error || `HTTP ${res.status}`);
    }
    return json;
  }

  async function call(path, init = {}) {
    const headers = init.headers || {};
    return gmJson({
      method: init.method || "GET",
      url: `${edgeBase()}${path}`,
      headers,
      body: init.body,
      timeout: init.timeout || 30_000,
    });
  }

  function getGhToken() {
    if (gmGet(GH_CLIENT_KEY, "") !== GH_CLIENT_ID) return "";
    return gmGet(GH_TOKEN_KEY, "");
  }

  function getGhLogin() {
    if (gmGet(GH_CLIENT_KEY, "") !== GH_CLIENT_ID) return "";
    return gmGet(GH_LOGIN_KEY, "");
  }

  function setGh(token, login) {
    gmSet(GH_TOKEN_KEY, token);
    gmSet(GH_LOGIN_KEY, login);
    gmSet(GH_CLIENT_KEY, GH_CLIENT_ID);
  }

  function clearGh() {
    gmSet(GH_TOKEN_KEY, "");
    gmSet(GH_LOGIN_KEY, "");
    gmSet(GH_CLIENT_KEY, "");
  }

  function authedPost(signals) {
    const token = getGhToken();
    return {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      body: signals,
    };
  }

  async function ghStart() {
    return gmJson({
      method: "POST",
      url: "https://github.com/login/device/code",
      headers: { accept: "application/json", "content-type": "application/json" },
      body: { client_id: GH_CLIENT_ID, scope: "read:user" },
    });
  }

  async function ghPoll(deviceCode) {
    const tokenResp = await gmJson({
      method: "POST",
      url: "https://github.com/login/oauth/access_token",
      headers: { accept: "application/json", "content-type": "application/json" },
      body: {
        client_id: GH_CLIENT_ID,
        device_code: deviceCode,
        grant_type: "urn:ietf:params:oauth:grant-type:device_code",
      },
    }).catch((e) => ({ error: e.message || "pending" }));
    if (!tokenResp.access_token) return { pending: tokenResp.error || "pending" };
    const user = await gmJson({
      method: "GET",
      url: "https://api.github.com/user",
      headers: { authorization: `Bearer ${tokenResp.access_token}`, "user-agent": "mxga" },
    });
    setGh(tokenResp.access_token, user.login || "github");
    return { login: user.login || "github" };
  }

  async function send(msg) {
    try {
      if (msg.type === "health") {
        const h = await call("/v1/health");
        return { ok: true, data: { records: h.published || 0 } };
      }
      if (msg.type === "stats") return { ok: true, data: getMxgaStats() };
      if (msg.type === "whitelist_status") return { ok: true, data: whitelistStatus() };
      if (msg.type === "whitelist_refresh") return { ok: true, data: await refreshWhitelist(true) };
      if (msg.type === "lookup") {
        const r = await call(`/v1/check?ids=${encodeURIComponent(msg.userId)}`);
        const h = (r.hits || {})[msg.userId];
        if (h) bumpMxgaStat("hitPublic");
        return { ok: true, data: { hit: h ? curationHit(msg.userId, h) : null } };
      }
      if (msg.type === "lookup_batch") {
        const ids = [...new Set((msg.userIds || []).filter((id) => /^\d+$/.test(id)))].slice(0, 100);
        if (!ids.length) return { ok: true, data: { hits: {} } };
        const r = await call(`/v1/check?ids=${ids.map(encodeURIComponent).join(",")}`);
        const rawHits = r.hits || {};
        const hits = {};
        for (const id of ids) {
          if (rawHits[id]) hits[id] = curationHit(id, rawHits[id]);
        }
        const hitCount = Object.keys(hits).length;
        if (hitCount) bumpMxgaStatBy("hitPublic", hitCount);
        return { ok: true, data: { hits } };
      }
      if (msg.type === "classify") {
        const r = await call("/v1/classify", authedPost(msg.signals));
        const rec = r.record || {};
        const s = msg.signals || {};
        if (!r.cached) bumpMxgaStat("scanned");
        return {
          ok: true,
          data: {
            record: {
              userId: s.userId || "",
              handle: s.handle,
              verdict: rec.verdict,
              reviewStatus: rec.status,
              model: "edge",
            },
            idResolved: !!s.userId,
          },
        };
      }
      if (msg.type === "confirm_spam") {
        await call("/v1/confirm", authedPost(msg.signals));
        bumpMxgaStat("blocked");
        return { ok: true };
      }
      if (msg.type === "report_spam") {
        await call("/v1/report", authedPost(msg.signals));
        return { ok: true };
      }
      if (msg.type === "gh_start") return { ok: true, data: await ghStart() };
      if (msg.type === "gh_poll") return { ok: true, data: await ghPoll(msg.deviceCode) };
      if (msg.type === "gh_status") return { ok: true, data: { login: getGhLogin() } };
      if (msg.type === "gh_logout") {
        clearGh();
        return { ok: true };
      }
      return { ok: false, error: "unknown message" };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  }

  function curationHit(userId, hit) {
    return {
      userId,
      handle: "",
      verdict: {
        label: hit.label,
        confidence: hit.confidence,
        reasons: hit.reasons || [],
      },
      reviewStatus: "human_confirmed",
      model: "",
    };
  }

  function getMxgaStats() {
    const s = gmGet(LOCAL_USAGE_STATS_KEY, {}) || {};
    return {
      scanned: s.scanned || 0,
      hitPublic: s.hitPublic || 0,
      blocked: s.blocked || 0,
      firstUsedAt: s.firstUsedAt || Date.now(),
    };
  }

  function bumpMxgaStat(key) {
    bumpMxgaStatBy(key, 1);
  }

  function bumpMxgaStatBy(key, n) {
    const cur = getMxgaStats();
    cur[key] = (cur[key] || 0) + Math.max(0, Math.floor(n));
    if (!cur.firstUsedAt) cur.firstUsedAt = Date.now();
    gmSet(LOCAL_USAGE_STATS_KEY, cur);
  }

  function getLocalStats() {
    return gmGet(STATS_KEY, { detections: 0, cacheHits: 0, blocks: 0, byLabel: {} }) || {
      detections: 0,
      cacheHits: 0,
      blocks: 0,
      byLabel: {},
    };
  }

  function bumpStats(patch) {
    const s = getLocalStats();
    s.detections += patch.detections || 0;
    s.cacheHits += patch.cacheHits || 0;
    s.blocks += patch.blocks || 0;
    if (patch.label) s.byLabel[patch.label] = (s.byLabel[patch.label] || 0) + 1;
    gmSet(STATS_KEY, s);
  }

  function getBlocklist() {
    const v2 = gmGet(BLOCK_RECORD_KEY, null);
    if (Array.isArray(v2)) return v2;
    const legacy = gmGet(BLOCK_KEY, []) || [];
    const migrated = legacy.map((id) => ({
      id,
      handle: String(id).startsWith("h:") ? String(id).slice(2) : String(id),
      source: "manual",
      ts: Date.now(),
    }));
    if (migrated.length) gmSet(BLOCK_RECORD_KEY, migrated);
    return migrated;
  }

  function addBlockRecord(rec) {
    const list = getBlocklist();
    if (!list.some((r) => r.id === rec.id)) {
      list.push(rec);
      gmSet(BLOCK_RECORD_KEY, list);
    }
  }

  function addBlocked(id) {
    const list = new Set(gmGet(BLOCK_KEY, []) || []);
    if (!list.has(id)) {
      list.add(id);
      gmSet(BLOCK_KEY, [...list]);
      blockedMem.add(id);
    }
  }

  function warmBlocklist() {
    blockedMem = new Set(gmGet(BLOCK_KEY, []) || []);
  }

  let blockedMem = new Set();

  function isBlockedSync(id) {
    return blockedMem.has(id);
  }

  function cacheTtl(label) {
    if (label === "spam" || label === "porn_bot") return 30 * DAY;
    if (label === "likely_spam") return 14 * DAY;
    if (label === "legit") return 14 * DAY;
    return 3 * DAY;
  }

  function cacheKey(id) {
    return `${CACHE_PREFIX}${id}`;
  }

  function cacheGet(id) {
    const k = cacheKey(id);
    const c = gmGet(k, null);
    if (!c || !c.verdict) return null;
    if (Date.now() - c.ts > cacheTtl(c.verdict.label)) {
      gmDelete(k);
      return null;
    }
    return c;
  }

  function cacheSet(id, c) {
    gmSet(cacheKey(id), c);
  }

  function signalsHash(parts) {
    const s = JSON.stringify([
      parts.handle,
      parts.displayName,
      parts.bio,
      parts.recentTweets,
      parts.hasDefaultAvatar,
      parts.accountAgeDays ?? null,
    ]);
    let h = 5381;
    for (let i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0;
    return h.toString(36);
  }

  let whitelistMirror = new Map();
  let whitelistUidMirror = new Map();

  function readWhitelistState() {
    const s = gmGet(WHITELIST_KEY, null);
    if (!s) return { cursor: 0, lastSyncedAt: 0, entries: [] };
    return {
      cursor: s.cursor || 0,
      lastSyncedAt: s.lastSyncedAt || 0,
      entries: Array.isArray(s.entries) ? s.entries.filter((e) => e && e.h) : [],
    };
  }

  function writeWhitelistState(s) {
    gmSet(WHITELIST_KEY, s);
  }

  function hydrateWhitelist(entries) {
    whitelistMirror = new Map();
    whitelistUidMirror = new Map();
    for (const e of entries || []) {
      whitelistMirror.set(String(e.h).toLowerCase(), true);
      if (e.u) whitelistUidMirror.set(String(e.u), true);
    }
  }

  function loadWhitelistOnce() {
    hydrateWhitelist(readWhitelistState().entries);
  }

  async function refreshWhitelist(force = false) {
    const state = readWhitelistState();
    if (!force && Date.now() - state.lastSyncedAt < REFRESH_MS) {
      hydrateWhitelist(state.entries);
      return { added: 0, total: state.entries.length };
    }
    let cursor = 0;
    let merged = [];
    for (let i = 0; i < 20; i++) {
      let j;
      try {
        j = await call(`/v1/whitelist?since=${cursor}&limit=2000`);
      } catch {
        break;
      }
      const list = j.list || [];
      if (!list.length) {
        cursor = j.latestAt || cursor;
        break;
      }
      for (const r of list) {
        const h = String(r.handle || "").toLowerCase();
        if (!h) continue;
        const u = r.x_user_id || undefined;
        const idx = merged.findIndex((e) => e.h === h || (u && e.u === u));
        if (idx >= 0) merged[idx] = { h, ...(u ? { u } : {}) };
        else merged.push({ h, ...(u ? { u } : {}) });
      }
      const last = list[list.length - 1];
      cursor = j.latestAt || (last && last.last_scored) || cursor;
      if (list.length < 2000) break;
    }
    if (!merged.length && state.entries.length) merged = state.entries;
    const before = new Set(state.entries.map((e) => `${e.h}:${e.u || ""}`));
    const added = merged.filter((e) => !before.has(`${e.h}:${e.u || ""}`)).length;
    const next = { cursor, lastSyncedAt: Date.now(), entries: merged };
    writeWhitelistState(next);
    hydrateWhitelist(next.entries);
    return { added, total: merged.length };
  }

  function whitelistStatus() {
    const s = readWhitelistState();
    return { count: s.entries.length, lastSyncedAt: s.lastSyncedAt };
  }

  function isWhitelisted(handle, xUserId) {
    if (xUserId && whitelistUidMirror.has(String(xUserId))) return true;
    const h = normalizeHandle(handle);
    return !!h && whitelistMirror.has(h);
  }

  const graphqlUserCache = new Map();

  function ingestGraphqlUsers(users) {
    let changed = false;
    for (const user of users || []) {
      const handle = normalizeHandle(user.handle);
      const userId = numericId(user.userId);
      if (!handle || !userId) continue;
      const created = user.createdAt ? Date.parse(user.createdAt) : NaN;
      const accountCreatedAt = Number.isNaN(created) ? undefined : new Date(created).toISOString();
      const next = {
        userId,
        ...(user.bio !== undefined ? { bio: user.bio } : {}),
        ...(user.followersCount !== undefined ? { followersCount: user.followersCount } : {}),
        ...(user.followingCount !== undefined ? { followingCount: user.followingCount } : {}),
        ...(user.displayName ? { displayName: user.displayName } : {}),
        ...(user.avatarUrl ? { avatarUrl: user.avatarUrl } : {}),
        ...(user.viewerFollowing ? { viewerFollowing: true } : {}),
        ...(user.viewerBlocking ? { viewerBlocking: true } : {}),
        ...(user.viewerMuting ? { viewerMuting: true } : {}),
        ...(user.viewerFollowRequestSent ? { viewerFollowRequestSent: true } : {}),
        ...(accountCreatedAt ? { accountCreatedAt } : {}),
        ...(Number.isNaN(created)
          ? {}
          : { accountAgeDays: Math.max(0, Math.round((Date.now() - created) / DAY)) }),
      };
      const prev = graphqlUserCache.get(handle);
      if (JSON.stringify(prev) !== JSON.stringify(next)) {
        graphqlUserCache.set(handle, next);
        changed = true;
      }
    }
    return changed;
  }

  function readGraphqlUser(handle) {
    const key = normalizeHandle(handle);
    return key ? graphqlUserCache.get(key) || {} : {};
  }

  function collectGraphqlUsers(payload) {
    const out = new Map();
    const seen = new WeakSet();
    const budget = { n: 12000 };

    function walk(value, depth) {
      const o = object(value);
      if (!o || depth > 28 || budget.n-- <= 0) return;
      if (seen.has(o)) return;
      seen.add(o);

      if (o.__typename === "User") {
        const legacy = object(o.legacy) || {};
        const core = object(o.core) || {};
        const avatar = object(o.avatar) || {};
        const relationship = object(o.relationship_perspectives) || {};
        const restId = numericId(o.rest_id);
        const legacyId = numericId(legacy.id_str);
        const userId = legacyId || restId;
        const handle = text(legacy.screen_name) || text(core.screen_name);
        if (userId && restId && legacyId && restId !== legacyId) return;
        if (userId && handle) {
          out.set(handle.toLowerCase(), {
            handle,
            userId,
            ...(text(legacy.description) !== undefined ? { bio: text(legacy.description) } : {}),
            ...(text(legacy.name) || text(core.name) ? { displayName: text(legacy.name) || text(core.name) } : {}),
            ...(text(legacy.profile_image_url_https) || text(avatar.image_url)
              ? { avatarUrl: text(legacy.profile_image_url_https) || text(avatar.image_url) }
              : {}),
            ...(number(legacy.followers_count) !== undefined ? { followersCount: number(legacy.followers_count) } : {}),
            ...(number(legacy.friends_count) !== undefined ? { followingCount: number(legacy.friends_count) } : {}),
            ...(text(legacy.created_at) || text(core.created_at) ? { createdAt: text(legacy.created_at) || text(core.created_at) } : {}),
            ...(trueFlag(legacy.following) || trueFlag(relationship.following) ? { viewerFollowing: true } : {}),
            ...(trueFlag(legacy.blocking) || trueFlag(relationship.blocking) ? { viewerBlocking: true } : {}),
            ...(trueFlag(legacy.muting) || trueFlag(relationship.muting) ? { viewerMuting: true } : {}),
            ...(trueFlag(legacy.follow_request_sent) || trueFlag(relationship.follow_request_sent)
              ? { viewerFollowRequestSent: true }
              : {}),
          });
        }
      }

      for (const child of Object.values(o)) walk(child, depth + 1);
    }

    walk(payload, 0);
    return [...out.values()];
  }

  function emitGraphqlUsers(payload) {
    const users = collectGraphqlUsers(payload);
    if (!users.length) return;
    window.dispatchEvent(new CustomEvent(GRAPHQL_EVENT, { detail: JSON.stringify({ users: users.slice(0, 200) }) }));
  }

  function shouldInspectGraphqlUrl(url) {
    return typeof url === "string" && /\/i\/api\/graphql\/[^/]+\/[^/?#]+/.test(url);
  }

  function installGraphqlHooks() {
    try {
      if (pageWindow.__mxgaUserscriptHooked) return;
      pageWindow.__mxgaUserscriptHooked = true;
      const originalFetch = pageWindow.fetch;
      if (typeof originalFetch === "function") {
        pageWindow.fetch = async function mxgaFetchHook(...args) {
          const response = await originalFetch.apply(this, args);
          const url =
            args[0] instanceof pageWindow.Request
              ? args[0].url
              : typeof args[0] === "string"
                ? args[0]
                : response.url;
          if (shouldInspectGraphqlUrl(url)) {
            response
              .clone()
              .json()
              .then(emitGraphqlUsers)
              .catch(() => {});
          }
          return response;
        };
      }

      const XHR = pageWindow.XMLHttpRequest;
      if (XHR && XHR.prototype) {
        const originalOpen = XHR.prototype.open;
        const originalSend = XHR.prototype.send;
        XHR.prototype.open = function mxgaXhrOpen(method, url, async, username, password) {
          this.__mxgaGraphqlUrl = shouldInspectGraphqlUrl(String(url || "")) ? String(url) : undefined;
          if (async === undefined) return originalOpen.call(this, method, url);
          return originalOpen.call(this, method, url, async, username, password);
        };
        XHR.prototype.send = function mxgaXhrSend(body) {
          if (this.__mxgaGraphqlUrl) {
            this.addEventListener("loadend", () => {
              try {
                if (typeof this.responseText === "string") emitGraphqlUsers(JSON.parse(this.responseText));
              } catch {
                /* ignore */
              }
            });
          }
          return originalSend.call(this, body);
        };
      }
    } catch (e) {
      console.warn("[SFG] GraphQL hook failed", e);
    }
  }

  installGraphqlHooks();

  function parseJoinDate(value) {
    if (!value) return undefined;
    let d;
    const zh = String(value).match(/(\d{4})年(\d{1,2})月/);
    if (zh) d = new Date(Number(zh[1]), Number(zh[2]) - 1, 1);
    if (!d) {
      const en = String(value).match(/Joined\s+([A-Za-z]+)\s+(\d{4})/i);
      if (en) d = new Date(`${en[1]} 1, ${en[2]}`);
    }
    if (!d || Number.isNaN(d.getTime())) return undefined;
    return Math.max(0, Math.round((Date.now() - d.getTime()) / DAY));
  }

  function parseCount(value) {
    if (!value) return undefined;
    const m = String(value).replace(/[, ]/g, "").match(/([\d.]+)\s*([万KkMm千]?)/);
    if (!m || m[1] === undefined) return undefined;
    const mult = { 万: 1e4, 千: 1e3, K: 1e3, k: 1e3, M: 1e6, m: 1e6 };
    return Math.round(Number.parseFloat(m[1]) * (mult[m[2] || ""] || 1));
  }

  function avatarInfo(scope) {
    const img = scope.querySelector?.('img[src*="profile_images/"]');
    return { hasDefaultAvatar: !img, avatarUrl: img && img.src };
  }

  function bannerUserId(scope) {
    const el = scope.querySelector?.('[src*="profile_banners/"], [style*="profile_banners/"]');
    const raw = el instanceof HTMLImageElement ? el.src : el?.getAttribute("style") || "";
    return numericId((raw.match(/profile_banners\/(\d+)\//) || [])[1]);
  }

  function snowflakeTimeMs(id) {
    if (!id || id.length < 16) return undefined;
    try {
      return Number((BigInt(id) >> 22n) + TWITTER_SNOWFLAKE_EPOCH_MS);
    } catch {
      return undefined;
    }
  }

  function numericString(v) {
    if (typeof v === "number" && Number.isSafeInteger(v)) return String(v);
    return numericId(v);
  }

  function profileJsonLdUserId(expectedHandle) {
    for (const script of document.querySelectorAll('script[type="application/ld+json"]')) {
      try {
        const data = JSON.parse(script.textContent || "null");
        const pages = Array.isArray(data) ? data : [data];
        for (const page of pages) {
          if (!page || typeof page !== "object" || page["@type"] !== "ProfilePage") continue;
          const e = page.mainEntity;
          if (!e || typeof e !== "object" || e["@type"] !== "Person") continue;
          const handle =
            normalizeHandle(typeof e.additionalName === "string" ? e.additionalName : undefined) ||
            normalizeHandle(typeof e.url === "string" ? (e.url.match(/\/([^/?#]+)(?:[?#].*)?$/) || [])[1] : undefined);
          if (expectedHandle && handle !== normalizeHandle(expectedHandle)) continue;
          const id = numericString(e.identifier);
          if (id) return id;
        }
      } catch {
        /* skip */
      }
    }
    return undefined;
  }

  function viewerHandle() {
    const profileHref = document
      .querySelector('[data-testid="AppTabBar_Profile_Link"]')
      ?.getAttribute("href");
    const fromHref = normalizeHandle((profileHref?.match(/^\/([^/?#]+)/) || [])[1]);
    if (fromHref && !NON_PROFILE.has(fromHref)) return fromHref;

    const switcherText =
      document.querySelector('[data-testid="SideNav_AccountSwitcher_Button"]')?.innerText || "";
    return normalizeHandle((switcherText.match(/@([A-Za-z0-9_]{1,15})/) || [])[1]);
  }

  function isViewerHandle(handle) {
    const viewer = viewerHandle();
    const target = normalizeHandle(handle);
    return viewer && target && viewer === target ? true : undefined;
  }

  function escapeRegExp(s) {
    return String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  function actionUserInfo(scope, handle) {
    const expected = normalizeHandle(handle);
    const mention = expected ? new RegExp(`@${escapeRegExp(expected)}\\b`, "i") : undefined;
    for (const el of scope.querySelectorAll?.('[data-testid$="-follow"], [data-testid$="-unfollow"], [data-testid$="-subscribe"]') || []) {
      const testid = el.getAttribute("data-testid") || "";
      const match = testid.match(/^(\d+)-(follow|unfollow|subscribe)$/);
      if (!match) continue;
      const label = `${el.getAttribute("aria-label") || ""}\n${el.innerText || ""}`;
      if (mention && !mention.test(label)) continue;
      return {
        userId: match[1],
        ...(match[2] === "unfollow" ? { viewerFollowing: true } : {}),
      };
    }
    if (mention) {
      for (const el of scope.querySelectorAll?.('button, [role="button"]') || []) {
        const label = `${el.getAttribute("aria-label") || ""}\n${el.innerText || ""}`;
        if (mention.test(label) && /(取消关注|正在关注|Following|Unfollow)/i.test(label)) {
          return { viewerFollowing: true };
        }
      }
    }
    return {};
  }

  const fiberCache = new WeakMap();

  function readFiberUser(el, handle) {
    const cacheKey = normalizeHandle(handle) || "";
    const hit = fiberCache.get(el)?.get(cacheKey);
    if (hit) return hit;
    const out = readFiberUserUncached(el, cacheKey || undefined);
    if (Object.keys(out).length) {
      const byHandle = fiberCache.get(el) || new Map();
      byHandle.set(cacheKey, out);
      fiberCache.set(el, byHandle);
    }
    return out;
  }

  function readFiberUserUncached(el, expectedHandle) {
    try {
      const fk = Object.keys(el).find((k) => k.startsWith("__reactFiber$"));
      if (!fk) return {};
      let node = el[fk];
      const seen = new Set();
      const budget = { n: 4000 };
      for (let i = 0; node && i < 24; i++) {
        for (const bag of [node.memoizedProps, node.memoizedState]) {
          const u = findFiberUser(bag, seen, 0, budget, expectedHandle);
          if (u) {
            const legacy = u.legacy || u;
            const created = legacy.created_at ? Date.parse(legacy.created_at) : NaN;
            const userId = fiberUserId(u, legacy);
            return {
              bio: typeof legacy.description === "string" ? legacy.description : "",
              ...(userId ? { userId } : {}),
              ...(typeof legacy.followers_count === "number" ? { followersCount: legacy.followers_count } : {}),
              ...(typeof legacy.friends_count === "number" ? { followingCount: legacy.friends_count } : {}),
              ...(Number.isNaN(created) ? {} : { accountCreatedAt: new Date(created).toISOString() }),
              ...(Number.isNaN(created) ? {} : { accountAgeDays: Math.max(0, Math.round((Date.now() - created) / DAY)) }),
              ...(trueFlag(legacy.following) ? { viewerFollowing: true } : {}),
              ...(trueFlag(legacy.blocking) ? { viewerBlocking: true } : {}),
              ...(trueFlag(legacy.muting) ? { viewerMuting: true } : {}),
              ...(trueFlag(legacy.follow_request_sent) ? { viewerFollowRequestSent: true } : {}),
            };
          }
        }
        node = node.return;
      }
    } catch {
      /* X internals changed */
    }
    return {};
  }

  function fiberUserId(u, legacy) {
    const fromLegacy = numericId(legacy?.id_str);
    const fromRest = numericId(u?.rest_id);
    if (fromLegacy && fromRest && fromLegacy !== fromRest) return undefined;
    const candidate = fromLegacy || fromRest;
    const avatarId = numericId((String(legacy?.profile_image_url_https || "").match(/profile_images\/(\d+)\//) || [])[1]);
    const candidateTime = candidate ? snowflakeTimeMs(candidate) : undefined;
    const created = typeof legacy?.created_at === "string" ? Date.parse(legacy.created_at) : NaN;
    if (
      candidate &&
      avatarId === candidate &&
      candidateTime !== undefined &&
      !Number.isNaN(created) &&
      Math.abs(candidateTime - created) > UID_CREATED_AT_TOLERANCE_MS
    ) {
      return undefined;
    }
    return candidate;
  }

  function findFiberUser(o, seen, depth, budget, expectedHandle) {
    if (!o || typeof o !== "object" || depth > 5 || seen.has(o)) return null;
    if (--budget.n <= 0) return null;
    if (o.nodeType || o === window || o === pageWindow) return null;
    seen.add(o);
    try {
      const legacy = o.legacy || o;
      if (
        o.__typename === "User" &&
        legacy &&
        typeof legacy === "object" &&
        typeof legacy.description === "string" &&
        ("followers_count" in legacy || "screen_name" in legacy)
      ) {
        const screenName = normalizeHandle(legacy.screen_name);
        if (!expectedHandle || screenName === expectedHandle) return o;
      }
      for (const k of Object.keys(o)) {
        const r = findFiberUser(o[k], seen, depth + 1, budget, expectedHandle);
        if (r) return r;
      }
    } catch {
      /* getter threw */
    }
    return null;
  }

  function extractProfile() {
    const seg = location.pathname.split("/").filter(Boolean);
    if (seg.length !== 1 || NON_PROFILE.has(seg[0] || "")) return null;
    const nameEl = document.querySelector('[data-testid="UserName"]');
    if (!nameEl) return null;

    const lines = nameEl.innerText.split("\n").map((s) => s.trim()).filter(Boolean);
    const handle = ((lines.find((s) => s.startsWith("@")) || `@${seg[0]}`).slice(1));
    const displayName = lines[0] && !lines[0].startsWith("@") ? lines[0] : "";
    const bioEl = document.querySelector('[data-testid="UserDescription"]');
    const joinEl = document.querySelector('[data-testid="UserJoinDate"]');
    let followers;
    let following;
    for (const a of document.querySelectorAll('a[href*="/follow"], a[href$="/verified_followers"]')) {
      const href = a.getAttribute("href") || "";
      const val = parseCount(a.innerText);
      if (/\/following$/.test(href)) following = val;
      else if (/(verified_)?followers$/.test(href)) followers = val;
    }
    const scope = document.querySelector('[data-testid="primaryColumn"]') || document;
    const av = avatarInfo(scope);
    const profileScope = scope instanceof Element ? scope : nameEl;
    const networkUser = readGraphqlUser(handle);
    const actionUser = actionUserInfo(profileScope, handle);
    const fu = {
      ...readFiberUser(profileScope, handle),
      ...networkUser,
      ...(actionUser.userId ? { userId: actionUser.userId } : {}),
      ...(actionUser.viewerFollowing ? { viewerFollowing: true } : {}),
      ...(isViewerHandle(handle) || profileScope.querySelector('[data-testid="editProfileButton"]') ? { viewerIsSelf: true } : {}),
    };
    const jsonLdUserId = profileJsonLdUserId(handle);
    const userId = jsonLdUserId || fu.userId || bannerUserId(scope);
    const parsedJoin = parseJoinDate(joinEl?.innerText);
    return {
      isProfile: true,
      handle,
      displayName,
      bio: bioEl ? bioEl.innerText.trim() : "",
      hasDefaultAvatar: av.hasDefaultAvatar,
      recentTweets: [],
      ...(av.avatarUrl ? { avatarUrl: av.avatarUrl } : {}),
      ...(userId ? { userId } : {}),
      ...(fu.viewerFollowing ? { viewerFollowing: true } : {}),
      ...(fu.viewerBlocking ? { viewerBlocking: true } : {}),
      ...(fu.viewerMuting ? { viewerMuting: true } : {}),
      ...(fu.viewerFollowRequestSent ? { viewerFollowRequestSent: true } : {}),
      ...(fu.viewerIsSelf ? { viewerIsSelf: true } : {}),
      ...(fu.accountCreatedAt ? { accountCreatedAt: fu.accountCreatedAt } : {}),
      ...(parsedJoin !== undefined ? { accountAgeDays: parsedJoin } : {}),
      ...(followers !== undefined ? { followersCount: followers } : {}),
      ...(following !== undefined ? { followingCount: following } : {}),
    };
  }

  function isPromoted(article) {
    if (article.querySelector('[data-testid="placementTracking"]')) return true;
    const tweetText = article.querySelector('[data-testid="tweetText"]');
    for (const el of article.querySelectorAll("span,div")) {
      if (tweetText?.contains(el)) continue;
      if (AD_LABEL.test(el.textContent?.trim() || "")) return true;
    }
    return false;
  }

  function extractFromArticle(article) {
    if (isPromoted(article)) return null;
    const av = avatarInfo(article);
    const nameBlock = article.querySelector('[data-testid="User-Name"]');
    if (!nameBlock) return null;
    let handle;
    let displayName = "";
    for (const a of nameBlock.querySelectorAll('a[href^="/"]')) {
      const s = (a.getAttribute("href") || "").split("/").filter(Boolean);
      if (s.length === 1 && /^[A-Za-z0-9_]{1,15}$/.test(s[0] || "")) handle = s[0];
    }
    const txt = nameBlock.innerText.split("\n").map((s) => s.trim()).filter(Boolean);
    if (txt.length) displayName = txt[0] || "";
    if (!handle) {
      const at = txt.find((s) => s.startsWith("@"));
      if (at) handle = at.slice(1);
    }
    if (!handle) return null;
    const tweetEl = article.querySelector('[data-testid="tweetText"]');
    const tweetText = tweetEl ? tweetEl.innerText.trim() : "";
    const networkUser = readGraphqlUser(handle);
    const fiberUser = readFiberUser(article, handle);
    const actionUser = actionUserInfo(article, handle);
    const fu = {
      ...fiberUser,
      ...networkUser,
      ...(!fiberUser.userId && !networkUser.userId && actionUser.userId ? { userId: actionUser.userId } : {}),
      ...(actionUser.viewerFollowing ? { viewerFollowing: true } : {}),
      ...(isViewerHandle(handle) ? { viewerIsSelf: true } : {}),
    };
    return {
      isProfile: false,
      handle,
      displayName: networkUser.displayName || displayName,
      bio: fu.bio || "",
      hasDefaultAvatar: av.hasDefaultAvatar,
      recentTweets: tweetText ? [tweetText] : [],
      ...(networkUser.avatarUrl || av.avatarUrl ? { avatarUrl: networkUser.avatarUrl || av.avatarUrl } : {}),
      ...(fu.userId ? { userId: fu.userId } : {}),
      ...(tweetText ? { triggeringComment: tweetText } : {}),
      ...(fu.accountCreatedAt ? { accountCreatedAt: fu.accountCreatedAt } : {}),
      ...(fu.accountAgeDays !== undefined ? { accountAgeDays: fu.accountAgeDays } : {}),
      ...(fu.followersCount !== undefined ? { followersCount: fu.followersCount } : {}),
      ...(fu.followingCount !== undefined ? { followingCount: fu.followingCount } : {}),
      ...(fu.viewerFollowing ? { viewerFollowing: true } : {}),
      ...(fu.viewerBlocking ? { viewerBlocking: true } : {}),
      ...(fu.viewerMuting ? { viewerMuting: true } : {}),
      ...(fu.viewerFollowRequestSent ? { viewerFollowRequestSent: true } : {}),
      ...(fu.viewerIsSelf ? { viewerIsSelf: true } : {}),
    };
  }

  function extractThreadTopic() {
    if (!/^\/[^/]+\/status\/\d+/.test(location.pathname)) return undefined;
    const first = document.querySelector('article[data-testid="tweet"] [data-testid="tweetText"]');
    const t = first?.innerText.trim();
    return t ? t.slice(0, 400) : undefined;
  }

  function heuristic(s) {
    let score = 0;
    const why = [];
    const blob = `${s.displayName} ${s.bio} ${(s.recentTweets || []).join(" ")}`;
    const t = s.recentTweets?.[0] || "";
    const INNUENDO_RE = /[骚涩约]|sao/i;
    const shapeMatch =
      !!t &&
      t.length < 80 &&
      HAS_CJK_RE.test(t) &&
      HAS_MENTION_RE.test(t) &&
      (EMOJI_RE.test(t) || INNUENDO_RE.test(t));
    if (shapeMatch) {
      score += 0.4;
      why.push("reasonReplyTemplate");
    }
    if (s.hasDefaultAvatar) {
      score += 0.35;
      why.push("reasonDefaultAvatar");
    }
    if (typeof s.accountAgeDays === "number") {
      if (s.accountAgeDays < 30) {
        score += 0.4;
        why.push("reasonNewAccount30");
      } else if (s.accountAgeDays < 90) {
        score += 0.25;
        why.push("reasonNewAccount90");
      } else if (s.accountAgeDays > 730 && !shapeMatch) {
        score -= 0.25;
        why.push("reasonOldAccount");
      }
    }
    if (typeof s.followersCount === "number" && s.followersCount <= 5) {
      score += 0.2;
      why.push("reasonNoFollowers");
    }
    if (PROMO_RE.test(blob)) {
      score += 0.35;
      why.push("reasonPromoText");
    }
    if (LINK_RE.test(blob)) {
      score += 0.2;
      why.push("reasonSuspiciousLink");
    }
    if (RANDOM_HANDLE_RE.test(s.handle)) {
      score += 0.15;
      why.push("reasonRandomHandle");
    }
    return { score: Math.max(0, Math.min(1, score)), why };
  }

  function blockApiOrigin() {
    return location.hostname.endsWith("twitter.com") ? "https://twitter.com" : "https://x.com";
  }

  function ct0() {
    return (document.cookie.match(/ct0=([^;]+)/) || [])[1] || "";
  }

  function storageNumber(key) {
    try {
      return Number(localStorage.getItem(key) || 0) || 0;
    } catch {
      return 0;
    }
  }

  function setStorageNumber(key, value) {
    try {
      localStorage.setItem(key, String(Math.max(0, Math.floor(value))));
    } catch {
      /* ignore */
    }
  }

  function readBlockRound() {
    try {
      const raw = JSON.parse(localStorage.getItem(LS_BLOCK_ROUND) || "{}");
      return {
        count: Math.max(0, Number(raw.count || 0) || 0),
        cooldownUntil: Math.max(0, Number(raw.cooldownUntil || 0) || 0),
      };
    } catch {
      return { count: 0, cooldownUntil: 0 };
    }
  }

  function writeBlockRound(round) {
    try {
      localStorage.setItem(
        LS_BLOCK_ROUND,
        JSON.stringify({
          count: Math.max(0, Number(round.count || 0) || 0),
          cooldownUntil: Math.max(0, Number(round.cooldownUntil || 0) || 0),
        }),
      );
    } catch {
      /* ignore */
    }
  }

  function nextBlockCooldown(count) {
    if (count > 0 && count % BLOCK_LONG_COOLDOWN_EVERY === 0) return BLOCK_LONG_COOLDOWN_MS;
    if (count > 0 && count % BLOCK_SHORT_COOLDOWN_EVERY === 0) return BLOCK_SHORT_COOLDOWN_MS;
    return 0;
  }

  function parseRetryAfterMs(value) {
    if (!value) return undefined;
    const seconds = Number(value);
    if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
    const at = Date.parse(value);
    return Number.isFinite(at) ? Math.max(0, at - Date.now()) : undefined;
  }

  function recordBlockBackoff(ms) {
    if (ms <= 0) return;
    const round = readBlockRound();
    writeBlockRound({ ...round, cooldownUntil: Math.max(round.cooldownUntil, Date.now() + ms) });
  }

  function recordBlockFailure(attempt) {
    if (attempt.status === 429) recordBlockBackoff(attempt.retryAfterMs || BLOCK_RATE_LIMIT_COOLDOWN_MS);
    else if (attempt.retryable) recordBlockBackoff(BLOCK_TRANSIENT_COOLDOWN_MS);
  }

  function retryDelayForAttempt(attempt, tries) {
    if (!attempt.retryable) return 0;
    if (attempt.status === 429) return Math.min(60_000, attempt.retryAfterMs || BLOCK_RATE_LIMIT_COOLDOWN_MS);
    return Math.min(12_000, 900 * 2 ** Math.max(0, tries - 1));
  }

  async function waitForBlockSlot() {
    while (true) {
      const round = readBlockRound();
      const cooldownRemaining = round.cooldownUntil - Date.now();
      if (cooldownRemaining > 0) {
        await sleep(Math.min(1000, cooldownRemaining));
        continue;
      }
      const lastAt = storageNumber(LS_LAST_BLOCK);
      const jitter = Math.floor(Math.random() * BLOCK_JITTER_MS);
      const remaining = lastAt + BLOCK_DELAY_MS + jitter - Date.now();
      if (remaining <= 0) break;
      await sleep(Math.min(1000, remaining));
    }
    setStorageNumber(LS_LAST_BLOCK, Date.now());
  }

  function recordBlockSuccess() {
    const round = readBlockRound();
    const count = round.count + 1;
    const cooldownMs = nextBlockCooldown(count);
    writeBlockRound({ count, cooldownUntil: cooldownMs ? Date.now() + cooldownMs : 0 });
  }

  async function withBlockLock(fn) {
    const locks = navigator.locks;
    return locks ? locks.request(BLOCK_LOCK_NAME, fn) : fn();
  }

  async function apiBlock(userId, handle) {
    try {
      const csrf = ct0();
      if (!csrf) return { ok: false, retryable: false };
      const screenName = displayHandle(handle);
      const body = new URLSearchParams();
      if (screenName) body.set("screen_name", screenName);
      else if (userId && /^\d+$/.test(userId)) body.set("user_id", userId);
      else return { ok: false, retryable: false };
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 15_000);
      const res = await fetch(`${blockApiOrigin()}/i/api/1.1/blocks/create.json`, {
        method: "POST",
        credentials: "include",
        signal: controller.signal,
        headers: {
          authorization: FALLBACK_X_BEARER,
          "x-csrf-token": csrf,
          "x-twitter-auth-type": "OAuth2Session",
          "x-twitter-active-user": "yes",
          "content-type": "application/x-www-form-urlencoded",
        },
        body: body.toString(),
      }).finally(() => clearTimeout(timer));
      const status = res.status;
      return {
        ok: res.ok,
        status,
        retryAfterMs: parseRetryAfterMs(res.headers.get("retry-after")),
        retryable: status === 408 || status === 425 || status === 429 || status >= 500,
      };
    } catch {
      return { ok: false, retryable: true };
    }
  }

  async function coordinatedApiBlock(userId, handle) {
    return withBlockLock(async () => {
      await waitForBlockSlot();
      const attempt = await apiBlock(userId, handle);
      if (attempt.ok) recordBlockSuccess();
      else recordBlockFailure(attempt);
      return attempt;
    });
  }

  function hideTweet(node) {
    const cell = node?.closest?.('[data-testid="cellInnerDiv"]') || node?.closest?.("article");
    if (cell instanceof HTMLElement) cell.style.display = "none";
  }

  const STYLE = `
    :host {
      all: initial;
      --mxga-bg: rgba(255,255,255,.88); --mxga-panel: rgba(255,255,255,.94);
      --mxga-border: rgba(96,112,128,.22); --mxga-border-strong: rgba(96,112,128,.34);
      --mxga-text: #17202a; --mxga-muted: #667789; --mxga-blue: #0a84ff; --mxga-red: #ff3b30;
      --mxga-warn: #b26a00; --mxga-green: #248a3d; --mxga-control: rgba(118,134,150,.12);
      --mxga-shadow: 0 18px 48px rgba(20,32,46,.18), 0 2px 8px rgba(20,32,46,.08);
    }
    * { box-sizing: border-box; font-family: system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif; }
    .mxga-bubble {
      position: fixed; right: 16px; top: 96px; z-index: 2147483000;
      color: var(--mxga-text); -webkit-font-smoothing: antialiased;
    }
    .mxga-bubble.br { top: auto; bottom: 96px; }
    .pill, .panel, .modal {
      background: var(--mxga-panel); border: 1px solid var(--mxga-border);
      box-shadow: var(--mxga-shadow); backdrop-filter: blur(18px) saturate(1.25); -webkit-backdrop-filter: blur(18px) saturate(1.25);
    }
    .pill {
      min-height: 34px; border-radius: 999px; padding: 6px 11px; display: inline-flex; align-items: center; gap: 8px;
      color: var(--mxga-text); cursor: pointer; user-select: none; font-size: 12px; font-weight: 760;
    }
    .pill.hit {
      background: rgba(255,255,255,.94);
      border-color: rgba(255,59,48,.26);
      box-shadow: 0 10px 28px rgba(255,59,48,.12), 0 2px 8px rgba(20,32,46,.08);
    }
    .dot { width: 8px; height: 8px; border-radius: 999px; background: var(--mxga-blue); box-shadow: 0 0 0 4px rgba(10,132,255,.13); }
    .dot.busy { animation: mxgaPulse 1.1s ease-in-out infinite; }
    .dot.danger { background: var(--mxga-red); box-shadow: 0 0 0 4px rgba(255,59,48,.15); }
    @keyframes mxgaPulse { 0%,100% { opacity:.55; transform: scale(.88); } 50% { opacity:1; transform: scale(1); } }
    .panel { width: 350px; max-width: calc(100vw - 24px); max-height: min(72vh, 620px); overflow: auto; margin-top: 8px; border-radius: 18px; padding: 12px; display: none; }
    .panel.open { display: block; }
    .head { display:flex; align-items:center; gap:8px; margin-bottom:10px; }
    .head b { font-size:13px; }
    .head .spacer { flex:1; }
    .iconbtn { border: 1px solid var(--mxga-border); background: var(--mxga-control); color: var(--mxga-text); border-radius: 10px; height: 30px; min-width: 30px; padding: 0 9px; cursor:pointer; }
    .stats { display:grid; grid-template-columns: repeat(4, 1fr); gap:6px; margin-bottom:10px; }
    .metric { border-radius: 10px; padding: 7px 5px; background: var(--mxga-control); text-align:center; min-width:0; }
    .metric b { display:block; color: var(--mxga-text); font-size:13px; }
    .metric span { color: var(--mxga-muted); font-size:10.5px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
    .row { display:flex; gap:8px; padding:8px 0; border-top:1px solid var(--mxga-border); align-items:flex-start; }
    .avatar { width:28px; height:28px; border-radius:999px; flex:none; object-fit:cover; background: rgba(148,163,184,.22); }
    .body { min-width:0; flex:1; }
    .name { color: var(--mxga-text); font-size:12px; font-weight:700; overflow:hidden; white-space:nowrap; text-overflow:ellipsis; }
    .meta { font-size:11px; margin-top:1px; }
    .snip { color: var(--mxga-muted); font-size:11px; margin-top:2px; overflow:hidden; white-space:nowrap; text-overflow:ellipsis; }
    .note { font-size:11px; margin-top:3px; }
    button.main, button.small {
      border:1px solid transparent; border-radius:10px; background: var(--mxga-blue); color:white; cursor:pointer; font-weight:760;
      box-shadow: 0 1px 0 rgba(255,255,255,.24) inset, 0 6px 14px rgba(10,132,255,.18);
    }
    button.main { width:100%; padding:9px 10px; margin-top:8px; font-size:13px; }
    button.small { padding:5px 8px; font-size:11px; white-space:nowrap; }
    button.main:disabled, button.small:disabled { opacity:.55; cursor:default; }
    button.secondary { background: var(--mxga-control); color: var(--mxga-text); border:1px solid var(--mxga-border); box-shadow:none; }
    button.warn { background: var(--mxga-warn); box-shadow: 0 6px 14px rgba(178,106,0,.16); }
    button.safe { background: var(--mxga-green); box-shadow: 0 6px 14px rgba(36,138,61,.16); }
    button.danger { background: var(--mxga-red); box-shadow: 0 6px 14px rgba(255,59,48,.18); }
    .links { display:flex; gap:12px; margin-top:10px; color: var(--mxga-muted); font-size:12px; }
    .link { cursor:pointer; }
    .link:hover { color: var(--mxga-text); }
    .empty { color: var(--mxga-muted); font-size:12px; line-height:1.55; padding:5px 0 8px; }
    .modal-backdrop { position:fixed; inset:0; display:grid; place-items:start end; padding:48px 14px 14px; z-index:2147483001; background: rgba(245,247,250,.42); pointer-events:auto; backdrop-filter: blur(8px); -webkit-backdrop-filter: blur(8px); }
    .modal { width:340px; max-width:calc(100vw - 28px); max-height:calc(100vh - 62px); overflow:auto; border-radius:20px; padding:16px; color:var(--mxga-text); }
    .modal .head b { font-size:18px; line-height:1.2; }
    .formrow { display:grid; grid-template-columns: minmax(0, 1fr) max-content; gap:12px; align-items:center; padding:12px 0; border-top:1px solid var(--mxga-border); }
    .formrow label { font-size:12px; font-weight:700; }
    .hint { color: var(--mxga-muted); font-size:11px; line-height:1.45; margin-top:2px; }
    .textinput { width:100%; border:1px solid var(--mxga-border); background:rgba(118,134,150,.08); color:var(--mxga-text); border-radius:12px; padding:9px 10px; font-size:12px; }
    .toggle { width:46px; height:26px; border-radius:999px; border:1px solid var(--mxga-border-strong); background:rgba(118,134,150,.16); position:relative; cursor:pointer; padding:0; box-shadow:none; }
    .toggle:after { content:""; position:absolute; top:3px; left:4px; width:18px; height:18px; border-radius:999px; background:#fff; box-shadow:0 1px 3px rgba(20,32,46,.24); transition:left .15s, background .15s; }
    .toggle.on { background: rgba(10,132,255,.18); border-color: var(--mxga-blue); }
    .toggle.on:after { left:22px; background:var(--mxga-blue); }
    .seg { display:flex; border:1px solid var(--mxga-border); border-radius:10px; overflow:hidden; background:var(--mxga-control); }
    .seg button { border:0; background:transparent; color:var(--mxga-text); padding:6px 10px; cursor:pointer; font-size:12px; min-width:44px; }
    .seg button.on { background:var(--mxga-blue); color:#fff; }
    .code { display:inline-block; padding:5px 8px; border-radius:7px; background:rgba(148,163,184,.16); font-family:ui-monospace,SFMono-Regular,Menlo,monospace; letter-spacing:.06em; }
    .badge-host { display:inline-flex; align-items:center; }
    .xss-badge {
      display:inline-flex; align-items:center; gap:4px; height:20px; min-width:20px; padding:0 6px; margin-left:5px;
      border-radius:999px; border:1px solid currentColor; color:#64748b; background:rgba(100,116,139,.12);
      font-size:11px; font-weight:800; line-height:1; cursor:pointer; vertical-align:middle; white-space:nowrap;
      font-family: system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;
    }
    .xss-badge.clean { color:#0ea5e9; background:rgba(14,165,233,.10); }
    .xss-badge.safe { color:#16a34a; background:rgba(22,163,74,.12); }
    .xss-badge.warn { color:#f59e0b; background:rgba(245,158,11,.12); }
    .xss-badge.danger { color:#ef4444; background:rgba(239,68,68,.13); }
    .xss-badge.blocking { color:#fff; border-color:#ef4444; background:#ef4444; animation:mxgaPulse 1.1s ease-in-out infinite; }
    .pop {
      position:fixed; z-index:2147483002; width:280px; padding:11px; border-radius:11px; color:var(--mxga-text);
      background:var(--mxga-panel); border:1px solid var(--mxga-border); box-shadow:var(--mxga-shadow);
      backdrop-filter: blur(18px) saturate(1.25); -webkit-backdrop-filter: blur(18px) saturate(1.25);
      font-family: system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;
    }
    .pop h4 { margin:0 0 6px; font-size:13px; }
    .pop ul { margin:6px 0; padding-left:17px; color:var(--mxga-muted); font-size:12px; line-height:1.45; }
    .acts { display:flex; flex-wrap:wrap; gap:7px; margin-top:9px; }
  `;

  let bubbleRoot = null;
  let bubbleShadow = null;
  let bubbleOpen = false;
  let settingsOpen = false;
  let settingsPollTimer = null;

  function iconText(kind) {
    if (kind === "ok") return "✓";
    if (kind === "x") return "×";
    if (kind === "gear") return "⚙";
    return "◆";
  }

  function ensureBubble() {
    if (bubbleRoot && bubbleRoot.isConnected) return;
    const host = document.createElement("mxga-safari-root");
    host.style.position = "fixed";
    host.style.zIndex = "2147483000";
    host.style.inset = "0";
    host.style.pointerEvents = "none";
    const shadow = host.attachShadow({ mode: "open" });
    const st = document.createElement("style");
    st.textContent = STYLE;
    shadow.appendChild(st);
    const app = document.createElement("div");
    app.className = `mxga-bubble ${getSettings().bubblePos === "br" ? "br" : ""}`;
    app.style.pointerEvents = "auto";
    shadow.appendChild(app);
    (document.documentElement || document.body).appendChild(host);
    bubbleRoot = host;
    bubbleShadow = shadow;
    renderBubble();
  }

  function updateBubbleVisibility() {
    if (!bubbleShadow) return;
    const app = bubbleShadow.querySelector(".mxga-bubble");
    if (!app) return;
    const settings = getSettings();
    app.className = `mxga-bubble ${settings.bubblePos === "br" ? "br" : ""}`;
    app.style.display = settings.bubble && settings.enabled ? "" : "none";
  }

  function renderBubble() {
    ensureBubble();
    const app = bubbleShadow.querySelector(".mxga-bubble");
    if (!app) return;
    const blocks = blockStats();
    const dangerous = findings.some((f) => ["spam", "porn_bot", "likely_spam"].includes(f.verdict.label));
    const title = !currentSettings.enabled
      ? t("off")
      : blocks.active + blocks.queued
        ? t("blockingProgress", { done: blocks.done, total: Math.max(1, findings.length) })
        : findings.length
          ? t("hits", { count: findings.length })
          : activeScans
            ? t("scanning", { count: activeScans })
            : scannedCount
              ? t("scanned", { count: scannedCount })
              : t("guard");
    app.innerHTML = `
      <button class="pill ${dangerous ? "hit" : ""}" data-toggle>
        <span class="dot ${activeScans || blocks.active + blocks.queued ? "busy" : ""} ${dangerous ? "danger" : ""}"></span>
        <span>${BRAND.acronym} · ${escHtml(title)}</span>
      </button>
      <div class="panel ${bubbleOpen ? "open" : ""}">
        ${renderPanelHtml()}
      </div>
    `;
    app.querySelector("[data-toggle]")?.addEventListener("click", () => {
      bubbleOpen = !bubbleOpen;
      renderBubble();
    });
    bindPanel(app);
    updateBubbleVisibility();
  }

  function blockStats() {
    const done = findings.filter((x) => x.blocked).length;
    const active = findings.filter((x) => x.blockActive && !x.blocked).length;
    const failed = findings.filter((x) => x.blockFailed && !x.blocked).length;
    const queued = findings.filter((x) => x.blockQueued && !x.blockActive && !x.blocked && !x.blockFailed).length;
    return { done, active, failed, queued };
  }

  function renderPanelHtml() {
    const stats = blockStats();
    if (!findings.length) {
      return `
        <div class="head"><b>${escHtml(t("enabledTitle", { brand: BRAND.acronym }))}</b><span class="spacer"></span><button class="iconbtn" data-settings>${iconText("gear")}</button></div>
        <div class="stats">
          <div class="metric"><b>${scannedCount}</b><span>${escHtml(t("metricScanned"))}</span></div>
          <div class="metric"><b>${activeScans}</b><span>${escHtml(t("metricAnalyzing"))}</span></div>
          <div class="metric"><b>${getMxgaStats().hitPublic}</b><span>${escHtml(t("metricPublic"))}</span></div>
          <div class="metric"><b>${getMxgaStats().blocked}</b><span>${escHtml(t("metricConfirmed"))}</span></div>
        </div>
        <div class="empty">${escHtml(t("emptyPanel"))}</div>
        <div class="links"><span class="link" data-refresh>${escHtml(t("refreshWhitelist"))}</span><span class="link" data-gov>${escHtml(t("governanceRules"))}</span></div>
      `;
    }

    const visible = [
      ...findings.filter((x) => !x.blocked && (x.blockActive || x.blockQueued)),
      ...findings.filter((x) => !x.blocked && !x.blockActive && !x.blockQueued),
      ...findings.filter((x) => x.blocked),
    ];
    const pendingSelectable = findings.filter((x) => !x.blocked && !x.blockQueued && !x.blockActive);
    return `
      <div class="head"><b>${escHtml(t("pageHitsTitle", { count: findings.length }))}</b><span class="spacer"></span><button class="iconbtn" data-settings>${iconText("gear")}</button><button class="iconbtn" data-close>${iconText("x")}</button></div>
      <div class="stats">
        <div class="metric"><b>${findings.length}</b><span>${escHtml(t("metricHits"))}</span></div>
        <div class="metric"><b>${stats.active}</b><span>${escHtml(t("metricActive"))}</span></div>
        <div class="metric"><b>${stats.queued}</b><span>${escHtml(t("metricQueued"))}</span></div>
        <div class="metric"><b>${stats.done}</b><span>${escHtml(t("metricBlocked"))}</span></div>
      </div>
      <div>
        ${visible.map((f) => renderFindingRow(f)).join("")}
      </div>
      <button class="main" data-block-all ${pendingSelectable.length ? "" : "disabled"}>${escHtml(t("blockAllPending", { count: pendingSelectable.length }))}</button>
      <div class="links"><span class="link" data-first>${escHtml(t("jumpFirst"))}</span><span class="link" data-clear>${escHtml(t("ignorePage"))}</span><span class="link" data-gov>${escHtml(t("governanceRules"))}</span></div>
    `;
  }

  function renderFindingRow(f) {
    const meta = labelMeta(f.verdict.label);
    const rowKeyValue = escHtml(f.userId || `h:${normalizeHandle(f.handle)}`);
    const avatar = f.avatarUrl ? `<img class="avatar" src="${escHtml(f.avatarUrl)}" alt="">` : `<span class="avatar"></span>`;
    const source = f.blockSource ? ` · ${sourceText(f.blockSource)}` : "";
    const note = f.blocked
      ? `<div class="note" style="color:var(--mxga-green)">${escHtml(t("blockedWithSource", { source }))}</div>`
      : f.blockActive
        ? `<div class="note" style="color:var(--mxga-red)">${escHtml(t("blockingWithSource", { source }))}</div>`
        : f.blockQueued
          ? `<div class="note" style="color:var(--mxga-blue)">${escHtml(t("queuedWithSource", { source }))}</div>`
          : f.blockFailed
            ? `<div class="note" style="color:var(--mxga-warn)">${escHtml(t("blockFailed"))}</div>`
            : "";
    return `
      <div class="row">
        ${avatar}
        <div class="body">
          <div class="name">${escHtml(f.displayName || `@${displayHandle(f.handle)}`)}</div>
          <div class="meta" style="color:${meta.color}">@${escHtml(displayHandle(f.handle))} · ${escHtml(labelText(f.verdict.label))} · ${(f.verdict.confidence * 100).toFixed(0)}%</div>
          ${f.snippet ? `<div class="snip">${escHtml(String(f.snippet).replace(/\s+/g, " ").slice(0, 80))}</div>` : ""}
          ${note}
        </div>
        <button class="small ${f.blocked ? "safe" : f.blockFailed ? "warn" : "danger"}" data-one="${rowKeyValue}" ${f.blocked || f.blockQueued || f.blockActive ? "disabled" : ""}>${escHtml(f.blocked ? t("blocked") : f.blockFailed ? t("retry") : t("block"))}</button>
      </div>
    `;
  }

  function sourceText(source) {
    return {
      manual: t("sourceManual"),
      block_all: t("sourceBatch"),
      list_hit: t("sourcePublicAuto"),
      cache_hit: t("sourceCacheAuto"),
    }[source] || source;
  }

  function bindPanel(app) {
    app.querySelector("[data-close]")?.addEventListener("click", () => {
      bubbleOpen = false;
      renderBubble();
    });
    app.querySelector("[data-settings]")?.addEventListener("click", openSettings);
    app.querySelector("[data-gov]")?.addEventListener("click", () => window.open(BRAND.governance, "_blank", "noopener"));
    app.querySelector("[data-refresh]")?.addEventListener("click", async () => {
      const el = app.querySelector("[data-refresh]");
      if (el) el.textContent = t("syncing");
      await refreshWhitelist(true);
      if (el) el.textContent = t("synced");
    });
    app.querySelector("[data-first]")?.addEventListener("click", () => {
      const first = findings[0];
      if (!first) return;
      anchorByKey.get(first.userId || `h:${normalizeHandle(first.handle)}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
    });
    app.querySelector("[data-clear]")?.addEventListener("click", () => {
      findings.length = 0;
      renderBubble();
    });
    app.querySelector("[data-block-all]")?.addEventListener("click", () => {
      const targets = findings.filter((x) => !x.blocked && !x.blockQueued && !x.blockActive);
      enqueueBlocks(
        targets.map((f) => ({
          key: f.userId || `h:${normalizeHandle(f.handle)}`,
          sig: signalFromFinding(f),
          verdict: f.verdict,
        })),
        "block_all",
      );
    });
    app.querySelectorAll("[data-one]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const id = btn.getAttribute("data-one");
        const f = findings.find((x) => (x.userId || `h:${normalizeHandle(x.handle)}`) === id);
        if (f) void blockAccount(f.userId || `h:${normalizeHandle(f.handle)}`, signalFromFinding(f));
      });
    });
  }

  function signalFromFinding(f) {
    return {
      isProfile: false,
      handle: f.handle,
      displayName: f.displayName || "",
      bio: "",
      hasDefaultAvatar: false,
      recentTweets: f.snippet ? [f.snippet] : [],
      ...(f.userId ? { userId: f.userId } : {}),
      ...(f.avatarUrl ? { avatarUrl: f.avatarUrl } : {}),
    };
  }

  function openSettings() {
    ensureBubble();
    settingsOpen = true;
    renderSettingsIfOpen();
  }

  function closeSettings() {
    settingsOpen = false;
    if (settingsPollTimer) clearInterval(settingsPollTimer);
    settingsPollTimer = null;
    bubbleShadow?.querySelector(".modal-backdrop")?.remove();
  }

  function renderSettingsIfOpen() {
    if (!settingsOpen || !bubbleShadow) return;
    let back = bubbleShadow.querySelector(".modal-backdrop");
    if (!back) {
      back = document.createElement("div");
      back.className = "modal-backdrop";
      back.style.pointerEvents = "auto";
      back.addEventListener("click", (ev) => {
        if (ev.target === back) closeSettings();
      });
      bubbleShadow.appendChild(back);
    }
    const s = getSettings();
    const ws = whitelistStatus();
    const login = getGhLogin();
    const local = getLocalStats();
    const mxga = getMxgaStats();
    const language = s.language === "zh-CN" || s.language === "en" ? s.language : "auto";
    back.innerHTML = `
      <div class="modal">
        <div class="head"><b>${escHtml(t("settingsTitle", { brand: BRAND.acronym }))}</b><span class="spacer"></span><button class="iconbtn" data-settings-close>${iconText("x")}</button></div>
        <div class="formrow">
          <div><label>${escHtml(t("language"))}</label><div class="hint">${escHtml(t("languageHint"))}</div></div>
          <div class="seg"><button data-lang="auto" class="${language === "auto" ? "on" : ""}">${escHtml(t("auto"))}</button><button data-lang="zh-CN" class="${language === "zh-CN" ? "on" : ""}">${escHtml(t("simplifiedChinese"))}</button><button data-lang="en" class="${language === "en" ? "on" : ""}">${escHtml(t("english"))}</button></div>
        </div>
        ${toggleRow("enabled", t("enabledDetection"), t("enabledDetectionHint"), s.enabled)}
        ${toggleRow("bubble", t("bubbleVisible"), t("bubbleVisibleHint"), s.bubble)}
        ${toggleRow("replyAuto", t("replyAuto"), t("replyAutoHint"), s.replyAuto)}
        ${toggleRow("autoExpandOnFinding", t("autoExpand"), t("autoExpandHint"), s.autoExpandOnFinding)}
        ${toggleRow("autoBlockListHits", t("autoBlockHits"), t("autoBlockHitsHint"), s.autoBlockListHits)}
        <div class="formrow">
          <div><label>${escHtml(t("bubblePosition"))}</label><div class="hint">${escHtml(t("bubblePositionHint"))}</div></div>
          <div class="seg"><button data-pos="tr" class="${s.bubblePos === "tr" ? "on" : ""}">${escHtml(t("topRight"))}</button><button data-pos="br" class="${s.bubblePos === "br" ? "on" : ""}">${escHtml(t("bottomRight"))}</button></div>
        </div>
        <div class="formrow" style="grid-template-columns:1fr">
          <div><label>${escHtml(t("edgeApi"))}</label><div class="hint">${escHtml(t("edgeApiHint", { url: BRAND.edgeBase }))}</div></div>
          <input class="textinput" data-edge-base value="${escHtml(s.edgeBase)}" placeholder="${escHtml(BRAND.edgeBase)}">
        </div>
        <div class="formrow">
          <div><label>${escHtml(t("githubLogin"))}</label><div class="hint">${login ? escHtml(t("githubCurrent", { login })) : escHtml(t("githubLoginHint"))}</div></div>
          <button class="small ${login ? "secondary" : ""}" data-gh>${escHtml(login ? t("logout") : t("login"))}</button>
        </div>
        <div class="formrow">
          <div><label>${escHtml(t("whitelistCache"))}</label><div class="hint">${escHtml(t("whitelistStatus", { count: ws.count, time: formatDateTime(ws.lastSyncedAt) }))}</div></div>
          <button class="small secondary" data-whitelist>${escHtml(t("refreshWhitelist"))}</button>
        </div>
        <div class="formrow">
          <div><label>${escHtml(t("localStats"))}</label><div class="hint">${escHtml(t("localStatsLine", { ai: mxga.scanned, public: mxga.hitPublic, confirmed: mxga.blocked, blocks: local.blocks }))}</div></div>
          <button class="small danger" data-clear-local>${escHtml(t("clear"))}</button>
        </div>
        <div class="links"><span class="link" data-open-repo>GitHub</span><span class="link" data-open-privacy>${escHtml(t("privacy"))}</span></div>
        <div class="hint" style="margin-top:12px">${escHtml(t("safariNote"))}</div>
      </div>
    `;
    bindSettings(back);
  }

  function toggleRow(key, label, hint, enabled) {
    return `
      <div class="formrow">
        <div><label>${escHtml(label)}</label><div class="hint">${escHtml(hint)}</div></div>
        <button class="toggle ${enabled ? "on" : ""}" data-toggle-setting="${escHtml(key)}" aria-label="${escHtml(label)}"></button>
      </div>
    `;
  }

  function bindSettings(root) {
    root.querySelector("[data-settings-close]")?.addEventListener("click", closeSettings);
    root.querySelectorAll("[data-toggle-setting]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const key = btn.getAttribute("data-toggle-setting");
        setSetting(key, !getSettings()[key]);
      });
    });
    root.querySelectorAll("[data-pos]").forEach((btn) => {
      btn.addEventListener("click", () => setSetting("bubblePos", btn.getAttribute("data-pos")));
    });
    root.querySelectorAll("[data-lang]").forEach((btn) => {
      btn.addEventListener("click", () => setSetting("language", btn.getAttribute("data-lang")));
    });
    const input = root.querySelector("[data-edge-base]");
    input?.addEventListener("change", () => setSetting("edgeBase", input.value.trim().replace(/\/+$/, "")));
    root.querySelector("[data-gh]")?.addEventListener("click", async () => {
      if (getGhLogin()) {
        clearGh();
        renderSettingsIfOpen();
      } else {
        await startGithubLogin(root.querySelector(".modal"));
      }
    });
    root.querySelector("[data-whitelist]")?.addEventListener("click", async (ev) => {
      ev.currentTarget.textContent = t("refreshing");
      await refreshWhitelist(true);
      renderSettingsIfOpen();
    });
    root.querySelector("[data-clear-local]")?.addEventListener("click", () => {
      if (!confirm(t("clearConfirm"))) return;
      gmClearAll();
      warmBlocklist();
      loadWhitelistOnce();
      currentSettings = getSettings();
      findings.length = 0;
      renderBubble();
      renderSettingsIfOpen();
    });
    root.querySelector("[data-open-repo]")?.addEventListener("click", () => window.open(BRAND.repo, "_blank", "noopener"));
    root.querySelector("[data-open-privacy]")?.addEventListener("click", () => window.open(BRAND.privacy, "_blank", "noopener"));
  }

  async function startGithubLogin(modal) {
    const start = await send({ type: "gh_start" });
    if (!start.ok) {
      alert(t("githubLoginStartFailed", { error: start.error || "unknown" }));
      return;
    }
    const data = start.data;
    modal.insertAdjacentHTML(
      "afterbegin",
      `<div class="formrow" style="grid-template-columns:1fr;margin-bottom:8px">
        <div><label>${escHtml(t("githubDeviceFlow"))}</label><div class="hint">${escHtml(t("githubDeviceHint", { code: "" }))}<span class="code">${escHtml(data.user_code)}</span></div></div>
        <button class="small" data-open-gh>${escHtml(t("openVerification"))}</button>
        <div class="hint" data-gh-status>${escHtml(t("waitingAuth"))}</div>
      </div>`,
    );
    modal.querySelector("[data-open-gh]")?.addEventListener("click", () => window.open(data.verification_uri, "_blank", "noopener"));
    window.open(data.verification_uri, "_blank", "noopener");
    const status = modal.querySelector("[data-gh-status]");
    if (settingsPollTimer) clearInterval(settingsPollTimer);
    settingsPollTimer = setInterval(async () => {
      const res = await send({ type: "gh_poll", deviceCode: data.device_code });
      if (res.ok && res.data?.login) {
        clearInterval(settingsPollTimer);
        settingsPollTimer = null;
        if (status) status.textContent = t("loggedInAs", { login: res.data.login });
        setTimeout(renderSettingsIfOpen, 700);
      } else if (status) {
        status.textContent = t("waitingAuthDetail", { detail: res.data?.pending || res.error || "" });
      }
    }, Math.max(5, data.interval || 5) * 1000);
  }

  function createPopoverHost() {
    let host = document.querySelector("mxga-safari-popovers");
    if (host) return host.shadowRoot;
    host = document.createElement("mxga-safari-popovers");
    host.style.position = "fixed";
    host.style.inset = "0";
    host.style.zIndex = "2147483002";
    host.style.pointerEvents = "none";
    const root = host.attachShadow({ mode: "open" });
    const st = document.createElement("style");
    st.textContent = STYLE;
    root.appendChild(st);
    (document.documentElement || document.body).appendChild(host);
    return root;
  }

  function mountBadge(anchor, build) {
    const host = document.createElement("span");
    host.className = "xss-mount";
    host.style.display = "inline-flex";
    host.style.alignItems = "center";
    host.style.verticalAlign = "middle";
    host.style.flex = "0 0 auto";
    const sr = host.attachShadow({ mode: "open" });
    const st = document.createElement("style");
    st.textContent = STYLE;
    sr.append(st, build());
    anchor.appendChild(host);
  }

  function clearMounts(anchor) {
    anchor.querySelectorAll(":scope > .xss-mount, :scope > .xss-pending").forEach((n) => n.remove());
  }

  function mountStatus(anchor, kind) {
    const cls = kind === "pending" ? "xss-pending" : "xss-mount";
    if (anchor.querySelector(`:scope > .${cls}`)) return;
    const host = document.createElement("span");
    host.className = cls;
    host.style.display = "inline-flex";
    host.style.alignItems = "center";
    host.style.verticalAlign = "middle";
    host.style.flex = "0 0 auto";
    const sr = host.attachShadow({ mode: "open" });
    const st = document.createElement("style");
    st.textContent = STYLE;
    const el = document.createElement("span");
    el.className = `xss-badge ${kind === "blocking" ? "blocking" : kind === "analyzing" ? "clean" : ""}`;
    el.textContent = kind === "blocking" ? t("statusBlocking") : kind === "analyzing" ? t("statusAnalyzing") : t("statusQueued");
    sr.append(st, el);
    anchor.appendChild(host);
  }

  function mountBlocking(anchor) {
    clearMounts(anchor);
    mountStatus(anchor, "blocking");
  }

  function createBadge(v, actions, note, source = "fresh") {
    const el = document.createElement("span");
    if (source === "whitelist") {
      el.className = "xss-badge safe";
      el.textContent = t("whitelist");
      return el;
    }
    if (!v) {
      el.className = "xss-badge clean";
      el.textContent = actions.canReport ? t("handle") : t("check");
      el.addEventListener("click", (ev) => showManualPopover(ev, el, actions));
      return el;
    }
    const meta = labelMeta(v.label);
    const spammy = ["spam", "porn_bot", "likely_spam"].includes(v.label);
    el.className = `xss-badge ${spammy ? "danger" : v.label === "legit" ? "safe" : "warn"}`;
    el.textContent = source === "list" ? t("badgePublic") : source === "cache" ? `${t("badgeCache")} ${labelShort(v.label)}` : labelShort(v.label);
    el.title = `${labelText(v.label)} ${(v.confidence * 100).toFixed(0)}%`;
    el.addEventListener("click", (ev) => showVerdictPopover(ev, el, v, actions, note, source));
    el.addEventListener("mouseenter", (ev) => showVerdictPopover(ev, el, v, actions, note, source, true));
    return el;
  }

  function placePop(pop, anchor, ev) {
    const point = ev instanceof MouseEvent ? { x: ev.clientX, y: ev.clientY } : (() => {
      const r = anchor.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.bottom };
    })();
    const pad = 8;
    const gap = 10;
    let left = point.x + gap;
    let top = point.y + gap;
    pop.style.left = `${Math.round(left)}px`;
    pop.style.top = `${Math.round(top)}px`;
    requestAnimationFrame(() => {
      const r = pop.getBoundingClientRect();
      left = point.x + gap;
      top = point.y + gap;
      if (left + r.width + pad > window.innerWidth) left = point.x - r.width - gap;
      if (top + r.height + pad > window.innerHeight) top = point.y - r.height - gap;
      pop.style.left = `${Math.round(Math.max(pad, Math.min(left, window.innerWidth - r.width - pad)))}px`;
      pop.style.top = `${Math.round(Math.max(pad, Math.min(top, window.innerHeight - r.height - pad)))}px`;
    });
  }

  function clearPopovers() {
    createPopoverHost().querySelectorAll(".pop").forEach((p) => p.remove());
  }

  function showManualPopover(ev, anchor, actions) {
    clearPopovers();
    const root = createPopoverHost();
    const pop = document.createElement("div");
    pop.className = "pop";
    pop.style.pointerEvents = "auto";
    pop.innerHTML = `
      <h4>${escHtml(t("manualTitle"))}</h4>
      <div class="hint">${escHtml(t("manualHint"))}</div>
      <div class="acts">
        <button class="small secondary" data-check>${escHtml(t("check"))}</button>
        ${actions.canReport ? `<button class="small warn" data-report>${escHtml(t("report"))}</button>` : ""}
        <button class="small" data-block>${escHtml(t("blockAndReport"))}</button>
      </div>`;
    root.appendChild(pop);
    placePop(pop, anchor, ev);
    pop.querySelector("[data-check]")?.addEventListener("click", () => {
      actions.onCheck?.();
      clearPopovers();
    });
    pop.querySelector("[data-report]")?.addEventListener("click", async (e) => {
      e.currentTarget.textContent = t("reporting");
      try {
        await actions.onReport();
        e.currentTarget.textContent = t("reported");
      } catch (err) {
        e.currentTarget.textContent = t("failed");
        e.currentTarget.title = err.message || String(err);
      }
    });
    pop.querySelector("[data-block]")?.addEventListener("click", () => {
      actions.onBlock();
      clearPopovers();
    });
    schedulePopoverDismiss(pop);
  }

  function showVerdictPopover(ev, anchor, v, actions, note, source, hover = false) {
    clearPopovers();
    const root = createPopoverHost();
    const meta = labelMeta(v.label);
    const spammy = ["spam", "porn_bot", "likely_spam"].includes(v.label);
    const pop = document.createElement("div");
    pop.className = "pop";
    pop.style.pointerEvents = "auto";
    const sourceLabel = source === "list" ? t("sourcePublicConfirmed") : source === "cache" ? t("sourceLocalCache") : t("sourceAiLive");
    pop.innerHTML = `
      <h4 style="color:${meta.color}">${escHtml(sourceLabel)} · ${escHtml(labelText(v.label))} ${(v.confidence * 100).toFixed(0)}%</h4>
      <ul>${(v.reasons || []).map((r) => `<li>${escHtml(reasonText(r))}</li>`).join("") || `<li>${escHtml(t("noDetailedReason"))}</li>`}</ul>
      ${note ? `<div class="hint">${escHtml(note)}</div>` : ""}
      <div class="acts">
        ${spammy ? `<button class="small" data-block>${escHtml(t("block"))}</button><button class="small secondary" data-hide>${escHtml(t("hide"))}</button>` : ""}
        ${actions.canReport ? `<button class="small warn" data-report>${escHtml(t("report"))}</button>` : ""}
        <button class="small secondary" data-appeal>${escHtml(t("appeal"))}</button>
      </div>`;
    root.appendChild(pop);
    placePop(pop, anchor, ev);
    pop.querySelector("[data-block]")?.addEventListener("click", () => {
      actions.onBlock();
      clearPopovers();
    });
    pop.querySelector("[data-hide]")?.addEventListener("click", () => {
      actions.onHide();
      clearPopovers();
    });
    pop.querySelector("[data-report]")?.addEventListener("click", async (e) => {
      e.currentTarget.textContent = t("reporting");
      try {
        await actions.onReport();
        e.currentTarget.textContent = t("reported");
      } catch (err) {
        e.currentTarget.textContent = t("failed");
        e.currentTarget.title = err.message || String(err);
      }
    });
    pop.querySelector("[data-appeal]")?.addEventListener("click", () => window.open(BRAND.appealNewIssue, "_blank", "noopener"));
    if (hover) schedulePopoverDismiss(pop);
  }

  function schedulePopoverDismiss(pop) {
    let timer = null;
    const schedule = () => {
      clearTimeout(timer);
      timer = setTimeout(() => pop.remove(), 400);
    };
    const cancel = () => clearTimeout(timer);
    pop.addEventListener("mouseenter", cancel);
    pop.addEventListener("mouseleave", schedule);
    setTimeout(schedule, 2500);
  }

  currentSettings = getSettings();
  let canReport = false;
  const inflight = new Map();
  const anchorByKey = new Map();
  const nodeKey = new WeakMap();
  const findings = [];
  let activeScans = 0;
  let scannedCount = 0;
  const TOK_CAP = 40;
  let tokens = TOK_CAP;
  setInterval(() => {
    tokens = Math.min(TOK_CAP, tokens + 1);
  }, 3000);

  function takeToken() {
    if (tokens > 0) {
      tokens--;
      return true;
    }
    return false;
  }

  function isReplyContext() {
    return /^\/[^/]+\/status\/\d+/.test(location.pathname);
  }

  function keyOf(s) {
    return s.userId || `h:${normalizeHandle(s.handle)}`;
  }

  const lookupResolvers = new Map();
  const lookupInflight = new Map();
  let lookupTimer;
  const LOOKUP_BATCH_DELAY_MS = 80;
  const LOOKUP_BATCH_MAX = 100;

  function scheduleLookupFlush() {
    if (lookupTimer) return;
    lookupTimer = setTimeout(() => {
      lookupTimer = undefined;
      void flushLookupBatch();
    }, LOOKUP_BATCH_DELAY_MS);
  }

  async function flushLookupBatch() {
    const batch = [...lookupResolvers.entries()].slice(0, LOOKUP_BATCH_MAX);
    if (!batch.length) return;
    for (const [id] of batch) lookupResolvers.delete(id);
    if (lookupResolvers.size) scheduleLookupFlush();
    const userIds = batch.map(([id]) => id);
    const resp = await send({ type: "lookup_batch", userIds });
    const hits = resp.ok ? resp.data?.hits || {} : {};
    for (const [id, resolve] of batch) resolve(hits[id] || null);
  }

  function lookupPublicHit(userId) {
    const existing = lookupInflight.get(userId);
    if (existing) return existing;
    const p = new Promise((resolve) => {
      lookupResolvers.set(userId, resolve);
      if (lookupResolvers.size >= LOOKUP_BATCH_MAX) {
        if (lookupTimer) clearTimeout(lookupTimer);
        lookupTimer = undefined;
        void flushLookupBatch();
      } else {
        scheduleLookupFlush();
      }
    });
    lookupInflight.set(userId, p);
    p.finally(() => lookupInflight.delete(userId));
    return p;
  }

  const scannedKeys = new Set();
  const ignoredKeys = new Set();
  const autoBlockingKeys = new Set();

  function tallyScan(key) {
    if (scannedKeys.has(key)) return;
    scannedKeys.add(key);
    scannedCount++;
    renderBubble();
  }

  function isViewerKnownIgnored(sig) {
    return sig.viewerIsSelf || sig.viewerFollowing || sig.viewerBlocking || sig.viewerMuting || sig.viewerFollowRequestSent;
  }

  function findFinding(sig) {
    return findings.find((x) =>
      sig.userId ? x.userId === sig.userId : normalizeHandle(x.handle) === normalizeHandle(sig.handle),
    );
  }

  function dropFinding(sig) {
    const id = sig.userId || normalizeHandle(sig.handle);
    const i = findings.findIndex((f) => (f.userId || normalizeHandle(f.handle)) === id);
    if (i >= 0) {
      findings.splice(i, 1);
      renderBubble();
    }
  }

  function pushFinding(sig, v, opts = {}) {
    if (!opts.allowAnyLabel && !["spam", "porn_bot", "likely_spam"].includes(v.label)) return null;
    let finding = findFinding(sig);
    const snippet = sig.triggeringComment || sig.recentTweets?.[0] || sig.bio;
    if (!finding) {
      finding = {
        handle: sig.handle,
        verdict: v,
        ...(sig.userId ? { userId: sig.userId } : {}),
        ...(sig.avatarUrl ? { avatarUrl: sig.avatarUrl } : {}),
        ...(sig.displayName ? { displayName: sig.displayName } : {}),
        ...(snippet ? { snippet } : {}),
      };
      findings.push(finding);
      if (currentSettings.autoExpandOnFinding) bubbleOpen = true;
    } else {
      finding.verdict = v;
      if (sig.userId && !finding.userId) finding.userId = sig.userId;
      if (sig.avatarUrl && !finding.avatarUrl) finding.avatarUrl = sig.avatarUrl;
      if (sig.displayName && !finding.displayName) finding.displayName = sig.displayName;
      if (snippet && !finding.snippet) finding.snippet = snippet;
    }
    if (opts.blockSource) finding.blockSource = opts.blockSource;
    if (opts.blockQueued !== undefined) finding.blockQueued = opts.blockQueued;
    if (opts.blockActive !== undefined) finding.blockActive = opts.blockActive;
    if (opts.blockFailed !== undefined) finding.blockFailed = opts.blockFailed;
    if (opts.blocked !== undefined) finding.blocked = opts.blocked;
    renderBubble();
    return finding;
  }

  async function reportAccount(sig) {
    const resp = await send({ type: "report_spam", signals: stripIsProfile(sig) });
    if (!resp.ok) throw new Error(resp.error || t("reportFailed"));
  }

  function stripIsProfile(sig) {
    const { isProfile, ...rest } = sig;
    return rest;
  }

  function badgeFor(anchor, key, sig, v, note, source = "fresh") {
    tallyScan(key);
    clearMounts(anchor);
    mountBadge(anchor, () =>
      createBadge(
        v,
        {
          onBlock: () => void blockAccount(key, sig),
          onHide: () => hideTweet(anchor),
          onReport: () => reportAccount(sig),
          onAppeal: () => window.open(BRAND.appealNewIssue, "_blank", "noopener"),
          onCheck: () => void classify(anchor, key, sig),
          canReport,
        },
        note,
        source,
      ),
    );
  }

  function renderCached(anchor, key, sig, c) {
    badgeFor(anchor, key, sig, c.verdict, undefined, "cache");
    pushFinding(sig, c.verdict);
  }

  function tryAutoBlock(key, sig, verdict, anchor, source) {
    if (!currentSettings.autoBlockListHits) return false;
    if (source === "cache_hit" && !["spam", "porn_bot", "likely_spam"].includes(verdict.label)) return false;
    autoBlockingKeys.add(key);
    tallyScan(key);
    enqueueBlocks([{ key, sig, verdict }], source);
    mountBlocking(anchor);
    return true;
  }

  async function classify(anchor, key, sig) {
    const running = inflight.get(key);
    if (running) return running;
    mountStatus(anchor, "analyzing");
    const p = (async () => {
      const resp = await send({ type: "classify", signals: stripIsProfile(sig) });
      if (!resp.ok || !resp.data) {
        badgeFor(anchor, key, sig, null, resp.error || t("classifyFailed"));
        return;
      }
      const { record, idResolved } = resp.data;
      badgeFor(anchor, key, sig, record.verdict, idResolved ? undefined : t("idFallback"), "fresh");
      pushFinding(sig, record.verdict);
      bumpStats({ detections: 1, label: record.verdict.label });
      cacheSet(key, {
        verdict: record.verdict,
        signalsHash: signalsHash(sig),
        model: record.model,
        ts: Date.now(),
        handle: sig.handle,
        ...(sig.displayName ? { displayName: sig.displayName } : {}),
        ...(sig.avatarUrl ? { avatarUrl: sig.avatarUrl } : {}),
      });
    })();
    inflight.set(key, p);
    try {
      await p;
    } finally {
      inflight.delete(key);
    }
  }

  async function process(sig, anchor) {
    if (!currentSettings.enabled) return;
    const key = keyOf(sig);
    anchorByKey.set(key, anchor);

    if (isViewerKnownIgnored(sig)) {
      ignoredKeys.add(key);
      clearMounts(anchor);
      dropFinding(sig);
      return;
    }

    if (isBlockedSync(key) || (sig.userId && isBlockedSync(sig.userId))) {
      hideTweet(anchor);
      return;
    }

    if (autoBlockingKeys.has(key)) {
      mountBlocking(anchor);
      return;
    }

    if (isWhitelisted(sig.handle, sig.userId)) {
      badgeFor(anchor, key, sig, null, undefined, "whitelist");
      return;
    }

    const cached = cacheGet(key);
    if (cached) {
      if (tryAutoBlock(key, sig, cached.verdict, anchor, "cache_hit")) return;
      const spammy = ["spam", "porn_bot", "likely_spam"].includes(cached.verdict.label);
      if (spammy || cached.signalsHash === signalsHash(sig)) {
        renderCached(anchor, key, sig, cached);
        bumpStats({ cacheHits: 1 });
        return;
      }
    }

    if (sig.userId) {
      const hit = await lookupPublicHit(sig.userId);
      if (hit) {
        const verdict = hit.verdict;
        if (tryAutoBlock(key, sig, verdict, anchor, "list_hit")) return;
        badgeFor(anchor, key, sig, verdict, undefined, "list");
        pushFinding(sig, verdict);
        return;
      }
    }

    if (inflight.has(key)) return;
    const h = heuristic(sig);
    const ageDays = sig.accountAgeDays;
    const isEstablished = typeof ageDays === "number" && ageDays > 730;
    if (isEstablished && h.score < 0.15) {
      badgeFor(anchor, key, sig, null);
      return;
    }
    const threshold = currentSettings.replyAuto && isReplyContext() ? 0.25 : AUTO_THRESHOLD;
    const wantAuto = h.score >= threshold;
    if (!wantAuto) {
      badgeFor(anchor, key, sig, null);
      return;
    }
    if (!takeToken()) {
      mountStatus(anchor, "pending");
      return;
    }
    activeScans++;
    renderBubble();
    void classify(anchor, key, sig).finally(() => {
      activeScans--;
      renderBubble();
    });
  }

  function scan() {
    if (!currentSettings.enabled) return;
    const p = extractProfile();
    if (p) {
      const el = document.querySelector('[data-testid="UserName"]');
      if (el) void process(p, el);
    }
    const topic = extractThreadTopic();
    for (const art of document.querySelectorAll('article[data-testid="tweet"]')) {
      const info = extractFromArticle(art);
      const nameBlock = art.querySelector('[data-testid="User-Name"]');
      if (!info || !nameBlock) continue;
      if (topic && !info.threadTopic) info.threadTopic = topic;
      const key = keyOf(info);
      const hasMount = !!nameBlock.querySelector(":scope > .xss-mount");
      if (nodeKey.get(art) === key) {
        if (ignoredKeys.has(key)) continue;
        if (hasMount && !isViewerKnownIgnored(info)) continue;
      }
      if (nodeKey.get(art) !== key) clearMounts(nameBlock);
      nodeKey.set(art, key);
      void process(info, nameBlock);
    }
  }

  let scanTimer;
  function scanSoon(delay = 600) {
    clearTimeout(scanTimer);
    scanTimer = setTimeout(scan, delay);
  }

  async function finalizeBlocked(key, sig, source = "manual") {
    addBlocked(key);
    if (sig.userId) addBlocked(sig.userId);
    const f = findFinding(sig);
    addBlockRecord({
      id: key,
      handle: sig.handle,
      source,
      ts: Date.now(),
      ...(sig.displayName ? { displayName: sig.displayName } : {}),
      ...(sig.avatarUrl ? { avatarUrl: sig.avatarUrl } : {}),
      ...(f?.verdict ? { verdict: f.verdict, reason: f.verdict.reasons?.[0] } : {}),
    });
    bumpStats({ blocks: 1 });
    hideTweet(anchorByKey.get(key) || null);
    if (source === "manual" || source === "block_all") {
      void send({ type: "confirm_spam", signals: stripIsProfile(sig) });
    }
    if (f) {
      f.blocked = true;
      f.blockQueued = false;
      f.blockActive = false;
      f.blockFailed = false;
      f.blockSource = source;
    }
    renderBubble();
  }

  async function blockAccount(key, sig) {
    const active = findFinding(sig);
    if (active) {
      active.blockQueued = false;
      active.blockActive = true;
      active.blockFailed = false;
      active.blockSource = "manual";
      renderBubble();
    }
    const attempt = await coordinatedApiBlock(sig.userId, sig.handle);
    if (attempt.ok) {
      await finalizeBlocked(key, sig);
      return true;
    }
    const f = findFinding(sig);
    if (f) {
      f.blockQueued = false;
      f.blockActive = false;
      f.blockFailed = true;
    }
    renderBubble();
    return false;
  }

  let queue = [];
  let draining = false;

  function persistQ() {
    gmSet(
      QUEUE_KEY,
      queue.map((q) => ({
        key: q.key,
        sig: q.sig,
        tries: q.tries,
        source: q.source,
        verdict: q.verdict,
      })),
    );
  }

  function restoreQueue() {
    const saved = gmGet(QUEUE_KEY, []) || [];
    if (saved.length) {
      queue = saved
        .filter((q) => q.key && q.sig)
        .map((q) => ({
          key: q.key,
          sig: q.sig,
          tries: q.tries || 0,
          source: q.source || "manual",
          ...(q.verdict ? { verdict: q.verdict } : {}),
        }));
      queue.forEach((q) => {
        if (q.verdict) {
          pushFinding(q.sig, q.verdict, {
            allowAnyLabel: q.source === "list_hit",
            blockQueued: true,
            blockActive: false,
            blockFailed: false,
            blockSource: q.source,
          });
        }
      });
      void drain();
    }
  }

  async function drain() {
    if (draining) return;
    draining = true;
    while (queue.length) {
      const it = queue[0];
      const activeFinding = findFinding(it.sig);
      if (activeFinding) {
        activeFinding.blockQueued = false;
        activeFinding.blockActive = true;
        activeFinding.blockFailed = false;
        activeFinding.blockSource = it.source;
        renderBubble();
      }
      const attempt = await coordinatedApiBlock(it.sig.userId, it.sig.handle).catch(() => ({ ok: false, retryable: true }));
      if (attempt.ok) {
        await finalizeBlocked(it.key, it.sig, it.source);
        queue.shift();
        persistQ();
        await sleep(BLOCK_SUCCESS_SETTLE_MS);
      } else {
        it.tries++;
        if (!attempt.retryable || it.tries >= 6) {
          const f = findFinding(it.sig);
          if (f) {
            f.blockQueued = false;
            f.blockActive = false;
            f.blockFailed = true;
          }
          queue.shift();
          renderBubble();
        } else {
          const f = findFinding(it.sig);
          if (f) {
            f.blockQueued = true;
            f.blockActive = false;
            f.blockFailed = false;
            renderBubble();
          }
          await sleep(retryDelayForAttempt(attempt, it.tries));
        }
        persistQ();
      }
    }
    draining = false;
    renderBubble();
  }

  function enqueueBlocks(items, source = "manual") {
    for (const x of items) {
      if (x.verdict) {
        pushFinding(x.sig, x.verdict, {
          allowAnyLabel: source === "list_hit",
          blockQueued: true,
          blockActive: false,
          blockFailed: false,
          blockSource: source,
        });
      }
      if (!queue.some((q) => q.key === x.key)) queue.push({ ...x, tries: 0, source });
    }
    persistQ();
    void drain();
  }

  function bootWhenReady() {
    if (!document.documentElement) {
      setTimeout(bootWhenReady, 20);
      return;
    }
    ensureBubble();
    warmBlocklist();
    loadWhitelistOnce();
    void refreshWhitelist(false);
    restoreQueue();
    void send({ type: "gh_status" }).then((r) => {
      canReport = !!r.ok && !!r.data?.login;
      document.querySelectorAll('[data-testid="User-Name"], [data-testid="UserName"]').forEach((el) => clearMounts(el));
      scanSoon(0);
    });
    window.addEventListener(GRAPHQL_EVENT, (ev) => {
      if (!(ev instanceof CustomEvent) || typeof ev.detail !== "string") return;
      try {
        const payload = JSON.parse(ev.detail);
        if (payload.users && ingestGraphqlUsers(payload.users)) scanSoon(0);
      } catch {
        /* ignore */
      }
    });
    new MutationObserver(() => scanSoon(600)).observe(document.documentElement, {
      childList: true,
      subtree: true,
    });
    setInterval(scan, 4000);
    scanSoon(0);
  }

  if (typeof GM_registerMenuCommand === "function") {
    GM_registerMenuCommand(t("menuSettings"), openSettings);
    GM_registerMenuCommand(t("menuToggle"), () => setSetting("enabled", !getSettings().enabled));
    GM_registerMenuCommand(t("menuRefreshWhitelist"), () => void refreshWhitelist(true));
  }

  bootWhenReady();
})();

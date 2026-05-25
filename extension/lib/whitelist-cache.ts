// L0a — local subscription to the public maintainer whitelist.
// Subscribes incrementally to `/v1/whitelist?since=<ts>` and keeps a hash
// set in chrome.storage.local. content.ts checks this BEFORE calling
// classify(), so whitelisted accounts cost zero Worker round-trips and
// zero LLM dollars even on cache miss.
//
// Why a separate file (not folded into cache.ts):
//   - This is admin-curated truth, not a per-account L2 cache row.
//   - The cache.ts TTL story (3d uncertain / 30d spam) doesn't fit here;
//     whitelist removal is a maintainer action, not a time event, so we
//     just refresh the whole set on the cadence below.
//   - Lookups are by handle AND by numeric uid (X changes handles).

import { BRAND } from "./brand";
import { getSettings } from "./settings";

const KEY = "mxga_whitelist_v1";
const REFRESH_MS = 6 * 3600_000; // 6h — matches the planned Worker cron cadence

interface Entry {
  /** Lowercase X handle (without @), authoritative when uid is absent. */
  h: string;
  /** Optional X numeric user id; survives handle changes. */
  u?: string;
}

interface State {
  /** Last `latestAt` we saw from the Worker; the next request's `since=`. */
  cursor: number;
  /** When we last completed any sync (success or empty result). */
  lastSyncedAt: number;
  /** All known whitelisted entries, normalized. */
  entries: Entry[];
}

const EMPTY: State = { cursor: 0, lastSyncedAt: 0, entries: [] };

async function read(): Promise<State> {
  try {
    const got = await chrome.storage.local.get(KEY);
    const s = got?.[KEY] as Partial<State> | undefined;
    if (!s) return { ...EMPTY };
    return {
      cursor: s.cursor ?? 0,
      lastSyncedAt: s.lastSyncedAt ?? 0,
      entries: Array.isArray(s.entries) ? s.entries.filter((e) => e && e.h) : [],
    };
  } catch {
    return { ...EMPTY };
  }
}

async function write(s: State): Promise<void> {
  try {
    await chrome.storage.local.set({ [KEY]: s });
  } catch {
    /* non-fatal */
  }
}

async function base(): Promise<string> {
  return (await getSettings()).edgeBase || BRAND.edgeBase;
}

/** Pull the next page of whitelist entries since the stored cursor.
 *  Returns whether we actually added anything (for telemetry / tests). */
export async function refreshWhitelist(force = false): Promise<{
  added: number;
  total: number;
}> {
  const state = await read();
  if (!force && Date.now() - state.lastSyncedAt < REFRESH_MS) {
    return { added: 0, total: state.entries.length };
  }
  let added = 0;
  // Paginate until we drain — server caps each page at 2000, so this is
  // bounded for any realistic whitelist size.
  let cursor = state.cursor;
  let merged = state.entries.slice();
  for (let i = 0; i < 20; i++) {
    let resp: Response;
    try {
      resp = await fetch(`${await base()}/v1/whitelist?since=${cursor}&limit=2000`);
    } catch {
      break; // network blip — try again next tick
    }
    if (!resp.ok) break;
    const j = (await resp.json().catch(() => null)) as {
      list?: { x_user_id?: string | null; handle: string; last_scored: number }[];
      latestAt?: number;
    } | null;
    const list = j?.list ?? [];
    if (!list.length) {
      cursor = j?.latestAt ?? cursor;
      break;
    }
    for (const r of list) {
      const h = r.handle.toLowerCase();
      const u = r.x_user_id ?? undefined;
      // Replace existing entry for this handle/uid (last write wins).
      const idx = merged.findIndex((e) => e.h === h || (u && e.u === u));
      if (idx >= 0) merged[idx] = { h, ...(u ? { u } : {}) };
      else {
        merged.push({ h, ...(u ? { u } : {}) });
        added++;
      }
    }
    cursor = j?.latestAt ?? list[list.length - 1].last_scored;
    if (list.length < 2000) break; // last page
  }
  const next: State = { cursor, lastSyncedAt: Date.now(), entries: merged };
  await write(next);
  return { added, total: merged.length };
}

/** Synchronous membership check. content.ts must call `loadWhitelistOnce()`
 *  at boot to populate the in-memory mirror used here. */
let mirror: Map<string, true> | null = null;
let mirrorUid: Map<string, true> | null = null;

export async function loadWhitelistOnce(): Promise<void> {
  if (mirror) return;
  const s = await read();
  mirror = new Map();
  mirrorUid = new Map();
  for (const e of s.entries) {
    mirror.set(e.h, true);
    if (e.u) mirrorUid.set(e.u, true);
  }
}

export function isWhitelisted(handle: string | undefined, xUserId?: string): boolean {
  if (!mirror) return false;
  if (xUserId && mirrorUid?.has(xUserId)) return true;
  if (!handle) return false;
  return mirror.has(handle.toLowerCase());
}

/** For the popup / options panel — show count & freshness. */
export async function whitelistStatus(): Promise<{ count: number; lastSyncedAt: number }> {
  const s = await read();
  return { count: s.entries.length, lastSyncedAt: s.lastSyncedAt };
}

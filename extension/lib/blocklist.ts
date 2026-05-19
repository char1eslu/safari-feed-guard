// Local persistent blocklist. Once the user blocks an account it is hidden
// on every page forever and never re-rendered / re-analyzed / re-requested
// (the strongest short-circuit + the user-confirm signal for the public DB).
const KEY = "xss:blocked";

let mem: Set<string> | null = null;

async function load(): Promise<Set<string>> {
  if (mem) return mem;
  try {
    const got = await chrome.storage.local.get(KEY);
    mem = new Set<string>((got[KEY] as string[]) ?? []);
  } catch {
    mem = new Set();
  }
  return mem;
}

export async function isBlocked(id: string): Promise<boolean> {
  return (await load()).has(id);
}

/** Synchronous check once the set is warm (after the first load()). */
export function isBlockedSync(id: string): boolean {
  return mem ? mem.has(id) : false;
}

export async function warm(): Promise<void> {
  await load();
}

export async function addBlocked(id: string): Promise<void> {
  const s = await load();
  if (s.has(id)) return;
  s.add(id);
  try {
    await chrome.storage.local.set({ [KEY]: [...s] });
  } catch {
    /* non-fatal */
  }
}

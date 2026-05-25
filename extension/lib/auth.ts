// Local auth storage. GitHub token gates the write endpoints.
// (Admin moderation is a separate web console, never in the extension.)
const K = { ghToken: "xss:ghToken", ghLogin: "xss:ghLogin" } as const;

async function get(k: string): Promise<string> {
  try {
    return ((await chrome.storage.local.get(k))[k] as string) ?? "";
  } catch {
    return "";
  }
}
async function set(k: string, v: string): Promise<void> {
  try {
    await chrome.storage.local.set({ [k]: v });
  } catch {
    /* non-fatal */
  }
}

// Public GitHub Device-Flow client id — NOT a secret (device flow has no
// client secret; this ships in every OAuth client by design). A build
// constant, never a user-facing setting.
//
export const GH_CLIENT_ID = "Ov23liP2AbdNePTyKUEA";

// When the compiled-in client_id changes (e.g. after an app migration), any
// previously stored token belongs to the OLD app and won't be accepted by
// the new app. Bind the token to the client_id under which it was issued;
// on read, if the stored id doesn't match, treat the user as logged out so
// the popup shows the GitHub login prompt again — instead of silently 401ing
// every classify call.
const K_CLIENT = "xss:ghClientId";

async function ghBoundClientId(): Promise<string> {
  return get(K_CLIENT);
}

export const getGhToken = async () => {
  if ((await ghBoundClientId()) !== GH_CLIENT_ID) return "";
  return get(K.ghToken);
};
export const getGhLogin = async () => {
  if ((await ghBoundClientId()) !== GH_CLIENT_ID) return "";
  return get(K.ghLogin);
};
export const setGh = async (token: string, login: string) => {
  await set(K.ghToken, token);
  await set(K.ghLogin, login);
  await set(K_CLIENT, GH_CLIENT_ID);
};
export const clearGh = async () => {
  await set(K.ghToken, "");
  await set(K.ghLogin, "");
  await set(K_CLIENT, "");
};

/** Clear all local extension data (privacy). */
export async function clearAllLocal(): Promise<void> {
  try {
    await chrome.storage.local.clear();
  } catch {
    /* non-fatal */
  }
}

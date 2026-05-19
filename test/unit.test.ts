import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";

const tmp = mkdtempSync(join(tmpdir(), "xss-"));
process.env.CURATION_DB_PATH = join(tmp, "records.jsonl");
after(() => rmSync(tmp, { recursive: true, force: true }));

// Imported after CURATION_DB_PATH is set so the store picks up the temp path.
const { signalsHash } = await import("../src/classify.ts");
const { appendRecord, latestByUserId } = await import("../src/store.ts");
const { AccountSignals } = await import("../src/schema.ts");

test("AccountSignals rejects a non-numeric userId (handle is not a key)", () => {
  assert.throws(() => AccountSignals.parse({ userId: "amy_x99", handle: "amy_x99" }));
  const ok = AccountSignals.parse({ userId: "123", handle: "amy" });
  assert.equal(ok.recentTweets.length, 0);
});

test("signalsHash is stable and ignores userId", () => {
  const a = AccountSignals.parse({ userId: "1", handle: "h", bio: "x", recentTweets: ["t"] });
  const b = AccountSignals.parse({ userId: "999", handle: "h", bio: "x", recentTweets: ["t"] });
  assert.equal(signalsHash(a), signalsHash(b));
  const c = AccountSignals.parse({ userId: "1", handle: "h", bio: "y", recentTweets: ["t"] });
  assert.notEqual(signalsHash(a), signalsHash(c));
});

test("store append/read roundtrip, last write wins per userId", () => {
  const base = {
    userId: "42",
    handle: "h",
    signalsHash: "abc",
    model: "test",
    reviewStatus: "auto_pending_review" as const,
  };
  appendRecord({
    ...base,
    verdict: { label: "uncertain", confidence: 0.3, reasons: ["thin"] },
    createdAt: "2026-01-01T00:00:00.000Z",
  });
  appendRecord({
    ...base,
    verdict: { label: "spam", confidence: 0.9, reasons: ["link spam"] },
    createdAt: "2026-01-02T00:00:00.000Z",
  });
  const latest = latestByUserId().get("42");
  assert.equal(latest?.verdict.label, "spam");
  assert.equal(latest?.reviewStatus, "auto_pending_review");
});

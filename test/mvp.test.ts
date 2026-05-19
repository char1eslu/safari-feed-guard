import assert from "node:assert/strict";
import { test } from "node:test";
import { adaptMvpSignals } from "../src/mvp.ts";

test("numeric userId from the avatar is kept and marked resolved", () => {
  const { signals, idResolved } = adaptMvpSignals({
    userId: "2053244804520427520",
    handle: "elonmusk",
    displayName: "Elon Musk",
  });
  assert.equal(idResolved, true);
  assert.equal(signals.userId, "2053244804520427520");
});

test("handle-only gets a deterministic numeric placeholder, idResolved=false", () => {
  const a = adaptMvpSignals({ handle: "randomguy" });
  const b = adaptMvpSignals({ handle: "randomguy" });
  assert.equal(a.idResolved, false);
  assert.match(a.signals.userId, /^\d+$/); // strict schema still satisfied
  assert.equal(a.signals.userId, b.signals.userId); // deterministic
  assert.notEqual(adaptMvpSignals({ handle: "someoneelse" }).signals.userId, a.signals.userId);
});

test("rejects an empty handle", () => {
  assert.throws(() => adaptMvpSignals({ handle: "" }));
});

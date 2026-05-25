import { z } from "zod";
import { AccountSignals } from "./schema.ts";

/**
 * MVP signal shape sent by the browser extension.
 *
 * Production extension signals include the X **numeric user id** only when it
 * was resolved from X's rendered user data. Avatar image URLs are not a user-id
 * source: their `profile_images/<number>` segment identifies the image asset,
 * not the account. If the id can't be resolved, this legacy local MVP adapter
 * still marks `idResolved: false` so callers can treat the record as
 * handle-only.
 */
export const MvpSignals = z.object({
  userId: z.string().regex(/^\d+$/).optional(),
  handle: z.string().min(1),
  displayName: z.string().default(""),
  bio: z.string().default(""),
  recentTweets: z.array(z.string()).max(20).default([]),
  triggeringComment: z.string().optional(),
  threadTopic: z.string().optional(),
  accountAgeDays: z.number().int().nonnegative().optional(),
  followersCount: z.number().int().nonnegative().optional(),
  followingCount: z.number().int().nonnegative().optional(),
  hasDefaultAvatar: z.boolean().optional(),
});
export type MvpSignals = z.infer<typeof MvpSignals>;

export interface AdaptedSignals {
  signals: AccountSignals;
  idResolved: boolean;
}

/**
 * Adapt loose extension signals into the strict AccountSignals the classifier
 * needs. When the numeric id is missing we synthesize a stable non-numeric-safe
 * placeholder so the strict regex still holds, and flag idResolved=false.
 */
export function adaptMvpSignals(input: unknown): AdaptedSignals {
  const m = MvpSignals.parse(input);
  const idResolved = m.userId !== undefined;
  // Strict schema requires a numeric-looking id; for handle-only records we
  // derive a deterministic numeric placeholder from the handle.
  const userId =
    m.userId ?? `0${Array.from(m.handle).reduce((a, c) => (a * 31 + c.charCodeAt(0)) % 1e15, 7)}`;
  const opt: Record<string, unknown> = {};
  if (m.triggeringComment) opt.triggeringComment = m.triggeringComment;
  if (m.threadTopic) opt.threadTopic = m.threadTopic;
  if (m.accountAgeDays !== undefined) opt.accountAgeDays = m.accountAgeDays;
  if (m.followersCount !== undefined) opt.followersCount = m.followersCount;
  if (m.followingCount !== undefined) opt.followingCount = m.followingCount;
  if (m.hasDefaultAvatar !== undefined) opt.hasDefaultAvatar = m.hasDefaultAvatar;
  const signals = AccountSignals.parse({
    userId,
    handle: m.handle,
    displayName: m.displayName,
    bio: m.bio,
    recentTweets: m.recentTweets,
    ...opt,
  });
  return { signals, idResolved };
}

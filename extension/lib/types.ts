export type Label = "spam" | "porn_bot" | "likely_spam" | "uncertain" | "legit";

export interface Verdict {
  label: Label;
  confidence: number;
  reasons: string[];
}

export interface CurationRecord {
  userId: string;
  handle: string;
  verdict: Verdict;
  reviewStatus: string;
  model: string;
}

/** Signals scraped passively from the rendered DOM. */
export interface Signals {
  isProfile: boolean;
  userId?: string;
  handle: string;
  displayName: string;
  bio: string;
  hasDefaultAvatar: boolean;
  avatarUrl?: string;
  recentTweets: string[];
  triggeringComment?: string;
  threadTopic?: string;
  accountAgeDays?: number;
  followersCount?: number;
  followingCount?: number;
}

export type BgRequest =
  | { type: "health" }
  | { type: "records" }
  | { type: "lookup"; userId: string }
  | { type: "classify"; signals: Omit<Signals, "isProfile"> }
  | { type: "confirm_spam"; signals: Omit<Signals, "isProfile"> };

export interface BgResponse {
  ok: boolean;
  data?: unknown;
  error?: string;
}

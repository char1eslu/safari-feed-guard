import { appendFileSync, mkdirSync, readFileSync } from "node:fs";
import { dirname } from "node:path";
import { type CurationRecord, CurationRecord as CurationRecordSchema } from "./schema.ts";

/**
 * Append-only JSONL local curation store — the private source of truth.
 * Never published as-is; a later track applies the human-review gate before
 * anything reaches the public sharded list.
 */
const DB_PATH = process.env.CURATION_DB_PATH ?? ".curation-db/records.jsonl";

export function readAll(): CurationRecord[] {
  let raw: string;
  try {
    raw = readFileSync(DB_PATH, "utf8");
  } catch {
    return [];
  }
  const out: CurationRecord[] = [];
  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    out.push(CurationRecordSchema.parse(JSON.parse(line)));
  }
  return out;
}

/** Latest record per userId (last write wins). */
export function latestByUserId(): Map<string, CurationRecord> {
  const m = new Map<string, CurationRecord>();
  for (const r of readAll()) m.set(r.userId, r);
  return m;
}

export function appendRecord(record: CurationRecord): void {
  CurationRecordSchema.parse(record);
  mkdirSync(dirname(DB_PATH), { recursive: true });
  appendFileSync(DB_PATH, `${JSON.stringify(record)}\n`, "utf8");
}

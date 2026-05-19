# Governance

x-spam-sentinel publishes a list that effectively **accuses real accounts**
of being spam/abuse bots. That power is dangerous if misused. These rules are
non-negotiable and bind the code, the service, and the published data. The
final, detailed policy is owned by track T1 (LUO-16); this is the contract it
must satisfy.

## Scope

- In scope: **commercial spam and pornographic-advertising bots only**.
- Out of scope, never judged: viewpoints, politics, religion, opinions,
  language, nationality, or who a person is.

## No auto-publication

- An AI verdict is **never** automatically public.
- A crowdsourced report is a **prioritization signal, not a verdict**.
- Only entries that pass a **human-review gate** with sufficient confidence
  are eligible for the public list.

## Appeal & removal

- Anyone can appeal a listing (see the appeal issue template, or
  `POST /v1/appeal`).
- Appeals are reviewed by a human. An upheld appeal **removes** the entry,
  which disappears from the next published version with an **auditable diff**.
- Removal must be at least as fast and easy as listing.

## Data minimization & privacy

- The public list stores only the **public X numeric user id** plus minimal
  evidence needed to justify the verdict (verdict, confidence, model version,
  reasons, timestamp).
- **No PII** beyond the public identifier. Reporter identities are never
  stored — only a salted, hashed fingerprint for anti-abuse.
- Page context in reports is reduced to a path; no query strings, no content
  beyond the reported account's own public signals.

## Abuse resistance

- Mass-reporting to defame is an explicit threat. Reports never auto-publish;
  rate-limited and deduped; the LLM + human gate is the sole authority.

## Transparency

- The public data repo is versioned and forkable; every publication carries
  a version tag, generation time, count, and source commit.
- Removals are logged. Methodology and scope are public.

## Accountability

- Maintainers must keep the human-review gate functioning. If review capacity
  cannot keep up, slow publication — never bypass the gate.

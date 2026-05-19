# Security & privacy policy

## Reporting a vulnerability

Do **not** open a public issue for security or privacy problems. Email the
maintainers (see the repo's organization profile) with:

- a description and impact,
- reproduction steps,
- affected component (extension / central service / data repo).

We aim to acknowledge within a few days and to coordinate disclosure.

## In scope

- Extension exfiltrating data, exceeding passive read, or acting on the
  user's X account without an explicit user gesture.
- Central service: report-flooding / defamation amplification, auth bypass on
  admin/review endpoints, PII leakage.
- Public data repo: integrity of the published list, unauthorized entries.

## Privacy commitments

- No PII beyond the public X numeric id is stored or published.
- Reporter identity is never stored — only a salted, hashed fingerprint for
  anti-abuse.
- The extension is strictly passive and makes no extra requests to X.

See [GOVERNANCE.md](./GOVERNANCE.md) for the full data-handling contract.

# SECURITY-NPM-AUDIT — St0r/agent

**Date:** 2026-06-08
**Trigger:** npm Shai-Hulud / Mini Shai-Hulud supply-chain incident defensive sweep
**Package manager:** npm 10.9.4 (lockfile-only mode, scripts disabled throughout)

## Files inspected

- `agent/package.json`
- `agent/package-lock.json` — **was missing at audit start; generated during this audit**

No `.npmrc` / `.yarnrc`. No `node_modules`.

## Lifecycle scripts found

None in `package.json` (only `start`, `dev`, `build`). No transitive `hasInstallScript` packages in the newly-generated lockfile.

## Supply-chain indicator scan

| Indicator | Result |
|---|---|
| `@tanstack/*`, `@antv/*`, `@redhat-cloud-services/*`, `@mistralai/*`, `@bitwarden/cli`, `plain-crypto-js` | none |
| `axios@1.14.1` / `axios@0.30.4` | none |
| Non-default registry / git / tarball resolutions | none |

**No obvious supply-chain compromise indicators found.**

## Pre-audit state warning

`agent/` had a `package.json` (declaring 2 direct deps + 4 devDeps) but **no `package-lock.json`** — meaning any prior install would have pulled "latest matching" versions from npm at install time, without integrity verification. This is exactly the attack window the current Shai-Hulud campaign exploits. Audit generated a clean lockfile via:

```
npm install --package-lock-only --ignore-scripts
```

which resolves and writes `package-lock.json` without touching `node_modules` or running any install scripts.

## Advisories

| | Before | After |
|---|---|---|
| total | 0 (n/a — no lockfile) | **0** |

Newly generated lockfile audits clean.

## Files changed in this audit

- `agent/package-lock.json` — **new file** (created via `npm install --package-lock-only --ignore-scripts`)
- `agent/npm-audit.before.json` — audit on freshly-generated lockfile
- `agent/npm-audit.after.json` — same (no fixes needed)
- `agent/SECURITY-NPM-AUDIT.md` — this file

## Builds / tests skipped

No build/test/install execution. A clean install + smoke test in CI with `--ignore-scripts` is recommended to confirm the new lockfile resolves correctly in the real install path.

## Manual follow-ups

1. **Commit the lockfile.** Going forward, all installs in CI should use `npm ci` (lockfile-strict mode), not `npm install`, so dependency drift can't reintroduce the integrity gap.

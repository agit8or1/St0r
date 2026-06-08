# SECURITY-NPM-AUDIT — St0r/frontend

**Date:** 2026-06-08
**Trigger:** npm Shai-Hulud / Mini Shai-Hulud supply-chain incident defensive sweep
**Package manager:** npm 10.9.4 (lockfile-only mode, scripts disabled throughout)

## Files inspected

- `frontend/package.json`
- `frontend/package-lock.json`

No `.npmrc` / `.yarnrc`. No `node_modules` committed.

## Lifecycle scripts found

None in `package.json` (only `dev`, `build`, `preview`, `lint`). Lockfile-level `hasInstallScript: true` on **2** transitive packages, both legitimate:
- `esbuild` @ 0.27.3
- `fsevents` @ 2.3.3

## Supply-chain indicator scan

| Indicator | Result |
|---|---|
| `@tanstack/*`, `@antv/*`, `@redhat-cloud-services/*`, `@mistralai/*`, `@bitwarden/cli`, `plain-crypto-js` | none |
| `axios@1.14.1` / `axios@0.30.4` | none (declared `^1.6.2`, resolved 1.16.1) |
| Non-default registry / git / tarball resolutions | none |

**No obvious supply-chain compromise indicators found.**

## Advisories

| | Before | After |
|---|---|---|
| critical / high | 0 | 0 |
| moderate | 2 (`react-router`, `react-router-dom`) | **0** |
| **total** | **2** | **0** |

`npm audit fix --package-lock-only --ignore-scripts` resolved both in-range.

## Files changed in this audit

- `frontend/package-lock.json` — refreshed
- `frontend/npm-audit.before.json` — pre-fix snapshot
- `frontend/npm-audit.after.json` — post-fix snapshot (clean)
- `frontend/SECURITY-NPM-AUDIT.md` — this file

## Builds / tests skipped

No build/test/install execution.

## Manual follow-ups

None outstanding.

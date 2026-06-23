# SECURITY-NPM-AUDIT — St0r/backend

**Date:** 2026-06-08
**Trigger:** npm Shai-Hulud / Mini Shai-Hulud supply-chain incident defensive sweep
**Package manager:** npm 10.9.4 (lockfile-only mode, scripts disabled throughout)

## Files inspected

- `backend/package.json`
- `backend/package-lock.json`

No `.npmrc` / `.yarnrc`. No `node_modules` committed.

## Lifecycle scripts found

None in `package.json` (only `start`, `dev`, `build`, `lint`, `test`). Lockfile-level `hasInstallScript: true` on **6** transitive packages — all legitimate native-compile packages:
- `bcrypt` @ 6.0.0 (native crypto bindings)
- `cpu-features` @ 0.0.10 (native CPU detection)
- `esbuild` @ 0.25.12 (build tool)
- `fsevents` @ 2.3.3 (macOS file watcher)
- `sqlite3` @ 6.0.1 (native bindings)
- `ssh2` @ 1.17.0 (native crypto helpers)

No anomalous install-script packages.

## Supply-chain indicator scan

| Indicator | Result |
|---|---|
| `@tanstack/*`, `@antv/*`, `@redhat-cloud-services/*`, `@mistralai/*`, `@bitwarden/cli`, `plain-crypto-js` | none |
| `axios@1.14.1` / `axios@0.30.4` | none (declared `^1.13.1`, resolved 1.16.1) |
| Non-default registry / git / tarball resolutions | none — all sha512 from `registry.npmjs.org` |

**No obvious supply-chain compromise indicators found.**

## Advisories

| | Before | After |
|---|---|---|
| critical / high | 0 | 0 |
| moderate | 3 (`qs`, `body-parser`, `express` — all via `qs`) | **0** |
| **total** | **3** | **0** |

`npm audit fix --package-lock-only --ignore-scripts` resolved all 3 in-range.

## Files changed in this audit

- `backend/package-lock.json` — refreshed
- `backend/npm-audit.before.json` — pre-fix snapshot
- `backend/npm-audit.after.json` — post-fix snapshot (clean)
- `backend/SECURITY-NPM-AUDIT.md` — this file

## Builds / tests skipped

No build/test/install execution. Native-binding packages (`bcrypt`, `sqlite3`, `ssh2`) will need a clean install in CI to recompile against the deploy environment.

## Manual follow-ups

None outstanding.

# GitHub repository settings

Proposed values for the repository's **About** panel. These are settings in the GitHub web UI, not files —
apply them at <https://github.com/agit8or1/St0r> → ⚙️ next to *About*.

Verified on 2026-09-15.

---

## Description

Current:

> St0r is a addon web gui for Urbackup Server | Project managed by MIA the GSD 🐾

Proposed (338 characters is the GitHub limit; this is 118):

```
A modern management interface for UrBackup — endpoint status, schedules and retention, file recovery, and offsite replication.
```

Why change it: the current text has two small grammar slips (“a addon”, “Urbackup”), and the search-facing
description is a good place to say what the tool does rather than who maintains it. The Mia credit is kept
in the README instead.

---

## Website

**Current setting is broken.** The repository's homepage is `https://st0r.mspreboot.com`, which has no DNS
record and does not resolve.

| URL | Result |
|---|---|
| `https://st0r.mspreboot.com` | ❌ does not resolve (no DNS record) |
| `https://agit8or.net/projects/stor.html` | ✅ HTTP 200 |
| `https://mspreboot.com` | ✅ HTTP 200 |

Proposed:

```
https://agit8or.net/projects/stor.html
```

That is the project page and it responds. If `st0r.mspreboot.com` is meant to be the canonical home, the
DNS record needs creating first — until then the About panel links visitors to a dead host.

---

## Topics

The repository already carries a good set. Verified present:

`backup` · `backup-management` · `dashboard` · `disaster-recovery` · `linux` · `nodejs` · `react` ·
`replication` · `self-hosted` · `typescript` · `urbackup` · `web-ui`

All five topics that matter most for discovery are already there — `urbackup`, `backup`, `self-hosted`,
`backup-management`, `replication`. **No change required.**

Optional additions, each accurate for this project:

| Topic | Justification |
|---|---|
| `sysadmin` | The audience is server administrators |
| `msp` | Customer grouping and customer-scoped read-only accounts are built for managed service providers |
| `mariadb` | St0r's own datastore |

---

## Other repository settings

| Setting | Current | Suggested |
|---|---|---|
| License | **None detected by GitHub** | See below |
| Issues | Enabled | Keep |
| Releases | 30 published, latest `v3.2.104` | See below |

### License

`backend/package.json` declares `"license": "MIT"`, but **there is no `LICENSE` file**, so GitHub reports
the repository as unlicensed and shows no licence badge. Without that file, the default position is that
no permission is granted to reuse the code — which contradicts the package metadata.

Adding a `LICENSE` file is a decision for the copyright holder, so this has been left alone rather than
chosen on your behalf. Once one exists, add a badge to the README:

```markdown
[![License](https://img.shields.io/github/license/agit8or1/St0r)](LICENSE)
```

### Releases

The latest GitHub release is `v3.2.104`, while `VERSION` in the repository is ahead of that. Publishing a
release for the current version keeps the README's release badge meaningful, since it reads the latest
release tag.

### Continuous integration

There are no workflows in `.github/workflows`, so no CI badge is claimed in the README. If a build or test
workflow is added later, a badge can be added then.

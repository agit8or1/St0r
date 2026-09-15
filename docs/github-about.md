# GitHub repository settings

Proposed values for the repository's **About** panel. These are settings in the GitHub web UI, not files —
apply them at <https://github.com/agit8or1/St0r> → ⚙️ next to *About*.

Verified on 2026-09-15.

---

## Description

**Applied 2026-09-15.**

Previously:

> St0r is a addon web gui for Urbackup Server | Project managed by MIA the GSD 🐾

Now:

```
A modern management interface for UrBackup — endpoint status, schedules and retention, file recovery, and offsite replication.
```

Why: the old text had two grammar slips (“a addon”, “Urbackup”), and the search-facing description is
better spent saying what the tool does than who maintains it. The Mia credit lives in the README instead.

---

## Website

**Applied 2026-09-15.** The homepage was `https://st0r.mspreboot.com`, which has no DNS record and does not
resolve. It now points at the project page, which does.

| URL | Result | Role |
|---|---|---|
| `https://agit8or.net/projects/stor.html` | ✅ HTTP 200 | **About URL** — the product page, best for visitors arriving from GitHub |
| `https://mspreboot.com` | ✅ HTTP 200 | linked from the README, not the About panel |
| `https://st0r.mspreboot.com` | ❌ no DNS record | previous setting, removed |

The product page is kept as the primary About URL because it describes St0r specifically; MSP Reboot is the
author's consulting practice and is linked from the README instead. If `st0r.mspreboot.com` is meant to
become the canonical home, create the DNS record first and switch then.

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
| License | MIT (`LICENSE` added 2026-09-15) | Done — see below |
| Issues | Enabled | Keep |
| Releases | 30 published, latest `v3.2.104` | See below |

### License

**Resolved.** A `LICENSE` file (MIT) is now in the repository, matching the `"license": "MIT"` already
declared in `backend/package.json`, and the README carries a licence badge.

Copyright line: `Copyright (c) 2025-2026 Agit8or` — the year span comes from the commit history, and the
holder name from the identity the application publishes on its About page. Change it if a different legal
name or entity should hold the copyright.

GitHub detects `LICENSE` automatically and will show *MIT* in the About panel; that may take a few minutes
to appear after the file lands on the default branch.

### Releases

**Resolved.** `v3.2.115` and `v3.2.116` are published, so the README's release badge now reports the
current version rather than a stale one.

### MSP Reboot

Checked 2026-09-15. <https://mspreboot.com> describes itself as *"Practical MSP consulting from a former
25-year MSP owner. Improve pricing, operations, margins, service delivery, technology strategy and owner
independence — without the vendor pitch."* It offers a free introductory hour and a contact form.

It is a **consulting practice, not a software catalogue**, so the README describes it as such and links to
it — it does not claim MSP Reboot publishes tools, sponsors this project, or provides support for it.
Neither site states a relationship between St0r and MSP Reboot, so none is asserted beyond shared
authorship, which the README words as "St0r's author also runs".

### Continuous integration

There are no workflows in `.github/workflows`, so no CI badge is claimed in the README. If a build or test
workflow is added later, a badge can be added then.

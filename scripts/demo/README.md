# Demo environment and media capture

Tooling for regenerating the screenshot gallery and the walkthrough video **without
touching production data**. None of this runs as part of a normal install or the
application build.

## What it guarantees

- A separate `st0r_demo` MariaDB database — the production database is never opened.
- A fabricated UrBackup SQLite database, built from the local schema but containing
  only invented endpoints, backups and job logs.
- A mock UrBackup HTTP API. The demo instance never reaches a real UrBackup server,
  so no backup can be started, no setting written, and no real client data can appear
  in a capture.
- Fictitious customers, endpoint names, IP addresses and file names throughout.
  Credential fields carry obvious placeholders and stay masked in the UI.

## Requirements

- A built backend and frontend (`npm run build` in each).
- `sqlite3`, `mysql` client, and `sudo` access to read the UrBackup schema.
- `node scripts/demo && npm install` for `playwright-core`.
- A Chromium build: `npx playwright install chromium`, then export `CHROME_EXE`.
- `pngquant` for screenshot optimisation, `ffmpeg` for video encoding.

## 1. Build the demo data

```bash
node scripts/demo/build-demo-data.mjs --out /tmp/st0r-demo
```

Creates `/tmp/st0r-demo/{backup_server.db,backup_server_settings.db,storage,demo.env}`
and the `st0r_demo` database.

## 2. Start the demo instance

```bash
node scripts/demo/mock-urbackup-api.mjs &                 # port 9714
cd backend && set -a && . /tmp/st0r-demo/demo.env && set +a
PORT=3099 node dist/server.js &
```

The demo listens on **3099**; production is untouched on its own port.

## 3. Capture

```bash
export CHROME_EXE=$(find ~/.cache/ms-playwright -name chrome | head -1)
export DEMO_PASSWORD='<the demo account password>'

node scripts/demo/capture-screenshots.mjs --out docs/images/github
node scripts/demo/capture-video.mjs --out /tmp/st0r-media --mode full
node scripts/demo/capture-video.mjs --out /tmp/st0r-media --mode highlight
```

`DEMO_PASSWORD` is read from the environment and is never written into these
scripts, the manifest, or the repository.

## Capture parameters

| Parameter | Setting |
|---|---|
| Screenshot viewport | 1440 × 1000, deviceScaleFactor 2 |
| Video | 1920 × 1080, 30 fps, H.264 MP4 (`+faststart`) |
| Theme | switched with the application's own selector, then verified against `documentElement.classList` before capture |
| Animations | frozen via injected CSS so captures are deterministic |
| Optimisation | `pngquant --quality=70-92` — keeps interface text crisp where JPEG would soften it |

Each screenshot's route and theme are recorded in the `SHOTS` manifest in
`capture-screenshots.mjs`, so the gallery can be regenerated exactly.

## 4. Tear down

```bash
kill %1 %2                       # mock API and demo backend
sudo mysql -e "DROP DATABASE st0r_demo;"
rm -rf /tmp/st0r-demo
```

## Notes

- Video output is written **outside** the repository by default. Large binaries do
  not belong in normal Git history — publish them as release assets instead.
- The Logs page is deliberately excluded from the gallery: it renders the host's
  `journalctl` output, which is real system data even in a demo database.

---

## Video outputs and how to publish them

`capture-video.mjs` writes to `--out` (default `/tmp/st0r-media`), **outside the repository**. Large video
binaries do not belong in normal Git history.

| File | What it is |
|---|---|
| `st0r-walkthrough.mp4` | The main walkthrough — 1920×1080, 30 fps, H.264, `+faststart` |
| `st0r-highlight.mp4` | The short highlight clip |
| `poster.png` | A walkthrough frame with a download badge composited on, for use as the README thumbnail |
| `st0r-walkthrough.vtt` | WebVTT captions, generated from the same cue list the video was drawn from |
| `st0r-walkthrough-transcript.md` | Plain-text transcript with timestamps |
| `raw/` | The original WebM recordings — delete these once the MP4s are verified |

Captions and transcript are generated from the cue list used to draw the on-screen captions, so they
cannot drift from what the video actually shows.

### Publishing

GitHub will not play a video embedded from a raw file link, so the MP4s live as **release assets** and the
README links the poster to them. Both videos are published on the `v3.2.116` release; a later capture is
uploaded the same way:

```bash
gh release upload v3.2.116 \
  /tmp/st0r-media/st0r-walkthrough.mp4 \
  /tmp/st0r-media/st0r-highlight.mp4 \
  /tmp/st0r-media/st0r-walkthrough.vtt
```

The README carries this block, directly above **See it in action** — repoint the two release URLs at the
tag the new files were uploaded to:

```markdown
## Watch the walkthrough

[<img src="docs/images/github/walkthrough-poster.png" alt="Download the St0r walkthrough — a three and a half minute tour of the dashboard, endpoint health, file recovery, schedules and offsite replication" width="100%">](https://github.com/agit8or1/St0r/releases/download/v3.2.116/st0r-walkthrough.mp4)

A short tour of the dashboard, endpoint health, recovering a file, schedules and retention, and offsite
replication — in both themes. GitHub will not play it inline, so the poster above **downloads the MP4**
(3:26, 6.6 MB).
[Highlight clip](https://github.com/agit8or1/St0r/releases/download/v3.2.116/st0r-highlight.mp4) —
also a download (0:45, 1.7 MB) ·
[Transcript](docs/media/st0r-walkthrough-transcript.md) — reads in the browser
```

GitHub strips `<video>` tags and serves release assets with `Content-Disposition: attachment`, so a release
URL can only ever download. The one thing that plays inline is a `github.com/user-attachments/assets/…`
URL, which exists only if the file is dragged into an issue or comment box in the browser — there is no API
for it. Update the durations and sizes above if a re-capture changes them.

The poster, both transcripts and both caption files are committed —
`docs/images/github/walkthrough-poster.png` and `docs/media/`. The MP4s are not: they are release assets
only, so a fresh clone has the poster and the transcripts but pulls the videos from GitHub.

If a later capture changes the video, refresh the committed copies too:

```bash
pngquant --quality 70-92 --force --output docs/images/github/walkthrough-poster.png /tmp/st0r-media/poster.png
cp /tmp/st0r-media/*-transcript.md /tmp/st0r-media/*.vtt docs/media/
```

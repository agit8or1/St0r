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

| | |
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

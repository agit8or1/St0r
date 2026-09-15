#!/usr/bin/env node
/**
 * Record the walkthrough video against the demo environment.
 *
 * Drives the real application — this is a screen recording of St0r, not a
 * slideshow of stills. Captions are drawn as a capture-only overlay injected
 * into the page; nothing about the application itself is modified.
 *
 * Requires a running demo instance (see scripts/demo/README.md) and ffmpeg.
 *
 *   node scripts/demo/capture-video.mjs --out /tmp/st0r-media --mode full
 *   node scripts/demo/capture-video.mjs --out /tmp/st0r-media --mode highlight
 *
 * Output is written outside the repository by default: video binaries do not
 * belong in normal Git history.
 */
import { chromium } from 'playwright-core';
import { mkdirSync, writeFileSync, renameSync, readdirSync } from 'fs';
import { execFileSync } from 'child_process';
import { resolve, join } from 'path';

const args = Object.fromEntries(
  process.argv.slice(2).flatMap((a, i, all) => (a.startsWith('--') ? [[a.slice(2), all[i + 1]]] : []))
);
const BASE = args.base || 'http://localhost:3099';
const OUT = resolve(args.out || '/tmp/st0r-media');
const MODE = args.mode || 'full';
const USER = args.user || 'demo';
const PASS = process.env.DEMO_PASSWORD || args.password;
if (!PASS) { console.error('Set DEMO_PASSWORD. Credentials are never stored in this script.'); process.exit(1); }

const SIZE = { width: 1920, height: 1080 };
const CLIENT = 'SRV-FILES-03';
const TARGET = '11111111-1111-4111-8111-111111111111';
const raw = join(OUT, 'raw');
mkdirSync(raw, { recursive: true });

const browser = await chromium.launch({
  executablePath: process.env.CHROME_EXE,
  args: ['--no-sandbox', '--force-color-profile=srgb', '--font-render-hinting=none'],
});
const ctx = await browser.newContext({
  viewport: SIZE,
  deviceScaleFactor: 1,
  reducedMotion: 'reduce',
  recordVideo: { dir: raw, size: SIZE },
});
const page = await ctx.newPage();

/** Caption overlay — capture-only chrome, never part of the product. */
const CAPTION_CSS = `
#st0r-cap{position:fixed;left:0;right:0;bottom:0;z-index:2147483647;display:flex;justify-content:center;
  pointer-events:none;font-family:system-ui,-apple-system,"Segoe UI",sans-serif}
#st0r-cap .b{margin:0 0 42px;max-width:1180px;padding:16px 30px;border-radius:12px;
  background:rgba(11,15,25,.93);color:#fff;font-size:29px;line-height:1.35;font-weight:500;
  box-shadow:0 10px 40px rgba(0,0,0,.45);text-align:center}
#st0r-cap.hide{display:none}
#st0r-end{position:fixed;inset:0;z-index:2147483646;display:flex;flex-direction:column;
  align-items:center;justify-content:center;gap:22px;background:#0b0f19;color:#fff;
  font-family:system-ui,-apple-system,"Segoe UI",sans-serif}
#st0r-end .t{font-size:74px;font-weight:700;letter-spacing:-1px}
#st0r-end .s{font-size:31px;color:#9fb0c9}
#st0r-end .u{font-size:27px;color:#7aa2f7;margin-top:6px}
*,*::before,*::after{animation-duration:.001s!important;transition-duration:.12s!important}`;

const cues = [];
let t0 = 0;
const nowMs = () => Date.now() - t0;
const fmt = (ms) => {
  const s = Math.max(0, ms) / 1000;
  const hh = String(Math.floor(s / 3600)).padStart(2, '0');
  const mm = String(Math.floor((s % 3600) / 60)).padStart(2, '0');
  const ss = (s % 60).toFixed(3).padStart(6, '0');
  return `${hh}:${mm}:${ss}`;
};

async function caption(text, holdMs = 3200) {
  const start = nowMs();
  await page.evaluate((t) => {
    let el = document.getElementById('st0r-cap');
    if (!el) {
      el = document.createElement('div');
      el.id = 'st0r-cap';
      el.innerHTML = '<div class="b"></div>';
      document.body.appendChild(el);
    }
    el.classList.remove('hide');
    el.querySelector('.b').textContent = t;
  }, text);
  await page.waitForTimeout(holdMs);
  cues.push({ start, end: nowMs(), text });
}

async function hideCaption() {
  await page.evaluate(() => document.getElementById('st0r-cap')?.classList.add('hide'));
}

async function style() { await page.addStyleTag({ content: CAPTION_CSS }).catch(() => {}); }

async function go(path, settle = 2400) {
  await page.goto(`${BASE}${path}`, { waitUntil: 'networkidle' });
  await style();
  await page.waitForTimeout(settle);
}

/** Deliberate pointer movement reads better than teleporting. */
async function glide(x, y, steps = 26) { await page.mouse.move(x, y, { steps }); await page.waitForTimeout(450); }

async function theme(want) {
  const cur = await page.evaluate(() => (document.documentElement.classList.contains('dark') ? 'dark' : 'light'));
  if (cur === want) return;
  await glide(300, 48);
  await page.locator('aside button').first().click();
  await page.waitForFunction((t) => (document.documentElement.classList.contains('dark') ? 'dark' : 'light') === t, want, { timeout: 8000 });
  await page.waitForTimeout(900);
}

async function endCard(lines) {
  await page.evaluate((l) => {
    const d = document.createElement('div');
    d.id = 'st0r-end';
    d.innerHTML = `<div class="t">${l.t}</div><div class="s">${l.s}</div><div class="u">${l.u}</div><div class="u">${l.u2}</div>`;
    document.body.appendChild(d);
  }, lines);
  await page.waitForTimeout(4200);
}

async function login() {
  await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' });
  await page.fill('input[type="text"], input[name="username"]', USER);
  await page.fill('input[type="password"]', PASS);
  await page.click('button[type="submit"]');
  await page.waitForURL((u) => !u.pathname.includes('/login'), { timeout: 25000 });
}

await login();
t0 = Date.now();

if (MODE === 'full') {
  await go('/', 2600);
  await caption('St0r — a modern management interface for UrBackup', 4200);
  await caption('For administrators who already run UrBackup Server. It does not replace the backup engine.', 4600);
  await caption('The dashboard: every endpoint, job totals, replication health and capacity in one view', 4800);
  await glide(1200, 700); await page.waitForTimeout(1600);
  await caption('Three backups are running right now, with live progress', 4200);
  await glide(760, 1010); await page.waitForTimeout(1800);
  await caption('And one endpoint needs attention — surfaced instead of buried', 4200);
  await hideCaption(); await page.waitForTimeout(1200);

  // Workflow 1 — find and inspect the endpoint that needs attention
  await go('/clients', 2400);
  await caption('Workflow one: every endpoint, its customer, last backup and quota usage', 4600);
  await glide(700, 330); await page.waitForTimeout(1500);
  await caption('Filter by state or by customer to find what you are looking for', 3800);
  await go(`/clients/${CLIENT}`, 2600);
  await caption('Opening an endpoint shows its status and full backup history', 4400);
  await glide(1100, 760); await page.waitForTimeout(1800);
  await hideCaption(); await page.waitForTimeout(1000);

  // Workflow 2 — recover a file
  await go(`/clients/${CLIENT}/browse`, 3000);
  await caption('Workflow two: recovering a file. Pick a day that has a backup', 4400);
  // Scope every click to <main>: an unscoped match can hit the sidebar account
  // button and navigate away mid-walkthrough.
  const main = page.locator('main');
  const day = String(new Date().getDate());
  try { await glide(640, 470); await main.locator(`button:text-is("${day}")`).first().click({ timeout: 4000 }); } catch {}
  await page.waitForTimeout(2600);
  await caption('Open the backup taken that day', 3600);
  for (const sel of ['button:has-text("AM")', 'button:has-text("PM")', '[class*="cursor-pointer"]']) {
    try { const el = main.locator(sel).first(); if (await el.count()) { await el.click({ timeout: 3000 }); break; } } catch {}
  }
  await page.waitForTimeout(3000);
  await caption('Browse into the backup and download individual files or whole folders', 4600);
  for (const f of ['Projects', '2026-Q3']) {
    try { await main.locator(`text="${f}"`).first().click({ timeout: 3500 }); await page.waitForTimeout(2200); } catch {}
  }
  if (!page.url().includes('/browse')) console.log('  ! walkthrough left the file browser unexpectedly');
  await page.waitForTimeout(1800);
  await hideCaption(); await page.waitForTimeout(1000);

  // Workflow 3 — schedules and retention
  await go(`/clients/${CLIENT}/settings`, 2600);
  await caption('Workflow three: schedules and retention, per endpoint', 4200);
  try { await page.locator('text="Schedule & Retention"').first().click({ timeout: 5000 }); } catch {}
  await page.waitForTimeout(2600);
  await caption('Intervals, backup windows and how many snapshots to keep — with UrBackup defaults shown', 5200);
  await glide(1300, 620); await page.waitForTimeout(1600);
  try { await page.locator('text="Storage Limit"').first().click({ timeout: 4000 }); } catch {}
  await page.waitForTimeout(2400);
  await caption('And an optional storage quota with warning thresholds', 4000);
  await hideCaption(); await page.waitForTimeout(1200);

  // Theme switch, then monitoring and reporting in dark
  await caption('St0r ships light and dark themes', 3000);
  await theme('dark');
  await caption('Replication: target health, lag, and the history of every run', 4600);
  await go('/replication', 2600);
  await page.waitForTimeout(2000);
  await go(`/replication/targets/${TARGET}`, 2800);
  await caption('Each run records status, trigger, duration and bytes transferred', 4600);
  await page.waitForTimeout(1600);
  await go('/reports', 4200);
  await caption('Reports summarise the estate and export to CSV or PDF', 4800);
  await glide(1000, 640); await page.waitForTimeout(2200);

  await go('/alerts', 2600);
  await caption('Alerts raise failures and stale backups on the channels you choose', 4800);
  await glide(1150, 700); await page.waitForTimeout(2000);

  await go('/customers', 2600);
  await caption('For MSPs: group endpoints by customer …', 4200);
  await go('/users', 2600);
  await caption('… then scope a read-only account to just that customer\'s endpoints', 5000);
  await glide(1000, 430); await page.waitForTimeout(2000);
  await hideCaption(); await page.waitForTimeout(1200);

  await caption('Install with one command on the same server as UrBackup', 3800);
  await hideCaption();
  await endCard({
    t: 'St0r',
    s: 'A modern management interface for UrBackup',
    u: 'github.com/agit8or1/St0r',
    u2: 'mspreboot.com',
  });
} else {
  // 30–60 second highlight
  await go('/', 2200);
  await caption('St0r — a modern management interface for UrBackup', 3600);
  await caption('Your whole backup estate in one view', 3600);
  await glide(1150, 700); await page.waitForTimeout(1400);
  await go('/clients', 2000);
  await caption('Endpoint health, quotas and customer grouping', 3600);
  await go(`/clients/${CLIENT}/browse`, 2600);
  await caption('Browse a backup and recover individual files', 3600);
  await theme('dark');
  await go('/replication', 2400);
  await caption('Offsite replication with run history — in light or dark', 3800);
  await hideCaption();
  await endCard({
    t: 'St0r',
    s: 'A modern management interface for UrBackup',
    u: 'github.com/agit8or1/St0r',
    u2: 'mspreboot.com',
  });
}

const duration = nowMs();
await ctx.close();
await browser.close();

// Playwright names the file by page GUID; find the newest webm it just wrote.
const webm = readdirSync(raw).filter((f) => f.endsWith('.webm'))
  .map((f) => join(raw, f)).sort((a, b) => execFileSync('stat', ['-c%Y', b]) - execFileSync('stat', ['-c%Y', a]))[0];
const stamped = join(raw, `${MODE}.webm`);
renameSync(webm, stamped);

const mp4 = join(OUT, MODE === 'full' ? 'st0r-walkthrough.mp4' : 'st0r-highlight.mp4');
console.log('Encoding MP4 …');
execFileSync('ffmpeg', [
  '-y', '-i', stamped,
  '-vf', 'scale=1920:1080:flags=lanczos,fps=30',
  '-c:v', 'libx264', '-preset', 'slow', '-crf', '21',
  '-pix_fmt', 'yuv420p', '-profile:v', 'high', '-level', '4.0',
  '-movflags', '+faststart', mp4,
], { stdio: ['ignore', 'ignore', 'pipe'] });

// WebVTT captions and a plain-text transcript, both generated from the cue list
// so they cannot drift from what the video actually shows.
const vtt = ['WEBVTT', '', ...cues.flatMap((c, i) => [String(i + 1), `${fmt(c.start)} --> ${fmt(c.end)}`, c.text, ''])].join('\n');
writeFileSync(join(OUT, MODE === 'full' ? 'st0r-walkthrough.vtt' : 'st0r-highlight.vtt'), vtt);
writeFileSync(
  join(OUT, MODE === 'full' ? 'st0r-walkthrough-transcript.md' : 'st0r-highlight-transcript.md'),
  `# St0r — ${MODE === 'full' ? 'walkthrough' : 'highlight'} transcript\n\n` +
    `Captured from the demo environment. Every figure shown is fictitious sample data.\n\n` +
    cues.map((c) => `**${fmt(c.start).slice(3, 8)}** — ${c.text}`).join('\n\n') + '\n'
);

if (MODE === 'full') {
  console.log('Extracting poster …');
  execFileSync('ffmpeg', ['-y', '-ss', '12', '-i', mp4, '-frames:v', '1', '-q:v', '2', join(OUT, 'poster.png')],
    { stdio: ['ignore', 'ignore', 'pipe'] });
}

console.log(`\n${MODE}: ${mp4}  (~${Math.round(duration / 1000)}s, ${cues.length} captions)`);

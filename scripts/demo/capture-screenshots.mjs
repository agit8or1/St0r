#!/usr/bin/env node
/**
 * Capture the documentation screenshot gallery from the demo environment.
 *
 * Requires a running demo instance — see scripts/demo/README.md:
 *   node scripts/demo/build-demo-data.mjs --out /tmp/st0r-demo
 *   node scripts/demo/mock-urbackup-api.mjs &
 *   (cd backend && set -a && . /tmp/st0r-demo/demo.env && set +a && PORT=3099 node dist/server.js &)
 *
 *   node scripts/demo/capture-screenshots.mjs --out docs/images/github
 *
 * Every shot records its route and theme in SHOTS below, so the gallery can be
 * regenerated reproducibly. Themes are switched with the application's own
 * theme selector and verified against the document class before capturing.
 */
import { chromium } from 'playwright-core';
import { mkdirSync, existsSync } from 'fs';
import { execFileSync } from 'child_process';
import { resolve } from 'path';

const args = Object.fromEntries(
  process.argv.slice(2).flatMap((a, i, all) => (a.startsWith('--') ? [[a.slice(2), all[i + 1]]] : []))
);
const BASE = args.base || 'http://localhost:3099';
const OUT = resolve(args.out || 'docs/images/github');
const USER = args.user || 'demo';
const PASS = process.env.DEMO_PASSWORD || args.password;
const ONLY = args.only ? new Set(args.only.split(',')) : null;

if (!PASS) {
  console.error('Set DEMO_PASSWORD (or pass --password). Credentials are never stored in this script.');
  process.exit(1);
}

const VIEWPORT = { width: 1440, height: 1000 };
const SCALE = 2;

const CLIENT = 'SRV-FILES-03';
const TARGET_ID = '11111111-1111-4111-8111-111111111111';

/**
 * name    — output filename (without extension) and gallery anchor
 * route   — path captured
 * theme   — light | dark, applied with the in-app selector
 * tab     — optional tab label clicked after load
 * wait    — extra settle time in ms for charts and data
 */
const SHOTS = [
  // ---------------------------------------------------------------- light
  { name: 'dashboard-light',            route: '/',                                   theme: 'light', wait: 3500 },
  { name: 'endpoints-light',            route: '/clients',                            theme: 'light', wait: 3000 },
  { name: 'activity-progress-light',    route: '/activities',                         theme: 'light', wait: 3500 },
  { name: 'endpoint-detail-light',      route: `/clients/${CLIENT}`,                  theme: 'light', wait: 3500 },
  { name: 'file-browser-light',         route: `/clients/${CLIENT}/browse`,           theme: 'light', browse: true },
  { name: 'schedule-retention-light',   route: `/clients/${CLIENT}/settings`,         theme: 'light', tab: 'Schedule & Retention' },
  { name: 'replication-overview-light', route: '/replication',                        theme: 'light', wait: 3000 },
  { name: 'reports-light',              route: '/reports',                            theme: 'light', wait: 5000 },
  { name: 'customers-light',            route: '/customers',                          theme: 'light', tab: 'Northwind Trading', wait: 2500 },
  { name: 'alerts-light',               route: '/alerts',                             theme: 'light', wait: 3000 },
  { name: 'storage-limit-light',        route: `/clients/${CLIENT}/settings`,         theme: 'light', tab: 'Storage Limit' },
  { name: 'users-light',                route: '/users',                              theme: 'light', wait: 2500 },
  { name: 'permissions-light',          route: `/clients/${CLIENT}/settings`,         theme: 'light', tab: 'Permissions' },

  // ----------------------------------------------------------------- dark
  { name: 'dashboard-dark',             route: '/',                                   theme: 'dark',  wait: 3500 },
  { name: 'endpoints-dark',             route: '/clients',                            theme: 'dark',  wait: 3000 },
  { name: 'replication-runs-dark',      route: `/replication/targets/${TARGET_ID}`,   theme: 'dark',  wait: 3000 },
  { name: 'replication-targets-dark',   route: '/replication',                        theme: 'dark',  tab: 'Targets' },
  // Configuration Backup (the default tab) lists real files from the production
  // install path, so capture UrBackup's own settings instead.
  { name: 'server-settings-dark',       route: '/server-settings',                    theme: 'dark',  tab: 'General Settings', wait: 3000 },
  { name: 'settings-general-dark',      route: '/settings',                           theme: 'dark',  wait: 3000 },
  { name: 'disk-guard-dark',            route: '/settings',                           theme: 'dark',  tab: 'Storage Protection' },
  { name: 'backup-paths-dark',          route: `/clients/${CLIENT}/settings`,         theme: 'dark',  tab: 'Backup Paths' },
  { name: 'image-backup-dark',          route: `/clients/${CLIENT}/settings`,         theme: 'dark',  tab: 'Image Backup' },
  { name: 'transfer-settings-dark',     route: `/clients/${CLIENT}/settings`,         theme: 'dark',  tab: 'Transfer' },
  { name: 'bare-metal-restore-dark',    route: '/bare-metal-restore',                 theme: 'dark',  wait: 3500 },
  { name: 'backup-defaults-dark',       route: '/settings',                           theme: 'dark',  tab: 'Backup Defaults' },
  { name: 'client-config-dark',         route: '/settings',                           theme: 'dark',  tab: 'Client Configuration' },
];

// Animations and transitions make captures non-deterministic.
const FREEZE_CSS = `*,*::before,*::after{animation:none!important;transition:none!important;
  animation-duration:0s!important;transition-duration:0s!important;caret-color:transparent!important}`;

mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({
  executablePath: process.env.CHROME_EXE,
  args: ['--no-sandbox', '--force-color-profile=srgb', '--font-render-hinting=none'],
});
const ctx = await browser.newContext({
  viewport: VIEWPORT,
  deviceScaleFactor: SCALE,
  reducedMotion: 'reduce',
});
const page = await ctx.newPage();

async function login() {
  await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' });
  await page.fill('input[type="text"], input[name="username"]', USER);
  await page.fill('input[type="password"]', PASS);
  await page.click('button[type="submit"]');
  await page.waitForURL((u) => !u.pathname.includes('/login'), { timeout: 25000 });
}

async function currentTheme() {
  return page.evaluate(() => (document.documentElement.classList.contains('dark') ? 'dark' : 'light'));
}

/** Switch themes using the sidebar toggle — the control a user actually uses. */
async function setTheme(want) {
  if ((await currentTheme()) === want) return;
  const toggle = page.locator('aside button').first();
  await toggle.click();
  await page.waitForFunction(
    (t) => (document.documentElement.classList.contains('dark') ? 'dark' : 'light') === t,
    want,
    { timeout: 8000 }
  );
  await page.waitForTimeout(600);
  if ((await currentTheme()) !== want) throw new Error(`theme did not settle on ${want}`);
}

async function settle(ms = 2500) {
  await page.addStyleTag({ content: FREEZE_CSS }).catch(() => {});
  try { await page.evaluate(() => document.fonts && document.fonts.ready); } catch {}
  await page.waitForTimeout(ms);
  // Park the pointer so no hover tooltip overlays the capture.
  await page.mouse.move(VIEWPORT.width - 8, VIEWPORT.height - 8);
  await page.waitForTimeout(400);
}

/**
 * File browser needs a date and a backup selected before files are listed.
 * Every click is scoped to <main>: unscoped selectors can match the sidebar's
 * account button, which navigates away to the profile page.
 */
async function openBrowseBackup() {
  const main = page.locator('main');
  await page.waitForTimeout(3000);

  // Days that have a backup are marked with a bullet. Work back from the most
  // recent until one opens a backup list.
  const days = main.locator('button:has-text("\u25cf")');
  const count = await days.count();
  const entry = () => main.locator('[class*="rounded"]:has-text("AM"), [class*="rounded"]:has-text("PM")');
  let opened = false;
  for (let i = count - 1; i >= 0 && i >= count - 10 && !opened; i--) {
    try {
      await days.nth(i).click({ timeout: 2500 });
      await page.waitForTimeout(1800);
      opened = (await entry().count()) > 0;
    } catch { /* not selectable — try the previous day */ }
  }
  if (!opened) throw new Error('no calendar day yielded a backup list');

  await entry().first().click({ timeout: 5000 });
  await page.waitForTimeout(3200);

  for (const folder of ['Projects', '2026-Q3']) {
    try { await main.locator(`text="${folder}"`).first().click({ timeout: 3500 }); await page.waitForTimeout(2200); } catch {}
  }

  if (!page.url().includes('/browse')) throw new Error(`navigated away from the file browser to ${page.url()}`);
}

await login();
console.log(`Capturing ${SHOTS.length} screenshots at ${VIEWPORT.width}x${VIEWPORT.height} @${SCALE}x`);

const results = [];
for (const shot of SHOTS) {
  if (ONLY && !ONLY.has(shot.name)) continue;
  try {
    await page.goto(`${BASE}${shot.route}`, { waitUntil: 'networkidle' });
    await setTheme(shot.theme);
    if (shot.browse) await openBrowseBackup();
    if (shot.tab) {
      try { await page.locator(`text="${shot.tab}"`).first().click({ timeout: 6000 }); }
      catch { console.log(`    ! tab not found: ${shot.tab}`); }
      await page.waitForTimeout(1200);
    }
    await settle(shot.wait ?? 2500);
    const file = `${OUT}/${shot.name}.png`;
    await page.screenshot({ path: file });
    results.push({ ...shot, file });
    console.log(`  ✓ ${shot.name.padEnd(28)} ${shot.theme.padEnd(5)} ${shot.route}`);
  } catch (err) {
    console.log(`  ✗ ${shot.name}: ${String(err).split('\n')[0]}`);
  }
}

await browser.close();

// Optimise in place: pngquant keeps interface text crisp where JPEG would soften it.
if (existsSync('/usr/bin/pngquant')) {
  console.log('Optimising …');
  for (const r of results) {
    try {
      execFileSync('pngquant', ['--quality=70-92', '--speed', '1', '--force', '--strip', '--output', r.file, r.file]);
    } catch { /* pngquant exits non-zero when it cannot hit the quality target; keep the original */ }
  }
}

const light = results.filter((r) => r.theme === 'light').length;
console.log(`\n${results.length} screenshots → ${OUT}  (${light} light / ${results.length - light} dark)`);

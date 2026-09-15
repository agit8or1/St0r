#!/usr/bin/env node
/**
 * Build an isolated demo environment for screenshot capture.
 *
 * Creates, entirely separately from any production data:
 *   - a `st0r_demo` MariaDB database with fictitious customers, users,
 *     quotas and replication history
 *   - a fabricated UrBackup SQLite database built from the real schema
 *   - a small backup storage tree with harmless invented file names
 *
 * Nothing here touches UrBackup, its databases, or real backups. The schema is
 * copied (read-only) from the local UrBackup installation so the demo data is
 * shape-compatible with whatever version is installed.
 *
 *   node scripts/demo/build-demo-data.mjs --out /tmp/st0r-demo
 *
 * See scripts/demo/README.md for the full capture workflow.
 */
import { execFileSync } from 'child_process';
import { mkdirSync, writeFileSync, rmSync, readFileSync } from 'fs';
import { resolve, dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(__dirname, '../..');

const args = Object.fromEntries(
  process.argv.slice(2).flatMap((a, i, all) => (a.startsWith('--') ? [[a.slice(2), all[i + 1]]] : []))
);
const OUT = resolve(args.out || '/tmp/st0r-demo');
const DB_NAME = args.db || 'st0r_demo';
const URBACKUP_DB = args['urbackup-db'] || '/var/urbackup/backup_server.db';

// Credentials for the demo database come from the backend .env, so this script
// does not carry any of its own.
const env = Object.fromEntries(
  readFileSync(join(REPO, 'backend/.env'), 'utf8')
    .split('\n')
    .filter((l) => l.includes('=') && !l.trim().startsWith('#'))
    .map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()])
);

const sh = (cmd, cmdArgs, opts = {}) =>
  execFileSync(cmd, cmdArgs, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, ...opts });
const mysqlDemo = (sql) =>
  sh('mysql', ['-u', env.DB_USER, `-p${env.DB_PASSWORD}`, DB_NAME, '-e', sql], { stdio: ['ignore', 'pipe', 'ignore'] });
// Seed SQL runs to hundreds of KB, past the argv limit — pipe it via a file.
const sqlite = (file, sql) => {
  const tmp = `${file}.seed.sql`;
  writeFileSync(tmp, sql);
  try { return sh('bash', ['-c', `sqlite3 "${file}" < "${tmp}"`], { stdio: ['ignore', 'pipe', 'ignore'] }); }
  finally { rmSync(tmp, { force: true }); }
};
const sqliteQuery = (file, sql) => sh('sqlite3', [file, sql], { stdio: ['ignore', 'pipe', 'ignore'] });

const now = Math.floor(Date.now() / 1000);
const ts = (secs) => new Date(secs * 1000).toISOString().slice(0, 19).replace('T', ' ');

console.log(`Building demo environment in ${OUT}`);
rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

/* ---------------------------------------------------------------- endpoints */
// Role-based names, no personal identifiers. A believable mix: mostly healthy,
// one failing, one stale — not a wall of red.
const CLIENTS = [
  { id: 1, name: 'SRV-APP-01',    hrs: 5,  files: 412, images: 180, os: 'windows', osv: 'Microsoft Windows Server 2022 (build 20348), 64-bit', ip: '10.20.4.11', ok: 1 },
  { id: 2, name: 'SRV-DB-02',     hrs: 3,  files: 689, images: 240, os: 'windows', osv: 'Microsoft Windows Server 2022 (build 20348), 64-bit', ip: '10.20.4.12', ok: 1 },
  { id: 3, name: 'SRV-FILES-03',  hrs: 6,  files: 921, images: 310, os: 'linux',   osv: 'Ubuntu 24.04.3 LTS',                                   ip: '10.20.4.18', ok: 1 },
  { id: 4, name: 'SRV-MAIL-04',   hrs: 8,  files: 268, images: 150, os: 'linux',   osv: 'Debian GNU/Linux 12 (bookworm)',                       ip: '10.20.4.21', ok: 1 },
  { id: 5, name: 'WS-FINANCE-04', hrs: 10, files: 96,  images: 74,  os: 'windows', osv: 'Microsoft Windows 11 Pro (build 22631), 64-bit',       ip: '10.20.9.34', ok: 1 },
  { id: 6, name: 'WS-DESIGN-09',  hrs: 9,  files: 154, images: 88,  os: 'windows', osv: 'Microsoft Windows 11 Pro (build 22631), 64-bit',       ip: '10.20.9.41', ok: 1 },
  { id: 7, name: 'WS-SUPPORT-02', hrs: 12, files: 71,  images: 60,  os: 'windows', osv: 'Microsoft Windows 11 Pro (build 22631), 64-bit',       ip: '10.20.9.52', ok: 1 },
  { id: 8, name: 'LT-SALES-07',   hrs: 98, files: 48,  images: 31,  os: 'windows', osv: 'Microsoft Windows 11 Pro (build 22631), 64-bit',       ip: '10.20.9.77', ok: 0 },
  { id: 9, name: 'NAS-ARCHIVE-01',hrs: 14, files: 1480,images: 420, os: 'linux',   osv: 'Ubuntu 22.04.5 LTS',                                   ip: '10.20.4.30', ok: 1 },
];

/* ------------------------------------------------- UrBackup SQLite (demo) */
const demoDb = join(OUT, 'backup_server.db');
const demoSettingsDb = join(OUT, 'backup_server_settings.db');
const storage = join(OUT, 'storage');

console.log('  copying UrBackup schema (read-only) …');
const schema = sh('sudo', ['-n', 'sqlite3', URBACKUP_DB, '.schema'], { stdio: ['ignore', 'pipe', 'ignore'] });
const settingsSchema = sh('sudo', ['-n', 'sqlite3', URBACKUP_DB.replace('backup_server.db', 'backup_server_settings.db'), '.schema'], { stdio: ['ignore', 'pipe', 'ignore'] });
writeFileSync(join(OUT, 'schema.sql'), schema);
writeFileSync(join(OUT, 'settings-schema.sql'), settingsSchema);
sh('bash', ['-c', `sqlite3 "${demoDb}" < "${join(OUT, 'schema.sql')}"`]);
sh('bash', ['-c', `sqlite3 "${demoSettingsDb}" < "${join(OUT, 'settings-schema.sql')}"`]);

console.log('  seeding endpoints, backups and job logs …');
const stmts = [];
for (const c of CLIENTS) {
  const lb = now - c.hrs * 3600;
  stmts.push(`INSERT INTO clients (id,name,lastbackup,lastseen,lastbackup_image,bytes_used_files,bytes_used_images,
      delete_pending,last_filebackup_issues,os_simple,os_version_str,client_version_str,groupid,file_ok,image_ok,created,uid)
      VALUES (${c.id},'${c.name}','${ts(lb)}','${ts(now - (c.ok ? 180 : 172800))}','${ts(lb - 3600)}',
      ${Math.round(c.files * 1e9)},${Math.round(c.images * 1e9)},0,0,'${c.os}','${c.osv}','2.5.28',0,
      ${c.ok},${c.images > 0 ? 1 : 0},${now - 240 * 86400},'uid${String(c.id).padStart(4, '0')}');`);
}

// 45 days of file backups: a weekly full, incrementals in between.
let bid = 1;
for (const c of CLIENTS) {
  for (let d = 0; d < 45; d++) {
    const t = now - c.hrs * 3600 - d * 86400;
    const full = d % 7 === 0;
    const size = Math.round(c.files * 1e9 * (full ? 0.92 : 0.03 + (d % 5) * 0.004));
    stmts.push(`INSERT INTO backups (id,clientid,backuptime,incremental,path,complete,size_bytes,done,archived,resumed,tgroup,synctime,delete_pending)
      VALUES (${bid++},${c.id},'${ts(t)}',${full ? 0 : 1},'${new Date(t * 1000).toISOString().slice(2, 16).replace(/[-:T]/g, '').slice(0, 6)}-${new Date(t * 1000).toISOString().slice(11, 16).replace(':', '')}',1,${size},1,${d > 35 && full ? 1 : 0},0,0,${t + 1500},0);`);
  }
}

// Image backups, weekly. An endpoint with no image backups computes image_ok
// as false and reads as "Image Failed", so every demo endpoint images.
let iid = 1;
for (const c of CLIENTS.filter((x) => x.images > 0)) {
  for (let w = 0; w < 6; w++) {
    const t = now - c.hrs * 3600 - w * 7 * 86400;
    const full = w === 5;
    const p = new Date(t * 1000).toISOString().slice(2, 16).replace(/[-:T]/g, '').slice(0, 6);
    stmts.push(`INSERT INTO backup_images (id,clientid,backuptime,incremental,incremental_ref,path,complete,size_bytes,version,letter,synctime,archived,delete_pending)
      VALUES (${iid++},${c.id},'${ts(t)}',${full ? 0 : 1},0,'/srv/backups/${c.name}/${p}_Image_C/Image_C_${p}.vhdz',1,${Math.round(c.images * 1e9 * (full ? 0.95 : 0.05))},1,'C:',${t + 2400},0,0);`);
  }
}

// Job logs — healthy across the estate, with the one endpoint that is failing.
let lid = 1;
for (const c of CLIENTS) {
  for (let d = 0; d < 20; d++) {
    const t = now - c.hrs * 3600 - d * 86400;
    const failed = c.ok === 0 && d < 4;
    stmts.push(`INSERT INTO logs (id,clientid,created,sent,errors,warnings,infos,image,incremental,resumed,restore)
      VALUES (${lid},${c.id},'${ts(t)}',0,${failed ? 2 : 0},${failed ? 1 : 0},7,0,1,0,0);`);
    const body = failed
      ? `0-${t}-Starting scheduled incremental file backup...\n2-${t + 40}-Client is offline. Connection timed out.\n0-${t + 40}-Time taken for backing up client ${c.name}: 40s\n2-${t + 40}-Backup failed`
      : `0-${t}-Starting scheduled incremental file backup...\n0-${t + 780}-Transferred ${(2 + (d % 7)).toFixed(2)} GB - Average speed: ${180 + d * 7} MBit/s\n0-${t + 780}-Time taken for backing up client ${c.name}: 13m 0s\n0-${t + 780}-Backup succeeded`;
    stmts.push(`INSERT INTO log_data (logid,data) VALUES (${lid},'${body.replace(/'/g, "''")}');`);
    lid++;
  }
}
sqlite(demoDb, `BEGIN;${stmts.join('')}COMMIT;`);

/* ------------------------------------------------------- UrBackup settings */
const settings = {
  backupfolder: storage,
  internet_server: 'backup.example.com',
  internet_server_port: '55415',
  update_freq_incr: '3600', update_freq_full: '604800',
  update_freq_image_incr: '604800', update_freq_image_full: '5184000',
  min_file_incr: '5', max_file_incr: '20', min_file_full: '2', max_file_full: '5',
  min_image_incr: '4', max_image_incr: '10', min_image_full: '1', max_image_full: '2',
  image_letters: 'C', backup_window_incr_file: '1-7/0-24', backup_window_full_file: '1-7/0-24',
  global_soft_fs_quota: '85%', max_active_clients: '20', cleanup_window: '1-7/3-5',
};
sqlite(demoSettingsDb, Object.entries(settings)
  .map(([k, v]) => `INSERT INTO settings (key,value,clientid) VALUES ('${k}','${v}',0);`).join(''));

/* -------------------------------------------------------------- storage tree */
console.log('  creating demo backup storage tree …');
const latest = sqliteQuery(demoDb, `SELECT path FROM backups WHERE clientid=3 ORDER BY backuptime DESC LIMIT 1;`).trim();
const base = join(storage, 'SRV-FILES-03', latest);
const files = {
  'Projects/2026-Q3/site-survey-notes.docx': 48213,
  'Projects/2026-Q3/materials-estimate.xlsx': 92840,
  'Projects/2026-Q3/floorplan-revb.pdf': 1840221,
  'Projects/2026-Q3/change-order-014.pdf': 322104,
  'Shared/Templates/invoice-template.xlsx': 33120,
  'Shared/Templates/letterhead.docx': 71004,
  'Shared/Handbook/onboarding-guide.pdf': 2204118,
  'Archive/2025-annual-report.pdf': 4210993,
  'Archive/asset-register.csv': 18477,
  'README.txt': 1042,
};
for (const [rel, size] of Object.entries(files)) {
  const p = join(base, rel);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, Buffer.alloc(size, 0x20));
}

/* ------------------------------------------------------- demo app database */
console.log('  creating demo application database …');
sh('sudo', ['-n', 'mysql', '-e',
  `DROP DATABASE IF EXISTS ${DB_NAME}; CREATE DATABASE ${DB_NAME} CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
   GRANT ALL PRIVILEGES ON ${DB_NAME}.* TO '${env.DB_USER}'@'localhost'; FLUSH PRIVILEGES;`], { stdio: 'ignore' });
sh('bash', ['-c', `mysql -u ${env.DB_USER} -p'${env.DB_PASSWORD}' ${DB_NAME} < ${join(REPO, 'database/init/01_schema.sql')} 2>/dev/null`]);
sh('bash', ['-c', `for m in ${join(REPO, 'database/migrations')}/*.sql; do mysql -u ${env.DB_USER} -p'${env.DB_PASSWORD}' ${DB_NAME} < "$m" 2>/dev/null; done`]);

// bcrypt hash of the demo password below — a throwaway credential for a
// throwaway database, never used by any real installation.
const DEMO_HASH = '$2b$10$0Gb3iuaoAQXiQvLyGOgTuu/gTUqN3fmls2QeXg5IcE1ZekqOz2Mou';
mysqlDemo(`
INSERT INTO app_users (username,email,password_hash,is_admin,must_change_password) VALUES
  ('demo','demo@example.com','${DEMO_HASH}',1,0),
  ('helpdesk','helpdesk@example.com','${DEMO_HASH}',0,0),
  ('northwind-viewer','viewer@example.com','${DEMO_HASH}',0,0);

INSERT INTO urbackup_servers (id,name,host,port,username,password,is_active)
  VALUES (1,'Primary backup server','localhost',55414,'admin','',1);

INSERT INTO customers (id,name,company,email,phone) VALUES
  (1,'Northwind Trading','Northwind Trading Ltd','ops@example.com','+44 20 7946 0100'),
  (2,'Apex Manufacturing','Apex Manufacturing Inc','it@example.com','+1 555 0142'),
  (3,'Redwood Clinic','Redwood Clinic','admin@example.com','+1 555 0177');

INSERT INTO customer_clients (customer_id,server_id,client_name) VALUES
  (1,1,'SRV-APP-01'),(1,1,'SRV-DB-02'),(1,1,'WS-FINANCE-04'),(1,1,'WS-SUPPORT-02'),
  (2,1,'SRV-FILES-03'),(2,1,'WS-DESIGN-09'),(2,1,'NAS-ARCHIVE-01'),
  (3,1,'SRV-MAIL-04'),(3,1,'LT-SALES-07');

INSERT INTO customer_users (customer_id,user_id) SELECT 1,id FROM app_users WHERE username='northwind-viewer';

INSERT INTO client_storage_limits (client_name,limit_bytes,warn_threshold_pct,critical_threshold_pct) VALUES
  ('SRV-DB-02',2500000000000,80,95),
  ('SRV-FILES-03',3000000000000,80,95),
  ('WS-FINANCE-04',400000000000,80,95),
  ('NAS-ARCHIVE-01',4000000000000,80,95);

INSERT INTO replication_targets
  (id,name,enabled,mode,host,port,ssh_user,auth_type,target_root_path,target_db_type,verify_after_sync,checksum_verify,bandwidth_limit_mbps,standby_service_mode)
VALUES
  ('11111111-1111-4111-8111-111111111111','Offsite DR (datacentre B)',1,'push_ssh_rsync','dr-replica.example.com',22,'st0r-repl','ssh_key','/srv/replica','sqlite',1,1,500,'stopped'),
  ('22222222-2222-4222-8222-222222222222','Cold storage (site C)',1,'push_ssh_rsync','cold.example.com',22,'st0r-repl','ssh_key','/mnt/cold','sqlite',1,0,200,'stopped');
`);

// Replication history: mostly successful, one failure, so the run table is not
// uniformly green — a real estate has the occasional bad night.
const runs = [];
for (let i = 0; i < 9; i++) {
  const hrs = 3 + i * 12;
  const failed = i === 4;
  runs.push(`('aaaaaaa${i}-1111-4111-8111-111111111111','11111111-1111-4111-8111-111111111111',
    NOW() - INTERVAL ${hrs + 1} HOUR, NOW() - INTERVAL ${hrs} HOUR,'${failed ? 'failed' : 'success'}',
    '${i % 3 === 0 ? 'hook' : 'schedule'}','${failed ? 'rsync' : 'done'}',${failed ? 62 : 100},
    ${failed ? 41200000000 : 60000000000 + i * 37000000000},${failed ? 18400 : 22000 + i * 9000},7200,
    ${failed ? "'rsync exited 30 — connection timed out while transferring SRV-FILES-03'" : 'NULL'})`);
}
for (let i = 0; i < 4; i++) {
  const hrs = 6 + i * 24;
  runs.push(`('bbbbbbb${i}-2222-4222-8222-222222222222','22222222-2222-4222-8222-222222222222',
    NOW() - INTERVAL ${hrs + 2} HOUR, NOW() - INTERVAL ${hrs} HOUR,'success','schedule','done',100,
    ${120000000000 + i * 51000000000},${44000 + i * 11000},21600,NULL)`);
}
mysqlDemo(`INSERT INTO replication_runs
  (id,target_id,started_at,finished_at,status,trigger_type,step,progress,bytes_sent,files_sent,lag_seconds,error_message)
  VALUES ${runs.join(',')};`);
mysqlDemo(`INSERT INTO replication_settings (id,enabled) VALUES (1,1) ON DUPLICATE KEY UPDATE enabled=1;`);

writeFileSync(join(OUT, 'demo.env'), [
  `DB_HOST=${env.DB_HOST || 'localhost'}`,
  `DB_PORT=${env.DB_PORT || 3306}`,
  `DB_USER=${env.DB_USER}`,
  `DB_PASSWORD=${env.DB_PASSWORD}`,
  `DB_NAME=${DB_NAME}`,
  `JWT_SECRET=${env.JWT_SECRET}`,
  `APP_SECRET_KEY=${env.APP_SECRET_KEY}`,
  `URBACKUP_DB_PATH=${demoDb}`,
  `URBACKUP_API_URL=http://127.0.0.1:9714/x`,
  `URBACKUP_URL=http://127.0.0.1:9714`,
  `URBACKUP_SERVER_FQDN=backup.example.com`,
  `ST0R_DISK_GUARD_ENABLED=1`,
  `NODE_ENV=production`,
  '',
].join('\n'));

console.log(`
Demo environment ready.
  UrBackup DB : ${demoDb}
  Settings DB : ${demoSettingsDb}
  Storage     : ${storage}
  App DB      : ${DB_NAME}
  Env file    : ${join(OUT, 'demo.env')}
  Sign in as  : demo / (see scripts/demo/README.md)
`);

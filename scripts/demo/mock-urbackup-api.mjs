#!/usr/bin/env node
/**
 * A minimal stand-in for UrBackup's HTTP API, used only when capturing
 * screenshots of the demo environment.
 *
 * It exists so the demo instance never talks to a real UrBackup server: no
 * backup can be started, no setting can be written, and no real client data can
 * leak into a screenshot. Every value it returns is fictitious.
 *
 *   node scripts/demo/mock-urbackup-api.mjs [--port 9714]
 */
import http from 'http';

const port = Number(process.argv[process.argv.indexOf('--port') + 1]) || 9714;

const CLIENTS = [
  { id: 1, name: 'SRV-APP-01',     ip: '10.20.4.11', online: true },
  { id: 2, name: 'SRV-DB-02',      ip: '10.20.4.12', online: true },
  { id: 3, name: 'SRV-FILES-03',   ip: '10.20.4.18', online: true },
  { id: 4, name: 'SRV-MAIL-04',    ip: '10.20.4.21', online: true },
  { id: 5, name: 'WS-FINANCE-04',  ip: '10.20.9.34', online: true },
  { id: 6, name: 'WS-DESIGN-09',   ip: '10.20.9.41', online: true },
  { id: 7, name: 'WS-SUPPORT-02',  ip: '10.20.9.52', online: true },
  { id: 8, name: 'LT-SALES-07',    ip: '10.20.9.77', online: false },
  { id: 9, name: 'NAS-ARCHIVE-01', ip: '10.20.4.30', online: true },
];

// Jobs shown as in progress, so activity and progress views have real content.
const PROGRESS = [
  { clientid: 3, name: 'SRV-FILES-03',  action: 1, pcdone: 64, done_bytes: 41_200_000_000, total_bytes: 64_400_000_000, speed_bpms: 31_400, eta_ms: 1_380_000, logid: 9001, image: false },
  { clientid: 2, name: 'SRV-DB-02',     action: 2, pcdone: 28, done_bytes: 18_900_000_000, total_bytes: 67_500_000_000, speed_bpms: 24_100, eta_ms: 3_120_000, logid: 9002, image: true },
  { clientid: 9, name: 'NAS-ARCHIVE-01',action: 1, pcdone: 91, done_bytes: 88_100_000_000, total_bytes: 96_800_000_000, speed_bpms: 18_600, eta_ms: 420_000,  logid: 9003, image: false },
];

const S = (value, use = 2) => ({ use, value: String(value), value_client: String(value), value_group: String(value) });

const clientSettings = (id) => {
  const c = CLIENTS.find((x) => x.id === Number(id)) || CLIENTS[0];
  return {
    settings: {
      clientname: c.name,
      overwrite: S('true'),
      update_freq_incr: S(3600), update_freq_full: S(604800),
      update_freq_image_incr: S(604800), update_freq_image_full: S(5184000),
      min_file_incr: S(5), max_file_incr: S(20), min_file_full: S(2), max_file_full: S(5),
      min_image_incr: S(4), max_image_incr: S(10), min_image_full: S(1), max_image_full: S(2),
      backup_window_incr_file: S('1-7/0-24'), backup_window_full_file: S('1-7/20-7'),
      backup_window_incr_image: S('1-7/0-24'), backup_window_full_image: S('1-7/20-7'),
      computername: S(c.name),
      // Obviously-fake placeholder: credential fields stay masked in the UI.
      internet_authkey: S('demo-key-not-a-real-secret'),
      default_dirs: S('C:\\Users|Users;C:\\ProgramData|ProgramData'),
      exclude_files: S(':\\pagefile.sys;:\\hiberfil.sys;:\\swapfile.sys;:\\$Recycle.Bin'),
      include_files: S(''),
      image_letters: S('C'),
      local_speed: S(0), internet_speed: S(0),
      local_full_image_style: S('full'), local_incr_image_style: S('to-full'),
      internet_mode_enabled: S('true'), internet_full_file_backups: S('true'), internet_image_backups: S('true'),
      internet_encrypt: S('true'), internet_compress: S('true'),
      allow_overwrite: S('true'), allow_config_paths: S('true'), allow_starting_full_file_backups: S('true'),
      allow_starting_incr_file_backups: S('true'), allow_starting_full_image_backups: S('true'),
      allow_starting_incr_image_backups: S('true'), allow_pause: S('true'), allow_log_view: S('true'),
      allow_tray_exit: S('true'), client_set_settings: S('false'),
      background_backups: S('true'), max_running_jobs_per_client: S(1),
    },
  };
};

const readBody = (req) =>
  new Promise((done) => { let d = ''; req.on('data', (c) => (d += c)); req.on('end', () => done(d)); });

http
  .createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    const post = new URLSearchParams(await readBody(req));
    const a = url.searchParams.get('a') || post.get('a');
    const sa = url.searchParams.get('sa') || post.get('sa');
    res.setHeader('Content-Type', 'application/json');

    // No-password handshake: salt returns a session but no salt, then GET login.
    if (a === 'salt') return res.end(JSON.stringify({ ses: 'demosession', error: 0 }));
    if (a === 'login')
      return res.end(JSON.stringify({ success: true, session: 'demosession', ses: 'demosession', error: 0, admin: true }));

    if (a === 'status')
      return res.end(JSON.stringify({
        status: CLIENTS.map((c) => ({
          id: c.id, name: c.name, ip: c.ip, online: c.online, delete_pending: '0',
          no_backup_paths: false, file_ok: c.id !== 8, image_ok: true, os_simple: 'windows',
        })),
      }));

    if (a === 'progress') return res.end(JSON.stringify({ progress: PROGRESS }));
    if (a === 'settings' && sa === 'clientsettings')
      return res.end(JSON.stringify(clientSettings(post.get('t_clientid') || url.searchParams.get('t_clientid'))));
    if (a === 'settings')
      return res.end(JSON.stringify({
        settings: {
          backupfolder: '/srv/backups', internet_server: 'backup.example.com', internet_server_port: '55415',
          max_active_clients: '20', global_soft_fs_quota: '85%', cleanup_window: '1-7/3-5',
          // Notification settings, so the Email & Alerts screen shows a configured
          // state. The password stays empty — credential fields are never populated.
          mail_server: 'smtp.example.com', mail_serverport: '587',
          mail_username: 'backup-alerts@example.com', mail_password: '',
          mail_from: 'St0r Backup Alerts <backup-alerts@example.com>',
          mail_admin_addrs: 'ops@example.com', mail_ssl_only: '1', report_sendonly: '1',
          update_freq_incr: '3600', update_freq_full: '604800',
        },
      }));
    if (a === 'logs') return res.end(JSON.stringify({ logs: [], clients: CLIENTS.map((c) => ({ id: c.id, name: c.name })) }));

    // Anything not modelled is a no-op: the demo must never perform an action.
    res.end(JSON.stringify({ error: 0 }));
  })
  .listen(port, '127.0.0.1', () => console.log(`mock UrBackup API listening on 127.0.0.1:${port}`));

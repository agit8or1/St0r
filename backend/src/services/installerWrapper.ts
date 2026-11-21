import { execFile } from 'child_process';
import { mkdtemp, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { promisify } from 'util';
import { logger } from '../utils/logger.js';

const execFileAsync = promisify(execFile);

/**
 * UrBackup's installers only apply the settings baked into them (name, server,
 * authkey) when the computer has no client settings yet: the client copies
 * initial_settings.cfg to urbackup/data/settings.cfg only if that file does not
 * exist (urbackupclient/dllmain.cpp), and the Linux installer only writes
 * server_idents.txt when there is none. Installing over an existing client
 * therefore keeps its old name and key, and the server rejects it as an
 * unknown client.
 *
 * St0r wraps both installers so the existing client is removed first.
 */

/** Text that is safe inside an NSIS double-quoted string. */
export function nsisString(s: string): string {
  return s.replace(/[\r\n"`]/g, ' ').replace(/\$/g, '$$$$');
}

export function windowsWrapperScript(clientName: string, innerPath: string, outPath: string): string {
  const name = nsisString(clientName);
  return `Unicode true
ManifestDPIAware true
RequestExecutionLevel admin
SetCompress off
Name "UrBackup Client (${name})"
Caption "UrBackup Client setup for ${name}"
OutFile "${nsisString(outPath)}"
BrandingText "St0r"
ShowInstDetails show
!include "LogicLib.nsh"
!include "x64.nsh"
Page instfiles

Var OLD

; Removes a leftover UrBackup folder. Only a folder named UrBackup that holds
; UrBackup files is removed, whatever the registry said.
Function RemoveLeftovers
  \${If} $R0 == ""
    Return
  \${EndIf}
  StrCpy $R1 $R0 "" -9
  \${If} $R1 != "\\UrBackup"
    DetailPrint "Not removing $R0: it is not an UrBackup folder"
    Return
  \${EndIf}
  \${If} \${FileExists} "$R0\\urbackup\\*.*"
  \${OrIf} \${FileExists} "$R0\\UrBackupClientBackend.exe"
    DetailPrint "Removing the old settings in $R0"
    RMDir /r "$R0"
  \${EndIf}
FunctionEnd

Section
  \${If} \${RunningX64}
    SetRegView 64
  \${EndIf}

  DetailPrint "Stopping the UrBackup client..."
  nsExec::Exec 'sc.exe stop UrBackupClientBackend'
  Pop $0
  nsExec::Exec 'taskkill.exe /F /IM UrBackupClient.exe'
  Pop $0
  Sleep 3000
  nsExec::Exec 'taskkill.exe /F /IM UrBackupClientBackend.exe'
  Pop $0

  ReadRegStr $OLD HKLM "Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\UrBackup" "Path"
  \${If} $OLD != ""
  \${AndIf} \${FileExists} "$OLD\\Uninstall.exe"
    DetailPrint "Uninstalling the existing UrBackup client..."
    ExecWait '"$OLD\\Uninstall.exe" /S _?=$OLD' $0
    DetailPrint "Uninstaller finished (exit code $0)"
  \${EndIf}

  ; An existing settings.cfg would keep the old name and key.
  StrCpy $R0 $OLD
  Call RemoveLeftovers
  StrCpy $R0 "$PROGRAMFILES64\\UrBackup"
  Call RemoveLeftovers
  StrCpy $R0 "$PROGRAMFILES32\\UrBackup"
  Call RemoveLeftovers

  DetailPrint "Installing the UrBackup client for ${name}..."
  InitPluginsDir
  SetOutPath "$PLUGINSDIR"
  File "/oname=UrBackupClientSetup.exe" "${nsisString(innerPath)}"
  ExecWait '"$PLUGINSDIR\\UrBackupClientSetup.exe" /S' $0
  SetOutPath "$TEMP"
  \${If} $0 != 0
    DetailPrint "The UrBackup installer failed (exit code $0)."
    MessageBox MB_ICONSTOP "The UrBackup client could not be installed (exit code $0)."
    Abort
  \${EndIf}
  DetailPrint "The UrBackup client is installed. It connects to the server within a minute or two."
SectionEnd
`;
}

let makensisAvailable: boolean | null = null;

export async function hasMakensis(): Promise<boolean> {
  if (makensisAvailable !== null) return makensisAvailable;
  try {
    await execFileAsync('makensis', ['-VERSION'], { timeout: 10_000 });
    makensisAvailable = true;
  } catch {
    makensisAvailable = false;
    logger.warn('makensis not found (apt install nsis): Windows installers will not remove an existing client first');
  }
  return makensisAvailable;
}

/**
 * Reads a whole response body and checks it against Content-Length. UrBackup
 * closes the connection as it finishes sending, and a reader that falls behind
 * can lose the last part of the file, so anything short is an error.
 */
export async function readInstaller(response: Response): Promise<Buffer> {
  if (!response.body) throw new Error('UrBackup sent no installer');
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    size += value.length;
  }
  const expected = Number(response.headers.get('content-length'));
  if (expected && size !== expected) throw new Error(`UrBackup sent ${size} of ${expected} bytes of the installer`);
  return Buffer.concat(chunks, size);
}

/**
 * Builds the Windows wrapper around UrBackup's preconfigured installer.
 * The caller streams `path` and then calls `cleanup`.
 */
export async function buildWindowsWrapper(inner: Buffer, clientName: string): Promise<{ path: string; cleanup: () => Promise<void> }> {
  const dir = await mkdtemp(join(tmpdir(), 'st0r-installer-'));
  const cleanup = () => rm(dir, { recursive: true, force: true });
  try {
    const innerPath = join(dir, 'inner.exe');
    const outPath = join(dir, 'setup.exe');
    const scriptPath = join(dir, 'setup.nsi');
    await writeFile(innerPath, inner);
    await writeFile(scriptPath, windowsWrapperScript(clientName, innerPath, outPath), 'utf8');
    await execFileAsync('makensis', ['-V2', '-INPUTCHARSET', 'UTF8', scriptPath], { timeout: 120_000, maxBuffer: 4 * 1024 * 1024 });
    return { path: outPath, cleanup };
  } catch (err) {
    await cleanup();
    throw err;
  }
}

/**
 * A shell header that resets an existing UrBackup client, then runs UrBackup's
 * own installer (appended after the header) with the arguments given.
 * Mirrors what uninstall_urbackupclient removes, without its prompt.
 */
export function linuxWrapperHeader(clientName: string): string {
  const safeName = clientName.replace(/[^A-Za-z0-9 ._()-]/g, '?');
  const body = `#!/bin/sh
# UrBackup client installer for "${safeName}", from St0r.
# UrBackup only applies an installer's settings to a computer with no client
# settings yet, so an existing client's settings are removed first. UrBackup's
# own installer follows this header.
set -e
if [ "$(id -u)" != 0 ]; then
  echo "Run this installer as root, for example: sudo sh $0" >&2
  exit 1
fi
P=/usr/local/var/urbackup
if [ -e "$P" ]; then
  echo "Removing the existing UrBackup client's settings..."
  if command -v systemctl >/dev/null 2>&1; then systemctl stop urbackupclientbackend.service 2>/dev/null || true; fi
  if [ -x /etc/init.d/urbackupclientbackend ]; then /etc/init.d/urbackupclientbackend stop 2>/dev/null || true; fi
  for f in data tokens backup_client.db backup_client.db-wal backup_client.db-shm server_idents.txt session_idents.txt \\
           new_server_idents.txt access_keys.properties initial_settings.cfg pw.txt pw_change.txt; do
    rm -rf "$P/$f"
  done
fi
T=$(mktemp "\${TMPDIR:-/tmp}/urbackup-installer.XXXXXX")
trap 'rm -f "$T"' EXIT
tail -n +__SKIP__ "$0" > "$T"
sh "$T" "$@"
exit $?
`;
  const lines = body.split('\n').length; // the payload starts on the line after the header
  return body.replace('__SKIP__', String(lines));
}

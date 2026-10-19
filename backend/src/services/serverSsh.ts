/**
 * serverSsh.ts
 * One-time SSH connection used to install the stor-agent on a remote server.
 * Uses the ssh2 library (pure Node.js, no subprocess needed).
 */
import { Client as SshClient } from 'ssh2';
import { logger } from '../utils/logger.js';
import { normalizeFingerprint } from './agentClient.js';

/**
 * Prints the SHA-256 fingerprint of the agent's self-signed certificate, or
 * nothing when the agent uses a certificate of its own (verified against CAs
 * instead) or has none. Mirrors the check at the end of agent/install.sh.
 */
export const AGENT_TLS_FINGERPRINT_CMD =
  "grep -Fqx 'STOR_AGENT_TLS_CERT=/etc/stor-agent/tls/agent.crt' /etc/stor-agent/tls.env 2>/dev/null" +
  " && openssl x509 -in /etc/stor-agent/tls/agent.crt -noout -fingerprint -sha256 | cut -d= -f2";

export interface SshTarget {
  host: string;
  ssh_port: number;
  ssh_user: string;
  auth_type: 'ssh_key' | 'password';
  ssh_private_key?: string; // decrypted PEM key
  ssh_password?: string;    // decrypted password
  ssh_known_host_fingerprint?: string | null;
}

function connectSsh(target: SshTarget): Promise<SshClient> {
  return new Promise((resolve, reject) => {
    const client = new SshClient();
    const timeout = setTimeout(() => {
      client.end();
      reject(new Error(`SSH connection to ${target.host}:${target.ssh_port} timed out`));
    }, 15000);

    client.on('ready', () => {
      clearTimeout(timeout);
      resolve(client);
    });

    client.on('error', (err) => {
      clearTimeout(timeout);
      reject(err);
    });

    const connectConfig: any = {
      host: target.host,
      port: target.ssh_port,
      username: target.ssh_user,
      readyTimeout: 12000,
    };

    if (target.auth_type === 'ssh_key' && target.ssh_private_key) {
      connectConfig.privateKey = target.ssh_private_key;
    } else if (target.auth_type === 'password' && target.ssh_password) {
      connectConfig.password = target.ssh_password;
    }

    // Host key verification
    if (target.ssh_known_host_fingerprint) {
      connectConfig.hostVerifier = (hashedKey: Buffer | string) => {
        const presented = typeof hashedKey === 'string' ? hashedKey : hashedKey.toString('hex');
        return presented === target.ssh_known_host_fingerprint;
      };
    } else {
      // First connection — accept any key (fingerprint will be saved after)
      connectConfig.hostVerifier = () => true;
    }

    client.connect(connectConfig);
  });
}

function execSsh(client: SshClient, command: string): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  return new Promise((resolve, reject) => {
    let stdout = '';
    let stderr = '';
    client.exec(command, (err, stream) => {
      if (err) { reject(err); return; }
      stream.on('close', (code: number) => resolve({ stdout, stderr, exitCode: code || 0 }));
      stream.on('data', (data: Buffer) => { stdout += data.toString(); });
      stream.stderr.on('data', (data: Buffer) => { stderr += data.toString(); });
    });
  });
}

/**
 * Test SSH connectivity to a remote server.
 * Returns fingerprint + OS info on success.
 */
export async function testSshConnection(target: SshTarget): Promise<{
  ok: boolean;
  latencyMs: number;
  fingerprint?: string;
  hostname?: string;
  os?: string;
  error?: string;
}> {
  const start = Date.now();
  let client: SshClient | null = null;
  try {
    // Capture fingerprint
    let capturedFingerprint: string | null = null;
    const connectConfig: any = {
      host: target.host,
      port: target.ssh_port,
      username: target.ssh_user,
      readyTimeout: 12000,
      hostVerifier: (key: Buffer | string) => {
        capturedFingerprint = typeof key === 'string' ? key : key.toString('hex');
        return true; // accept all for test
      },
    };
    if (target.auth_type === 'ssh_key' && target.ssh_private_key) {
      connectConfig.privateKey = target.ssh_private_key;
    } else if (target.auth_type === 'password' && target.ssh_password) {
      connectConfig.password = target.ssh_password;
    }

    client = new SshClient();
    await new Promise<void>((resolve, reject) => {
      const t = setTimeout(() => { client!.end(); reject(new Error('Timeout')); }, 15000);
      client!.on('ready', () => { clearTimeout(t); resolve(); });
      client!.on('error', (e) => { clearTimeout(t); reject(e); });
      client!.connect(connectConfig);
    });

    const { stdout: hostnameOut } = await execSsh(client, 'hostname && cat /etc/os-release 2>/dev/null | grep PRETTY_NAME | cut -d= -f2 | tr -d \'"\'');
    const lines = hostnameOut.trim().split('\n');
    const hostname = lines[0];
    const os = lines[1] || '';

    return { ok: true, latencyMs: Date.now() - start, fingerprint: capturedFingerprint || undefined, hostname, os: os.trim() };
  } catch (e: any) {
    logger.warn(`[serverSsh] testConnection ${target.host}:${target.ssh_port} → ${e.message}`);
    return { ok: false, latencyMs: Date.now() - start, error: e.message };
  } finally {
    client?.end();
  }
}

/** Read over the same SSH session that installs the agent, so it is as trusted as that session. */
async function readAgentTlsFingerprint(client: SshClient): Promise<string | null> {
  const { stdout } = await execSsh(client, AGENT_TLS_FINGERPRINT_CMD);
  return normalizeFingerprint(stdout.trim());
}

/**
 * Install the stor-agent on a remote server via SSH.
 * Copies the agent directory, runs the install script, returns the generated
 * API key and, when the agent uses its self-signed certificate, that
 * certificate's fingerprint for the backend to pin.
 */
export async function installAgentViaSsh(
  target: SshTarget,
  agentDir: string,
  agentPort: number
): Promise<{ ok: boolean; apiKey?: string; tlsFingerprint?: string | null; error?: string }> {
  let client: SshClient | null = null;
  try {
    client = await connectSsh(target);
    logger.info(`[serverSsh] SSH connected to ${target.host}:${target.ssh_port} for agent install`);

    // Check if agent is already installed
    const checkResult = await execSsh(client, 'systemctl is-active stor-agent 2>/dev/null || echo not-installed');
    const isInstalled = !checkResult.stdout.trim().includes('not-installed') && !checkResult.stdout.trim().includes('inactive');

    // An agent installed before TLS has no tls.env and must be re-installed
    // to get a certificate; the installer keeps its API key.
    const hasTlsSettings = (await execSsh(client, 'test -e /etc/stor-agent/tls.env && echo yes || echo no')).stdout.trim() === 'yes';

    if (isInstalled && hasTlsSettings) {
      // Just retrieve the existing API key
      const keyResult = await execSsh(client, 'cat /etc/stor-agent/config.json 2>/dev/null || echo {}');
      try {
        const conf = JSON.parse(keyResult.stdout.trim());
        if (conf.api_key) {
          return { ok: true, apiKey: conf.api_key, tlsFingerprint: await readAgentTlsFingerprint(client) };
        }
      } catch { /* parse failed */ }
    }

    // Upload agent files using base64 + tar (no SCP needed)
    // Create a tar of the agent directory and pipe it over SSH
    const tarCmd = `tar czf - -C "${agentDir}" . | base64 -w 0`;
    const { execFile } = await import('child_process');
    const { promisify } = await import('util');
    const execFileAsync = promisify(execFile);

    let agentTarB64: string;
    try {
      const { stdout } = await execFileAsync('bash', ['-c', tarCmd]);
      agentTarB64 = stdout;
    } catch (e: any) {
      throw new Error(`Failed to pack agent: ${e.message}`);
    }

    // Upload and extract on remote
    const uploadCmd = [
      'mkdir -p /tmp/stor-agent-install',
      `echo "${agentTarB64}" | base64 -d | tar xzf - -C /tmp/stor-agent-install`,
      `chmod +x /tmp/stor-agent-install/install.sh`,
      `STOR_AGENT_PORT=${agentPort} bash /tmp/stor-agent-install/install.sh`,
      'rm -rf /tmp/stor-agent-install',
    ].join(' && ');

    const installResult = await execSsh(client, uploadCmd);
    logger.info(`[serverSsh] Agent install output: ${installResult.stdout.slice(-500)}`);

    if (installResult.exitCode !== 0) {
      throw new Error(`Install script failed (exit ${installResult.exitCode}): ${installResult.stderr.slice(-300)}`);
    }

    const tlsFingerprint = await readAgentTlsFingerprint(client);

    // Extract API key from install output
    const keyMatch = installResult.stdout.match(/API Key:\s*([a-f0-9]{64})/i);
    if (keyMatch) {
      return { ok: true, apiKey: keyMatch[1], tlsFingerprint };
    }

    // Fallback: read config file
    const readKey = await execSsh(client, 'cat /etc/stor-agent/config.json 2>/dev/null || echo {}');
    try {
      const conf = JSON.parse(readKey.stdout.trim());
      if (conf.api_key) return { ok: true, apiKey: conf.api_key, tlsFingerprint };
    } catch { /* parse failed */ }

    throw new Error('Agent installed but could not retrieve API key');
  } catch (e: any) {
    logger.error(`[serverSsh] installAgent ${target.host} failed: ${e.message}`);
    return { ok: false, error: e.message };
  } finally {
    client?.end();
  }
}

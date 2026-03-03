import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { readFileSync } from 'fs';
import { resolve } from 'path';

/**
 * Read a single key from a .env file without requiring dotenv.
 * Returns the value or null if the key is absent or the file can't be read.
 */
function readEnvKey(envPath: string, key: string): string | null {
  try {
    const contents = readFileSync(envPath, 'utf-8');
    for (const line of contents.split('\n')) {
      const trimmed = line.trim();
      if (trimmed.startsWith('#') || !trimmed.includes('=')) continue;
      const eqIdx = trimmed.indexOf('=');
      if (trimmed.slice(0, eqIdx).trim() === key) {
        return trimmed.slice(eqIdx + 1).trim() || null;
      }
    }
  } catch {
    // .env not present or not readable — silently skip
  }
  return null;
}

const backendEnv = resolve(__dirname, '../backend/.env');

// FQDN from backend settings (.env file) or from the process environment
const fqdn =
  readEnvKey(backendEnv, 'URBACKUP_SERVER_FQDN') ||
  process.env.URBACKUP_SERVER_FQDN ||
  null;

// If a FQDN is configured in Settings, restrict to it + localhost.
// If no FQDN is set yet, allow all hosts so the app isn't blocked while
// the administrator is still configuring it (matches pre-Vite-5 behaviour).
const allowedHosts: string[] | true = fqdn
  ? ['localhost', '127.0.0.1', fqdn]
  : true;

if (fqdn) {
  console.log(`[vite] Allowing host from settings: ${fqdn}`);
} else {
  console.log('[vite] URBACKUP_SERVER_FQDN not set — allowing all hosts. Set it in Settings to restrict access.');
}

export default defineConfig({
  plugins: [react()],
  server: {
    host: '0.0.0.0',
    port: 5173,
    allowedHosts,
    proxy: {
      '/api': 'http://localhost:3000',
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
  },
});

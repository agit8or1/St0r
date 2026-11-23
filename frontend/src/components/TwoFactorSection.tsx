import { useEffect, useState } from 'react';
import { Check, Copy, Key, Loader2, Smartphone } from 'lucide-react';

type Phase = 'loading' | 'off' | 'scan' | 'on' | 'disabling';

async function post(path: string, body?: Record<string, string>): Promise<any> {
  const response = await fetch(`/api/2fa/${path}`, {
    method: 'POST',
    credentials: 'include',
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `Request failed (${response.status})`);
  return data;
}

function CodeInput({ value, onChange, label }: { value: string; onChange: (v: string) => void; label: string }) {
  return (
    <input
      type="text"
      inputMode="numeric"
      autoComplete="one-time-code"
      aria-label={label}
      value={value}
      onChange={(e) => onChange(e.target.value.replace(/\D/g, '').slice(0, 6))}
      className="input w-32 text-center text-lg font-mono"
      placeholder="000000"
      maxLength={6}
    />
  );
}

/**
 * Turns two-factor authentication on or off for the signed-in user. Used on
 * the Profile and Settings pages (issue #60: both called the API wrongly).
 * Setup: POST /api/2fa/setup → QR code, then POST /api/2fa/verify {token}.
 * Turning it off needs a current code: POST /api/2fa/disable {token}.
 */
export function TwoFactorSection() {
  const [phase, setPhase] = useState<Phase>('loading');
  const [busy, setBusy] = useState(false);
  const [qrCode, setQrCode] = useState('');
  const [secret, setSecret] = useState('');
  const [code, setCode] = useState('');
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  useEffect(() => {
    fetch('/api/2fa/status', { credentials: 'include' })
      .then(r => (r.ok ? r.json() : { enabled: false }))
      .then(d => setPhase(d.enabled ? 'on' : 'off'))
      .catch(() => setPhase('off'));
  }, []);

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setMessage(null);
    try {
      await fn();
    } catch (err: any) {
      setMessage({ type: 'error', text: err.message || 'Something went wrong' });
    } finally {
      setBusy(false);
    }
  };

  const start = () => run(async () => {
    const data = await post('setup');
    setQrCode(data.qrCode);
    setSecret(data.secret);
    setCode('');
    setPhase('scan');
  });

  const verify = () => run(async () => {
    await post('verify', { token: code });
    setCode('');
    setSecret('');
    setQrCode('');
    setPhase('on');
    setMessage({ type: 'success', text: 'Two-factor authentication is on. You will be asked for a code each time you sign in.' });
  });

  const disable = () => run(async () => {
    await post('disable', { token: code });
    setCode('');
    setPhase('off');
    setMessage({ type: 'success', text: 'Two-factor authentication is off.' });
  });

  const copySecret = async () => {
    try {
      await navigator.clipboard.writeText(secret);
      setMessage({ type: 'success', text: 'Secret key copied.' });
    } catch {
      setMessage({ type: 'error', text: 'Could not copy. Select the key and copy it by hand.' });
    }
  };

  return (
    <div className="space-y-4">
      <h2 className="text-xl font-bold text-gray-900 dark:text-gray-100 flex items-center gap-2">
        <Smartphone className="h-5 w-5" />
        Two-Factor Authentication (2FA)
      </h2>

      {message && (
        <div role="status" className={`rounded-lg p-3 text-sm ${message.type === 'success' ? 'bg-green-50 dark:bg-green-900/20 text-green-800 dark:text-green-200 border border-green-200 dark:border-green-800' : 'bg-red-50 dark:bg-red-900/20 text-red-800 dark:text-red-200 border border-red-200 dark:border-red-800'}`}>
          {message.text}
        </div>
      )}

      {phase === 'loading' && <Loader2 className="h-5 w-5 animate-spin text-gray-400" />}

      {phase === 'off' && (
        <>
          <p className="text-gray-600 dark:text-gray-400">
            Add an extra layer of security to your account. You'll need an authenticator app such as
            Google Authenticator, Authy or Microsoft Authenticator.
          </p>
          <button onClick={start} disabled={busy} className="btn btn-primary flex items-center gap-2">
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Key className="h-4 w-4" />}
            {busy ? 'Setting up…' : 'Enable 2FA'}
          </button>
        </>
      )}

      {phase === 'scan' && (
        <>
          <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-4">
            <h3 className="font-semibold text-gray-900 dark:text-gray-100 mb-2">Step 1: Scan the QR code</h3>
            <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">Open your authenticator app and scan this code:</p>
            <div className="bg-white p-4 rounded-lg inline-block">
              <img src={qrCode} alt="QR code for your authenticator app" className="w-48 h-48" />
            </div>
            <p className="text-sm text-gray-600 dark:text-gray-400 mt-4 mb-2">Or enter this secret key by hand:</p>
            <div className="flex items-center gap-2">
              <code className="flex-1 p-2 bg-gray-900 text-green-400 rounded-sm font-mono text-sm break-all">{secret}</code>
              <button onClick={copySecret} className="p-2 hover:bg-gray-200 dark:hover:bg-gray-700 rounded-sm" title="Copy secret key" aria-label="Copy secret key">
                <Copy className="h-4 w-4" />
              </button>
            </div>
          </div>
          <div className="bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg p-4">
            <h3 className="font-semibold text-gray-900 dark:text-gray-100 mb-2">Step 2: Enter the code</h3>
            <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">Enter the 6-digit code your authenticator app shows:</p>
            <div className="flex flex-wrap items-center gap-2">
              <CodeInput value={code} onChange={setCode} label="Code from your authenticator app" />
              <button onClick={verify} disabled={busy || code.length !== 6} className="btn btn-primary">
                {busy ? 'Checking…' : 'Verify & Enable'}
              </button>
              <button onClick={() => { setPhase('off'); setCode(''); }} disabled={busy} className="btn btn-secondary">Cancel</button>
            </div>
          </div>
        </>
      )}

      {(phase === 'on' || phase === 'disabling') && (
        <>
          <div className="bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg p-4 flex items-center gap-3">
            <Check className="h-5 w-5 text-green-600 dark:text-green-400" />
            <div>
              <p className="font-semibold text-gray-900 dark:text-gray-100">2FA is on</p>
              <p className="text-sm text-gray-600 dark:text-gray-400">A code from your authenticator app is needed each time you sign in.</p>
            </div>
          </div>
          {phase === 'on' ? (
            <button onClick={() => { setPhase('disabling'); setCode(''); setMessage(null); }} className="btn bg-red-600 hover:bg-red-700 text-white">
              Disable 2FA
            </button>
          ) : (
            <div className="rounded-lg border border-red-200 dark:border-red-800 p-4 space-y-3">
              <p className="text-sm text-gray-700 dark:text-gray-300">Enter a current code from your authenticator app to turn 2FA off.</p>
              <div className="flex flex-wrap items-center gap-2">
                <CodeInput value={code} onChange={setCode} label="Current code from your authenticator app" />
                <button onClick={disable} disabled={busy || code.length !== 6} className="btn bg-red-600 hover:bg-red-700 text-white">
                  {busy ? 'Turning off…' : 'Turn off 2FA'}
                </button>
                <button onClick={() => { setPhase('on'); setCode(''); }} disabled={busy} className="btn btn-secondary">Cancel</button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

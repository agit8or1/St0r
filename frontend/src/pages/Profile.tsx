import { useState, useEffect } from 'react';
import {
  User,
  Mail,
  Lock,
  Shield,
  Smartphone,
  Key,
  Check,
  X,
  Copy,
  RefreshCw
} from 'lucide-react';
import { Layout } from '../components/Layout';
import { useAuth } from '../hooks/useAuth';

export function Profile() {
  const { user } = useAuth();
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Password change
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');

  // 2FA
  const [twoFactorEnabled, setTwoFactorEnabled] = useState(false);
  const [showQRCode, setShowQRCode] = useState(false);
  const [qrCodeUrl, setQrCodeUrl] = useState('');
  const [secret, setSecret] = useState('');
  const [verificationCode, setVerificationCode] = useState('');
  const [backupCodes, setBackupCodes] = useState<string[]>([]);

  useEffect(() => {
    loadTwoFactorStatus();
  }, []);

  const loadTwoFactorStatus = async () => {
    try {
      const response = await fetch('/api/profile/2fa/status', {
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('token')}`
        }
      });

      if (response.ok) {
        const data = await response.json();
        setTwoFactorEnabled(data.enabled);
      }
    } catch (err) {
      console.error('Failed to load 2FA status:', err);
    }
  };

  const handlePasswordChange = async (e: React.FormEvent) => {
    e.preventDefault();

    if (newPassword !== confirmPassword) {
      setMessage({ type: 'error', text: 'New passwords do not match' });
      return;
    }

    if (newPassword.length < 8) {
      setMessage({ type: 'error', text: 'Password must be at least 8 characters long' });
      return;
    }

    try {
      setLoading(true);
      const response = await fetch('/api/profile/change-password', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('token')}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          currentPassword,
          newPassword
        })
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to change password');
      }

      setMessage({ type: 'success', text: 'Password changed successfully' });
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
    } catch (err: any) {
      setMessage({ type: 'error', text: err.message });
    } finally {
      setLoading(false);
    }
  };

  const handleEnable2FA = async () => {
    try {
      setLoading(true);
      const response = await fetch('/api/profile/2fa/enable', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('token')}`
        }
      });

      if (!response.ok) {
        throw new Error('Failed to enable 2FA');
      }

      const data = await response.json();
      setQrCodeUrl(data.qrCode);
      setSecret(data.secret);
      setShowQRCode(true);
      setMessage({ type: 'success', text: 'Scan the QR code with your authenticator app' });
    } catch (err: any) {
      setMessage({ type: 'error', text: err.message });
    } finally {
      setLoading(false);
    }
  };

  const handleVerify2FA = async () => {
    try {
      setLoading(true);
      const response = await fetch('/api/profile/2fa/verify', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('token')}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ code: verificationCode })
      });

      if (!response.ok) {
        throw new Error('Invalid verification code');
      }

      const data = await response.json();
      setBackupCodes(data.backupCodes);
      setTwoFactorEnabled(true);
      setShowQRCode(false);
      setVerificationCode('');
      setMessage({ type: 'success', text: '2FA enabled successfully! Save your backup codes.' });
    } catch (err: any) {
      setMessage({ type: 'error', text: err.message });
    } finally {
      setLoading(false);
    }
  };

  const handleDisable2FA = async () => {
    if (!confirm('Are you sure you want to disable two-factor authentication?')) {
      return;
    }

    try {
      setLoading(true);
      const response = await fetch('/api/profile/2fa/disable', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('token')}`
        }
      });

      if (!response.ok) {
        throw new Error('Failed to disable 2FA');
      }

      setTwoFactorEnabled(false);
      setBackupCodes([]);
      setMessage({ type: 'success', text: '2FA disabled successfully' });
    } catch (err: any) {
      setMessage({ type: 'error', text: err.message });
    } finally {
      setLoading(false);
    }
  };

  const copySecret = () => {
    navigator.clipboard.writeText(secret);
    setMessage({ type: 'success', text: 'Secret copied to clipboard' });
  };

  const copyBackupCodes = () => {
    navigator.clipboard.writeText(backupCodes.join('\n'));
    setMessage({ type: 'success', text: 'Backup codes copied to clipboard' });
  };

  return (
    <Layout>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-center gap-4">
          <div className="p-3 bg-gradient-to-br from-blue-500 to-purple-600 rounded-xl">
            <User className="h-8 w-8 text-white" />
          </div>
          <div>
            <h1 className="text-3xl font-bold text-gray-900 dark:text-gray-100">Profile</h1>
            <p className="text-gray-600 dark:text-gray-400">Manage your account settings</p>
          </div>
        </div>

        {/* Messages */}
        {message && (
          <div className={`card ${
            message.type === 'success'
              ? 'bg-green-50 border-green-200 dark:bg-green-900/20 dark:border-green-800'
              : 'bg-red-50 border-red-200 dark:bg-red-900/20 dark:border-red-800'
          }`}>
            <div className="flex items-center gap-3">
              {message.type === 'success' ? (
                <Check className="h-5 w-5 text-green-600 dark:text-green-400" />
              ) : (
                <X className="h-5 w-5 text-red-600 dark:text-red-400" />
              )}
              <p className={message.type === 'success' ? 'text-green-800 dark:text-green-300' : 'text-red-800 dark:text-red-300'}>
                {message.text}
              </p>
            </div>
          </div>
        )}

        {/* Account Information */}
        <div className="card">
          <h2 className="text-xl font-bold text-gray-900 dark:text-gray-100 mb-4">Account Information</h2>
          <div className="space-y-4">
            <div className="flex items-center gap-3 p-3 bg-gray-50 dark:bg-gray-800 rounded-lg">
              <User className="h-5 w-5 text-gray-600 dark:text-gray-400" />
              <div>
                <p className="text-sm text-gray-600 dark:text-gray-400">Username</p>
                <p className="font-semibold text-gray-900 dark:text-gray-100">{user?.username}</p>
              </div>
            </div>

            <div className="flex items-center gap-3 p-3 bg-gray-50 dark:bg-gray-800 rounded-lg">
              <Mail className="h-5 w-5 text-gray-600 dark:text-gray-400" />
              <div>
                <p className="text-sm text-gray-600 dark:text-gray-400">Email</p>
                <p className="font-semibold text-gray-900 dark:text-gray-100">{user?.email || 'Not set'}</p>
              </div>
            </div>

            <div className="flex items-center gap-3 p-3 bg-gray-50 dark:bg-gray-800 rounded-lg">
              <Shield className="h-5 w-5 text-gray-600 dark:text-gray-400" />
              <div>
                <p className="text-sm text-gray-600 dark:text-gray-400">Role</p>
                <p className="font-semibold text-gray-900 dark:text-gray-100">
                  {user?.isAdmin ? 'Administrator' : 'User'}
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* Change Password */}
        <div className="card">
          <h2 className="text-xl font-bold text-gray-900 dark:text-gray-100 mb-4 flex items-center gap-2">
            <Lock className="h-5 w-5" />
            Change Password
          </h2>

          <form onSubmit={handlePasswordChange} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                Current Password
              </label>
              <input
                type="password"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                className="input w-full"
                required
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                New Password
              </label>
              <input
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                className="input w-full"
                required
                minLength={8}
              />
              <p className="text-xs text-gray-600 dark:text-gray-400 mt-1">Minimum 8 characters</p>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                Confirm New Password
              </label>
              <input
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                className="input w-full"
                required
              />
            </div>

            <button
              type="submit"
              disabled={loading}
              className="btn btn-primary"
            >
              {loading ? 'Changing Password...' : 'Change Password'}
            </button>
          </form>
        </div>

        {/* Two-Factor Authentication */}
        <div className="card">
          <h2 className="text-xl font-bold text-gray-900 dark:text-gray-100 mb-4 flex items-center gap-2">
            <Smartphone className="h-5 w-5" />
            Two-Factor Authentication (2FA)
          </h2>

          {!twoFactorEnabled && !showQRCode && (
            <div className="space-y-4">
              <p className="text-gray-600 dark:text-gray-400">
                Add an extra layer of security to your account by enabling two-factor authentication.
                You'll need an authenticator app like Google Authenticator, Authy, or Microsoft Authenticator.
              </p>

              <button
                onClick={handleEnable2FA}
                disabled={loading}
                className="btn btn-primary"
              >
                <Key className="h-4 w-4 mr-2" />
                {loading ? 'Setting up...' : 'Enable 2FA'}
              </button>
            </div>
          )}

          {showQRCode && (
            <div className="space-y-4">
              <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-4">
                <h3 className="font-semibold text-gray-900 dark:text-gray-100 mb-2">Step 1: Scan QR Code</h3>
                <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">
                  Open your authenticator app and scan this QR code:
                </p>

                <div className="bg-white p-4 rounded-lg inline-block">
                  <img src={qrCodeUrl} alt="2FA QR Code" className="w-48 h-48" />
                </div>

                <div className="mt-4">
                  <p className="text-sm text-gray-600 dark:text-gray-400 mb-2">
                    Or manually enter this secret key:
                  </p>
                  <div className="flex items-center gap-2">
                    <code className="flex-1 p-2 bg-gray-900 text-green-400 rounded font-mono text-sm break-all">
                      {secret}
                    </code>
                    <button
                      onClick={copySecret}
                      className="p-2 hover:bg-gray-200 dark:hover:bg-gray-700 rounded"
                      title="Copy secret"
                    >
                      <Copy className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              </div>

              <div className="bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg p-4">
                <h3 className="font-semibold text-gray-900 dark:text-gray-100 mb-2">Step 2: Verify Code</h3>
                <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">
                  Enter the 6-digit code from your authenticator app:
                </p>

                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    value={verificationCode}
                    onChange={(e) => setVerificationCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                    className="input w-32 text-center text-lg font-mono"
                    placeholder="000000"
                    maxLength={6}
                  />
                  <button
                    onClick={handleVerify2FA}
                    disabled={loading || verificationCode.length !== 6}
                    className="btn btn-primary"
                  >
                    {loading ? 'Verifying...' : 'Verify & Enable'}
                  </button>
                </div>
              </div>
            </div>
          )}

          {twoFactorEnabled && (
            <div className="space-y-4">
              <div className="bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg p-4">
                <div className="flex items-center gap-3">
                  <Check className="h-5 w-5 text-green-600 dark:text-green-400" />
                  <div>
                    <p className="font-semibold text-gray-900 dark:text-gray-100">2FA is Enabled</p>
                    <p className="text-sm text-gray-600 dark:text-gray-400">
                      Your account is protected with two-factor authentication
                    </p>
                  </div>
                </div>
              </div>

              {backupCodes.length > 0 && (
                <div className="bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-lg p-4">
                  <h3 className="font-semibold text-gray-900 dark:text-gray-100 mb-2 flex items-center gap-2">
                    <Key className="h-4 w-4" />
                    Backup Codes
                  </h3>
                  <p className="text-sm text-gray-600 dark:text-gray-400 mb-3">
                    Save these backup codes in a safe place. You can use them to access your account if you lose your authenticator device.
                  </p>

                  <div className="bg-gray-900 dark:bg-gray-950 rounded-lg p-4 mb-3">
                    <div className="grid grid-cols-2 gap-2 font-mono text-sm text-green-400">
                      {backupCodes.map((code, index) => (
                        <div key={index}>{code}</div>
                      ))}
                    </div>
                  </div>

                  <button
                    onClick={copyBackupCodes}
                    className="btn btn-secondary text-sm"
                  >
                    <Copy className="h-4 w-4 mr-2" />
                    Copy Backup Codes
                  </button>
                </div>
              )}

              <button
                onClick={handleDisable2FA}
                disabled={loading}
                className="btn bg-red-600 hover:bg-red-700 text-white"
              >
                {loading ? 'Disabling...' : 'Disable 2FA'}
              </button>
            </div>
          )}
        </div>
      </div>
    </Layout>
  );
}

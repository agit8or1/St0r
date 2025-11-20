import { useState, FormEvent, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { AlertCircle, Info } from 'lucide-react';
import { useAuth } from '../hooks/useAuth';
import { Logo } from '../components/Logo';
import { PasswordChangeModal } from '../components/PasswordChangeModal';

export function Login() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [showDefaultCredentials, setShowDefaultCredentials] = useState(false);
  const [showPasswordModal, setShowPasswordModal] = useState(false);
  const { login } = useAuth();
  const navigate = useNavigate();

  // Check if system needs setup (default password still in use)
  useEffect(() => {
    const checkSetupStatus = async () => {
      try {
        const response = await fetch('/api/setup/status');
        const data = await response.json();
        setShowDefaultCredentials(data.needsSetup);
      } catch (err) {
        console.error('Failed to check setup status:', err);
      }
    };
    checkSetupStatus();
  }, []);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      // Check if using default credentials
      const isDefaultLogin = username === 'admin' && password === 'admin123';

      await login(username, password);

      // If logged in with default password, show password change modal
      if (isDefaultLogin) {
        setShowPasswordModal(true);
      } else {
        navigate('/');
      }
    } catch (err: any) {
      setError(err.response?.data?.error || 'Login failed. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const handlePasswordChanged = () => {
    // Password changed successfully, hide modal and credentials box
    setShowPasswordModal(false);
    setShowDefaultCredentials(false);
    // Navigate to main page
    navigate('/');
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-primary-50 to-primary-100">
      <div className="w-full max-w-md">
        <div className="card">
          {/* Logo */}
          <div className="mb-8 text-center">
            <div className="flex justify-center mb-4">
              <Logo size="lg" showText={true} />
            </div>
            <p className="mt-2 text-sm text-gray-600">Sign in to your account</p>
          </div>

          {/* Default credentials notice */}
          {showDefaultCredentials && (
            <div className="mb-4 flex items-start gap-3 rounded-lg bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 p-4 text-sm text-blue-700 dark:text-blue-300">
              <Info className="h-5 w-5 mt-0.5 flex-shrink-0" />
              <div>
                <p className="font-semibold mb-1">First-time Setup</p>
                <p className="mb-2">Use these default credentials to sign in:</p>
                <div className="font-mono bg-blue-100 dark:bg-blue-900/40 rounded px-2 py-1 text-xs">
                  <div>Username: <strong>admin</strong></div>
                  <div>Password: <strong>admin123</strong></div>
                </div>
                <p className="mt-2 text-xs">You'll be prompted to change the password after signing in.</p>
              </div>
            </div>
          )}

          {/* Error message */}
          {error && (
            <div className="mb-4 flex items-center gap-2 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 p-3 text-sm text-red-700 dark:text-red-400">
              <AlertCircle className="h-4 w-4" />
              {error}
            </div>
          )}

          {/* Login form */}
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label htmlFor="username" className="label">
                Username
              </label>
              <input
                id="username"
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                className="input"
                placeholder="Enter your username"
                required
                disabled={loading}
              />
            </div>

            <div>
              <label htmlFor="password" className="label">
                Password
              </label>
              <input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="input"
                placeholder="Enter your password"
                required
                disabled={loading}
              />
            </div>

            <button
              type="submit"
              className="btn btn-primary w-full"
              disabled={loading}
            >
              {loading ? 'Signing in...' : 'Sign in'}
            </button>
          </form>
        </div>
      </div>

      {/* Password Change Modal */}
      {showPasswordModal && (
        <PasswordChangeModal onPasswordChanged={handlePasswordChanged} />
      )}
    </div>
  );
}

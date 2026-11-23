import { useState } from 'react';
import {
  User,
  Mail,
  Lock,
  Shield,
  Check,
  X,
} from 'lucide-react';
import { Layout } from '../components/Layout';
import { Tooltip } from '../components/Tooltip';
import { TwoFactorSection } from '../components/TwoFactorSection';
import { useAuth } from '../hooks/useAuth';

export function Profile() {
  const { user } = useAuth();
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Password change
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');

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

      // The password change revokes every prior session, including this one.
      localStorage.removeItem('user');
      localStorage.removeItem('token');
      window.location.assign('/login');
    } catch (err: any) {
      setMessage({ type: 'error', text: err.message });
    } finally {
      setLoading(false);
    }
  };

  return (
    <Layout>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-center gap-4">
          <div className="p-3 bg-linear-to-br from-blue-500 to-purple-600 rounded-xl">
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
            <Tooltip text="Your login username — contact an admin to change it" className="block">
              <div className="flex items-center gap-3 p-3 bg-gray-50 dark:bg-gray-800 rounded-lg">
                <User className="h-5 w-5 text-gray-600 dark:text-gray-400" />
                <div>
                  <p className="text-sm text-gray-600 dark:text-gray-400">Username</p>
                  <p className="font-semibold text-gray-900 dark:text-gray-100">{user?.username}</p>
                </div>
              </div>
            </Tooltip>

            <Tooltip text="Email address associated with this account" className="block">
              <div className="flex items-center gap-3 p-3 bg-gray-50 dark:bg-gray-800 rounded-lg">
                <Mail className="h-5 w-5 text-gray-600 dark:text-gray-400" />
                <div>
                  <p className="text-sm text-gray-600 dark:text-gray-400">Email</p>
                  <p className="font-semibold text-gray-900 dark:text-gray-100">{user?.email || 'Not set'}</p>
                </div>
              </div>
            </Tooltip>

            <Tooltip text="Administrator accounts have full access; Users have read-only access" className="block">
              <div className="flex items-center gap-3 p-3 bg-gray-50 dark:bg-gray-800 rounded-lg">
                <Shield className="h-5 w-5 text-gray-600 dark:text-gray-400" />
                <div>
                  <p className="text-sm text-gray-600 dark:text-gray-400">Role</p>
                  <p className="font-semibold text-gray-900 dark:text-gray-100">
                    {user?.isAdmin ? 'Administrator' : 'User'}
                  </p>
                </div>
              </div>
            </Tooltip>
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
              <Tooltip text="Enter your existing password to confirm your identity" className="block">
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  Current Password
                </label>
              </Tooltip>
              <Tooltip text="Your current login password — required to authorise this change" className="block">
                <input
                  type="password"
                  value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)}
                  className="input w-full"
                  autoComplete="current-password"
                  required
                />
              </Tooltip>
            </div>

            <div>
              <Tooltip text="Choose a strong password — minimum 8 characters" className="block">
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  New Password
                </label>
              </Tooltip>
              <Tooltip text="Must be at least 8 characters; use letters, numbers and symbols" className="block">
                <input
                  type="password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  className="input w-full"
                  autoComplete="new-password"
                  required
                  minLength={8}
                />
              </Tooltip>
              <p className="text-xs text-gray-600 dark:text-gray-400 mt-1">Minimum 8 characters</p>
            </div>

            <div>
              <Tooltip text="Re-enter your new password to prevent typos" className="block">
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  Confirm New Password
                </label>
              </Tooltip>
              <Tooltip text="Must exactly match the New Password field above" className="block">
                <input
                  type="password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  className="input w-full"
                  autoComplete="new-password"
                  required
                />
              </Tooltip>
            </div>

            <Tooltip text="Save the new password — you will stay logged in">
              <button
                type="submit"
                disabled={loading}
                className="btn btn-primary"
              >
                {loading ? 'Changing Password...' : 'Change Password'}
              </button>
            </Tooltip>
          </form>
        </div>

        {/* Two-Factor Authentication */}
        <div className="card">
          <TwoFactorSection />
        </div>
      </div>
    </Layout>
  );
}

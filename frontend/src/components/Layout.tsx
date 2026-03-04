import { ReactNode, useState } from 'react';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import {
  LayoutDashboard,
  Server,
  Activity,
  Settings,
  LogOut,
  HardDrive,
  Moon,
  Sun,
  Users,
  Bell,
  FileText,
  Info,
  Bug,
  Usb,
  GitBranch,
  Heart,
  Star,
  X,
  ExternalLink
} from 'lucide-react';
import { useAuth } from '../hooks/useAuth';
import { useTheme } from '../contexts/ThemeContext';
import { Logo } from './Logo';
import { BugReportModal } from './BugReportModal';

interface LayoutProps {
  children: ReactNode;
}

export function Layout({ children }: LayoutProps) {
  const { user, logout } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const navigate = useNavigate();
  const location = useLocation();
  const [isBugReportOpen, setIsBugReportOpen] = useState(false);
  const [showSupportModal, setShowSupportModal] = useState(false);

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  const navItems = [
    { path: '/', label: 'Dashboard', icon: LayoutDashboard },
    { path: '/clients', label: 'Endpoints', icon: HardDrive },
    { path: '/bare-metal-restore', label: 'Bare Metal Restore', icon: Usb },
    { path: '/activities', label: 'Activities', icon: Activity },
    { path: '/logs', label: 'Logs', icon: FileText },
    { path: '/customers', label: 'Customers', icon: Users },
    { path: '/alerts', label: 'Alerts', icon: Bell },
    { path: '/reports', label: 'Reports', icon: FileText },
    { path: '/replication', label: 'Replication', icon: GitBranch },
    { path: '/users', label: 'Users', icon: Users },
    { path: '/docs', label: 'Documentation', icon: FileText },
    { path: '/settings', label: 'Settings', icon: Settings },
    { path: '/about', label: 'About', icon: Info },
  ];

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      {/* Sidebar */}
      <aside className="fixed left-0 top-0 h-full w-64 bg-white dark:bg-gray-800 shadow-lg">
        <div className="flex h-full flex-col">
          {/* Logo */}
          <div className="flex items-center justify-between border-b dark:border-gray-700 px-6 py-4">
            <Logo size="md" showText={true} />
            <button
              onClick={toggleTheme}
              className="rounded-lg p-2 hover:bg-gray-100 dark:hover:bg-gray-700"
              title="Toggle theme"
            >
              {theme === 'light' ? (
                <Moon className="h-5 w-5 text-gray-600 dark:text-gray-300" />
              ) : (
                <Sun className="h-5 w-5 text-gray-600 dark:text-gray-300" />
              )}
            </button>
          </div>

          {/* Navigation */}
          <nav className="flex-1 space-y-1 px-3 py-4">
            {navItems.map((item) => {
              const Icon = item.icon;
              const isActive = location.pathname === item.path;

              return (
                <Link
                  key={item.path}
                  to={item.path}
                  className={`flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                    isActive
                      ? 'bg-primary-50 text-primary-700 dark:bg-primary-900 dark:text-primary-300'
                      : 'text-gray-700 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-700'
                  }`}
                >
                  <Icon className="h-5 w-5" />
                  {item.label}
                </Link>
              );
            })}
            <button
              onClick={() => setShowSupportModal(true)}
              className="w-full flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors text-pink-600 hover:bg-pink-50 dark:text-pink-400 dark:hover:bg-pink-900/20"
            >
              <Heart className="h-5 w-5 fill-current" />
              Support This Project
            </button>
          </nav>

          {/* Report Bug Button */}
          <div className="px-3 pb-3">
            <button
              onClick={() => setIsBugReportOpen(true)}
              className="w-full flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors bg-red-600 hover:bg-red-700 text-white"
              title="Report a Bug"
            >
              <Bug className="h-5 w-5" />
              Report Bug
            </button>
          </div>

          {/* User info */}
          <div className="border-t dark:border-gray-700 p-4">
            <div className="flex items-center justify-between">
              <button
                onClick={() => navigate('/profile')}
                className="flex-1 min-w-0 text-left p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
                title="View Profile"
              >
                <p className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">
                  {user?.username}
                </p>
                <p className="text-xs text-gray-500 dark:text-gray-400 truncate">{user?.email}</p>
              </button>
              <button
                onClick={handleLogout}
                className="ml-2 rounded-lg p-2 text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 hover:text-gray-700 dark:hover:text-gray-300"
                title="Logout"
              >
                <LogOut className="h-5 w-5" />
              </button>
            </div>
          </div>
        </div>
      </aside>

      {/* Main content */}
      <main className="ml-64 min-h-screen">
        <div className="p-8">{children}</div>
      </main>

      {/* Bug Report Modal */}
      <BugReportModal
        isOpen={isBugReportOpen}
        onClose={() => setIsBugReportOpen(false)}
      />

      {/* Support Modal */}
      {showSupportModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-60 backdrop-blur-sm" onClick={() => setShowSupportModal(false)}>
          <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-2xl w-full max-w-md mx-4 overflow-hidden border border-gray-200 dark:border-gray-700" onClick={e => e.stopPropagation()}>
            <div className="bg-gradient-to-r from-pink-500 to-rose-500 p-6 relative">
              <button onClick={() => setShowSupportModal(false)} className="absolute top-4 right-4 text-white/80 hover:text-white transition-colors">
                <X className="h-5 w-5" />
              </button>
              <div className="flex items-center gap-3">
                <Heart className="h-8 w-8 text-white fill-current" />
                <div>
                  <h2 className="text-xl font-bold text-white">Support St0r</h2>
                  <p className="text-pink-100 text-sm">Help keep this project alive and growing</p>
                </div>
              </div>
            </div>
            <div className="p-6 space-y-3">
              <a href="https://github.com/sponsors/agit8or1" target="_blank" rel="noopener noreferrer"
                className="flex items-center gap-4 p-4 rounded-xl border-2 border-pink-200 dark:border-pink-800 hover:border-pink-400 dark:hover:border-pink-600 hover:bg-pink-50 dark:hover:bg-pink-900/20 transition-all group">
                <div className="w-10 h-10 rounded-full bg-pink-100 dark:bg-pink-900/40 flex items-center justify-center flex-shrink-0">
                  <Heart className="h-5 w-5 text-pink-600 dark:text-pink-400 fill-current" />
                </div>
                <div className="flex-1">
                  <p className="font-semibold text-gray-900 dark:text-gray-100">Sponsor on GitHub</p>
                  <p className="text-sm text-gray-500 dark:text-gray-400">Support development with a monthly contribution</p>
                </div>
                <ExternalLink className="h-4 w-4 text-gray-400 group-hover:text-pink-500 transition-colors flex-shrink-0" />
              </a>
              <a href="https://github.com/agit8or1/St0r" target="_blank" rel="noopener noreferrer"
                className="flex items-center gap-4 p-4 rounded-xl border-2 border-yellow-200 dark:border-yellow-800 hover:border-yellow-400 dark:hover:border-yellow-600 hover:bg-yellow-50 dark:hover:bg-yellow-900/20 transition-all group">
                <div className="w-10 h-10 rounded-full bg-yellow-100 dark:bg-yellow-900/40 flex items-center justify-center flex-shrink-0">
                  <Star className="h-5 w-5 text-yellow-500 fill-current" />
                </div>
                <div className="flex-1">
                  <p className="font-semibold text-gray-900 dark:text-gray-100">Star on GitHub</p>
                  <p className="text-sm text-gray-500 dark:text-gray-400">Give the project a star — it really helps!</p>
                </div>
                <ExternalLink className="h-4 w-4 text-gray-400 group-hover:text-yellow-500 transition-colors flex-shrink-0" />
              </a>
              <a href="https://mspreboot.com" target="_blank" rel="noopener noreferrer"
                className="flex items-center gap-4 p-4 rounded-xl border-2 border-blue-200 dark:border-blue-800 hover:border-blue-400 dark:hover:border-blue-600 hover:bg-blue-50 dark:hover:bg-blue-900/20 transition-all group">
                <div className="w-10 h-10 rounded-full bg-blue-100 dark:bg-blue-900/40 flex items-center justify-center flex-shrink-0">
                  <Star className="h-5 w-5 text-blue-600 dark:text-blue-400" />
                </div>
                <div className="flex-1">
                  <p className="font-semibold text-gray-900 dark:text-gray-100">MSP Reboot</p>
                  <p className="text-sm text-gray-500 dark:text-gray-400">Support the business behind St0r</p>
                </div>
                <ExternalLink className="h-4 w-4 text-gray-400 group-hover:text-blue-500 transition-colors flex-shrink-0" />
              </a>
            </div>
            <div className="px-6 pb-6 text-center">
              <p className="text-xs text-gray-500 dark:text-gray-400">Thank you for using St0r! Your support means everything.</p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

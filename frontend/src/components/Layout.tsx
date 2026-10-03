import { ReactNode } from 'react';
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
} from 'lucide-react';
import { useAuth } from '../hooks/useAuth';
import { useTheme } from '../contexts/ThemeContext';
import { Logo } from './Logo';
import { Tooltip } from './Tooltip';
import { HelpUsGrowButton } from './HelpUsGrowButton';

interface LayoutProps {
  children: ReactNode;
}

export function Layout({ children }: LayoutProps) {
  const { user, logout } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const navigate = useNavigate();
  const location = useLocation();

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  // `adminOnly` pages expose server-wide data or configuration. Read-only,
  // customer-scoped accounts never see them (the API rejects them too).
  const allNavItems = [
    { path: '/', label: 'Dashboard', icon: LayoutDashboard, tip: 'Overview of backup status and system health' },
    { path: '/clients', label: 'Endpoints', icon: HardDrive, tip: 'Manage and monitor backup endpoints' },
    // Scoped per endpoint, not per role: the client picker and the image export
    // are both filtered to the caller's customers, so read-only accounts can
    // restore their own endpoints.
    { path: '/bare-metal-restore', label: 'Bare Metal Restore', icon: Usb, tip: 'Restore a full system image to bare metal' },
    { path: '/activities', label: 'Activities', icon: Activity, tip: 'View running and recent backup jobs' },
    { path: '/logs', label: 'Logs', icon: FileText, tip: 'Browse backup and system log entries', adminOnly: true },
    { path: '/customers', label: 'Customers', icon: Users, tip: 'Manage customer accounts and endpoint assignments' },
    { path: '/alerts', label: 'Alerts', icon: Bell, tip: 'View and manage backup alerts' },
    { path: '/reports', label: 'Reports', icon: FileText, tip: 'Generate and view backup reports' },
    { path: '/replication', label: 'Replication', icon: GitBranch, tip: 'Configure offsite backup replication targets', adminOnly: true },
    { path: '/servers', label: 'Servers', icon: Server, tip: 'Manage this server and remote servers', adminOnly: true },
    { path: '/users', label: 'Users', icon: Users, tip: 'Manage St0r user accounts and permissions', adminOnly: true },
    { path: '/docs', label: 'Documentation', icon: FileText, tip: 'View and generate endpoint documentation' },
    { path: '/settings', label: 'Settings', icon: Settings, tip: 'Configure server, backup, and notification settings', adminOnly: true },
    { path: '/about', label: 'About', icon: Info, tip: 'About St0r and version information' },
  ];

  const navItems = user?.isAdmin ? allNavItems : allNavItems.filter((item) => !item.adminOnly);

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      {/* Sidebar */}
      <aside className="fixed left-0 top-0 h-full w-64 bg-white dark:bg-gray-800 shadow-lg">
        <div className="flex h-full flex-col">
          {/* Logo */}
          <div className="flex items-center justify-between border-b dark:border-gray-700 px-6 py-4">
            <Logo size="md" showText={true} />
            <Tooltip text={theme === 'light' ? 'Switch to dark mode' : 'Switch to light mode'} position="right">
              <button
                onClick={toggleTheme}
                className="rounded-lg p-2 hover:bg-gray-100 dark:hover:bg-gray-700"
              >
                {theme === 'light' ? (
                  <Moon className="h-5 w-5 text-gray-600 dark:text-gray-300" />
                ) : (
                  <Sun className="h-5 w-5 text-gray-600 dark:text-gray-300" />
                )}
              </button>
            </Tooltip>
          </div>

          {/* Navigation */}
          <nav className="flex-1 space-y-1 px-3 py-4">
            {navItems.map((item) => {
              const Icon = item.icon;
              const isActive = location.pathname === item.path;

              return (
                <Tooltip key={item.path} text={item.tip} position="right" className="w-full">
                  <Link
                    to={item.path}
                    className={`w-full flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                      isActive
                        ? 'bg-primary-50 text-primary-700 dark:bg-primary-900 dark:text-primary-300'
                        : 'text-gray-700 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-700'
                    }`}
                  >
                    <Icon className="h-5 w-5" />
                    {item.label}
                  </Link>
                </Tooltip>
              );
            })}
            <Tooltip text="Share St0r, star it on GitHub, or support development" position="right" className="w-full">
              <HelpUsGrowButton variant="nav" />
            </Tooltip>
          </nav>

          {/* Report Bug Button */}
          <div className="px-3 pb-3">
            <Tooltip text="Report a bug or issue on GitHub" position="right" className="w-full">
              <a
                href="https://github.com/agit8or1/St0r/issues/new"
                target="_blank"
                rel="noopener noreferrer"
                className="w-full flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors bg-red-600 hover:bg-red-700 text-white"
              >
                <Bug className="h-5 w-5" />
                Report Bug
              </a>
            </Tooltip>
          </div>

          {/* User info */}
          <div className="border-t dark:border-gray-700 p-4">
            <div className="flex items-center justify-between">
              <Tooltip text="View and edit your profile" position="right" className="flex-1 min-w-0">
                <button
                  onClick={() => navigate('/profile')}
                  className="w-full text-left p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
                >
                  <p className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">
                    {user?.username}
                  </p>
                  <p className="text-xs text-gray-500 dark:text-gray-400 truncate">{user?.email}</p>
                </button>
              </Tooltip>
              <Tooltip text="Log out" position="right">
                <button
                  onClick={handleLogout}
                  className="ml-2 rounded-lg p-2 text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 hover:text-gray-700 dark:hover:text-gray-300"
                >
                  <LogOut className="h-5 w-5" />
                </button>
              </Tooltip>
            </div>
          </div>
        </div>
      </aside>

      {/* Main content */}
      <main className="ml-64 min-h-screen">
        <div className="p-8">{children}</div>
      </main>

    </div>
  );
}

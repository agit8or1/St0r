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
  Usb
} from 'lucide-react';
import { useAuth } from '../hooks/useAuth';
import { useTheme } from '../contexts/ThemeContext';
import { Logo } from './Logo';
import { UpdateNotification } from './UpdateNotification';
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

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  const navItems = [
    { path: '/', label: 'Dashboard', icon: LayoutDashboard },
    { path: '/clients', label: 'Clients', icon: HardDrive },
    { path: '/bare-metal-restore', label: 'Bare Metal Restore', icon: Usb },
    { path: '/activities', label: 'Activities', icon: Activity },
    { path: '/logs', label: 'Logs', icon: FileText },
    { path: '/customers', label: 'Customers', icon: Users },
    { path: '/alerts', label: 'Alerts', icon: Bell },
    { path: '/reports', label: 'Reports', icon: FileText },
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

      {/* Update Notification */}
      <UpdateNotification />

      {/* Bug Report Modal */}
      <BugReportModal
        isOpen={isBugReportOpen}
        onClose={() => setIsBugReportOpen(false)}
      />
    </div>
  );
}

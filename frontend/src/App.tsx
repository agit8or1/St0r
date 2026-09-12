import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { ThemeProvider } from './contexts/ThemeContext';
import { TooltipsProvider } from './contexts/TooltipContext';
import { useAuth } from './hooks/useAuth';
import { Login } from './pages/Login';
import { Dashboard } from './pages/Dashboard';
import { Clients } from './pages/Clients';
import { ClientDetail } from './pages/ClientDetail';
import { FileBrowser } from './pages/FileBrowser';
import { BareMetalRestore } from './pages/BareMetalRestore';
import { ClientSettings } from './pages/ClientSettings';
import { Activities } from './pages/Activities';
import { Logs } from './pages/Logs';
import { Settings } from './pages/Settings';
import { Customers } from './pages/Customers';
import { Alerts } from './pages/Alerts';
import { Reports } from './pages/Reports';
import { Users } from './pages/Users';
import { About } from './pages/About';
import { Documentation } from './pages/Documentation';
import { Profile } from './pages/Profile';
import ServerSettings from './pages/ServerSettings';
import { Replication } from './pages/Replication';
import { ReplicationTargetDetail } from './pages/ReplicationTargetDetail';
import { Servers } from './pages/Servers';
import { Loading } from './components/Loading';
import { UpdateNotification } from './components/UpdateNotification';

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, loading } = useAuth();

  if (loading) {
    return <Loading />;
  }

  return isAuthenticated ? <>{children}</> : <Navigate to="/login" />;
}

/** Admin-only page: read-only, customer-scoped accounts are sent to the dashboard. */
function AdminRoute({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, loading, user } = useAuth();

  if (loading) {
    return <Loading />;
  }
  if (!isAuthenticated) {
    return <Navigate to="/login" />;
  }
  return user?.isAdmin ? <>{children}</> : <Navigate to="/" replace />;
}

function AuthenticatedUpdateNotification() {
  const { isAuthenticated } = useAuth();
  return isAuthenticated ? <UpdateNotification /> : null;
}

function App() {
  return (
    <ThemeProvider>
      <TooltipsProvider>
      {/* v7_startTransition and v7_relativeSplatPath were opt-in flags under
          react-router 6; both are the default in 7, and the prop no longer
          accepts them. Behaviour is unchanged — this app already ran with them on. */}
      <BrowserRouter>
        <AuthenticatedUpdateNotification />
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route
            path="/"
            element={
              <ProtectedRoute>
                <Dashboard />
              </ProtectedRoute>
            }
          />
          <Route
            path="/clients"
            element={
              <ProtectedRoute>
                <Clients />
              </ProtectedRoute>
            }
          />
          <Route
            path="/clients/:clientName"
            element={
              <ProtectedRoute>
                <ClientDetail />
              </ProtectedRoute>
            }
          />
          <Route
            path="/clients/:clientName/browse"
            element={
              <ProtectedRoute>
                <FileBrowser />
              </ProtectedRoute>
            }
          />
          <Route
            path="/clients/:clientName/settings"
            element={
              <AdminRoute>
                <ClientSettings />
              </AdminRoute>
            }
          />
          <Route
            path="/bare-metal-restore"
            element={
              <ProtectedRoute>
                <BareMetalRestore />
              </ProtectedRoute>
            }
          />
          <Route
            path="/activities"
            element={
              <ProtectedRoute>
                <Activities />
              </ProtectedRoute>
            }
          />
          <Route
            path="/logs"
            element={
              <AdminRoute>
                <Logs />
              </AdminRoute>
            }
          />
          <Route
            path="/customers"
            element={
              <ProtectedRoute>
                <Customers />
              </ProtectedRoute>
            }
          />
          <Route
            path="/alerts"
            element={
              <ProtectedRoute>
                <Alerts />
              </ProtectedRoute>
            }
          />
          <Route
            path="/reports"
            element={
              <ProtectedRoute>
                <Reports />
              </ProtectedRoute>
            }
          />
          <Route
            path="/server-settings"
            element={
              <AdminRoute>
                <ServerSettings />
              </AdminRoute>
            }
          />
          <Route
            path="/settings"
            element={
              <AdminRoute>
                <Settings />
              </AdminRoute>
            }
          />
          <Route
            path="/users"
            element={
              <AdminRoute>
                <Users />
              </AdminRoute>
            }
          />
          <Route
            path="/about"
            element={
              <ProtectedRoute>
                <About />
              </ProtectedRoute>
            }
          />
          <Route
            path="/docs"
            element={
              <ProtectedRoute>
                <Documentation />
              </ProtectedRoute>
            }
          />
          <Route
            path="/profile"
            element={
              <ProtectedRoute>
                <Profile />
              </ProtectedRoute>
            }
          />
          <Route
            path="/replication"
            element={
              <AdminRoute>
                <Replication />
              </AdminRoute>
            }
          />
          <Route
            path="/replication/targets/:id"
            element={
              <AdminRoute>
                <ReplicationTargetDetail />
              </AdminRoute>
            }
          />
          <Route
            path="/servers"
            element={
              <AdminRoute>
                <Servers />
              </AdminRoute>
            }
          />
        </Routes>
      </BrowserRouter>
      </TooltipsProvider>
    </ThemeProvider>
  );
}

export default App;

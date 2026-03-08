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
import { Loading } from './components/Loading';
import { UpdateNotification } from './components/UpdateNotification';

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, loading } = useAuth();

  if (loading) {
    return <Loading />;
  }

  return isAuthenticated ? <>{children}</> : <Navigate to="/login" />;
}

function AuthenticatedUpdateNotification() {
  const { isAuthenticated } = useAuth();
  return isAuthenticated ? <UpdateNotification /> : null;
}

function App() {
  return (
    <ThemeProvider>
      <TooltipsProvider>
      <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
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
              <ProtectedRoute>
                <ClientSettings />
              </ProtectedRoute>
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
              <ProtectedRoute>
                <Logs />
              </ProtectedRoute>
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
              <ProtectedRoute>
                <ServerSettings />
              </ProtectedRoute>
            }
          />
          <Route
            path="/settings"
            element={
              <ProtectedRoute>
                <Settings />
              </ProtectedRoute>
            }
          />
          <Route
            path="/users"
            element={
              <ProtectedRoute>
                <Users />
              </ProtectedRoute>
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
              <ProtectedRoute>
                <Replication />
              </ProtectedRoute>
            }
          />
          <Route
            path="/replication/targets/:id"
            element={
              <ProtectedRoute>
                <ReplicationTargetDetail />
              </ProtectedRoute>
            }
          />
        </Routes>
      </BrowserRouter>
      </TooltipsProvider>
    </ThemeProvider>
  );
}

export default App;

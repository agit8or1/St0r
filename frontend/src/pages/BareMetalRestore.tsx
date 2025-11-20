import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ArrowLeft,
  HardDrive,
  Download,
  Server as ServerIcon,
  AlertCircle,
  CheckCircle,
  Usb,
  FileText,
  ExternalLink,
} from 'lucide-react';
import { Layout } from '../components/Layout';
import { Loading } from '../components/Loading';
import { api } from '../services/api';
import type { Client } from '../types';

interface ImageBackup {
  id: number;
  backuptime: number;
  size_bytes: number;
  incremental: boolean;
  path?: string;
  letter?: string;
}

export function BareMetalRestore() {
  const navigate = useNavigate();
  const [clients, setClients] = useState<Client[]>([]);
  const [selectedClient, setSelectedClient] = useState<Client | null>(null);
  const [imageBackups, setImageBackups] = useState<ImageBackup[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingBackups, setLoadingBackups] = useState(false);

  useEffect(() => {
    loadClients();
  }, []);

  const loadClients = async () => {
    try {
      setLoading(true);
      const data = await api.getClients();
      // Filter to clients with image backups
      const clientsWithImages = data.filter(c => c.lastbackup_image);
      setClients(clientsWithImages);
    } catch (err) {
      console.error('Failed to load clients:', err);
    } finally {
      setLoading(false);
    }
  };

  const loadImageBackups = async (clientId: string | number) => {
    try {
      setLoadingBackups(true);
      const backups = await api.getBackups(clientId.toString());

      // Filter image backups
      const imageBackupsList: ImageBackup[] = Array.isArray(backups)
        ? backups.filter((b: any) => b.image).map((b: any) => ({
            id: b.id,
            backuptime: b.backuptime,
            size_bytes: b.size_bytes || 0,
            incremental: b.incremental,
            path: b.path,
            letter: b.letter,
          }))
        : [];

      setImageBackups(imageBackupsList);
    } catch (err) {
      console.error('Failed to load image backups:', err);
      setImageBackups([]);
    } finally {
      setLoadingBackups(false);
    }
  };

  const handleClientSelect = (client: Client) => {
    setSelectedClient(client);
    loadImageBackups(client.id);
  };

  const formatBytes = (bytes: number) => {
    if (!bytes) return 'N/A';
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    let size = bytes;
    let unitIndex = 0;
    while (size >= 1024 && unitIndex < units.length - 1) {
      size /= 1024;
      unitIndex++;
    }
    return `${size.toFixed(2)} ${units[unitIndex]}`;
  };

  const formatDate = (timestamp: number) => {
    return new Date(timestamp).toLocaleString();
  };

  const downloadRestoreCD = () => {
    window.open('https://www.urbackup.org/download.html#restore_cd', '_blank');
  };

  return (
    <Layout>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <button
              onClick={() => navigate('/clients')}
              className="mb-2 flex items-center gap-2 text-sm text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200"
            >
              <ArrowLeft className="h-4 w-4" />
              Back to Clients
            </button>
            <h1 className="text-3xl font-bold text-gray-900 dark:text-gray-100 flex items-center gap-3">
              <HardDrive className="h-8 w-8" />
              Bare Metal Restore
            </h1>
            <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
              Restore complete system images to bare metal or new hardware
            </p>
          </div>
        </div>

        {/* Download Restore CD/USB Tool */}
        <div className="card bg-gradient-to-r from-blue-50 to-indigo-50 dark:from-blue-900/20 dark:to-indigo-900/20">
          <div className="flex items-start gap-4">
            <div className="rounded-full bg-blue-100 dark:bg-blue-900 p-3">
              <Usb className="h-8 w-8 text-blue-600 dark:text-blue-400" />
            </div>
            <div className="flex-1">
              <h2 className="text-xl font-semibold text-gray-900 dark:text-gray-100 mb-2">
                Step 1: Download UrBackup Restore CD/USB
              </h2>
              <p className="text-gray-700 dark:text-gray-300 mb-4">
                To perform a bare metal restore, you'll need the UrBackup Restore CD. This bootable image allows you to restore system backups to bare metal or new hardware.
              </p>
              <div className="grid gap-3 md:grid-cols-2">
                <button
                  onClick={downloadRestoreCD}
                  className="flex items-center gap-3 p-4 rounded-lg bg-white dark:bg-gray-800 border-2 border-blue-500 dark:border-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/20 transition-colors"
                >
                  <Download className="h-6 w-6 text-blue-600 dark:text-blue-400" />
                  <div className="text-left">
                    <p className="font-semibold text-gray-900 dark:text-gray-100">Download Restore CD ISO</p>
                    <p className="text-sm text-gray-600 dark:text-gray-400">Bootable ISO for CD/DVD or USB</p>
                  </div>
                  <ExternalLink className="h-4 w-4 text-gray-400 ml-auto" />
                </button>
                <a
                  href="https://rufus.ie/"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-3 p-4 rounded-lg bg-white dark:bg-gray-800 border-2 border-gray-300 dark:border-gray-700 hover:border-blue-500 dark:hover:border-blue-400 transition-colors"
                >
                  <Usb className="h-6 w-6 text-gray-600 dark:text-gray-400" />
                  <div className="text-left">
                    <p className="font-semibold text-gray-900 dark:text-gray-100">Rufus USB Tool</p>
                    <p className="text-sm text-gray-600 dark:text-gray-400">Create bootable USB from ISO</p>
                  </div>
                  <ExternalLink className="h-4 w-4 text-gray-400 ml-auto" />
                </a>
              </div>
            </div>
          </div>
        </div>

        {/* Instructions */}
        <div className="card">
          <div className="flex items-center gap-3 mb-4">
            <FileText className="h-6 w-6 text-gray-600 dark:text-gray-400" />
            <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
              Step 2: Restore Instructions
            </h2>
          </div>

          <div className="space-y-4">
            <div className="flex gap-4">
              <div className="flex-shrink-0 w-8 h-8 rounded-full bg-blue-100 dark:bg-blue-900 flex items-center justify-center text-blue-600 dark:text-blue-400 font-bold">
                1
              </div>
              <div>
                <h3 className="font-semibold text-gray-900 dark:text-gray-100 mb-1">Create Bootable USB</h3>
                <p className="text-sm text-gray-600 dark:text-gray-400">
                  Download the UrBackup Restore CD ISO and use Rufus (Windows) or dd (Linux/Mac) to create a bootable USB drive.
                </p>
                <code className="block mt-2 p-2 bg-gray-100 dark:bg-gray-800 rounded text-xs">
                  # Linux/Mac example:<br />
                  sudo dd if=urbackup-restore.iso of=/dev/sdX bs=4M status=progress
                </code>
              </div>
            </div>

            <div className="flex gap-4">
              <div className="flex-shrink-0 w-8 h-8 rounded-full bg-blue-100 dark:bg-blue-900 flex items-center justify-center text-blue-600 dark:text-blue-400 font-bold">
                2
              </div>
              <div>
                <h3 className="font-semibold text-gray-900 dark:text-gray-100 mb-1">Boot from USB</h3>
                <p className="text-sm text-gray-600 dark:text-gray-400">
                  Insert the USB drive into the target computer and boot from it (press F12, F2, or DEL during startup to access boot menu).
                </p>
              </div>
            </div>

            <div className="flex gap-4">
              <div className="flex-shrink-0 w-8 h-8 rounded-full bg-blue-100 dark:bg-blue-900 flex items-center justify-center text-blue-600 dark:text-blue-400 font-bold">
                3
              </div>
              <div>
                <h3 className="font-semibold text-gray-900 dark:text-gray-100 mb-1">Configure Network</h3>
                <p className="text-sm text-gray-600 dark:text-gray-400">
                  Once booted, configure network settings to connect to your UrBackup server. The restore environment will automatically detect DHCP.
                </p>
              </div>
            </div>

            <div className="flex gap-4">
              <div className="flex-shrink-0 w-8 h-8 rounded-full bg-blue-100 dark:bg-blue-900 flex items-center justify-center text-blue-600 dark:text-blue-400 font-bold">
                4
              </div>
              <div>
                <h3 className="font-semibold text-gray-900 dark:text-gray-100 mb-1">Select Client & Backup</h3>
                <p className="text-sm text-gray-600 dark:text-gray-400">
                  In the restore interface, select the client name (see list below) and choose which image backup to restore from.
                </p>
              </div>
            </div>

            <div className="flex gap-4">
              <div className="flex-shrink-0 w-8 h-8 rounded-full bg-blue-100 dark:bg-blue-900 flex items-center justify-center text-blue-600 dark:text-blue-400 font-bold">
                5
              </div>
              <div>
                <h3 className="font-semibold text-gray-900 dark:text-gray-100 mb-1">Start Restore</h3>
                <p className="text-sm text-gray-600 dark:text-gray-400">
                  Select the target disk and start the restore process. The system will overwrite the target disk with the backed-up image.
                </p>
                <div className="mt-2 p-3 bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-lg flex gap-2">
                  <AlertCircle className="h-5 w-5 text-yellow-600 dark:text-yellow-400 flex-shrink-0 mt-0.5" />
                  <p className="text-sm text-yellow-800 dark:text-yellow-200">
                    <strong>Warning:</strong> All data on the target disk will be erased during the restore process.
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Client Selection */}
        <div className="card">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-4">
            Step 3: Select Client for Restore
          </h2>

          {loading ? (
            <Loading />
          ) : clients.length === 0 ? (
            <div className="text-center py-12">
              <AlertCircle className="mx-auto h-12 w-12 text-gray-400" />
              <p className="mt-4 text-gray-600 dark:text-gray-400">
                No clients with image backups found
              </p>
            </div>
          ) : (
            <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
              {clients.map((client) => (
                <button
                  key={client.id}
                  onClick={() => handleClientSelect(client)}
                  className={`p-4 rounded-lg border-2 text-left transition-colors ${
                    selectedClient?.id === client.id
                      ? 'border-primary-600 bg-primary-50 dark:bg-primary-900/20'
                      : 'border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600'
                  }`}
                >
                  <div className="flex items-center gap-3 mb-2">
                    <ServerIcon className="h-5 w-5 text-primary-600 dark:text-primary-400" />
                    <span className="font-medium text-gray-900 dark:text-gray-100">
                      {client.name}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    {client.image_ok ? (
                      <CheckCircle className="h-4 w-4 text-green-600 dark:text-green-400" />
                    ) : (
                      <AlertCircle className="h-4 w-4 text-yellow-600 dark:text-yellow-400" />
                    )}
                    <span className="text-sm text-gray-600 dark:text-gray-400">
                      {client.image_ok ? 'Image OK' : 'Check required'}
                    </span>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Image Backups List */}
        {selectedClient && (
          <div className="card">
            <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-4">
              Available Image Backups for {selectedClient.name}
            </h2>

            {loadingBackups ? (
              <Loading />
            ) : imageBackups.length === 0 ? (
              <p className="text-center text-gray-600 dark:text-gray-400 py-8">
                No image backups available
              </p>
            ) : (
              <div className="space-y-2">
                {imageBackups.map((backup) => (
                  <div
                    key={backup.id}
                    className="flex items-center justify-between p-4 rounded-lg border border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700/50"
                  >
                    <div className="flex items-center gap-4">
                      <div className={`rounded-full p-2 ${
                        backup.incremental
                          ? 'bg-blue-100 dark:bg-blue-900'
                          : 'bg-green-100 dark:bg-green-900'
                      }`}>
                        <HardDrive className={`h-5 w-5 ${
                          backup.incremental
                            ? 'text-blue-600 dark:text-blue-400'
                            : 'text-green-600 dark:text-green-400'
                        }`} />
                      </div>
                      <div>
                        <p className="font-medium text-gray-900 dark:text-gray-100">
                          {backup.incremental ? 'Incremental' : 'Full'} Image Backup
                          {backup.letter && ` (Drive ${backup.letter}:)`}
                        </p>
                        <p className="text-sm text-gray-600 dark:text-gray-400">
                          {formatDate(backup.backuptime)} • {formatBytes(backup.size_bytes)}
                        </p>
                      </div>
                    </div>
                    <div className="text-sm text-gray-500 dark:text-gray-400">
                      Backup ID: {backup.id}
                    </div>
                  </div>
                ))}
              </div>
            )}

            <div className="mt-4 p-4 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg">
              <p className="text-sm text-blue-800 dark:text-blue-200">
                <strong>Note:</strong> You'll need the client name "<strong>{selectedClient.name}</strong>" when using the restore CD to identify this backup.
              </p>
            </div>
          </div>
        )}
      </div>
    </Layout>
  );
}

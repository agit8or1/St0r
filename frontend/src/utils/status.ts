// Map UrBackup status to human-readable strings
// Handles both string statuses from our backend and numeric codes from UrBackup API
export function getClientStatusText(statusCode: string | number | undefined): string {
  // Handle undefined/null
  if (statusCode === undefined || statusCode === null) {
    return 'Unknown';
  }

  // Handle string statuses from our backend
  if (typeof statusCode === 'string') {
    const lowerStatus = statusCode.toLowerCase();
    switch (lowerStatus) {
      case 'ok':
        return 'OK';
      case 'offline':
        return 'Offline';
      case 'failed':
        return 'Failed';
      case 'online':
        return 'Online';
      case 'unknown':
        return 'Unknown';
      default:
        // Try to parse as number for legacy numeric codes
        const parsed = parseInt(statusCode);
        if (!isNaN(parsed)) {
          return getNumericStatusText(parsed);
        }
        return statusCode.charAt(0).toUpperCase() + statusCode.slice(1);
    }
  }

  // Handle numeric codes
  return getNumericStatusText(statusCode);
}

function getNumericStatusText(status: number): string {
  switch (status) {
    case 0:
      return 'Idle';
    case 1:
      return 'Waiting for backup window';
    case 2:
      return 'Starting backup';
    case 3:
      return 'Scanning for changes';
    case 4:
      return 'Transferring files';
    case 5:
      return 'Resuming backup';
    case 6:
      return 'Image backup running';
    case 7:
      return 'Incremental file backup';
    case 8:
      return 'Full file backup';
    case 9:
      return 'Full image backup';
    case 10:
      return 'Incremental image backup';
    case 11:
      return 'Waiting for client';
    case 12:
      return 'No paths configured';
    default:
      return `Status ${status}`;
  }
}

// Get status color based on status code
export function getClientStatusColor(statusCode: string | number): 'green' | 'blue' | 'yellow' | 'gray' {
  // Handle string statuses from our backend
  if (typeof statusCode === 'string') {
    const lowerStatus = statusCode.toLowerCase();
    switch (lowerStatus) {
      case 'ok':
      case 'online':
        return 'green';
      case 'failed':
        return 'yellow';
      case 'offline':
        return 'gray';
      default:
        // Try to parse as number
        const parsed = parseInt(statusCode);
        if (!isNaN(parsed)) {
          return getNumericStatusColor(parsed);
        }
        return 'gray';
    }
  }

  return getNumericStatusColor(statusCode);
}

function getNumericStatusColor(status: number): 'green' | 'blue' | 'yellow' | 'gray' {
  if (status === 0) return 'green'; // Idle/OK
  if (status >= 1 && status <= 11) return 'blue'; // Active/backup in progress
  if (status === 12) return 'yellow'; // Warning - no paths configured
  return 'gray'; // Unknown
}

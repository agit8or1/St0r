import { formatDistanceToNow, format } from 'date-fns';

export function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
}

export function formatTimestamp(timestamp: number): string {
  if (!timestamp || timestamp === 0) return 'Never';
  // Backend already returns milliseconds, don't multiply by 1000
  return format(new Date(timestamp), 'MMM d, yyyy HH:mm');
}

export function formatTimeAgo(timestamp: number): string {
  // Handle null, undefined, 0, negative, or very old timestamps (before year 2000)
  if (!timestamp || timestamp <= 0 || timestamp < 946684800000) return 'Never';

  // Check if timestamp is in the future (system clock issues)
  const now = Date.now();
  if (timestamp > now + 86400000) return 'Never'; // More than 1 day in future

  // Backend already returns milliseconds, don't multiply by 1000
  return formatDistanceToNow(new Date(timestamp), { addSuffix: true });
}

export function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  return `${hours}h ${minutes}m`;
}

export function formatPercentage(value: number): string {
  return `${Math.round(value)}%`;
}

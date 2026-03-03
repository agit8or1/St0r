import os from 'os';
import net from 'net';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { logger } from '../utils/logger.js';

const execFileAsync = promisify(execFile);

export interface SystemMetrics {
  cpu: {
    usage: number;
    cores: number;
    model: string;
  };
  memory: {
    total: number;
    used: number;
    free: number;
    usagePercent: number;
  };
  disk: {
    total: number;
    used: number;
    free: number;
    usagePercent: number;
  };
  uptime: number;
  hostname: string;
}

export class SystemMonitor {
  private previousCpuInfo: { idle: number; total: number } | null = null;

  /**
   * Get CPU usage percentage
   */
  async getCpuUsage(): Promise<number> {
    const cpus = os.cpus();

    let idle = 0;
    let total = 0;

    cpus.forEach(cpu => {
      for (const type in cpu.times) {
        total += cpu.times[type as keyof typeof cpu.times];
      }
      idle += cpu.times.idle;
    });

    if (this.previousCpuInfo) {
      const idleDiff = idle - this.previousCpuInfo.idle;
      const totalDiff = total - this.previousCpuInfo.total;
      const usage = 100 - (100 * idleDiff / totalDiff);

      this.previousCpuInfo = { idle, total };
      return Math.max(0, Math.min(100, usage));
    }

    this.previousCpuInfo = { idle, total };
    return 0; // First call, no previous data
  }

  /**
   * Get memory information
   */
  getMemoryInfo() {
    const total = os.totalmem();
    const free = os.freemem();
    const used = total - free;
    const usagePercent = (used / total) * 100;

    return {
      total,
      used,
      free,
      usagePercent: Math.round(usagePercent * 100) / 100
    };
  }

  /**
   * Get disk information for the root filesystem
   */
  async getDiskInfo() {
    try {
      const { stdout } = await execFileAsync('df', ['-B1', '/']);
      const lines = stdout.trim().split('\n');
      const parts = lines[lines.length - 1].split(/\s+/);

      const total = parseInt(parts[1]);
      const used = parseInt(parts[2]);
      const free = parseInt(parts[3]);
      const usagePercent = parseInt(parts[4]);

      return {
        total,
        used,
        free,
        usagePercent
      };
    } catch (error) {
      logger.error('Failed to get disk info:', error);
      return {
        total: 0,
        used: 0,
        free: 0,
        usagePercent: 0
      };
    }
  }

  /**
   * Get comprehensive system metrics
   */
  async getMetrics(): Promise<SystemMetrics> {
    const cpus = os.cpus();
    const cpuUsage = await this.getCpuUsage();
    const memory = this.getMemoryInfo();
    const disk = await this.getDiskInfo();

    return {
      cpu: {
        usage: Math.round(cpuUsage * 100) / 100,
        cores: cpus.length,
        model: cpus[0]?.model || 'Unknown'
      },
      memory,
      disk,
      uptime: os.uptime(),
      hostname: os.hostname()
    };
  }

  /**
   * Test latency to UrBackup server
   */
  testLatency(host: string, port: number): Promise<number> {
    return new Promise((resolve) => {
      const start = Date.now();
      const socket = new net.Socket();

      socket.setTimeout(2000);

      socket.on('connect', () => {
        socket.destroy();
        resolve(Date.now() - start);
      });

      socket.on('error', () => {
        socket.destroy();
        resolve(-1);
      });

      socket.on('timeout', () => {
        socket.destroy();
        resolve(-1);
      });

      socket.connect(port, host);
    });
  }
}

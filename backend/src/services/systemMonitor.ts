import os from 'os';
import { exec } from 'child_process';
import { promisify } from 'util';
import { logger } from '../utils/logger.js';

const execAsync = promisify(exec);

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
      const { stdout } = await execAsync('df -B1 / | tail -1');
      const parts = stdout.trim().split(/\s+/);

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
  async testLatency(host: string, port: number): Promise<number> {
    const start = Date.now();

    try {
      // Use netcat to test connection
      await execAsync(`timeout 2 bash -c 'cat < /dev/null > /dev/tcp/${host}/${port}'`);
      const latency = Date.now() - start;
      return latency;
    } catch (error) {
      // If connection fails or times out, return -1
      return -1;
    }
  }
}

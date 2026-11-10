// In-memory DrillStore and config source for the drill tests (same contract as
// SqlDrillStore / SqlDrillConfig; the SQL versions are exercised against a
// throwaway MariaDB in recovery-sql.test.mjs).
export class MemoryStore {
  runs = new Map();
  resources = new Map();
  order = 0;
  async createRun(run) { this.runs.set(run.id, structuredClone(run)); }
  async updateRun(id, patch) { Object.assign(this.runs.get(id), structuredClone(patch)); }
  async getRun(id) { const r = this.runs.get(id); return r ? structuredClone(r) : null; }
  async runningRuns() { return [...this.runs.values()].filter((r) => r.status === 'running').map((r) => structuredClone(r)); }
  async lastRun(drillId, exclude = '') {
    return [...this.runs.values()].filter((r) => r.drill_id === drillId && r.id !== exclude && r.status !== 'running')
      .sort((a, b) => b.started_at - a.started_at)[0] ?? null;
  }
  async addResource(r) { this.resources.set(r.id, { ...r, state: 'creating', attempts: 0, last_error: null, seq: this.order++ }); }
  async updateResource(id, patch) { Object.assign(this.resources.get(id), patch); }
  async resourcesForRun(runId) { return [...this.resources.values()].filter((r) => r.run_id === runId).sort((a, b) => a.seq - b.seq).map((r) => ({ ...r })); }
  async liveResources() { return [...this.resources.values()].filter((r) => ['creating', 'created', 'delete_failed'].includes(r.state)).map((r) => ({ ...r })); }
}

export function drill(over = {}) {
  return {
    id: 'drill-1', name: 'Canary drill', kind: 'file', client_name: 'clientA', enabled: true,
    canary_id: 'canary-1', replication_target_id: 'target-1', hypervisor_id: null, boot_config: null,
    schedule_type: 'manual', interval_hours: 24, cron_expression: '0 3 * * *',
    max_recovery_point_age_hours: 48, timeout_seconds: 60, retry_max_attempts: 2, last_run_at: null,
    ...over,
  };
}

export class MemoryConfig {
  constructor({ drills = [], canaries = [], targets = [], hypervisors = [], repoPaths = [], channels = [], replication = {} } = {}) {
    Object.assign(this, { drills, canaries, targets, hypervisors, repoPaths, channels, replication });
    this.marked = [];
  }
  async getDrill(id) { return this.drills.find((d) => d.id === id) ?? null; }
  async listDrills() { return this.drills; }
  async getCanary(id) { return this.canaries.find((c) => c.id === id) ?? null; }
  async getTarget(id) { return this.targets.find((t) => t.id === id) ?? null; }
  async replicatedRepoPaths() { return this.repoPaths; }
  async lastReplication(id) { return this.replication[id] ?? { lastSuccess: null, last: null }; }
  async getHypervisor(id) { return this.hypervisors.find((h) => h.id === id) ?? null; }
  async alertChannels() { return this.channels; }
  async markRun(id, at) { this.marked.push([id, at]); }
}

export const quietLog = { info() {}, warn() {}, error() {} };

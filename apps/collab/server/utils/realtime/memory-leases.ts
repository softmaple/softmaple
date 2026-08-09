import {
  LeaseAcquireResult,
  type ConnectionLeaseStore,
  type LeaseAcquireResult as LeaseAcquireResultType,
} from "./types";

interface LeaseEntry {
  readonly connectionId: string;
  expiresAt: number;
}

export class MemoryConnectionLeaseStore implements ConnectionLeaseStore {
  private readonly scopes = new Map<string, Map<string, LeaseEntry>>();

  private purgeExpired(scope: string, now: number): Map<string, LeaseEntry> {
    const entries = this.scopes.get(scope) ?? new Map<string, LeaseEntry>();
    for (const [connectionId, entry] of entries) {
      if (entry.expiresAt <= now) entries.delete(connectionId);
    }
    if (entries.size === 0) this.scopes.delete(scope);
    else this.scopes.set(scope, entries);
    return entries;
  }

  async tryAcquire(
    scope: string,
    connectionId: string,
    maxConnections: number,
    ttlMs: number,
  ): Promise<LeaseAcquireResultType> {
    const now = Date.now();
    const entries = this.purgeExpired(scope, now);
    if (entries.has(connectionId)) return LeaseAcquireResult.Duplicate;
    if (entries.size >= maxConnections) return LeaseAcquireResult.Full;
    entries.set(connectionId, {
      connectionId,
      expiresAt: now + ttlMs,
    });
    this.scopes.set(scope, entries);
    return LeaseAcquireResult.Acquired;
  }

  async refresh(
    scope: string,
    connectionId: string,
    ttlMs: number,
  ): Promise<boolean> {
    const now = Date.now();
    const entries = this.purgeExpired(scope, now);
    const current = entries.get(connectionId);
    if (current === undefined) return false;
    entries.set(connectionId, {
      connectionId,
      expiresAt: now + ttlMs,
    });
    this.scopes.set(scope, entries);
    return true;
  }

  async release(scope: string, connectionId: string): Promise<void> {
    const entries = this.scopes.get(scope);
    if (entries === undefined) return;
    entries.delete(connectionId);
    if (entries.size === 0) this.scopes.delete(scope);
  }

  async close(): Promise<void> {
    this.scopes.clear();
  }
}

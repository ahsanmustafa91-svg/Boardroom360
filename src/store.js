// Persistence: Postgres when DATABASE_URL is set, otherwise in memory (for local demos).
// The whole tenant state lives in one JSONB document per tenant, with a version number
// that increases on every change so browsers can poll cheaply for updates.
'use strict';
const { seed } = require('./seed');

class MemoryStore {
  constructor() { this.state = null; }
  async init() { this.state = seed(); }
  async load() { return this.state; }
  async save(state) { this.state = state; }
  async audit() {}
  async kind() { return 'memory'; }
}

class PgStore {
  constructor(url) {
    const { Pool } = require('pg');
    // Local and Render-internal hosts (no dot in the hostname, e.g. dpg-xxx-a) connect without TLS.
    let host = '';
    try { host = new URL(url).hostname; } catch (e) { /* socket path or unusual URL */ }
    const local = !host || host === 'localhost' || host === '127.0.0.1' || !host.includes('.');
    const ssl = local || process.env.PGSSL === 'off' ? false : { rejectUnauthorized: false };
    this.pool = new Pool({ connectionString: url, ssl, max: 5 });
    this.tenant = process.env.TENANT_ID || 'demo';
    this.cache = null;
  }
  async init() {
    // A new database can take a minute or two to accept connections, so wait for it.
    for (let i = 0; ; i++) {
      try { await this.pool.query('SELECT 1'); break; } catch (e) {
        if (i >= 30) throw e;
        console.log(`Waiting for database (${e.code || e.message})…`);
        await new Promise((r) => setTimeout(r, 5000));
      }
    }
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS tenant_state (
        tenant_id TEXT PRIMARY KEY,
        version INTEGER NOT NULL,
        data JSONB NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
      CREATE TABLE IF NOT EXISTS audit_log (
        id BIGSERIAL PRIMARY KEY,
        tenant_id TEXT NOT NULL,
        at TIMESTAMPTZ NOT NULL DEFAULT now(),
        user_id TEXT,
        action TEXT NOT NULL,
        payload JSONB
      );`);
    const r = await this.pool.query('SELECT data FROM tenant_state WHERE tenant_id=$1', [this.tenant]);
    if (r.rows.length) this.cache = r.rows[0].data;
    else {
      this.cache = seed();
      await this.save(this.cache);
    }
  }
  async load() { return this.cache; }
  async save(state) {
    await this.pool.query(
      `INSERT INTO tenant_state (tenant_id, version, data, updated_at) VALUES ($1,$2,$3,now())
       ON CONFLICT (tenant_id) DO UPDATE SET version=EXCLUDED.version, data=EXCLUDED.data, updated_at=now()`,
      [this.tenant, state.version, state]);
    this.cache = state;
  }
  async audit(userId, action, payload) {
    try {
      await this.pool.query('INSERT INTO audit_log (tenant_id, user_id, action, payload) VALUES ($1,$2,$3,$4)', [this.tenant, userId, action, payload || {}]);
    } catch (e) { console.error('audit failed', e.message); }
  }
  async kind() { return 'postgres'; }
}

function createStore() {
  return process.env.DATABASE_URL ? new PgStore(process.env.DATABASE_URL) : new MemoryStore();
}

module.exports = { createStore };

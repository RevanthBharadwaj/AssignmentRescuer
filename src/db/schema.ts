/**
 * SQLite schema. Migrations are append only: never edit a shipped
 * migration, add a new one. `user_version` tracks the applied version.
 */
export const MIGRATIONS: string[] = [
  /* 1 */ `
  CREATE TABLE IF NOT EXISTS sources (
    id TEXT PRIMARY KEY,
    source_type TEXT NOT NULL,
    format TEXT NOT NULL,
    original_name TEXT NOT NULL,
    imported_at TEXT NOT NULL,
    content_hash TEXT NOT NULL UNIQUE,
    text TEXT NOT NULL,
    byte_size INTEGER NOT NULL,
    hints_json TEXT NOT NULL DEFAULT '{}',
    security_flags_json TEXT NOT NULL DEFAULT '[]',
    classifications_json TEXT NOT NULL DEFAULT '[]'
  );

  CREATE TABLE IF NOT EXISTS records (
    id TEXT PRIMARY KEY,
    entity_type TEXT NOT NULL,
    record_key TEXT NOT NULL,
    fields_json TEXT NOT NULL,
    unknown_fields_json TEXT NOT NULL DEFAULT '[]',
    confirmed_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE (entity_type, record_key)
  );
  CREATE INDEX IF NOT EXISTS idx_records_type ON records(entity_type);

  CREATE TABLE IF NOT EXISTS evidence (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    record_id TEXT NOT NULL REFERENCES records(id) ON DELETE CASCADE,
    source_id TEXT NOT NULL,
    provenance_json TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_evidence_record ON evidence(record_id);
  CREATE INDEX IF NOT EXISTS idx_evidence_source ON evidence(source_id);

  CREATE TABLE IF NOT EXISTS proposals (
    id TEXT PRIMARY KEY,
    kind TEXT NOT NULL,
    entity_type TEXT NOT NULL,
    record_key TEXT NOT NULL,
    target_record_id TEXT,
    proposal_json TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    created_at TEXT NOT NULL,
    resolved_at TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_proposals_status ON proposals(status);

  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value_json TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS change_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    record_id TEXT NOT NULL,
    proposal_id TEXT,
    changes_json TEXT NOT NULL,
    changed_at TEXT NOT NULL
  );
  `,
];

import type { SqlDriver, SqlValue } from './driver';
import { MIGRATIONS } from './schema';
import type {
  ChangeProposal,
  Classification,
  ConfirmedRecord,
  EntityType,
  Provenance,
  SourceDocument,
} from '../core/types';
import { applyProposal, type Resolution } from '../core/merge/merge';
import type { ImportResult } from '../core/pipeline';

type Row = Record<string, SqlValue>;

export class Repository {
  constructor(private readonly db: SqlDriver) {}

  async migrate(): Promise<void> {
    const [row] = await this.db.select<{ user_version: number }>('PRAGMA user_version');
    const current = Number(row?.user_version ?? 0);
    for (let v = current; v < MIGRATIONS.length; v++) {
      await this.db.transaction(async () => {
        await this.db.execute(MIGRATIONS[v]);
        await this.db.execute(`PRAGMA user_version = ${v + 1}`);
      });
    }
  }

  // ---------- sources ----------

  async sourceHashes(): Promise<Map<string, string>> {
    const rows = await this.db.select<{ id: string; content_hash: string }>('SELECT id, content_hash FROM sources');
    return new Map(rows.map((r) => [r.content_hash, r.id]));
  }

  async saveImport(result: ImportResult): Promise<void> {
    const reread = new Set(result.duplicateInputs.filter((d) => d.reprocessed).map((d) => d.existingSourceId));
    await this.db.transaction(async () => {
      for (const { source, classifications } of result.sources) {
        await this.insertSource(source, classifications);
        // Re-read content: keep the original row but record the latest course and kind.
        if (reread.has(source.id)) {
          await this.db.execute('UPDATE sources SET hints_json = ?, classifications_json = ? WHERE id = ?', [JSON.stringify(source.hints), JSON.stringify(classifications), source.id]);
        }
      }
      for (const p of result.proposals) await this.insertProposal(p);
    });
  }

  private async insertSource(s: SourceDocument, cls: Classification[]): Promise<void> {
    await this.db.execute(
      // A re-read of earlier content keeps its original source row.
      `INSERT OR IGNORE INTO sources (id, source_type, format, original_name, imported_at, content_hash, text, byte_size, hints_json, security_flags_json, classifications_json, page_offsets_json)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
      [s.id, s.sourceType, s.format, s.originalName, s.importedAt, s.contentHash, s.text, s.byteSize,
        JSON.stringify(s.hints), JSON.stringify(s.securityFlags), JSON.stringify(cls), s.pageOffsets ? JSON.stringify(s.pageOffsets) : null],
    );
  }

  async listSources(): Promise<(SourceDocument & { classifications: Classification[] })[]> {
    const rows = await this.db.select<Row>('SELECT * FROM sources ORDER BY imported_at DESC');
    return rows.map((r) => ({
      id: String(r.id),
      sourceType: r.source_type as SourceDocument['sourceType'],
      format: r.format as SourceDocument['format'],
      originalName: String(r.original_name),
      importedAt: String(r.imported_at),
      contentHash: String(r.content_hash),
      text: String(r.text),
      byteSize: Number(r.byte_size),
      hints: JSON.parse(String(r.hints_json)),
      securityFlags: JSON.parse(String(r.security_flags_json)),
      classifications: JSON.parse(String(r.classifications_json)),
      pageOffsets: r.page_offsets_json ? JSON.parse(String(r.page_offsets_json)) : null,
    }));
  }

  /** Change what the student says a source is (kind, course, linked assignment). */
  async updateSourceHints(sourceId: string, patch: Record<string, string | undefined>): Promise<void> {
    const [row] = await this.db.select<{ hints_json: string }>('SELECT hints_json FROM sources WHERE id = ?', [sourceId]);
    if (!row) throw new Error(`Source ${sourceId} not found`);
    const hints = { ...JSON.parse(row.hints_json), ...patch };
    for (const k of Object.keys(hints)) if (hints[k] === undefined || hints[k] === '') delete hints[k];
    await this.db.execute('UPDATE sources SET hints_json = ? WHERE id = ?', [JSON.stringify(hints), sourceId]);
  }

  /**
   * Delete an imported source and its pending proposals. Evidence pointing
   * at it is removed. Confirmed records that are left with no evidence are
   * deleted too when `deleteOrphanRecords` is true (the default).
   */
  async deleteSource(sourceId: string, deleteOrphanRecords = true): Promise<void> {
    // Read everything first; the writes below are applied as one batch.
    const pending = (await this.listProposals('pending')).filter(
      (p) => p.candidate.provenance.sourceId === sourceId || p.alternatives.some((a) => a.provenance.sourceId === sourceId),
    );
    const orphans = deleteOrphanRecords
      ? await this.db.select<{ record_id: string }>(
          `SELECT record_id FROM evidence GROUP BY record_id
           HAVING SUM(CASE WHEN source_id = ? THEN 1 ELSE 0 END) > 0
              AND SUM(CASE WHEN source_id <> ? THEN 1 ELSE 0 END) = 0`,
          [sourceId, sourceId],
        )
      : [];
    await this.db.transaction(async () => {
      for (const p of pending) await this.db.execute('DELETE FROM proposals WHERE id = ?', [p.id]);
      await this.db.execute('DELETE FROM evidence WHERE source_id = ?', [sourceId]);
      for (const { record_id } of orphans) await this.db.execute('DELETE FROM records WHERE id = ?', [record_id]);
      await this.db.execute('DELETE FROM sources WHERE id = ?', [sourceId]);
    });
  }

  // ---------- proposals ----------

  private async insertProposal(p: ChangeProposal): Promise<void> {
    await this.db.execute(
      `INSERT INTO proposals (id, kind, entity_type, record_key, target_record_id, proposal_json, status, created_at)
       VALUES (?,?,?,?,?,?,?,?)`,
      [p.id, p.kind, p.entityType, p.key, p.targetRecordId, JSON.stringify(p), p.status, p.createdAt],
    );
  }

  async listProposals(status: ChangeProposal['status'] = 'pending'): Promise<ChangeProposal[]> {
    const rows = await this.db.select<{ proposal_json: string; status: string }>(
      'SELECT proposal_json, status FROM proposals WHERE status = ? ORDER BY created_at, id',
      [status],
    );
    return rows.map((r) => ({ ...(JSON.parse(r.proposal_json) as ChangeProposal), status: r.status as ChangeProposal['status'] }));
  }

  async getProposal(id: string): Promise<ChangeProposal | null> {
    const [r] = await this.db.select<{ proposal_json: string; status: string }>('SELECT proposal_json, status FROM proposals WHERE id = ?', [id]);
    return r ? { ...(JSON.parse(r.proposal_json) as ChangeProposal), status: r.status as ChangeProposal['status'] } : null;
  }

  /** Approve a proposal. For updates and conflicts, `resolution` picks old or new per field. */
  async approveProposal(id: string, resolution: Resolution = {}, now = new Date().toISOString()): Promise<ConfirmedRecord> {
    const p = await this.getProposal(id);
    if (!p) throw new Error(`Proposal ${id} not found`);
    if (p.status !== 'pending') throw new Error(`Proposal ${id} is already ${p.status}`);
    // Re-read the target: it may have changed since the proposal was made.
    const existing = p.targetRecordId
      ? await this.getRecord(p.targetRecordId)
      : await this.findRecordByKey(p.entityType, p.key);
    const record = applyProposal(p, existing, resolution, now);
    await this.db.transaction(async () => {
      await this.upsertRecord(record, existing === null);
      const known = new Set((existing?.evidence ?? []).map((e) => JSON.stringify(e)));
      for (const ev of record.evidence) {
        const k = JSON.stringify(ev);
        if (known.has(k)) continue;
        known.add(k);
        await this.db.execute('INSERT INTO evidence (record_id, source_id, provenance_json) VALUES (?,?,?)', [record.id, ev.sourceId, k]);
      }
      if (p.changes.length > 0) {
        await this.db.execute('INSERT INTO change_log (record_id, proposal_id, changes_json, changed_at) VALUES (?,?,?,?)', [
          record.id, p.id, JSON.stringify(p.changes.map((c) => ({ ...c, chosen: resolution[c.field] ?? 'new' }))), now,
        ]);
      }
      await this.db.execute("UPDATE proposals SET status = 'confirmed', resolved_at = ? WHERE id = ?", [now, id]);
    });
    return record;
  }

  async rejectProposal(id: string, now = new Date().toISOString()): Promise<void> {
    await this.db.execute("UPDATE proposals SET status = 'rejected', resolved_at = ? WHERE id = ? AND status = 'pending'", [now, id]);
  }

  // ---------- records ----------

  private async upsertRecord(r: ConfirmedRecord, isNew: boolean): Promise<void> {
    if (isNew) {
      await this.db.execute(
        `INSERT INTO records (id, entity_type, record_key, fields_json, unknown_fields_json, confirmed_at, updated_at) VALUES (?,?,?,?,?,?,?)`,
        [r.id, r.entityType, r.key, JSON.stringify(r.fields), JSON.stringify(r.unknownFields), r.confirmedAt, r.updatedAt],
      );
    } else {
      await this.db.execute(
        `UPDATE records SET fields_json = ?, unknown_fields_json = ?, updated_at = ? WHERE id = ?`,
        [JSON.stringify(r.fields), JSON.stringify(r.unknownFields), r.updatedAt, r.id],
      );
    }
  }

  private async hydrate(rows: Row[]): Promise<ConfirmedRecord[]> {
    const out: ConfirmedRecord[] = [];
    for (const r of rows) {
      const ev = await this.db.select<{ provenance_json: string }>('SELECT provenance_json FROM evidence WHERE record_id = ? ORDER BY id', [String(r.id)]);
      out.push({
        id: String(r.id),
        entityType: r.entity_type as EntityType,
        key: String(r.record_key),
        fields: JSON.parse(String(r.fields_json)),
        unknownFields: JSON.parse(String(r.unknown_fields_json)),
        evidence: ev.map((e) => JSON.parse(e.provenance_json) as Provenance),
        confirmedAt: String(r.confirmed_at),
        updatedAt: String(r.updated_at),
      });
    }
    return out;
  }

  async getRecord(id: string): Promise<ConfirmedRecord | null> {
    const rows = await this.db.select<Row>('SELECT * FROM records WHERE id = ?', [id]);
    return (await this.hydrate(rows))[0] ?? null;
  }

  async findRecordByKey(entityType: EntityType, key: string): Promise<ConfirmedRecord | null> {
    const rows = await this.db.select<Row>('SELECT * FROM records WHERE entity_type = ? AND record_key = ?', [entityType, key]);
    return (await this.hydrate(rows))[0] ?? null;
  }

  async listRecords(entityType?: EntityType): Promise<ConfirmedRecord[]> {
    const rows = entityType
      ? await this.db.select<Row>('SELECT * FROM records WHERE entity_type = ? ORDER BY confirmed_at', [entityType])
      : await this.db.select<Row>('SELECT * FROM records ORDER BY confirmed_at');
    return this.hydrate(rows);
  }

  /** Manual correction of a confirmed record. Logged with old and new values. */
  async correctRecord(id: string, fields: ConfirmedRecord['fields'], now = new Date().toISOString()): Promise<ConfirmedRecord> {
    const existing = await this.getRecord(id);
    if (!existing) throw new Error(`Record ${id} not found`);
    const changes = Object.entries(fields)
      .filter(([k, v]) => JSON.stringify(existing.fields[k] ?? null) !== JSON.stringify(v))
      .map(([field, newValue]) => ({ field, oldValue: existing.fields[field] ?? null, newValue }));
    const updated: ConfirmedRecord = {
      ...existing,
      fields: { ...existing.fields, ...fields },
      updatedAt: now,
    };
    updated.unknownFields = Object.entries(updated.fields).filter(([, v]) => v === null).map(([k]) => k);
    await this.db.transaction(async () => {
      await this.upsertRecord(updated, false);
      if (changes.length) {
        await this.db.execute('INSERT INTO change_log (record_id, proposal_id, changes_json, changed_at) VALUES (?,?,?,?)', [
          id, null, JSON.stringify(changes.map((c) => ({ ...c, chosen: 'manual' }))), now,
        ]);
      }
    });
    return updated;
  }

  /**
   * Save something the app generated (an AI note). It is not a fact from the
   * student's material, so it skips review; re-saving the same key replaces it.
   */
  async saveGenerated(r: Omit<ConfirmedRecord, 'id' | 'confirmedAt' | 'updatedAt'>, now = new Date().toISOString()): Promise<ConfirmedRecord> {
    const existing = await this.findRecordByKey(r.entityType, r.key);
    const rec: ConfirmedRecord = { ...r, id: existing?.id ?? `rec_${globalThis.crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`, confirmedAt: existing?.confirmedAt ?? now, updatedAt: now };
    await this.db.transaction(async () => {
      await this.upsertRecord(rec, existing === null);
      if (existing) await this.db.execute('DELETE FROM evidence WHERE record_id = ?', [rec.id]);
      for (const ev of rec.evidence) {
        await this.db.execute('INSERT INTO evidence (record_id, source_id, provenance_json) VALUES (?,?,?)', [rec.id, ev.sourceId, JSON.stringify(ev)]);
      }
    });
    return rec;
  }

  /** Put a deleted record back exactly as it was (same id, same evidence). Does nothing if it already exists. */
  async restoreRecord(r: ConfirmedRecord): Promise<void> {
    if (await this.getRecord(r.id)) return;
    await this.db.transaction(async () => {
      await this.upsertRecord(r, true);
      for (const ev of r.evidence) {
        await this.db.execute('INSERT INTO evidence (record_id, source_id, provenance_json) VALUES (?,?,?)', [r.id, ev.sourceId, JSON.stringify(ev)]);
      }
    });
  }

  async deleteRecord(id: string): Promise<void> {
    await this.db.execute('DELETE FROM records WHERE id = ?', [id]);
  }

  async changeLog(recordId: string): Promise<{ changes: unknown[]; changedAt: string }[]> {
    const rows = await this.db.select<{ changes_json: string; changed_at: string }>(
      'SELECT changes_json, changed_at FROM change_log WHERE record_id = ? ORDER BY id', [recordId]);
    return rows.map((r) => ({ changes: JSON.parse(r.changes_json), changedAt: r.changed_at }));
  }

  // ---------- settings ----------

  async getSetting<T>(key: string, fallback: T): Promise<T> {
    const [r] = await this.db.select<{ value_json: string }>('SELECT value_json FROM settings WHERE key = ?', [key]);
    return r ? (JSON.parse(r.value_json) as T) : fallback;
  }

  async setSetting(key: string, value: unknown): Promise<void> {
    await this.db.execute(
      'INSERT INTO settings (key, value_json) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json',
      [key, JSON.stringify(value)],
    );
  }
}

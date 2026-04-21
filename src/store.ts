import Database from 'better-sqlite3';
import path from 'node:path';
import fs from 'node:fs';
import type { RnaAiuto } from './rna-client.js';
import { logger } from './logger.js';

export class Store {
  private db: Database.Database;

  constructor(dataDir: string) {
    fs.mkdirSync(dataDir, { recursive: true });
    const dbPath = path.join(dataDir, 'lookout.db');
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.migrate();
    logger.info(`Store opened: ${dbPath}`);
  }

  private migrate() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS aiuti (
        cor           TEXT PRIMARY KEY,
        car           TEXT NOT NULL,
        ce            TEXT,
        titolo        TEXT NOT NULL,
        tipo          TEXT NOT NULL,
        progetto      TEXT,
        data          TEXT NOT NULL,
        beneficiario  TEXT NOT NULL,
        cf            TEXT NOT NULL,
        regione       TEXT,
        elemento_aiuto TEXT,
        importo       REAL NOT NULL DEFAULT 0,
        id_concessione TEXT,
        first_seen_at TEXT NOT NULL DEFAULT (datetime('now')),
        notified      INTEGER NOT NULL DEFAULT 0
      );

      CREATE INDEX IF NOT EXISTS idx_aiuti_cf ON aiuti(cf);
      CREATE INDEX IF NOT EXISTS idx_aiuti_data ON aiuti(data);

      CREATE TABLE IF NOT EXISTS check_log (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        cf         TEXT NOT NULL,
        checked_at TEXT NOT NULL DEFAULT (datetime('now')),
        found      INTEGER NOT NULL,
        new_count  INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS watches (
        chat_id    TEXT NOT NULL,
        cf         TEXT NOT NULL,
        added_at   TEXT NOT NULL DEFAULT (datetime('now')),
        PRIMARY KEY (chat_id, cf)
      );

      CREATE INDEX IF NOT EXISTS idx_watches_cf ON watches(cf);
    `);
  }

  /** Return COR values already known for a given CF. */
  knownCors(cf: string): Set<string> {
    const rows = this.db.prepare('SELECT cor FROM aiuti WHERE cf = ?').all(cf) as { cor: string }[];
    return new Set(rows.map(r => r.cor));
  }

  /** Insert new aiuti, return the ones actually inserted (new). */
  insertNew(aiuti: RnaAiuto[]): RnaAiuto[] {
    const insert = this.db.prepare(`
      INSERT OR IGNORE INTO aiuti (cor, car, ce, titolo, tipo, progetto, data, beneficiario, cf, regione, elemento_aiuto, importo, id_concessione)
      VALUES (@cor, @car, @ce, @titolo, @tipo, @progetto, @data, @beneficiario, @cf, @regione, @elementoAiuto, @importo, @idConcessione)
    `);

    const inserted: RnaAiuto[] = [];
    const tx = this.db.transaction(() => {
      for (const a of aiuti) {
        const result = insert.run(a);
        if (result.changes > 0) {
          inserted.push(a);
        }
      }
    });
    tx();
    return inserted;
  }

  /** Mark aiuti as notified. */
  markNotified(cors: string[]) {
    const stmt = this.db.prepare('UPDATE aiuti SET notified = 1 WHERE cor = ?');
    const tx = this.db.transaction(() => {
      for (const cor of cors) {
        stmt.run(cor);
      }
    });
    tx();
  }

  /** Log a check. */
  logCheck(cf: string, found: number, newCount: number) {
    this.db.prepare('INSERT INTO check_log (cf, found, new_count) VALUES (?, ?, ?)').run(cf, found, newCount);
  }

  /** Get all stored aiuti for a CF, newest first. */
  getAiuti(cf: string): RnaAiuto[] {
    return this.db.prepare(
      'SELECT cor, car, ce, titolo, tipo, progetto, data, beneficiario, cf, regione, elemento_aiuto as elementoAiuto, importo, id_concessione as idConcessione FROM aiuti WHERE cf = ? ORDER BY data DESC'
    ).all(cf) as RnaAiuto[];
  }

  /** Get a single aiuto by COR. */
  getAiutoByCor(cor: string): RnaAiuto | null {
    const row = this.db.prepare(
      'SELECT cor, car, ce, titolo, tipo, progetto, data, beneficiario, cf, regione, elemento_aiuto as elementoAiuto, importo, id_concessione as idConcessione FROM aiuti WHERE cor = ?'
    ).get(cor) as RnaAiuto | undefined;
    return row ?? null;
  }

  // --- Watch management ---

  addWatch(chatId: string, cf: string): boolean {
    const result = this.db.prepare(
      'INSERT OR IGNORE INTO watches (chat_id, cf) VALUES (?, ?)'
    ).run(chatId, cf);
    return result.changes > 0;
  }

  removeWatch(chatId: string, cf: string): boolean {
    const result = this.db.prepare(
      'DELETE FROM watches WHERE chat_id = ? AND cf = ?'
    ).run(chatId, cf);
    return result.changes > 0;
  }

  getWatchesForChat(chatId: string): string[] {
    const rows = this.db.prepare(
      'SELECT cf FROM watches WHERE chat_id = ? ORDER BY added_at'
    ).all(chatId) as { cf: string }[];
    return rows.map(r => r.cf);
  }

  /** Get all distinct CFs being watched across all chats. */
  getAllWatchedCfs(): string[] {
    const rows = this.db.prepare(
      'SELECT DISTINCT cf FROM watches'
    ).all() as { cf: string }[];
    return rows.map(r => r.cf);
  }

  /** Get chat IDs watching a specific CF. */
  getChatIdsForCf(cf: string): string[] {
    const rows = this.db.prepare(
      'SELECT chat_id FROM watches WHERE cf = ?'
    ).all(cf) as { chat_id: string }[];
    return rows.map(r => r.chat_id);
  }

  close() {
    this.db.close();
  }
}

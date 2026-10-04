import Database from 'better-sqlite3'

export type DB = Database.Database

/**
 * Open (and migrate) the job database.
 *
 * WAL + per-block transactions give us: committed blocks survive a restart
 * or crash, and a crash mid-block rolls back cleanly so the stored state
 * always matches the stored cycle log.
 */
export function openDatabase(path: string): DB {
  const db = new Database(path)
  db.pragma('journal_mode = WAL')
  db.pragma('synchronous = NORMAL')
  db.pragma('foreign_keys = ON')
  migrate(db)
  return db
}

function migrate(db: DB): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS jobs (
      id                TEXT PRIMARY KEY,
      name              TEXT,
      material          TEXT NOT NULL,
      sn_c              REAL NOT NULL,
      sn_m              REAL NOT NULL,
      correction        TEXT NOT NULL CHECK (correction IN ('none', 'goodman')),
      ultimate_strength REAL,
      gate              REAL NOT NULL DEFAULT 0,
      status            TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'finalized')),
      last_seq          INTEGER NOT NULL DEFAULT 0,
      last_block_hash   TEXT,
      last_block_points INTEGER NOT NULL DEFAULT 0,
      last_block_cycles INTEGER NOT NULL DEFAULT 0,
      cycle_rows        INTEGER NOT NULL DEFAULT 0,
      total_count       REAL NOT NULL DEFAULT 0,
      total_damage      REAL NOT NULL DEFAULT 0,
      created_at        TEXT NOT NULL,
      finalized_at      TEXT
    );

    -- Incremental pipeline state, one row per job. This is what lets a
    -- restarted service continue appending without replaying history.
    CREATE TABLE IF NOT EXISTS job_state (
      job_id   TEXT PRIMARY KEY REFERENCES jobs(id) ON DELETE CASCADE,
      pv_state TEXT NOT NULL,  -- JSON: PvState of the peak/valley filter
      residual TEXT NOT NULL   -- JSON: number[] residual of the rainflow kernel
    );

    -- Append-only cycle log; cycles are never updated or deleted.
    CREATE TABLE IF NOT EXISTS cycles (
      job_id    TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
      idx       INTEGER NOT NULL,
      range     REAL NOT NULL,
      amplitude REAL NOT NULL,
      mean      REAL NOT NULL,
      count     REAL NOT NULL,
      damage    REAL NOT NULL,
      PRIMARY KEY (job_id, idx)
    );
  `)
}

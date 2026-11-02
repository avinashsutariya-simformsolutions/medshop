import Database from "@tauri-apps/plugin-sql";
import { isTauri } from "@tauri-apps/api/core";

// Must match DB_URL in src-tauri/src/lib.rs, which registers the migrations.
const DB_URL = "sqlite:medshop.db";

let dbPromise: Promise<Database> | null = null;

/** True when running inside the desktop app (not a plain browser tab). */
export function hasDatabase(): boolean {
  return isTauri();
}

/**
 * Open the local database once. Migrations in src-tauri/migrations run
 * automatically the first time it is opened.
 */
export function getDb(): Promise<Database> {
  if (!hasDatabase()) {
    return Promise.reject(new Error("NO_TAURI"));
  }
  if (!dbPromise) {
    dbPromise = (async () => {
      const db = await Database.load(DB_URL);
      // WAL survives power cuts better and lets reads run during writes.
      await db.execute("PRAGMA journal_mode = WAL");
      await db.execute("PRAGMA busy_timeout = 5000");
      await db.execute("PRAGMA foreign_keys = ON");
      return db;
    })().catch((e) => {
      dbPromise = null;
      throw e;
    });
  }
  return dbPromise;
}

export async function query<T>(sql: string, params: unknown[] = []): Promise<T[]> {
  const db = await getDb();
  return db.select<T[]>(sql, params);
}

export async function queryOne<T>(sql: string, params: unknown[] = []): Promise<T | null> {
  const rows = await query<T>(sql, params);
  return rows[0] ?? null;
}

export async function execute(sql: string, params: unknown[] = []) {
  const db = await getDb();
  return db.execute(sql, params);
}

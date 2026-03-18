import { Database } from "bun:sqlite";
import { drizzle } from "drizzle-orm/bun-sqlite";
import * as schema from "./schema";

const DB_PATH = process.env.DATABASE_PATH ?? "./photomind.db";

// Singleton SQLite connection with WAL mode enabled.
// WAL allows concurrent reads while Python daemon writes.
let _sqlite: Database | null = null;
let _db: ReturnType<typeof drizzle<typeof schema>> | null = null;

function getSqlite(): Database {
  if (!_sqlite) {
    _sqlite = new Database(DB_PATH, { create: true });
    // Enable WAL mode for concurrent reads (Next.js) + writes (Python daemon)
    _sqlite.exec("PRAGMA journal_mode=WAL");
    _sqlite.exec("PRAGMA foreign_keys=ON");
    _sqlite.exec("PRAGMA synchronous=NORMAL");
  }
  return _sqlite;
}

export function getDb() {
  if (!_db) {
    _db = drizzle(getSqlite(), { schema });
  }
  return _db;
}

export const db = getDb();

import fs from "node:fs";
import initSqlJs from "sql.js";
import { PRAGMA_SQL } from "../schema.js";

let SQL = null;

async function loadSql() {
  if (SQL) return SQL;
  SQL = await initSqlJs();
  return SQL;
}

export async function createSqlJsAdapter(filePath) {
  const SQLLib = await loadSql();
  const buf = fs.existsSync(filePath) ? fs.readFileSync(filePath) : null;
  const db = new SQLLib.Database(buf);
  db.exec(PRAGMA_SQL);
  // Schema is created/synced by migrate.js after adapter init

  let dirty = false;
  let saveTimer = null;
  let txDepth = 0; // >0 while a SAVEPOINT is open
  const SAVE_DEBOUNCE_MS = 100;

  function persist() {
    // sql.js db.export() closes and reopens the underlying connection, which discards
    // any open SAVEPOINT: a write inside transaction() used to flush here, so the
    // RELEASE that followed threw "no such savepoint" and rolled the whole body back.
    // Defer the flush until the outermost transaction has released.
    if (txDepth > 0) {
      dirty = true;
      return;
    }
    try {
      const data = db.export();
      fs.writeFileSync(filePath, Buffer.from(data));
      dirty = false;
    } catch (e) {
      console.error("[sqljs] persist error:", e);
    }
  }

  function scheduleSave(immediate = false) {
    dirty = true;
    if (saveTimer) {
      clearTimeout(saveTimer);
      saveTimer = null;
    }
    if (immediate) {
      persist();
      return;
    }
    saveTimer = setTimeout(() => {
      saveTimer = null;
      if (dirty) persist();
    }, SAVE_DEBOUNCE_MS);
  }

  function paramsObj(params) {
    if (!params || (Array.isArray(params) && params.length === 0)) return undefined;
    return params;
  }

  function run(sql, params = []) {
    const stmt = db.prepare(sql);
    try {
      stmt.bind(paramsObj(params));
      stmt.step();
      const changes = db.getRowsModified();
      const lastInsertRowid = db.exec("SELECT last_insert_rowid() as id")[0]?.values?.[0]?.[0] ?? null;
      scheduleSave(true);
      return { changes, lastInsertRowid };
    } finally {
      stmt.free();
    }
  }

  function get(sql, params = []) {
    const stmt = db.prepare(sql);
    try {
      stmt.bind(paramsObj(params));
      if (stmt.step()) return stmt.getAsObject();
      return undefined;
    } finally {
      stmt.free();
    }
  }

  function all(sql, params = []) {
    const stmt = db.prepare(sql);
    try {
      stmt.bind(paramsObj(params));
      const rows = [];
      while (stmt.step()) rows.push(stmt.getAsObject());
      return rows;
    } finally {
      stmt.free();
    }
  }

  function exec(sql) {
    db.exec(sql);
    scheduleSave(true);
  }

  function transaction(fn) {
    const sp = `sp_${Math.random().toString(36).slice(2)}`;
    db.exec(`SAVEPOINT ${sp}`);
    txDepth += 1;
    try {
      const result = fn();
      db.exec(`RELEASE ${sp}`);
      txDepth -= 1;
      scheduleSave(true);
      return result;
    } catch (e) {
      try { db.exec(`ROLLBACK TO ${sp}`); db.exec(`RELEASE ${sp}`); } catch {}
      txDepth = Math.max(0, txDepth - 1);
      // In-memory state is authoritative after a rollback, so flush whatever the
      // transaction body (and any earlier writes) left behind.
      scheduleSave(true);
      throw e;
    }
  }

  function close() {
    if (saveTimer) clearTimeout(saveTimer);
    if (dirty) persist();
    db.close();
  }

  // Flush on shutdown
  const flush = () => { if (dirty) try { persist(); } catch {} };
  process.on("beforeExit", flush);
  process.on("SIGINT", flush);
  process.on("SIGTERM", flush);

  return { driver: "sql.js", run, get, all, exec, transaction, close, raw: db };
}

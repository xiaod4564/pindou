// 兼容层:本地 SQLite / 云上 Postgres 双模式(自动方案言翻译)
const fs = require('fs');
const path = require('path');

const PG_MODE = !!process.env.DATABASE_URL;

// ---- SQL 方言翻译 ----
function translate(sql) {
  if (!PG_MODE) return sql;
  let idx = 0;
  let s = sql.replace(/\?/g, () => '$' + (++idx));
  s = s.replace(/printf\('%012d',\s*([\w.]+)\)/g, (m, col) => `lpad(${col}::text, 12, '0')`);
  s = s.replace(/instr\((\w+(?:\.\w+)?),\s*(\w+(?:\.\w+)?|'[^']*')\)/g, (m, a, b) => `position(${a} in ${b})`);
  s = s.replace(/instr\(lower\(([^)]+)\),\s*lower\(([^)]+)\)\)/g, (m, a, b) => `position(lower(${a}) in lower(${b}))`);
  return s;
}

let db;
if (!PG_MODE) {
  const Database = require('better-sqlite3');
  const DATA_DIR = path.join(__dirname, 'data');
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  db = new Database(path.join(DATA_DIR, 'pindou.db'));
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  // 异步桥接包装
  const origPrepare = db.prepare.bind(db);
  const origExec = db.exec.bind(db);
  db.prepare = (sql) => {
    const stmt = origPrepare(sql);
    const norm = (params) => params === undefined ? [] : (Array.isArray(params) ? params : [params]);
    return {
      run: async (...args) => stmt.run(...norm(args.length === 1 ? args[0] : args)),
      get: async (...args) => stmt.get(...norm(args.length === 1 ? args[0] : args)),
      all: async (...args) => stmt.all(...norm(args.length === 1 ? args[0] : args)),
      __raw: stmt
    };
  };
  db.exec = async (sql) => origExec(sql);
} else {
  const { Pool } = require('pg');
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
    max: 5
  });
  const q = [];
  let running = false;
  function drain() {
    if (running) return;
    const item = q.shift();
    if (!item) return;
    running = true;
    pool.query(item.sql, item.params).then(r => {
      running = false;
      item.resolve({ changes: r.rowCount, lastInsertRowid: (r.rows[0] && (r.rows[0].id !== undefined ? r.rows[0].id : r.rows[0].uid)) || 0, rows: r.rows });
      drain();
    }).catch(e => {
      running = false;
      item.reject(e);
      drain();
    });
  }
  function runRaw(sql, params) {
    return new Promise((resolve, reject) => {
      q.push({ sql, params, resolve, reject });
      drain();
    });
  }
  db = {
    __pg: pool,
    exec: (sql) => runRaw(sql, []),
    prepare: (sql) => {
      const t = translate(sql);
      const needsReturning = /^\s*(INSERT|REPLACE)/i.test(t);
      const finalSql = needsReturning ? t.replace(/;?\s*$/, '') + ' RETURNING *' : t;
      return {
        run: async (...args) => runRaw(finalSql, args.length === 1 ? (args[0] === undefined ? [] : (Array.isArray(args[0]) ? args[0] : [args[0]])) : args),
        get: async (...args) => {
          const p = args.length === 1 ? (args[0] === undefined ? [] : (Array.isArray(args[0]) ? args[0] : [args[0]])) : args;
          const r = await runRaw(finalSql, p);
          return r.rows[0];
        },
        all: async (...args) => {
          const p = args.length === 1 ? (args[0] === undefined ? [] : (Array.isArray(args[0]) ? args[0] : [args[0]])) : args;
          const r = await runRaw(finalSql, p);
          return r.rows;
        }
      };
    },
    pragma: () => {},
    transaction: (fn) => fn()
  };
}

module.exports = { db, PG_MODE };

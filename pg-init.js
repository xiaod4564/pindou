// Postgres 建表 + 初始数据(云端启动时自动执行)
const { db } = require('./db');
const bcrypt = require('bcryptjs');

async function initPg() {
  await db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    uid BIGSERIAL PRIMARY KEY,
    username TEXT UNIQUE NOT NULL,
    email TEXT UNIQUE,
    phone TEXT UNIQUE,
    password TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'user',
    coins INTEGER NOT NULL DEFAULT 0,
    security_question TEXT NOT NULL,
    security_answer TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'active',
    ban_until BIGINT,
    ban_reason TEXT,
    tokens TEXT NOT NULL DEFAULT '[]',
    created_at BIGINT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS patterns (
    id BIGSERIAL PRIMARY KEY,
    user_id BIGINT NOT NULL,
    title TEXT NOT NULL,
    description TEXT DEFAULT '',
    category_id BIGINT,
    difficulty TEXT NOT NULL DEFAULT 'easy',
    cover TEXT,
    image TEXT,
    original_url TEXT DEFAULT '',
    width INTEGER DEFAULT 0,
    height INTEGER DEFAULT 0,
    price INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'pending',
    source TEXT NOT NULL DEFAULT 'user',
    views INTEGER NOT NULL DEFAULT 0,
    created_at BIGINT NOT NULL,
    reviewed_at BIGINT,
    reviewer_note TEXT DEFAULT ''
  );
  CREATE TABLE IF NOT EXISTS categories (
    id BIGSERIAL PRIMARY KEY,
    name TEXT UNIQUE NOT NULL,
    icon TEXT,
    sort INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE IF NOT EXISTS comments (
    id BIGSERIAL PRIMARY KEY,
    pattern_id BIGINT NOT NULL,
    user_id BIGINT NOT NULL,
    content TEXT NOT NULL,
    created_at BIGINT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS ratings (
    id BIGSERIAL PRIMARY KEY,
    pattern_id BIGINT NOT NULL,
    user_id BIGINT NOT NULL,
    score INTEGER NOT NULL,
    created_at BIGINT NOT NULL,
    UNIQUE(pattern_id, user_id)
  );
  CREATE TABLE IF NOT EXISTS favorites (
    user_id BIGINT NOT NULL,
    pattern_id BIGINT NOT NULL,
    created_at BIGINT NOT NULL,
    PRIMARY KEY (user_id, pattern_id)
  );
  CREATE TABLE IF NOT EXISTS bans (
    id BIGSERIAL PRIMARY KEY,
    type TEXT NOT NULL,
    target TEXT NOT NULL,
    reason TEXT DEFAULT '',
    expires_at BIGINT,
    active INTEGER NOT NULL DEFAULT 1,
    created_at BIGINT NOT NULL,
    created_by TEXT DEFAULT 'admin'
  );
  CREATE TABLE IF NOT EXISTS login_failures (
    ip TEXT NOT NULL,
    account TEXT,
    fail_time BIGINT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS notices (
    id BIGSERIAL PRIMARY KEY,
    title TEXT NOT NULL,
    content TEXT NOT NULL,
    active INTEGER NOT NULL DEFAULT 1,
    created_at BIGINT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT
  );
  CREATE TABLE IF NOT EXISTS orders (
    id BIGSERIAL PRIMARY KEY,
    user_id BIGINT NOT NULL,
    merchant_no TEXT NOT NULL,
    coins INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    created_at BIGINT NOT NULL,
    reviewed_at BIGINT,
    note TEXT DEFAULT ''
  );
  CREATE TABLE IF NOT EXISTS redeem_codes (
    code TEXT PRIMARY KEY,
    coins INTEGER NOT NULL,
    used_by BIGINT,
    used_at BIGINT,
    created_at BIGINT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS coupon_codes (
    code TEXT PRIMARY KEY,
    discount REAL NOT NULL,
    max_uses INTEGER NOT NULL DEFAULT 0,
    used_count INTEGER NOT NULL DEFAULT 0,
    active INTEGER NOT NULL DEFAULT 1,
    created_at BIGINT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS coin_logs (
    id BIGSERIAL PRIMARY KEY,
    user_id BIGINT NOT NULL,
    change INTEGER NOT NULL,
    reason TEXT,
    created_at BIGINT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS purchases (
    user_id BIGINT NOT NULL,
    pattern_id BIGINT NOT NULL,
    created_at BIGINT NOT NULL,
    PRIMARY KEY (user_id, pattern_id)
  );
  CREATE TABLE IF NOT EXISTS star_images (
    id BIGSERIAL PRIMARY KEY,
    filename TEXT NOT NULL,
    uploaded_at BIGINT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS coin_icons (
    id BIGSERIAL PRIMARY KEY,
    filename TEXT NOT NULL,
    uploaded_at BIGINT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS files (
    id BIGSERIAL PRIMARY KEY,
    filename TEXT NOT NULL,
    title TEXT NOT NULL,
    size BIGINT NOT NULL,
    url TEXT NOT NULL,
    uploaded_at BIGINT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS blobs (
    id TEXT PRIMARY KEY,
    mime TEXT NOT NULL,
    data BYTEA NOT NULL,
    created_at BIGINT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_patterns_status ON patterns(status, created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_comments_pattern ON comments(pattern_id);
  CREATE INDEX IF NOT EXISTS idx_failures_time ON login_failures(fail_time);
  `);

  // 初始 admin 与默认分类
  const meta = await db.prepare(`SELECT value FROM settings WHERE key='meta_init_done'`).get();
  if (!meta) {
    const now = Date.now();
    await db.prepare(`INSERT INTO users (username,email,phone,password,role,coins,security_question,security_answer,status,created_at)
      VALUES (?,?,?,?,?,?,?,?,?,?)`)
      .run('admin', 'admin@pindou.local', '13800000000', bcrypt.hashSync('admin123', 10), 'admin', 0, '网站名称是什么?', '拼豆图纸助手', 'active', now);
    // admin 是第一个用户,UID=1
    await db.prepare(`SELECT setval('users_uid_seq', (SELECT MAX(uid) FROM users))`).run();
    await db.prepare(`INSERT INTO categories (name,icon,sort) VALUES (?,?,1)`).run('默认分类', null);
    await db.prepare(`INSERT INTO settings (key,value) VALUES ('meta_init_done','1')`).run();
  }
}

module.exports = { initPg };

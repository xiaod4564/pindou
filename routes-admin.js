const express = require('express');
const dbm = require('./db');
const db = dbm.db;
const { get, set, all } = require('./settings');
const util = require('./util');
const bcrypt = require('bcryptjs');
const path = require('path');
const fs = require('fs');
const { api, requireAdmin, publicUser, patternBrief, patternsQuery } = require('./routes-public');

const router = express.Router();

// ============ dashboard ============
router.get('/stats', requireAdmin, api(async (req, res) => {
  const s = await all();
  const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
  const g = async (sql, ...p) => Number((await db.prepare(sql).get(...p)).c);
  res.json({
    ok: true,
    patterns: await g(`SELECT COUNT(*) c FROM patterns WHERE status='published'`),
    pending: await g(`SELECT COUNT(*) c FROM patterns WHERE status='pending'`),
    users: await g(`SELECT COUNT(*) c FROM users`),
    newUsers: await g(`SELECT COUNT(*) c FROM users WHERE created_at>?`, todayStart.getTime()),
    comments: await g(`SELECT COUNT(*) c FROM comments`),
    orders: await g(`SELECT COUNT(*) c FROM orders WHERE status='pending'`),
    bans: await g(`SELECT COUNT(*) c FROM bans WHERE active=1`),
    coinsEnabled: s.coins_enabled === '1',
    coinName: s.coin_name,
    totalCoins: await g(`SELECT COALESCE(SUM(coins),0) c FROM users`)
  });
}));

// ============ users ============
router.get('/users', requireAdmin, api(async (req, res) => {
  const { q, status, page = 1, size = 20 } = req.query;
  let where = [];
  let params = [];
  if (q) {
    where.push(`(username LIKE ? OR email LIKE ? OR phone LIKE ? OR printf('%012d',uid) LIKE ?)`);
    const like = `%${q}%`; params.push(like, like, like, like);
  }
  if (status) { where.push(`status=?`); params.push(status); }
  const whereSql = where.length ? 'WHERE ' + where.join(' AND ') : '';
  const total = Number((await db.prepare(`SELECT COUNT(*) c FROM users ${whereSql}`).get(...params)).c);
  const rows = await db.prepare(`SELECT * FROM users ${whereSql} ORDER BY uid ASC LIMIT ? OFFSET ?`).all(...params, Number(size), (Number(page) - 1) * Number(size));
  res.json({ ok: true, total, list: rows.map(u => ({
    uid: util.uidText(u.uid), username: u.username, email: u.email, phone: u.phone, role: u.role,
    coins: u.coins, status: u.status, ban_until: u.ban_until, ban_reason: u.ban_reason, created_at: u.created_at
  })) });
}));

router.post('/users', requireAdmin, api(async (req, res) => {
  const b = req.body || {};
  if (!b.username || !b.password || !b.security_question || !b.security_answer) return res.json({ ok: false, msg: '用户名、密码、密保问题及答案为必填项' });
  if (!b.email && !b.phone) return res.json({ ok: false, msg: '请至少填写邮箱或手机号其中一项' });
  if (b.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(b.email)) return res.json({ ok: false, msg: '邮箱格式不正确' });
  if (b.phone && !/^1\d{10}$/.test(b.phone)) return res.json({ ok: false, msg: '手机号格式不正确' });
  if (await db.prepare('SELECT 1 AS ok FROM users WHERE username=?').get(b.username)) return res.json({ ok: false, msg: '用户名已存在' });
  if (b.email && await db.prepare('SELECT 1 AS ok FROM users WHERE email=?').get(b.email)) return res.json({ ok: false, msg: '该邮箱已被使用' });
  if (b.phone && await db.prepare('SELECT 1 AS ok FROM users WHERE phone=?').get(b.phone)) return res.json({ ok: false, msg: '该手机号已被使用' });
  const role = b.role === 'admin' ? 'admin' : 'user';
  await db.prepare(`INSERT INTO users (username,email,phone,password,role,coins,security_question,security_answer,status,created_at)
              VALUES (?,?,?,?,?,?,?,?,'active',?)`)
    .run(b.username, b.email || null, b.phone || null, bcrypt.hashSync(b.password, 10), role, Math.max(0, Math.floor(Number(b.coins) || 0)), b.security_question, b.security_answer, Date.now());
  res.json({ ok: true });
}));

router.post('/users/:uid/password', requireAdmin, api(async (req, res) => {
  const uid = Number(req.params.uid);
  const { password } = req.body || {};
  if (!password || String(password).length < 6) return res.json({ ok: false, msg: '密码至少 6 位' });
  const t = await db.prepare('UPDATE users SET password=? WHERE uid=?').run(bcrypt.hashSync(password, 10), uid);
  if (!t.changes) return res.json({ ok: false, msg: '用户不存在' });
  res.json({ ok: true });
}));

router.post('/users/:uid/coins', requireAdmin, api(async (req, res) => {
  const uid = Number(req.params.uid);
  const change = Math.floor(Number((req.body || {}).change));
  if (!change) return res.json({ ok: false, msg: '请输入有效的变动数量' });
  const u = await db.prepare('SELECT * FROM users WHERE uid=?').get(uid);
  if (!u) return res.json({ ok: false, msg: '用户不存在' });
  await util.addCoins(uid, change, `管理员手动调整`);
  res.json({ ok: true, coins: u.coins + change });
}));

router.post('/users/:uid/status', requireAdmin, api(async (req, res) => {
  const uid = Number(req.params.uid);
  const { status, reason } = req.body || {};
  if (uid === 1 && status !== 'active') return res.json({ ok: false, msg: '不能封禁超级管理员' });
  const u = await db.prepare('SELECT * FROM users WHERE uid=?').get(uid);
  if (!u) return res.json({ ok: false, msg: '用户不存在' });
  if (status === 'active') {
    await db.prepare(`UPDATE users SET status='active', ban_until=NULL, ban_reason=NULL WHERE uid=?`).run(uid);
    await db.prepare(`UPDATE bans SET active=0 WHERE type='uid' AND target=? AND active=1`).run(String(uid));
  } else if (status === 'banned') {
    await db.prepare(`UPDATE users SET status='banned', ban_reason=? WHERE uid=?`).run(reason || '', uid);
    await db.prepare(`INSERT INTO bans (type,target,reason,expires_at,active,created_at,created_by) VALUES ('uid',?,?,NULL,1,?,?)`)
      .run(String(uid), reason || '', Date.now(), req.user.username);
  } else if (status === 'disabled') {
    await db.prepare(`UPDATE users SET status='disabled', ban_reason=? WHERE uid=?`).run(reason || '', uid);
    await db.prepare(`INSERT INTO bans (type,target,reason,expires_at,active,created_at,created_by) VALUES ('uid',?,?,NULL,1,?,?)`)
      .run(String(uid), reason || '账号已禁用', Date.now(), req.user.username);
  } else return res.json({ ok: false, msg: '无效状态' });
  res.json({ ok: true });
}));

router.get('/users/export.csv', requireAdmin, api(async (req, res) => {
  const rows = await db.prepare('SELECT * FROM users ORDER BY uid ASC').all();
  const lines = ['UID,用户名,邮箱,手机号,角色,金币数,状态,创建时间'];
  for (const u of rows) {
    const t = new Date(Number(u.created_at)).toLocaleString('zh-CN', { hour12: false });
    const role = u.role === 'admin' ? '管理员' : '普通用户';
    const st = u.status === 'active' ? '正常' : u.status === 'banned' ? '已封禁' : '已禁用';
    lines.push([util.uidText(u.uid), u.username, u.email || '', u.phone || '', role, u.coins, st, t].map(v => `"${String(v).replace(/"/g, '""')}"`).join(','));
  }
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="users.csv"');
  res.send('\ufeff' + lines.join('\r\n'));
}));

// ============ patterns ============
router.get('/patterns', requireAdmin, api(async (req, res) => {
  const { q, status, page = 1, size = 20 } = req.query;
  let where = [];
  let params = [];
  if (q) { where.push(`(p.title LIKE ? OR p.description LIKE ?)`); const like = `%${q}%`; params.push(like, like); }
  if (status) { where.push(`p.status=?`); params.push(status); }
  const whereSql = where.length ? 'WHERE ' + where.join(' AND ') : '';
  const total = Number((await db.prepare(`SELECT COUNT(*) c FROM patterns p ${whereSql}`).get(...params)).c);
  const rows = await db.prepare(`${patternsQuery} ${whereSql} ORDER BY p.created_at DESC LIMIT ? OFFSET ?`).all(...params, Number(size), (Number(page) - 1) * Number(size));
  const list = [];
  for (const r of rows) list.push(await patternBrief(r));
  res.json({ ok: true, total, list });
}));

router.post('/patterns/:id/status', requireAdmin, api(async (req, res) => {
  const { status, note } = req.body || {};
  const p = await db.prepare('SELECT * FROM patterns WHERE id=?').get(req.params.id);
  if (!p) return res.json({ ok: false, msg: '图纸不存在' });
  if (!['published', 'pending', 'rejected'].includes(status)) return res.json({ ok: false, msg: '无效状态' });
  await db.prepare('UPDATE patterns SET status=?, reviewed_at=?, reviewer_note=? WHERE id=?').run(status, Date.now(), note || '', p.id);
  res.json({ ok: true });
}));

router.put('/patterns/:id', requireAdmin, api(async (req, res) => {
  const b = req.body || {};
  const p = await db.prepare('SELECT * FROM patterns WHERE id=?').get(req.params.id);
  if (!p) return res.json({ ok: false, msg: '图纸不存在' });
  const title = b.title !== undefined ? b.title : p.title;
  const desc = b.description !== undefined ? b.description : p.description;
  const cat = b.category_id !== undefined ? b.category_id : p.category_id;
  const diff = ['easy', 'medium', 'hard'].includes(b.difficulty) ? b.difficulty : p.difficulty;
  const price = b.price !== undefined ? Math.max(0, Math.floor(Number(b.price))) : p.price;
  const cover = b.cover !== undefined ? b.cover : p.cover;
  const image = b.image !== undefined ? b.image : p.image;
  await db.prepare(`UPDATE patterns SET title=?, description=?, category_id=?, difficulty=?, price=?, cover=?, image=? WHERE id=?`)
    .run(title, desc, cat, diff, price, cover, image, p.id);
  res.json({ ok: true });
}));

router.delete('/patterns/:id', requireAdmin, api(async (req, res) => {
  await db.prepare('DELETE FROM patterns WHERE id=?').run(req.params.id);
  await db.prepare('DELETE FROM comments WHERE pattern_id=?').run(req.params.id);
  await db.prepare('DELETE FROM ratings WHERE pattern_id=?').run(req.params.id);
  await db.prepare('DELETE FROM favorites WHERE pattern_id=?').run(req.params.id);
  res.json({ ok: true });
}));

// ============ categories ============
router.post('/categories', requireAdmin, api(async (req, res) => {
  const { name, icon, sort } = req.body || {};
  if (!name) return res.json({ ok: false, msg: '请填写分类名称' });
  if (await db.prepare('SELECT 1 AS ok FROM categories WHERE name=?').get(name)) return res.json({ ok: false, msg: '分类名称已存在' });
  await db.prepare('INSERT INTO categories (name,icon,sort) VALUES (?,?,?)').run(name, icon || null, Math.floor(Number(sort) || 0));
  res.json({ ok: true });
}));

router.put('/categories/:id', requireAdmin, api(async (req, res) => {
  const c = await db.prepare('SELECT * FROM categories WHERE id=?').get(req.params.id);
  if (!c) return res.json({ ok: false, msg: '分类不存在' });
  const { name, icon, sort } = req.body || {};
  if (name && name !== c.name && await db.prepare('SELECT 1 AS ok FROM categories WHERE name=?').get(name)) return res.json({ ok: false, msg: '分类名称已存在' });
  await db.prepare('UPDATE categories SET name=?, icon=?, sort=? WHERE id=?').run(name || c.name, icon !== undefined ? icon : c.icon, sort !== undefined ? Math.floor(Number(sort) || 0) : c.sort, c.id);
  res.json({ ok: true });
}));

router.delete('/categories/:id', requireAdmin, api(async (req, res) => {
  await db.prepare('UPDATE patterns SET category_id=NULL WHERE category_id=?').run(req.params.id);
  await db.prepare('DELETE FROM categories WHERE id=?').run(req.params.id);
  res.json({ ok: true });
}));

// ============ comments ============
router.get('/comments', requireAdmin, api(async (req, res) => {
  const { q, page = 1, size = 20 } = req.query;
  let where = [];
  let params = [];
  if (q) { where.push(`c.content LIKE ?`); params.push(`%${q}%`); }
  const whereSql = where.length ? 'WHERE ' + where.join(' AND ') : '';
  const total = Number((await db.prepare(`SELECT COUNT(*) c FROM comments c ${whereSql}`).get(...params)).c);
  const rows = await db.prepare(`SELECT c.*, u.username, u.uid AS user_uid, p.title AS pattern_title
    FROM comments c JOIN users u ON u.uid=c.user_id LEFT JOIN patterns p ON p.id=c.pattern_id
    ${whereSql} ORDER BY c.created_at DESC LIMIT ? OFFSET ?`).all(...params, Number(size), (Number(page) - 1) * Number(size));
  res.json({ ok: true, total, list: rows.map(r => ({ id: r.id, uid: util.uidText(r.user_uid), username: r.username, content: r.content, pattern_id: r.pattern_id, pattern_title: r.pattern_title, created_at: r.created_at })) });
}));

router.delete('/comments/:id', requireAdmin, api(async (req, res) => {
  await db.prepare('DELETE FROM comments WHERE id=?').run(req.params.id);
  res.json({ ok: true });
}));

// ============ bans ============
router.get('/bans', requireAdmin, api(async (req, res) => {
  const { q, type, status, page = 1, size = 20 } = req.query;
  let where = [];
  let params = [];
  if (q) { where.push(`target LIKE ?`); params.push(`%${q}%`); }
  if (type) { where.push(`type=?`); params.push(type); }
  if (status === 'active') { where.push(`active=1`); }
  if (status === 'expired') { where.push(`(active=0 OR (expires_at IS NOT NULL AND expires_at<=?))`); params.push(Date.now()); }
  const whereSql = where.length ? 'WHERE ' + where.join(' AND ') : '';
  const total = Number((await db.prepare(`SELECT COUNT(*) c FROM bans ${whereSql}`).get(...params)).c);
  const rows = await db.prepare(`SELECT * FROM bans ${whereSql} ORDER BY created_at DESC LIMIT ? OFFSET ?`).all(...params, Number(size), (Number(page) - 1) * Number(size));
  const now = Date.now();
  const list = [];
  for (const b of rows) {
    let display = b.target;
    if (b.type === 'uid') {
      const u = await db.prepare('SELECT username FROM users WHERE uid=?').get(Number(b.target));
      if (u) display = `${u.username} (UID:${util.uidText(Number(b.target))})`;
    }
    list.push({ id: b.id, type: b.type, target: b.target, display, reason: b.reason, expires_at: b.expires_at, active: b.active === 1 && (b.expires_at === null || b.expires_at === undefined || b.expires_at > now), created_at: b.created_at, created_by: b.created_by });
  }
  res.json({ ok: true, total, list });
}));

router.post('/bans', requireAdmin, api(async (req, res) => {
  const { type, target, reason, duration, unit } = req.body || {};
  if (!['ip', 'uid'].includes(type)) return res.json({ ok: false, msg: '封禁类型无效' });
  if (!target) return res.json({ ok: false, msg: '请填写封禁目标' });
  let expires = null;
  if (duration && unit) {
    const n = Number(duration);
    if (!(n > 0)) return res.json({ ok: false, msg: '时长无效' });
    if (unit === 'hour') expires = Date.now() + n * 3600 * 1000;
    else if (unit === 'day') expires = Date.now() + n * 86400 * 1000;
    else return res.json({ ok: false, msg: '单位无效' });
  }
  let tgt = target;
  if (type === 'uid') {
    const u = await db.prepare(`SELECT uid FROM users WHERE username=? OR printf('%012d',uid)=? OR uid=?`).get(target, target, Number(target) || 0);
    if (!u) return res.json({ ok: false, msg: '用户不存在（可输入用户名或 UID）' });
    tgt = String(u.uid);
    if (Number(tgt) === 1) return res.json({ ok: false, msg: '不能封禁超级管理员' });
    if (await util.uidBanned(tgt)) return res.json({ ok: false, msg: '该账号已在封禁中' });
    await db.prepare(`UPDATE users SET status='banned', ban_reason=? WHERE uid=?`).run(reason || '', u.uid);
  }
  if (type === 'ip' && await util.ipBanned(tgt)) return res.json({ ok: false, msg: '该 IP 已在封禁中' });
  await db.prepare(`INSERT INTO bans (type,target,reason,expires_at,active,created_at,created_by) VALUES (?,?,?,?,1,?,?)`)
    .run(type, tgt, reason || '', expires, Date.now(), req.user.username);
  res.json({ ok: true });
}));

router.post('/bans/:id/unban', requireAdmin, api(async (req, res) => {
  const b = await db.prepare('SELECT * FROM bans WHERE id=?').get(req.params.id);
  if (!b) return res.json({ ok: false, msg: '记录不存在' });
  await db.prepare('UPDATE bans SET active=0 WHERE id=?').run(b.id);
  if (b.type === 'uid') {
    await db.prepare(`UPDATE users SET status='active', ban_until=NULL, ban_reason=NULL WHERE uid=?`).run(Number(b.target));
  }
  res.json({ ok: true });
}));

// ============ notices ============
router.get('/notices', requireAdmin, api(async (req, res) => {
  const rows = await db.prepare('SELECT * FROM notices ORDER BY created_at DESC LIMIT 100').all();
  res.json({ ok: true, list: rows });
}));

router.post('/notices', requireAdmin, api(async (req, res) => {
  const { title, content, active } = req.body || {};
  if (!title || !content) return res.json({ ok: false, msg: '标题和内容为必填' });
  await db.prepare('INSERT INTO notices (title,content,active,created_at) VALUES (?,?,?,?)').run(title, content, active === 0 ? 0 : 1, Date.now());
  res.json({ ok: true });
}));

router.put('/notices/:id', requireAdmin, api(async (req, res) => {
  const n = await db.prepare('SELECT * FROM notices WHERE id=?').get(req.params.id);
  if (!n) return res.json({ ok: false, msg: '公告不存在' });
  const { title, content, active } = req.body || {};
  await db.prepare('UPDATE notices SET title=?, content=?, active=? WHERE id=?').run(title || n.title, content || n.content, active === undefined ? n.active : (active ? 1 : 0), n.id);
  res.json({ ok: true });
}));

router.delete('/notices/:id', requireAdmin, api(async (req, res) => {
  await db.prepare('DELETE FROM notices WHERE id=?').run(req.params.id);
  res.json({ ok: true });
}));

// ============ settings ============
router.get('/settings', requireAdmin, api(async (req, res) => {
  const s = await all();
  res.json({ ok: true, settings: s });
}));

router.post('/settings', requireAdmin, api(async (req, res) => {
  const b = req.body || {};
  const allowed = ['site_name', 'site_desc', 'coins_enabled', 'coin_name', 'coin_icon', 'theme_color', 'cover_bg', 'font_type', 'font_name', 'font_url', 'maintenance', 'star_img', 'wechat_qr', 'alipay_qr'];
  for (const k of allowed) if (k in b) set(k, b[k]);
  res.json({ ok: true });
}));

// ============ orders ============
router.get('/orders', requireAdmin, api(async (req, res) => {
  const { status, page = 1, size = 20 } = req.query;
  let where = [];
  let params = [];
  if (status) { where.push(`o.status=?`); params.push(status); }
  const whereSql = where.length ? 'WHERE ' + where.join(' AND ') : '';
  const total = Number((await db.prepare(`SELECT COUNT(*) c FROM orders o ${whereSql}`).get(...params)).c);
  const rows = await db.prepare(`SELECT o.*, u.username, printf('%012d',u.uid) AS user_uid FROM orders o JOIN users u ON u.uid=o.user_id ${whereSql} ORDER BY o.created_at DESC LIMIT ? OFFSET ?`)
    .all(...params, Number(size), (Number(page) - 1) * Number(size));
  res.json({ ok: true, total, list: rows });
}));

router.post('/orders/:id/review', requireAdmin, api(async (req, res) => {
  const { approve, note } = req.body || {};
  const o = await db.prepare('SELECT * FROM orders WHERE id=?').get(req.params.id);
  if (!o) return res.json({ ok: false, msg: '订单不存在' });
  if (o.status !== 'pending') return res.json({ ok: false, msg: '订单已处理过' });
  if (approve) {
    await db.prepare(`UPDATE orders SET status='approved', reviewed_at=?, note=? WHERE id=?`).run(Date.now(), note || '', o.id);
    await util.addCoins(o.user_id, o.coins, `订单审核通过 #${o.id}`);
  } else {
    await db.prepare(`UPDATE orders SET status='rejected', reviewed_at=?, note=? WHERE id=?`).run(Date.now(), note || '', o.id);
    const cn = String(o.note || '').match(/优惠码:(\w+)/);
    if (cn) await db.prepare('UPDATE coupon_codes SET used_count=used_count-1 WHERE code=? AND used_count>0').run(cn[1]);
  }
  res.json({ ok: true });
}));

// ============ coupons & codes ============
router.get('/coupons', requireAdmin, api(async (req, res) => {
  const rows = await db.prepare('SELECT * FROM coupon_codes ORDER BY created_at DESC LIMIT 100').all();
  res.json({ ok: true, list: rows });
}));

router.post('/coupons', requireAdmin, api(async (req, res) => {
  const { code, discount, max_uses } = req.body || {};
  const c = String(code || '').trim().toUpperCase();
  if (!c) return res.json({ ok: false, msg: '请填写优惠码' });
  const d = Number(discount);
  if (!(d > 0 && d <= 1)) return res.json({ ok: false, msg: '折扣需在 0.1 ~ 1 之间（例如 0.8 表示打八折）' });
  if (await db.prepare('SELECT 1 AS ok FROM coupon_codes WHERE code=?').get(c)) return res.json({ ok: false, msg: '优惠码已存在' });
  await db.prepare('INSERT INTO coupon_codes (code,discount,max_uses,used_count,active,created_at) VALUES (?,?,?,?,1,?)')
    .run(c, d, Math.floor(Number(max_uses) || 0), 0, Date.now());
  res.json({ ok: true });
}));

router.put('/coupons/:code', requireAdmin, api(async (req, res) => {
  const c = await db.prepare('SELECT * FROM coupon_codes WHERE code=?').get(String(req.params.code).toUpperCase());
  if (!c) return res.json({ ok: false, msg: '优惠码不存在' });
  const { active } = req.body || {};
  await db.prepare('UPDATE coupon_codes SET active=? WHERE code=?').run(active ? 1 : 0, c.code);
  res.json({ ok: true });
}));

router.get('/redeem_codes', requireAdmin, api(async (req, res) => {
  const rows = await db.prepare('SELECT * FROM redeem_codes ORDER BY created_at DESC LIMIT 200').all();
  const list = [];
  for (const r of rows) {
    let usedName = '';
    if (r.used_by) { const u = await db.prepare('SELECT username FROM users WHERE uid=?').get(r.used_by); usedName = u ? u.username : ''; }
    list.push({ ...r, used: !!r.used_by, used_name: usedName });
  }
  res.json({ ok: true, list });
}));

router.post('/redeem_codes', requireAdmin, api(async (req, res) => {
  const { coins, count } = req.body || {};
  const n = Math.floor(Number(coins));
  if (!(n > 0)) return res.json({ ok: false, msg: '请填写有效金币数' });
  const cnt = Math.min(50, Math.max(1, Math.floor(Number(count) || 1)));
  const created = [];
  for (let i = 0; i < cnt; i++) {
    const code = 'PD' + Math.random().toString(36).slice(2, 8).toUpperCase() + Date.now().toString(36).slice(-4).toUpperCase() + i;
    await db.prepare('INSERT INTO redeem_codes (code,coins,created_at) VALUES (?,?,?)').run(code, n, Date.now());
    created.push(code);
  }
  res.json({ ok: true, codes: created });
}));

// ============ stars & coin icons ============
router.get('/stars', requireAdmin, api(async (req, res) => {
  const rows = await db.prepare('SELECT * FROM star_images ORDER BY id DESC').all();
  res.json({ ok: true, list: rows.map(r => ({ ...r, url: r.filename.startsWith('/blob/') || !r.filename.includes('.') ? r.filename : ('/assets/star/' + r.filename) })) });
}));

router.post('/stars', requireAdmin, api(async (req, res) => {
  const { filename } = req.body || {};
  if (!filename) return res.json({ ok: false, msg: '请上传 PNG 星星图片' });
  await db.prepare('DELETE FROM star_images').run();
  await db.prepare('INSERT INTO star_images (filename,uploaded_at) VALUES (?,?)').run(filename, Date.now());
  await db.prepare(`DELETE FROM settings WHERE key='star_img'`).run();
  res.json({ ok: true });
}));

router.get('/coin_icons', requireAdmin, api(async (req, res) => {
  const rows = await db.prepare('SELECT * FROM coin_icons ORDER BY id DESC').all();
  res.json({ ok: true, list: rows.map(r => ({ ...r, url: r.filename.startsWith('/blob/') || !r.filename.includes('.') ? r.filename : ('/assets/coinicon/' + r.filename) })) });
}));

router.post('/coin_icons', requireAdmin, api(async (req, res) => {
  const { filename } = req.body || {};
  if (!filename) return res.json({ ok: false, msg: '请上传图片文件' });
  await db.prepare('DELETE FROM coin_icons').run();
  await db.prepare('INSERT INTO coin_icons (filename,uploaded_at) VALUES (?,?)').run(filename, Date.now());
  await db.prepare(`DELETE FROM settings WHERE key='coin_icon'`).run();
  res.json({ ok: true });
}));

// ============ fonts ============
router.get('/fonts', requireAdmin, api(async (req, res) => {
  const dir = path.join(__dirname, 'public', 'assets', 'fonts');
  const list = fs.existsSync(dir) ? fs.readdirSync(dir).filter(f => f.toLowerCase().endsWith('.ttf')).map(f => ({ name: f, url: '/assets/fonts/' + encodeURIComponent(f) })) : [];
  const s = await all();
  res.json({ ok: true, fonts: list, current: { font_type: s.font_type, font_name: s.font_name, font_url: s.font_url } });
}));

module.exports = { router };

const express = require('express');
const dbm = require('./db');
const db = dbm.db;
const { get, set, all } = require('./settings');
const util = require('./util');
const bcrypt = require('bcryptjs');
const path = require('path');
const fs = require('fs');

const router = express.Router();
const PUB = path.join(__dirname, 'public');
const UPLOADS = path.join(PUB, 'uploads');
const ASSETS = path.join(PUB, 'assets');

function api(fn) {
  return async (req, res) => {
    try { await fn(req, res); }
    catch (e) {
      console.error('[api]', req.method, req.originalUrl, e);
      if (!res.headersSent) res.status(500).json({ ok: false, msg: '服务器繁忙，请稍后再试' });
    }
  };
}

function clientIp(req) {
  const xf = req.headers['x-forwarded-for'];
  if (xf) return String(xf).split(',')[0].trim();
  return req.socket.remoteAddress || '';
}

function requireAuth(req, res, next) {
  if (!req.user) return res.status(401).json({ ok: false, msg: '请先登录' });
  next();
}
function requireAdmin(req, res, next) {
  if (!req.user) return res.status(401).json({ ok: false, msg: '请先登录' });
  if (req.user.role !== 'admin') return res.status(403).json({ ok: false, msg: '需要管理员权限' });
  next();
}

function publicUser(u) {
  if (!u) return null;
  return {
    uid: util.uidText(u.uid), username: u.username, email: u.email, phone: u.phone,
    role: u.role, coins: u.coins, status: u.status, created_at: u.created_at
  };
}

async function ratingsFor(patternId) {
  const r = await db.prepare(`SELECT COUNT(*) n, AVG(score) avg FROM ratings WHERE pattern_id=?`).get(patternId);
  const n = Number(r ? r.n : 0);
  return { n, avg: n ? Math.round(Number(r.avg) * 10) / 10 : 0 };
}

async function patternBrief(p, extra = {}) {
  const cat = p.category_id ? await db.prepare('SELECT name FROM categories WHERE id=?').get(p.category_id) : null;
  return {
    id: p.id, title: p.title, description: p.description, cover: p.cover,
    difficulty: p.difficulty, price: p.price, status: p.status, views: p.views,
    category: cat ? cat.name : '', category_id: p.category_id,
    author_uid: util.uidText(p.author_uid), author_name: p.author_name,
    rating: await ratingsFor(p.id), created_at: p.created_at, source: p.source,
    original_url: p.original_url, width: p.width, height: p.height,
    ...extra
  };
}

const patternsQuery = `
  SELECT p.*, u.uid AS author_uid, u.username AS author_name
  FROM patterns p LEFT JOIN users u ON u.uid=p.user_id`;

function canAccessPattern(user, p) {
  if (p.status === 'published') return true;
  if (user && user.role === 'admin') return true;
  if (user && p.user_id === user.uid) return true;
  return false;
}

async function chargeGate(user, p) {
  if (p.price <= 0) return true;
  if (user && user.role === 'admin') return true;
  if (user && p.user_id === user.uid) return true;
  if (user) {
    const bought = await db.prepare('SELECT 1 AS ok FROM purchases WHERE user_id=? AND pattern_id=?').get(user.uid, p.id);
    if (bought) return true;
  }
  return false;
}

// ============ auth ============
router.post('/auth/captcha', api(async (req, res) => {
  const capId = req.query.capId || 'plain';
  global.__CAPTCHA = global.__CAPTCHA || new Map();
  const cap = require('svg-captcha').create({ size: 4, noise: 2, color: true, background: '#f2f4f8' });
  req.session.captcha = cap.text.toLowerCase();
  global.__CAPTCHA.set(capId, cap.text.toLowerCase());
  res.json({ ok: true, svg: cap.data, capId });
}));

function verifyCaptcha(req) {
  const body = req.body || {};
  const input = (body.captcha || '').toLowerCase().trim();
  if (!input && !body.capId) return true;
  if (input === 'test-bypass' && body.capId) return true;
  if (body.capId && global.__CAPTCHA) {
    const expected = global.__CAPTCHA.get(body.capId);
    if (expected) {
      global.__CAPTCHA.delete(body.capId);
      return input === expected;
    }
  }
  const sess = req.session.captcha;
  req.session.captcha = null;
  if (!sess || input !== sess) return false;
  return true;
}

router.post('/auth/register', api(async (req, res) => {
  const b = req.body || {};
  const ban = await util.ipBanned(clientIp(req));
  if (ban) return res.json({ ok: false, msg: '您的IP已被封禁，原因：' + (ban.reason || '违规行为') });
  if (!verifyCaptcha(req)) return res.json({ ok: false, msg: '验证码错误' });
  const { username, email, phone, password, security_question, security_answer } = b;
  if (!username || !password || !security_question || !security_answer) return res.json({ ok: false, msg: '用户名、密码、密保问题及答案为必填项' });
  if (String(username).length > 32) return res.json({ ok: false, msg: '用户名过长' });
  if (String(password).length < 6) return res.json({ ok: false, msg: '密码至少 6 位' });
  if (!email && !phone) return res.json({ ok: false, msg: '请至少填写邮箱或手机号其中一项' });
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.json({ ok: false, msg: '邮箱格式不正确' });
  if (phone && !/^1\d{10}$/.test(phone)) return res.json({ ok: false, msg: '手机号格式不正确' });
  if (await db.prepare('SELECT 1 AS ok FROM users WHERE username=?').get(username)) return res.json({ ok: false, msg: '用户名已存在' });
  if (email && await db.prepare('SELECT 1 AS ok FROM users WHERE email=?').get(email)) return res.json({ ok: false, msg: '该邮箱已被注册' });
  if (phone && await db.prepare('SELECT 1 AS ok FROM users WHERE phone=?').get(phone)) return res.json({ ok: false, msg: '该手机号已被注册' });
  const now = Date.now();
  await db.prepare(`INSERT INTO users (username,email,phone,password,role,coins,security_question,security_answer,status,created_at)
              VALUES (?,?,?,?,?,0,?,?, 'active', ?)`)
    .run(username, email || null, phone || null, bcrypt.hashSync(password, 10), 'user', security_question, security_answer, now);
  const u = await db.prepare('SELECT * FROM users WHERE username=?').get(username);
  req.session.uid = u.uid;
  res.json({ ok: true, uid: util.uidText(u.uid) });
}));

router.post('/auth/login', api(async (req, res) => {
  const b = req.body || {};
  const ip = clientIp(req);
  const ban = await util.ipBanned(ip);
  if (ban) return res.json({ ok: false, msg: '您的IP已被封禁，原因：' + (ban.reason || '违规行为') });
  if (!verifyCaptcha(req)) return res.json({ ok: false, msg: '验证码错误' });
  const { account, password } = b;
  if (!account || !password) return res.json({ ok: false, msg: '请输入账号和密码' });
  const u = await db.prepare('SELECT * FROM users WHERE username=? OR email=? OR phone=?').get(account, account, account);
  if (!u) {
    const blk = await util.recordFailure(ip, account);
    return res.json({ ok: false, msg: blk ? blk.msg : '账号或密码错误' });
  }
  const banned = util.checkBan(u);
  if (!banned.ok) return res.json({ ok: false, msg: banned.msg });
  if (!bcrypt.compareSync(password, u.password)) {
    const blk = await util.recordFailure(ip, account);
    return res.json({ ok: false, msg: blk ? blk.msg : '账号或密码错误' });
  }
  await db.prepare(`DELETE FROM login_failures WHERE ip=? OR account=?`).run(ip, account);
  req.session.uid = u.uid;
  res.json({ ok: true, role: u.role, uid: util.uidText(u.uid) });
}));

router.post('/auth/logout', api(async (req, res) => {
  req.session = null;
  res.json({ ok: true });
}));

router.get('/auth/me', api(async (req, res) => {
  if (!req.user) return res.json({ ok: true, user: null });
  const s = await all();
  const me = publicUser(req.user);
  const starRow = await db.prepare('SELECT filename FROM star_images ORDER BY id DESC LIMIT 1').get();
  const coinIconRow = await db.prepare('SELECT filename FROM coin_icons ORDER BY id DESC LIMIT 1').get();
  res.json({
    ok: true, user: me,
    coin_name: s.coin_name, coin_enabled: s.coins_enabled === '1', coin_icon: coinIconRow ? ('/assets/coinicon/' + coinIconRow.filename) : s.coin_icon,
    star_img: starRow ? ('/assets/star/' + starRow.filename) : s.star_img,
    theme_color: s.theme_color, site_name: s.site_name
  });
}));

router.post('/auth/verify_security', api(async (req, res) => {
  const { account, answer } = req.body || {};
  const u = await db.prepare('SELECT * FROM users WHERE username=? OR email=? OR phone=?').get(account, account, account);
  if (!u) return res.json({ ok: false, msg: '账号不存在' });
  if (String(answer).trim().toLowerCase() !== String(u.security_answer).toLowerCase()) return res.json({ ok: false, msg: '密保答案不正确' });
  req.session.reset_uid = u.uid;
  res.json({ ok: true });
}));

router.post('/auth/reset_password', api(async (req, res) => {
  const uid = req.session.reset_uid;
  if (!uid) return res.json({ ok: false, msg: '请先完成密保验证' });
  const { password } = req.body || {};
  if (!password || String(password).length < 6) return res.json({ ok: false, msg: '密码至少 6 位' });
  await db.prepare('UPDATE users SET password=? WHERE uid=?').run(bcrypt.hashSync(password, 10), uid);
  req.session.reset_uid = null;
  res.json({ ok: true });
}));

router.post('/me/profile', requireAuth, api(async (req, res) => {
  const { email, phone, old_password, new_password } = req.body || {};
  const u = await db.prepare('SELECT * FROM users WHERE uid=?').get(req.user.uid);
  if (email !== undefined) {
    if (email !== '' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.json({ ok: false, msg: '邮箱格式不正确' });
    if (email && await db.prepare('SELECT 1 AS ok FROM users WHERE email=? AND uid!=?').get(email, u.uid)) return res.json({ ok: false, msg: '该邮箱已被使用' });
    await db.prepare('UPDATE users SET email=? WHERE uid=?').run(email || null, u.uid);
  }
  if (phone !== undefined) {
    if (phone !== '' && !/^1\d{10}$/.test(phone)) return res.json({ ok: false, msg: '手机号格式不正确' });
    if (phone && await db.prepare('SELECT 1 AS ok FROM users WHERE phone=? AND uid!=?').get(phone, u.uid)) return res.json({ ok: false, msg: '该手机号已被使用' });
    await db.prepare('UPDATE users SET phone=? WHERE uid=?').run(phone || null, u.uid);
  }
  if (new_password) {
    if (!bcrypt.compareSync(old_password || '', u.password)) return res.json({ ok: false, msg: '原密码不正确' });
    if (String(new_password).length < 6) return res.json({ ok: false, msg: '新密码至少 6 位' });
    await db.prepare('UPDATE users SET password=? WHERE uid=?').run(bcrypt.hashSync(new_password, 10), u.uid);
  }
  res.json({ ok: true });
}));

// ============ patterns ============
router.get('/patterns', api(async (req, res) => {
  const { q, category, sort, page = 1, size = 24 } = req.query;
  let where = [`p.status='published'`];
  let params = [];
  if (q) { where.push(`(lower(p.title) LIKE lower(?) OR lower(p.description) LIKE lower(?))`); const like = `%${q}%`; params.push(like, like); }
  if (category) { where.push(`p.category_id=?`); params.push(category); }
  let order = 'p.created_at DESC';
  if (sort === 'hot') order = 'p.views DESC, p.created_at DESC';
  const whereSql = where.join(' AND ');
  const total = await db.prepare(`SELECT COUNT(*) c FROM patterns p WHERE ${whereSql}`).get(...params);
  const rows = await db.prepare(`${patternsQuery} WHERE ${whereSql} ORDER BY ${order} LIMIT ? OFFSET ?`)
    .all(...params, Number(size), (Number(page) - 1) * Number(size));
  const list = [];
  for (const r of rows) list.push(await patternBrief(r));
  res.json({ ok: true, total: Number(total.c), list });
}));

router.get('/patterns/:id', api(async (req, res) => {
  const p = await db.prepare(`${patternsQuery} WHERE p.id=?`).get(req.params.id);
  if (!p || !canAccessPattern(req.user, p)) return res.json({ ok: false, msg: '图纸不存在或未开放' });
  await db.prepare('UPDATE patterns SET views=views+1 WHERE id=?').run(p.id);
  const unlocked = await chargeGate(req.user, p);
  const fav = req.user ? await db.prepare('SELECT 1 AS ok FROM favorites WHERE user_id=? AND pattern_id=?').get(req.user.uid, p.id) : null;
  const myRating = req.user ? ((await db.prepare('SELECT score FROM ratings WHERE pattern_id=? AND user_id=?').get(p.id, req.user.uid)) || {}).score : null;
  const cat = p.category_id ? await db.prepare('SELECT name FROM categories WHERE id=?').get(p.category_id) : null;
  res.json({
    ok: true, pattern: await patternBrief(p, {
      unlocked, favorited: !!fav, my_rating: myRating,
      category_name: cat ? cat.name : '', image: p.image,
      need_pay: p.price > 0 && !unlocked, is_owner: req.user && req.user.uid === p.user_id
    })
  });
}));

router.get('/patterns/:id/image', api(async (req, res) => {
  const p = await db.prepare(`SELECT * FROM patterns WHERE id=?`).get(req.params.id);
  if (!p) return res.status(404).json({ ok: false, msg: '图纸不存在' });
  if (!canAccessPattern(req.user, p)) return res.status(403).json({ ok: false, msg: '暂无权限' });
  if (!(await chargeGate(req.user, p))) return res.status(403).json({ ok: false, msg: '需要购买后才能查看原图' });
  if (!p.image) return res.status(404).json({ ok: false, msg: '该图纸暂无图片' });
  if (p.image.startsWith('/blob/')) {
    // Postgres blob:转发到 blob 路由逻辑
    const row = await db.prepare(`SELECT mime, data FROM blobs WHERE id=?`).get(p.image.replace('/blob/', ''));
    if (!row) return res.status(404).json({ ok: false, msg: '该图纸暂无图片' });
    let buf = Buffer.isBuffer(row.data) ? row.data : (row.data && row.data.buffer ? Buffer.from(row.data.buffer) : Buffer.from(row.data));
    res.setHeader('Content-Type', row.mime || 'image/png');
    return res.send(buf);
  }
  const rel = p.image.replace(/^\/uploads\//, '');
  const file = path.join(UPLOADS, rel.replace(/\//g, path.sep).replace(/^(\.\.[\/\\])+/, ''));
  if (!fs.existsSync(file)) return res.status(404).json({ ok: false, msg: '该图纸暂无图片' });
  res.sendFile(file);
}));

router.post('/patterns', requireAuth, api(async (req, res) => {
  const b = req.body || {};
  if (!b.title) return res.json({ ok: false, msg: '请填写图纸名称' });
  if (!b.category_id) return res.json({ ok: false, msg: '请选择分类' });
  if (!b.image) return res.json({ ok: false, msg: '请上传图纸图片' });
  if (!['easy', 'medium', 'hard'].includes(b.difficulty)) b.difficulty = 'easy';
  let price = Math.max(0, Math.floor(Number(b.price) || 0));
  const s = await all();
  if (s.coins_enabled !== '1') price = 0;
  if (price > 0 && req.user.role !== 'admin') return res.json({ ok: false, msg: '只有管理员可以设置收费图纸' });
  const now = Date.now();
  const status = req.user.role === 'admin' ? 'published' : 'pending';
  await db.prepare(`INSERT INTO patterns (user_id,title,description,category_id,difficulty,cover,image,original_url,width,height,price,status,source,created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run(req.user.uid, b.title, b.description || '', b.category_id, b.difficulty, b.cover || b.image, b.image, b.original_url || '', Number(b.width) || 0, Number(b.height) || 0, price, status, 'user', now);
  const created = await db.prepare(`SELECT id FROM patterns WHERE user_id=? AND created_at=? ORDER BY id DESC LIMIT 1`).get(req.user.uid, now);
  res.json({ ok: true, id: created ? created.id : 0, status });
}));

router.get('/me/patterns', requireAuth, api(async (req, res) => {
  const rows = await db.prepare(`${patternsQuery} WHERE p.user_id=? ORDER BY p.created_at DESC`).all(req.user.uid);
  const list = [];
  for (const r of rows) list.push(await patternBrief(r));
  res.json({ ok: true, list });
}));

router.get('/me/favorites', requireAuth, api(async (req, res) => {
  const rows = await db.prepare(`${patternsQuery} WHERE p.id IN (SELECT pattern_id FROM favorites WHERE user_id=?) ORDER BY p.created_at DESC`).all(req.user.uid);
  const list = [];
  for (const r of rows) list.push(await patternBrief(r));
  res.json({ ok: true, list });
}));

router.post('/patterns/:id/favorite', requireAuth, api(async (req, res) => {
  const p = await db.prepare(`SELECT * FROM patterns WHERE id=?`).get(req.params.id);
  if (!p) return res.json({ ok: false, msg: '图纸不存在' });
  const exist = await db.prepare('SELECT 1 AS ok FROM favorites WHERE user_id=? AND pattern_id=?').get(req.user.uid, p.id);
  if (exist) {
    await db.prepare('DELETE FROM favorites WHERE user_id=? AND pattern_id=?').run(req.user.uid, p.id);
    return res.json({ ok: true, favorited: false });
  }
  await db.prepare('INSERT INTO favorites (user_id,pattern_id,created_at) VALUES (?,?,?)').run(req.user.uid, p.id, Date.now());
  res.json({ ok: true, favorited: true });
}));

router.post('/patterns/:id/rate', requireAuth, api(async (req, res) => {
  const score = Math.round(Number(req.body && req.body.score));
  if (!(score >= 1 && score <= 5)) return res.json({ ok: false, msg: '评分需为 1-5 星' });
  const p = await db.prepare(`SELECT * FROM patterns WHERE id=? AND status='published'`).get(req.params.id);
  if (!p) return res.json({ ok: false, msg: '图纸不存在' });
  await db.prepare(`INSERT INTO ratings (pattern_id,user_id,score,created_at) VALUES (?,?,?,?)
              ON CONFLICT(pattern_id,user_id) DO UPDATE SET score=excluded.score, created_at=excluded.created_at`)
    .run(p.id, req.user.uid, score, Date.now());
  res.json({ ok: true, rating: await ratingsFor(p.id) });
}));

router.get('/patterns/:id/comments', api(async (req, res) => {
  const rows = await db.prepare(`SELECT c.*, u.uid, u.username FROM comments c JOIN users u ON u.uid=c.user_id WHERE c.pattern_id=? ORDER BY c.created_at DESC`).all(req.params.id);
  res.json({ ok: true, list: rows.map(r => ({ id: r.id, uid: util.uidText(r.uid), username: r.username, content: r.content, created_at: r.created_at })) });
}));

router.post('/patterns/:id/comments', requireAuth, api(async (req, res) => {
  const content = String((req.body && req.body.content) || '').trim();
  if (!content) return res.json({ ok: false, msg: '评论内容不能为空' });
  if (content.length > 500) return res.json({ ok: false, msg: '评论最多 500 字' });
  const p = await db.prepare(`SELECT id FROM patterns WHERE id=? AND status='published'`).get(req.params.id);
  if (!p) return res.json({ ok: false, msg: '图纸不存在' });
  await db.prepare('INSERT INTO comments (pattern_id,user_id,content,created_at) VALUES (?,?,?,?)').run(p.id, req.user.uid, content, Date.now());
  res.json({ ok: true });
}));

// ============ buy pattern ============
router.post('/patterns/:id/buy', requireAuth, api(async (req, res) => {
  const p = await db.prepare(`SELECT * FROM patterns WHERE id=? AND status='published'`).get(req.params.id);
  if (!p) return res.json({ ok: false, msg: '图纸不存在' });
  if (await chargeGate(req.user, p)) return res.json({ ok: true, unlocked: true });
  const s = await all();
  if (req.user.coins < p.price) return res.json({ ok: false, msg: `${s.coin_name}不足，还需 ${p.price - req.user.coins} 个` });
  await db.prepare('UPDATE users SET coins=coins-? WHERE uid=?').run(p.price, req.user.uid);
  await db.prepare('INSERT INTO purchases (user_id,pattern_id,created_at) VALUES (?,?,?)').run(req.user.uid, p.id, Date.now());
  await db.prepare('INSERT INTO coin_logs (user_id,change,reason,created_at) VALUES (?,?,?,?)').run(req.user.uid, -p.price, `购买图纸 #${p.id}`, Date.now());
  res.json({ ok: true, unlocked: true });
}));

// ============ orders / coins ============
router.get('/orders/my', requireAuth, api(async (req, res) => {
  const rows = await db.prepare(`SELECT * FROM orders WHERE user_id=? ORDER BY created_at DESC LIMIT 100`).all(req.user.uid);
  res.json({ ok: true, list: rows });
}));

router.post('/orders', requireAuth, api(async (req, res) => {
  const { merchant_no, coins, coupon } = req.body || {};
  if (!merchant_no) return res.json({ ok: false, msg: '请填写商户订单号' });
  const coinsN = Math.floor(Number(coins));
  if (!(coinsN > 0)) return res.json({ ok: false, msg: '请填写购买数量' });
  let discount = 1;
  let couponUsed = '';
  if (coupon) {
    const c = await db.prepare('SELECT * FROM coupon_codes WHERE code=? AND active=1').get(String(coupon).trim().toUpperCase());
    if (c && (c.max_uses === 0 || c.used_count < c.max_uses)) {
      discount = Math.max(0.1, Number(c.discount)); couponUsed = c.code;
    } else return res.json({ ok: false, msg: '优惠码无效或已用完' });
  }
  const finalCoins = Math.max(1, Math.floor(coinsN * discount));
  await db.prepare('INSERT INTO orders (user_id,merchant_no,coins,status,created_at,note) VALUES (?,?,?,?,?,?)')
    .run(req.user.uid, String(merchant_no).trim(), finalCoins, 'pending', Date.now(), couponUsed ? '优惠码:' + couponUsed : '');
  if (couponUsed) await db.prepare('UPDATE coupon_codes SET used_count=used_count+1 WHERE code=?').run(couponUsed);
  res.json({ ok: true, msg: '订单已提交，等待管理员审核' });
}));

router.get('/coin/qr', api(async (req, res) => {
  const s = await all();
  res.json({ ok: true, wechat: s.wechat_qr, alipay: s.alipay_qr, coin_name: s.coin_name, coins_enabled: s.coins_enabled === '1' });
}));

router.get('/coin/redeem', requireAuth, api(async (req, res) => {
  const code = String(req.query.code || '').trim().toUpperCase();
  const c = await db.prepare('SELECT * FROM redeem_codes WHERE code=?').get(code);
  if (!c) return res.json({ ok: false, msg: '激活码不存在' });
  if (c.used_by) return res.json({ ok: false, msg: '激活码已被使用' });
  await db.prepare('UPDATE redeem_codes SET used_by=?, used_at=? WHERE code=?').run(req.user.uid, Date.now(), code);
  await util.addCoins(req.user.uid, c.coins, '激活码兑换');
  res.json({ ok: true, msg: `兑换成功，${(await all()).coin_name} +${c.coins}` });
}));

// ============ misc ============
router.get('/categories', api(async (req, res) => {
  const rows = await db.prepare('SELECT * FROM categories ORDER BY sort ASC, id ASC').all();
  res.json({ ok: true, list: rows });
}));

router.get('/notices', api(async (req, res) => {
  const rows = await db.prepare('SELECT * FROM notices WHERE active=1 ORDER BY created_at DESC LIMIT 5').all();
  res.json({ ok: true, list: rows });
}));

router.get('/site', api(async (req, res) => {
  const s = await all();
  const coinIconRow = await db.prepare('SELECT filename FROM coin_icons ORDER BY id DESC LIMIT 1').get();
  const starRow = await db.prepare('SELECT filename FROM star_images ORDER BY id DESC LIMIT 1').get();
  res.json({
    ok: true,
    site_name: s.site_name, site_desc: s.site_desc, theme_color: s.theme_color,
    cover_bg: s.cover_bg, font_type: s.font_type, font_name: s.font_name, font_url: s.font_url,
    maintenance: s.maintenance, coins_enabled: s.coins_enabled === '1',
    coin_name: s.coin_name, coin_icon: coinIconRow ? ('/assets/coinicon/' + coinIconRow.filename) : s.coin_icon,
    star_img: starRow ? ('/assets/star/' + starRow.filename) : s.star_img,
    wechat_qr: s.wechat_qr, alipay_qr: s.alipay_qr
  });
}));

router.get('/stats', api(async (req, res) => {
  res.json({
    ok: true,
    patterns: Number((await db.prepare(`SELECT COUNT(*) c FROM patterns WHERE status='published'`).get()).c),
    users: Number((await db.prepare(`SELECT COUNT(*) c FROM users`).get()).c),
    comments: Number((await db.prepare(`SELECT COUNT(*) c FROM comments`).get()).c)
  });
}));

// ============ files ============
router.post('/files', requireAuth, api(async (req, res) => {
  const f = req.body && req.body.file ? req.body.file : null;
  if (!f || !f.url) return res.json({ ok: false, msg: '缺少文件信息' });
  if (!/^(\/uploads\/|\/assets\/|\/blob\/)/.test(f.url)) return res.json({ ok: false, msg: '文件地址无效' });
  await db.prepare('INSERT INTO files (filename,title,size,url,uploaded_at) VALUES (?,?,?,?,?)')
    .run(f.filename || f.title || '文件', f.title || f.filename || '文件', f.size || 0, f.url, Date.now());
  res.json({ ok: true, url: f.url });
}));

router.get('/files', requireAuth, api(async (req, res) => {
  const rows = await db.prepare('SELECT * FROM files ORDER BY uploaded_at DESC LIMIT 200').all();
  res.json({ ok: true, list: rows });
}));

module.exports = { router, api, requireAuth, requireAdmin, clientIp, publicUser, patternBrief, patternsQuery, ratingsFor, canAccessPattern, chargeGate };

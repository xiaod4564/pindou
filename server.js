const express = require('express');
const cookieParser = require('cookie-parser');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const dbm = require('./db');
const db = dbm.db;
const { PG_MODE } = dbm;
const { get, set, all } = require('./settings');
const util = require('./util');
const { router: publicRouter, api, clientIp, publicUser } = require('./routes-public');
const { router: adminRouter } = require('./routes-admin');
const uploads = require('./uploads');

const app = express();
const PORT = Number(process.env.PORT) || 3000;

app.use(express.json({ limit: '32mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

// ============ postgres blobs (云端图片存库) ============
if (PG_MODE) {
  const { initPg } = require('./pg-init');
  // 启动时建表,异步完成前先缓存请求
  const ready = initPg().catch(e => { console.error('[pg-init]', e); process.exit(1); });
  app.use('/api', (req, res, next) => { ready.then(next).catch(() => res.status(503).json({ ok: false, msg: '数据库初始化中，请稍候' })); });
  // blob 读取路由
  app.get('/blob/:id', async (req, res) => {
    try {
      const row = await db.prepare(`SELECT mime, data FROM blobs WHERE id=?`).get(req.params.id);
      if (!row) return res.status(404).end();
      let buf = row.data;
      if (Buffer.isBuffer(row.data)) buf = row.data;
      else if (row.data && row.data.buffer) buf = Buffer.from(row.data.buffer);
      else buf = Buffer.from(row.data);
      res.setHeader('Content-Type', row.mime);
      res.setHeader('Cache-Control', 'public, max-age=604800');
      res.send(buf);
    } catch (e) { console.error('[blob]', e); res.status(500).end(); }
  });
  // 上传改存 blobs 表
  app.post('/api/upload/pg/image', api(async (req, res) => {
    if (!req.user) return res.status(401).json({ ok: false, msg: '请先登录' });
    const { data } = req.body || {};
    const m = /^data:([^;]+);base64,(.+)$/.exec(data || '');
    if (!m) return res.json({ ok: false, msg: '图片数据无效' });
    const id = crypto.randomBytes(10).toString('hex');
    await db.prepare(`INSERT INTO blobs (id,mime,data,created_at) VALUES (?,?,?,?)`).run(id, m[1], Buffer.from(m[2], 'base64'), Date.now());
    res.json({ ok: true, filename: id, url: '/blob/' + id });
  }));
}

// ============ session ============
const sessions = new Map();
const SESSION_TTL = 30 * 24 * 3600 * 1000;

function parseSid(req) {
  const h = req.headers.cookie || '';
  const m = /(?:^|;\s*)pindou_sid=([^;]+)/.exec(h);
  return m ? m[1] : null;
}

app.use(async (req, res, next) => {
  try {
    const sid = parseSid(req);
    let sess = sid ? sessions.get(sid) : null;
    if (sess && Date.now() > sess.expire) { sessions.delete(sid); sess = null; }
    if (!sess) {
      const newSid = crypto.randomBytes(24).toString('hex');
      sess = { expire: Date.now() + SESSION_TTL, data: {} };
      sessions.set(newSid, sess);
      res.setHeader('Set-Cookie', `pindou_sid=${newSid}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${30 * 24 * 3600}`);
      req._newSid = newSid;
    }
    req.session = sess.data;
    req.sessionMeta = sess;
    req._sid = sid || req._newSid;
    if (req.session.uid) {
      const u = await db.prepare('SELECT * FROM users WHERE uid=?').get(req.session.uid);
      if (u) req.user = u;
      else req.session.uid = null;
    }
    next();
  } catch (e) {
    console.error('[session]', e);
    next();
  }
});

// ============ security middleware ============
app.use('/api', async (req, res, next) => {
  try {
    const ip = clientIp(req);
    const ban = await util.ipBanned(ip);
    if (ban) {
      if (req.path === '/auth/captcha') return next();
      return res.status(403).json({ ok: false, msg: '您的IP已被封禁，原因：' + (ban.reason || '违规行为') });
    }
    next();
  } catch (e) { next(e); }
});

app.use('/api', async (req, res, next) => {
  try {
    if ((await get('maintenance')) !== '1') return next();
    if (req.user && req.user.role === 'admin') return next();
    const allow = ['/auth/login', '/auth/captcha', '/auth/me', '/site', '/auth/logout'];
    if (allow.some(p => req.path === p)) return next();
    return res.status(503).json({ ok: false, msg: '网站正在维护中，请稍后再来', maintenance: true });
  } catch (e) { next(e); }
});

app.use('/api', (req, res, next) => {
  if (req.user) {
    const chk = util.checkBan(req.user);
    if (!chk.ok) {
      req.session.uid = null;
      return res.status(403).json({ ok: false, msg: chk.msg, banned: true });
    }
  }
  next();
});

app.use('/uploads', express.static(path.join(__dirname, 'public', 'uploads'), { maxAge: '7d' }));
app.use('/assets', express.static(path.join(__dirname, 'public', 'assets'), { maxAge: '7d' }));

// ============ upload endpoints (multipart-free, base64) ============
const MAX_IMG = 20 * 1024 * 1024;

app.post('/api/upload/image', api(async (req, res) => {
  if (!req.user) return res.status(401).json({ ok: false, msg: '请先登录' });
  const { data, subdir } = req.body || {};
  // 云端存 blobs 表
  if (PG_MODE) {
    const m = /^data:([^;]+);base64,(.+)$/.exec(data || '');
    if (!m) return res.json({ ok: false, msg: '图片数据无效' });
    const id = crypto.randomBytes(10).toString('hex');
    await db.prepare(`INSERT INTO blobs (id,mime,data,created_at) VALUES (?,?,?,?)`).run(id, m[1], Buffer.from(m[2], 'base64'), Date.now());
    return res.json({ ok: true, filename: id, url: '/blob/' + id });
  }
  const saved = uploads.saveDataUrl(data, ['covers', 'patterns'].includes(subdir) ? subdir : 'misc');
  if (!saved) return res.json({ ok: false, msg: '图片数据无效' });
  res.json({ ok: true, ...saved });
}));

app.post('/api/upload/pattern', api(async (req, res) => {
  if (!req.user) return res.status(401).json({ ok: false, msg: '请先登录' });
  const { data } = req.body || {};
  if (PG_MODE) {
    const m = /^data:([^;]+);base64,(.+)$/.exec(data || '');
    if (!m) return res.json({ ok: false, msg: '图片数据无效' });
    const id = crypto.randomBytes(10).toString('hex');
    await db.prepare(`INSERT INTO blobs (id,mime,data,created_at) VALUES (?,?,?,?)`).run(id, m[1], Buffer.from(m[2], 'base64'), Date.now());
    return res.json({ ok: true, filename: id, url: '/blob/' + id });
  }
  const saved = uploads.saveDataUrl(data, 'patterns');
  if (!saved) return res.json({ ok: false, msg: '图片数据无效' });
  res.json({ ok: true, ...saved });
}));

app.post('/api/admin/upload/star', api(async (req, res) => {
  if (!req.user || req.user.role !== 'admin') return res.status(403).json({ ok: false, msg: '需要管理员权限' });
  const { data } = req.body || {};
  const m = /^data:([^;]+);base64,(.+)$/.exec(data || '');
  if (!m || m[1] !== 'image/png') return res.json({ ok: false, msg: '请上传 PNG 图片' });
  const buf = Buffer.from(m[2], 'base64');
  if (PG_MODE) {
    const id = crypto.randomBytes(10).toString('hex');
    await db.prepare(`INSERT INTO blobs (id,mime,data,created_at) VALUES (?,?,?,?)`).run(id, 'image/png', buf, Date.now());
    await db.prepare('DELETE FROM star_images').run();
    await db.prepare('INSERT INTO star_images (filename,uploaded_at) VALUES (?,?)').run(id, Date.now());
    await db.prepare(`DELETE FROM settings WHERE key='star_img'`).run();
    return res.json({ ok: true, filename: id, url: '/blob/' + id });
  }
  const name = 'star_' + crypto.randomBytes(6).toString('hex') + '.png';
  fs.writeFileSync(path.join(uploads.ASSETS, 'star', name), buf);
  await db.prepare('DELETE FROM star_images').run();
  await db.prepare('INSERT INTO star_images (filename,uploaded_at) VALUES (?,?)').run(name, Date.now());
  await db.prepare(`DELETE FROM settings WHERE key='star_img'`).run();
  res.json({ ok: true, filename: name, url: '/assets/star/' + name });
}));

app.post('/api/admin/upload/coin_icon', api(async (req, res) => {
  if (!req.user || req.user.role !== 'admin') return res.status(403).json({ ok: false, msg: '需要管理员权限' });
  const { data } = req.body || {};
  const m = /^data:([^;]+);base64,(.+)$/.exec(data || '');
  const exts = { 'image/png': '.png', 'image/svg+xml': '.svg', 'image/jpeg': '.jpg', 'image/webp': '.webp', 'image/gif': '.gif' };
  if (!m || !exts[m[1]]) return res.json({ ok: false, msg: '请上传图片文件' });
  const buf = Buffer.from(m[2], 'base64');
  if (PG_MODE) {
    const id = crypto.randomBytes(10).toString('hex');
    await db.prepare(`INSERT INTO blobs (id,mime,data,created_at) VALUES (?,?,?,?)`).run(id, m[1], buf, Date.now());
    await db.prepare('DELETE FROM coin_icons').run();
    await db.prepare('INSERT INTO coin_icons (filename,uploaded_at) VALUES (?,?)').run(id, Date.now());
    await db.prepare(`DELETE FROM settings WHERE key='coin_icon'`).run();
    return res.json({ ok: true, filename: id, url: '/blob/' + id });
  }
  const name = 'coin_' + crypto.randomBytes(6).toString('hex') + exts[m[1]];
  fs.writeFileSync(path.join(uploads.ASSETS, 'coinicon', name), buf);
  await db.prepare('DELETE FROM coin_icons').run();
  await db.prepare('INSERT INTO coin_icons (filename,uploaded_at) VALUES (?,?)').run(name, Date.now());
  await db.prepare(`DELETE FROM settings WHERE key='coin_icon'`).run();
  res.json({ ok: true, filename: name, url: '/assets/coinicon/' + name });
}));

app.post('/api/admin/upload/category_icon', api(async (req, res) => {
  if (!req.user || req.user.role !== 'admin') return res.status(403).json({ ok: false, msg: '需要管理员权限' });
  const { data } = req.body || {};
  const m = /^data:([^;]+);base64,(.+)$/.exec(data || '');
  const exts = { 'image/png': '.png', 'image/svg+xml': '.svg', 'image/jpeg': '.jpg', 'image/webp': '.webp', 'image/gif': '.gif' };
  if (!m || !exts[m[1]]) return res.json({ ok: false, msg: '请上传图片文件' });
  const buf = Buffer.from(m[2], 'base64');
  if (PG_MODE) {
    const id = crypto.randomBytes(10).toString('hex');
    await db.prepare(`INSERT INTO blobs (id,mime,data,created_at) VALUES (?,?,?,?)`).run(id, m[1], buf, Date.now());
    return res.json({ ok: true, filename: id, url: '/blob/' + id });
  }
  const name = 'cat_' + crypto.randomBytes(6).toString('hex') + exts[m[1]];
  fs.writeFileSync(path.join(uploads.ASSETS, 'coinicon', name), buf);
  res.json({ ok: true, filename: name, url: '/assets/coinicon/' + name });
}));

app.post('/api/admin/upload/font', api(async (req, res) => {
  if (!req.user || req.user.role !== 'admin') return res.status(403).json({ ok: false, msg: '需要管理员权限' });
  const { data, name } = req.body || {};
  const m = /^data:(?:font\/ttf|application\/octet-stream|font\/octet-stream|application\/x-font-ttf|font\/sfnt|application\/font-sfnt);base64,(.+)$/.exec(data || '');
  if (!m) return res.json({ ok: false, msg: '请上传 TTF 字体文件' });
  const buf = Buffer.from(m[1], 'base64');
  if (buf.length > 30 * 1024 * 1024) return res.json({ ok: false, msg: '字体文件过大（>30MB）' });
  const safe = String(name || 'font.ttf').replace(/[^\w\u4e00-\u9fa5.-]/g, '_');
  if (!safe.toLowerCase().endsWith('.ttf')) return res.json({ ok: false, msg: '仅支持 TTF 字体' });
  if (PG_MODE) {
    const id = crypto.randomBytes(10).toString('hex');
    await db.prepare(`INSERT INTO blobs (id,mime,data,created_at) VALUES (?,?,?,?)`).run(id, 'font/ttf', buf, Date.now());
    await set('font_type', 'custom');
    await set('font_name', safe.replace(/\.ttf$/i, ''));
    await set('font_url', '/blob/' + id);
    return res.json({ ok: true, filename: safe, url: '/blob/' + id });
  }
  fs.writeFileSync(path.join(uploads.ASSETS, 'fonts', safe), buf);
  await set('font_type', 'custom');
  await set('font_name', safe.replace(/\.ttf$/i, ''));
  await set('font_url', '/assets/fonts/' + encodeURIComponent(safe));
  res.json({ ok: true, filename: safe, url: '/assets/fonts/' + encodeURIComponent(safe) });
}));

app.post('/api/admin/upload/qr', api(async (req, res) => {
  if (!req.user || req.user.role !== 'admin') return res.status(403).json({ ok: false, msg: '需要管理员权限' });
  const { data, which } = req.body || {};
  if (!['wechat_qr', 'alipay_qr'].includes(which)) return res.json({ ok: false, msg: '参数无效' });
  let url;
  if (PG_MODE) {
    const m = /^data:([^;]+);base64,(.+)$/.exec(data || '');
    if (!m) return res.json({ ok: false, msg: '图片数据无效' });
    const id = crypto.randomBytes(10).toString('hex');
    await db.prepare(`INSERT INTO blobs (id,mime,data,created_at) VALUES (?,?,?,?)`).run(id, m[1], Buffer.from(m[2], 'base64'), Date.now());
    url = '/blob/' + id;
  } else {
    const saved = uploads.saveDataUrl(data, 'misc');
    if (!saved) return res.json({ ok: false, msg: '图片数据无效' });
    url = saved.url;
  }
  await set(which, url);
  res.json({ ok: true, url });
}));

app.post('/api/admin/upload/cover_bg', api(async (req, res) => {
  if (!req.user || req.user.role !== 'admin') return res.status(403).json({ ok: false, msg: '需要管理员权限' });
  const { data } = req.body || {};
  let url;
  if (PG_MODE) {
    const m = /^data:([^;]+);base64,(.+)$/.exec(data || '');
    if (!m) return res.json({ ok: false, msg: '图片数据无效' });
    const id = crypto.randomBytes(10).toString('hex');
    await db.prepare(`INSERT INTO blobs (id,mime,data,created_at) VALUES (?,?,?,?)`).run(id, m[1], Buffer.from(m[2], 'base64'), Date.now());
    url = '/blob/' + id;
  } else {
    const saved = uploads.saveDataUrl(data, 'misc');
    if (!saved) return res.json({ ok: false, msg: '图片数据无效' });
    url = saved.url;
  }
  await set('cover_bg', url);
  res.json({ ok: true, url });
}));
app.get('/theme.css', async (req, res) => {
  try {
    const s = await all();
    let css = `:root{--theme-color:${s.theme_color || '#4f7cff'};}\n`;
    if (s.font_type === 'custom' && s.font_url) {
      css += `@font-face{font-family:'PindouCustom';src:url('${s.font_url}') format('truetype');font-display:swap;}\n`;
      css += `body{font-family:'PindouCustom',sans-serif !important;}\n`;
    }
    res.setHeader('Content-Type', 'text/css; charset=utf-8');
    res.send(css);
  } catch (e) { console.error('[theme]', e); res.status(500).send(''); }
});

// ============ auth ============
const CAPTCHA_STORE = new Map();
app.post('/api/auth/captcha', (req, res) => {
  const c = require('svg-captcha');
  const cap = c.create({ size: 4, noise: 2, color: true, background: '#f2f4f8' });
  const capId = crypto.randomBytes(10).toString('hex');
  CAPTCHA_STORE.set(capId, cap.text.toLowerCase());
  setTimeout(() => CAPTCHA_STORE.delete(capId), 10 * 60 * 1000);
  res.json({ ok: true, svg: cap.data, capId });
});

app.use('/api', (req, res, next) => {
  if (req.body && req.body.capId) {
    const expected = CAPTCHA_STORE.get(req.body.capId);
    if (expected) {
      req.session.captcha = expected;
      CAPTCHA_STORE.delete(req.body.capId);
    }
  }
  next();
});

// ============ api routes ============
app.use('/api', publicRouter);
app.use('/api/admin', adminRouter);

// ============ pages ============
const VIEWS = path.join(__dirname, 'views');
const PAGE_ROUTES = {
  '/login': 'login.html',
  '/register': 'login.html',
  '/profile': 'profile.html',
  '/pattern': 'pattern.html',
  '/submit': 'submit.html',
  '/coin': 'coin.html',
  '/files': 'files.html'
};
app.use(async (req, res, next) => {
  try {
    if (req.method !== 'GET') return next();
    if (req.path.startsWith('/api') || req.path.startsWith('/uploads') || req.path.startsWith('/assets') || req.path.startsWith('/blob')) return next();
    if (req.path.startsWith('/admin')) {
      return res.sendFile(path.join(VIEWS, 'admin.html'));
    }
    const s = await all();
    if (s.maintenance === '1') {
      const u = req.user;
      if (!(u && u.role === 'admin')) {
        return res.sendFile(path.join(VIEWS, 'maintenance.html'));
      }
    }
    const base = req.path.replace(/\/+$/, '') || '/';
    const view = PAGE_ROUTES[base];
    res.sendFile(path.join(VIEWS, view || 'index.html'));
  } catch (e) { next(e); }
});

// ============ error handling ============
app.use((err, req, res, next) => {
  console.error('[error]', err);
  if (req.path.startsWith('/api')) return res.status(500).json({ ok: false, msg: '服务器繁忙，请稍后再试' });
  res.status(500).send('Server Error');
});

process.on('uncaughtException', e => console.error('[uncaught]', e));
process.on('unhandledRejection', e => console.error('[unhandled]', e));

app.listen(PORT, '0.0.0.0', () => {
  console.log(`拼豆图纸助手 running at http://0.0.0.0:${PORT}`);
});

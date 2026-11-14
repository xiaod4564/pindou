const dbm = require('./db');
const db = dbm.db;

const DEFAULTS = {
  site_name: '拼豆图纸助手',
  site_desc: '发现、分享、创作你的拼豆图纸',
  coins_enabled: '1',
  coin_name: '金币',
  coin_icon: '/assets/icons/coin.svg',
  star_img: '',
  theme_color: '#4f7cff',
  cover_bg: '',
  font_type: 'default',
  font_name: '',
  font_url: '',
  maintenance: '0',
  wechat_qr: '',
  alipay_qr: '',
  admin_username: 'admin',
  admin_password: 'admin123'
};

async function get(key) {
  const row = await db.prepare('SELECT value FROM settings WHERE key=?').get(key);
  return row ? row.value : DEFAULTS[key] !== undefined ? DEFAULTS[key] : null;
}
async function set(key, value) {
  await db.prepare('INSERT INTO settings (key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value')
    .run(key, value === undefined || value === null ? '' : String(value));
}
async function all() {
  const out = { ...DEFAULTS };
  const rows = await db.prepare('SELECT key,value FROM settings').all();
  for (const row of rows) out[row.key] = row.value;
  return out;
}

module.exports = { get, set, all, DEFAULTS };

const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const UPLOADS = path.join(__dirname, 'public', 'uploads');
const ASSETS = path.join(__dirname, 'public', 'assets');
for (const d of ['covers', 'patterns', 'misc']) {
  const dir = path.join(UPLOADS, d);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}
for (const d of ['star', 'coinicon', 'fonts']) {
  const dir = path.join(ASSETS, d);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

const IMAGE_TYPES = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/gif': '.gif', 'image/webp': '.webp', 'image/svg+xml': '.svg' };

function saveBuffer(buf, subdir, ext) {
  const name = crypto.randomBytes(8).toString('hex') + (ext || '.png');
  const dir = path.join(UPLOADS, subdir);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, name), buf);
  return { filename: name, url: '/uploads/' + subdir + '/' + name };
}

function saveDataUrl(dataUrl, subdir) {
  const m = /^data:([^;]+);base64,(.+)$/.exec(dataUrl || '');
  if (!m) return null;
  const ext = IMAGE_TYPES[m[1]] || '.png';
  const buf = Buffer.from(m[2], 'base64');
  return saveBuffer(buf, subdir, ext);
}

module.exports = { saveBuffer, saveDataUrl, IMAGE_TYPES, UPLOADS, ASSETS };

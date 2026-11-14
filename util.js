const dbm = require('./db');
const db = dbm.db;
const { get } = require('./settings');

const UID_LEN = 12;

function uidText(uid) {
  return String(uid).padStart(UID_LEN, '0');
}

function fmtUid(u) {
  if (!u) return '';
  return uidText(u.uid);
}

function checkBan(user) {
  if (!user) return { ok: true };
  if (user.status === 'banned') return { ok: false, msg: '你的账号已被封禁' + (user.ban_reason ? '，原因：' + user.ban_reason : '') };
  if (user.status === 'disabled') return { ok: false, msg: '你的账号已被禁用' };
  if (user.ban_until && user.ban_until > Date.now()) return { ok: false, msg: '你的账号已被封禁' + (user.ban_reason ? '，原因：' + user.ban_reason : '') };
  return { ok: true };
}

async function ipBanned(ip) {
  if (!ip) return null;
  const bans = await db.prepare(`SELECT * FROM bans WHERE type='ip' AND active=1 AND target=?`).get(ip);
  if (bans && (bans.expires_at === null || bans.expires_at === undefined || bans.expires_at > Date.now())) return bans;
  return null;
}

async function uidBanned(uid) {
  const bans = await db.prepare(`SELECT * FROM bans WHERE type='uid' AND active=1 AND target=?`).get(String(uid));
  if (bans && (bans.expires_at === null || bans.expires_at === undefined || bans.expires_at > Date.now())) return bans;
  return null;
}

async function recordFailure(ip, account) {
  const now = Date.now();
  await db.prepare('INSERT INTO login_failures (ip,account,fail_time) VALUES (?,?,?)').run(ip, account || null, now);
  await db.prepare(`DELETE FROM login_failures WHERE fail_time<?`).run(now - 10 * 60 * 1000);
  const ipCount = Number((await db.prepare(`SELECT COUNT(*) c FROM login_failures WHERE ip=? AND fail_time>?`).get(ip, now - 10 * 60 * 1000)).c);
  if (ipCount >= 8) {
    if (!(await ipBanned(ip))) {
      await db.prepare(`INSERT INTO bans (type,target,reason,expires_at,active,created_at,created_by) VALUES ('ip',?,?,?,1,?,?)`)
        .run(ip, '同一IP登录失败8次，自动封禁2小时', now + 2 * 60 * 60 * 1000, now, 'auto');
    }
    await db.prepare('DELETE FROM login_failures WHERE ip=?').run(ip);
    return { type: 'ip', msg: '您的IP已被封禁，原因：同一IP登录失败8次，自动封禁2小时' };
  }
  if (account) {
    const accCount = Number((await db.prepare(`SELECT COUNT(*) c FROM login_failures WHERE account=? AND fail_time>?`).get(account, now - 10 * 60 * 1000)).c);
    if (accCount >= 10) {
      const u = await db.prepare(`SELECT uid,username FROM users WHERE username=? OR email=? OR phone=?`).get(account, account, account);
      if (u && !(await uidBanned(u.uid))) {
        await db.prepare(`INSERT INTO bans (type,target,reason,expires_at,active,created_at,created_by) VALUES ('uid',?,?,?,1,?,?)`)
          .run(String(u.uid), '同一账号登录失败10次，自动封禁2小时', now + 2 * 60 * 60 * 1000, now, 'auto');
        await db.prepare(`UPDATE users SET status='banned', ban_reason=? WHERE uid=? AND status!='admin'`).run('同一账号登录失败10次，自动封禁2小时', u.uid);
      }
      await db.prepare('DELETE FROM login_failures WHERE account=?').run(account);
      return { type: 'uid', msg: '你的账号已被封禁' };
    }
  }
  return null;
}

function maintenanceBlock(req) {
  if (get('maintenance') !== '1') return false;
  const u = req.user;
  return !(u && u.role === 'admin');
}

async function addCoins(uid, change, reason) {
  await db.prepare('UPDATE users SET coins=coins+? WHERE uid=?').run(change, uid);
  await db.prepare('INSERT INTO coin_logs (user_id,change,reason,created_at) VALUES (?,?,?,?)').run(uid, change, reason || '', Date.now());
}

module.exports = { uidText, fmtUid, checkBan, ipBanned, uidBanned, recordFailure, maintenanceBlock, addCoins, UID_LEN };

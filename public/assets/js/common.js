/* common frontend helpers */
const API = (path, opts) => fetch('/api' + path, opts).then(r => r.json().catch(() => ({ ok: false, msg: '网络异常' })));
function toast(msg, isErr) {
  document.querySelectorAll('.toast').forEach(t => t.remove());
  const d = document.createElement('div');
  d.className = 'toast' + (isErr ? ' err' : '');
  d.textContent = msg;
  document.body.appendChild(d);
  setTimeout(() => d.remove(), 2600);
}
function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function fmtTime(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}
function starsHtml(avg, starImg) {
  const full = Math.round(avg || 0);
  let h = '';
  for (let i = 1; i <= 5; i++) {
    h += `<img ${i <= full ? `style="opacity:1"` : `style="opacity:.25"`} src="${esc(starImg || '/assets/icons/star.png')}" alt="">`;
  }
  return `<span class="p-stars">${h}</span>`;
}
function ratingText(r) {
  if (!r || !r.n) return '暂无评分';
  return `${r.avg.toFixed(1)} / 5 · ${r.n} 人评价`;
}
async function uploadImage(file, subdir) {
  const data = await new Promise((ok, err) => {
    const fr = new FileReader();
    fr.onload = () => ok(fr.result);
    fr.onerror = err;
    fr.readAsDataURL(file);
  });
  const r = await API('/upload/image', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ data, subdir }) });
  if (!r.ok) throw new Error(r.msg || '上传失败');
  return r;
}
let ME = null;
let SITE = null;
async function loadCommon() {
  try {
    const [me, site] = await Promise.all([API('/auth/me'), API('/site')]);
    if (me.ok) {
      ME = me.user;
      window.COIN_NAME = me.coin_name || '金币';
      window.COIN_ENABLED = me.coin_enabled;
      const ci = document.getElementById('coin-icon'); if (ci && me.coin_icon) ci.src = me.coin_icon;
      const st = document.getElementById('site-name'); if (st) st.textContent = me.site_name || '拼豆图纸助手';
      if (ME) {
        const uc = document.getElementById('user-chip'); if (uc) uc.classList.remove('hidden');
        const gc = document.getElementById('guest-chip'); if (gc) gc.classList.add('hidden');
        const ul = document.getElementById('username-link'); if (ul) ul.textContent = ME.username;
        if (window.COIN_ENABLED) {
          const cc = document.getElementById('coin-chip'); if (cc) cc.classList.remove('hidden');
          const mc = document.getElementById('my-coins'); if (mc) mc.textContent = ME.coins;
        }
        if (ME.role === 'admin') { const al = document.getElementById('admin-link'); if (al) al.classList.remove('hidden'); }
      } else {
        const cc = document.getElementById('coin-chip'); if (cc) cc.classList.add('hidden');
      }
    }
    if (site.ok) {
      SITE = site;
      document.title = site.site_name || '拼豆图纸助手';
      const dn = document.getElementById('site-desc'); if (dn && site.site_desc) dn.textContent = site.site_desc;
      const fn = document.getElementById('footer-name'); if (fn) fn.textContent = site.site_name;
      const hd = document.getElementById('hero'); if (hd && site.cover_bg) hd.style.backgroundImage = `url('${site.cover_bg}')`;
      window.STAR_IMG = site.star_img || '';
      window.refreshNotices && refreshNotices();
    }
  } catch (e) { console.error(e); }
}
async function refreshNotices() {
  try {
    const r = await API('/notices');
    const bar = document.getElementById('notice-bar');
    if (!bar) return;
    if (r.ok && r.list.length) {
      const n = r.list[0];
      bar.innerHTML = `📢 <b>${esc(n.title)}</b>：${esc(n.content)}`;
      bar.classList.remove('hidden');
    } else bar.classList.add('hidden');
  } catch (e) {}
}
document.addEventListener('DOMContentLoaded', () => {
  loadCommon();
  const lb = document.getElementById('logout-btn');
  if (lb) lb.addEventListener('click', async (e) => { e.preventDefault(); await API('/auth/logout', { method: 'POST' }); location.href = '/'; });
});

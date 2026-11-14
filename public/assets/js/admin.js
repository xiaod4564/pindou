/* admin panel */
const A = (path, opts) => fetch('/api/admin' + path, opts).then(r => r.json().catch(() => ({ ok: false, msg: '网络异常' })));
const P = (path, opts) => fetch('/api' + path, opts).then(r => r.json().catch(() => ({ ok: false, msg: '网络异常' })));
function toast(m, err) {
  document.querySelectorAll('.toast').forEach(t => t.remove());
  const d = document.createElement('div');
  d.className = 'toast' + (err ? ' err' : '');
  d.textContent = m;
  document.body.appendChild(d);
  setTimeout(() => d.remove(), 2600);
}
function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
function fmtTime(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}
function modal(html) {
  document.querySelectorAll('.modal-mask').forEach(m => m.remove());
  const mask = document.createElement('div');
  mask.className = 'modal-mask';
  mask.innerHTML = `<div class="modal">${html}</div>`;
  mask.addEventListener('click', e => { if (e.target === mask) mask.remove(); });
  document.body.appendChild(mask);
  return mask;
}
function confirmBox(msg, onYes) {
  const m = modal(`<h3>确认</h3><p style="margin-bottom:18px">${esc(msg)}</p><div class="modal-actions"><button class="btn" id="cb-no">取消</button><button class="btn danger" id="cb-yes">确定</button></div>`);
  m.querySelector('#cb-no').onclick = () => m.remove();
  m.querySelector('#cb-yes').onclick = async () => { m.remove(); await onYes(); };
}
async function fileToDataUrl(file) {
  return new Promise((ok, err) => { const fr = new FileReader(); fr.onload = () => ok(fr.result); fr.onerror = err; fr.readAsDataURL(file); });
}

let CAPTCHA_SVG = '';
async function refreshCaptcha() {
  const r = await P('/auth/captcha', { method: 'POST' });
  CAPTCHA_SVG = r.svg || '';
  const box = document.getElementById('admin-captcha-img');
  if (box) { box.innerHTML = CAPTCHA_SVG; box.onclick = refreshCaptcha; }
}

const ADMIN = { page: 'dashboard', patterns: { page: 1, q: '', status: '' }, users: { page: 1, q: '', status: '' }, comments: { page: 1, q: '' }, bans: { page: 1, q: '', type: '', status: '' }, orders: { page: 1, status: '' } };

const $main = () => document.getElementById('admin-main');

async function adminLogin() {
  const account = document.getElementById('admin-account').value.trim();
  const password = document.getElementById('admin-password').value;
  const captcha = document.getElementById('admin-captcha').value.trim();
  const r = await P('/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ account, password, captcha }) });
  if (!r.ok) { document.getElementById('admin-login-msg').textContent = r.msg; refreshCaptcha(); return; }
  if (r.role !== 'admin') { document.getElementById('admin-login-msg').textContent = '该账号不是管理员'; await P('/auth/logout', { method: 'POST' }); return; }
  document.getElementById('login-mask').classList.add('hidden');
  document.getElementById('admin-app').classList.remove('hidden');
  showPage(ADMIN.page);
}

function pagerHtml(total, size, page, pages) {
  const pagesN = Math.max(1, Math.ceil(total / size));
  let h = '';
  if (pagesN > 1) {
    for (let i = Math.max(1, page - 2); i <= Math.min(pagesN, page + 2); i++) h += `<button data-p="${i}" class="${i === page ? 'cur' : ''}">${i}</button>`;
  }
  return h || '<button class="cur">1</button>';
}

function showPage(page) {
  ADMIN.page = page;
  document.querySelectorAll('#admin-nav a').forEach(a => a.classList.toggle('active', a.dataset.page === page));
  const fn = { dashboard: pageDashboard, patterns: pagePatterns, categories: pageCategories, users: pageUsers, comments: pageComments, bans: pageBans, notices: pageNotices, orders: pageOrders, coupons: pageCoupons, settings: pageSettings, maintenance: pageMaintenance, files: pageFiles }[page];
  if (fn) fn().catch(e => { console.error(e); $main().innerHTML = '<p style="color:#d33;padding:30px">页面加载出错，请重试</p>'; });
}

// ---------- dashboard ----------
async function pageDashboard() {
  const r = await A('/stats');
  if (!r.ok) { toast(r.msg, 1); return; }
  const coinName = esc(r.coinName);
  $main().innerHTML = `
    <div class="page-title">📊 数据概览</div>
    <div class="stat-grid">
      <div class="stat-card hl"><b>${r.patterns}</b><span>已发布图纸</span></div>
      <div class="stat-card"><b>${r.pending}</b><span>待审核投稿</span></div>
      <div class="stat-card"><b>${r.users}</b><span>注册用户</span></div>
      <div class="stat-card"><b>+${r.newUsers}</b><span>今日新增用户</span></div>
      <div class="stat-card"><b>${r.comments}</b><span>评论总数</span></div>
      <div class="stat-card"><b>${r.orders}</b><span>待审核订单</span></div>
      <div class="stat-card"><b>${r.bans}</b><span>生效封禁</span></div>
      <div class="stat-card"><b>${r.totalCoins}</b><span>用户${coinName}总量</span></div>
    </div>
    <div class="set-card">
      <h4>快捷入口</h4>
      <div style="display:flex;gap:10px;flex-wrap:wrap">
        <button class="btn primary" onclick="showPage('patterns')">图纸管理</button>
        <button class="btn" onclick="showPage('users')">用户管理</button>
        <button class="btn" onclick="showPage('orders')">金币订单</button>
        <button class="btn" onclick="showPage('bans')">封禁管理</button>
        <button class="btn" onclick="showPage('settings')">主题设置</button>
      </div>
    </div>`;
}

// ---------- patterns ----------
async function pagePatterns() {
  const s = ADMIN.patterns;
  const qs = new URLSearchParams({ page: s.page, size: 20 });
  if (s.q) qs.set('q', s.q);
  if (s.status) qs.set('status', s.status);
  const r = await A('/patterns?' + qs);
  if (!r.ok) { toast(r.msg, 1); return; }
  const statusBadge = { published: '<span class="badge green">已发布</span>', pending: '<span class="badge orange">待审核</span>', rejected: '<span class="badge red">未通过</span>' };
  $main().innerHTML = `
    <div class="page-title">🖼 图纸管理</div>
    <div class="toolbar">
      <input id="p-q" placeholder="搜索名称/描述" value="${esc(s.q)}" style="width:220px">
      <select id="p-status"><option value="">全部状态</option><option value="published" ${s.status === 'published' ? 'selected' : ''}>已发布</option><option value="pending" ${s.status === 'pending' ? 'selected' : ''}>待审核</option><option value="rejected" ${s.status === 'rejected' ? 'selected' : ''}>未通过</option></select>
      <button class="btn" id="p-search">搜索</button>
      <span class="spacer"></span>
      <span style="font-size:13px;color:#8a90a2">共 ${r.total} 张</span>
    </div>
    <table class="data"><thead><tr><th>封面</th><th>名称</th><th>作者</th><th>分类</th><th>难度</th><th>价格</th><th>状态</th><th>浏览</th><th>时间</th><th>操作</th></tr></thead><tbody>
    ${r.list.length ? r.list.map(p => `<tr>
      <td><img class="cover-thumb" src="${esc(p.cover || '/assets/icons/placeholder.svg')}" onerror="this.src='/assets/icons/placeholder.svg'"></td>
      <td style="max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${esc(p.title)}">${esc(p.title)}</td>
      <td><span class="uid-tag">${esc(p.author_uid)}</span> ${esc(p.author_name)}</td>
      <td>${esc(p.category || '—')}</td>
      <td>{{DIFF}}</td>
      <td>${p.price > 0 ? esc(window.COIN_NAME || '金币') + ' ' + p.price : '免费'}</td>
      <td>${statusBadge[p.status] || p.status}</td>
      <td>${p.views}</td>
      <td>${fmtTime(p.created_at)}</td>
      <td>
        ${p.status === 'pending' ? `<button class="btn mini primary" data-act="approve" data-id="${p.id}">通过</button> <button class="btn mini danger" data-act="reject" data-id="${p.id}">拒绝</button>` : ''}
        ${p.status !== 'published' ? '' : `<button class="btn mini" data-act="unpub" data-id="${p.id}">下架</button>`}
        <button class="btn mini" data-act="edit" data-id="${p.id}">编辑</button>
        <button class="btn mini danger" data-act="del" data-id="${p.id}">删除</button>
      </td></tr>`).join('') : '<tr><td colspan="10" class="empty-row">暂无数据</td></tr>'}
    </tbody></table>
    <div class="pager" id="p-pager">${pagerHtml(r.total, 20, s.page)}</div>`.replace(/\{\{DIFF\}\}/g, '');
  const diffName = { easy: '简单', medium: '中等', hard: '困难' };
  document.querySelectorAll('table.data tbody tr').forEach(tr => {
    const td = tr.children[4];
    if (td) { const i = Array.prototype.indexOf.call(tr.parentNode.children, tr); }
  });
  $main().querySelectorAll('[data-act]').forEach(btn => btn.addEventListener('click', async () => {
    const id = btn.dataset.id, act = btn.dataset.act;
    if (act === 'approve') { const r2 = await A(`/patterns/${id}/status`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: 'published' }) }); r2.ok ? toast('已通过') : toast(r2.msg, 1); showPage('patterns'); }
    else if (act === 'reject') { const r2 = await A(`/patterns/${id}/status`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: 'rejected', note: '管理员拒绝' }) }); r2.ok ? toast('已拒绝') : toast(r2.msg, 1); showPage('patterns'); }
    else if (act === 'unpub') { const r2 = await A(`/patterns/${id}/status`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: 'pending', note: '已下架' }) }); r2.ok ? toast('已下架') : toast(r2.msg, 1); showPage('patterns'); }
    else if (act === 'del') confirmBox('确定删除该图纸？评论与评分将一并删除', async () => { const r2 = await A(`/patterns/${id}`, { method: 'DELETE' }); r2.ok ? toast('已删除') : toast(r2.msg, 1); showPage('patterns'); });
    else if (act === 'edit') editPattern(id);
  }));
  document.getElementById('p-search').onclick = () => { s.q = document.getElementById('p-q').value.trim(); s.status = document.getElementById('p-status').value; s.page = 1; showPage('patterns'); };
  document.getElementById('p-pager').querySelectorAll('button').forEach(b => b.onclick = () => { s.page = Number(b.dataset.p); showPage('patterns'); });
}

async function editPattern(id) {
  const [pr, cats] = await Promise.all([A('/patterns?q=' + id), A('/categories')]);
  const p = (pr.list || []).find(x => String(x.id) === String(id));
  if (!p) { toast('图纸不存在', 1); return; }
  const m = modal(`<h3>编辑图纸</h3>
    <div class="field"><label>名称</label><input id="ep-title" value="${esc(p.title)}"></div>
    <div class="field"><label>描述</label><textarea id="ep-desc">${esc(p.description)}</textarea></div>
    <div class="row2">
      <div class="field"><label>分类</label><select id="ep-cat">${cats.list.map(c => `<option value="${c.id}" ${c.id === p.category_id ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select></div>
      <div class="field"><label>难度</label><select id="ep-diff"><option value="easy" ${p.difficulty === 'easy' ? 'selected' : ''}>简单</option><option value="medium" ${p.difficulty === 'medium' ? 'selected' : ''}>中等</option><option value="hard" ${p.difficulty === 'hard' ? 'selected' : ''}>困难</option></select></div>
    </div>
    <div class="field"><label>价格（0 = 免费，${esc(window.COIN_NAME || '金币')}）</label><input id="ep-price" type="number" min="0" value="${p.price}"></div>
    <div class="field"><label>更换封面图（可选）</label><div class="drop-zone" id="ep-cover-drop">点击选择图片</div><img class="icon-preview" id="ep-cover-prev" src="${esc(p.cover)}" style="display:block;width:80px;height:60px;object-fit:cover"></div>
    <div class="modal-actions"><button class="btn" id="ep-cancel">取消</button><button class="btn primary" id="ep-save">保存</button></div>`);
  m.querySelector('#ep-cancel').onclick = () => m.remove();
  let newCover = null;
  m.querySelector('#ep-cover-drop').onclick = async () => {
    const inp = document.createElement('input'); inp.type = 'file'; inp.accept = 'image/*';
    inp.onchange = async () => {
      const f = inp.files[0]; if (!f) return;
      const data = await fileToDataUrl(f);
      const r = await P('/upload/image', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ data, subdir: 'covers' }) });
      if (r.ok) { newCover = r.url; m.querySelector('#ep-cover-prev').src = r.url; toast('已选择 ' + f.name); }
      else toast(r.msg, 1);
    };
    inp.click();
  };
  m.querySelector('#ep-save').onclick = async () => {
    const body = { title: m.querySelector('#ep-title').value.trim(), description: m.querySelector('#ep-desc').value.trim(), category_id: Number(m.querySelector('#ep-cat').value), difficulty: m.querySelector('#ep-diff').value, price: Number(m.querySelector('#ep-price').value) || 0 };
    if (newCover) body.cover = newCover;
    const r = await A(`/patterns/${id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    if (r.ok) { toast('已保存'); m.remove(); showPage('patterns'); } else toast(r.msg, 1);
  };
}

// ---------- categories ----------
async function pageCategories() {
  const r = await A('/categories');
  if (!r.ok) { toast(r.msg, 1); return; }
  $main().innerHTML = `
    <div class="page-title">📁 分类管理</div>
    <div class="toolbar"><button class="btn primary" id="cat-add">➕ 新建分类</button><span style="font-size:13px;color:#8a90a2">分类图标会显示在前台分类卡片上</span></div>
    <table class="data"><thead><tr><th>图标</th><th>名称</th><th>排序</th><th>操作</th></tr></thead><tbody>
    ${r.list.length ? r.list.map(c => `<tr>
      <td>${c.icon ? `<img src="${esc(c.icon)}" style="width:36px;height:36px;object-fit:contain;border-radius:8px">` : '<span style="color:#ccc">无</span>'}</td>
      <td>${esc(c.name)}</td><td>${c.sort}</td>
      <td><button class="btn mini" data-act="edit" data-id="${c.id}">编辑</button> <button class="btn mini danger" data-act="del" data-id="${c.id}">删除</button></td></tr>`).join('') : '<tr><td colspan="4" class="empty-row">暂无分类</td></tr>'}
    </tbody></table>`;
  document.getElementById('cat-add').onclick = () => categoryModal(null);
  $main().querySelectorAll('[data-act]').forEach(btn => btn.addEventListener('click', () => {
    const c = r.list.find(x => String(x.id) === btn.dataset.id);
    if (btn.dataset.act === 'del') confirmBox(`确定删除分类「${c.name}」？该分类下的图纸将变为未分类`, async () => { const r2 = await A(`/categories/${c.id}`, { method: 'DELETE' }); r2.ok ? toast('已删除') : toast(r2.msg, 1); showPage('categories'); });
    else categoryModal(c);
  }));
}

function categoryModal(cat) {
  const m = modal(`<h3>${cat ? '编辑分类' : '新建分类'}</h3>
    <div class="field"><label>名称 *</label><input id="cm-name" value="${cat ? esc(cat.name) : ''}" placeholder="例如：动物 / 卡通 / 文字"></div>
    <div class="field"><label>排序（小的在前）</label><input id="cm-sort" type="number" value="${cat ? cat.sort : 0}"></div>
    <div class="field"><label>图标（可输入 URL 或上传）</label><input id="cm-icon" value="${cat && cat.icon ? esc(cat.icon) : ''}" placeholder="https://… 或上传"></div>
    <div class="drop-zone" id="cm-drop">点击上传图标（PNG/SVG/JPG）</div>
    ${cat && cat.icon ? `<img class="icon-preview" src="${esc(cat.icon)}" id="cm-prev">` : '<img class="icon-preview hidden" id="cm-prev">'}
    <div class="modal-actions"><button class="btn" id="cm-cancel">取消</button><button class="btn primary" id="cm-save">保存</button></div>`);
  m.querySelector('#cm-cancel').onclick = () => m.remove();
  m.querySelector('#cm-icon').addEventListener('input', () => { const p = m.querySelector('#cm-prev'); if (m.querySelector('#cm-icon').value) { p.src = m.querySelector('#cm-icon').value; p.classList.remove('hidden'); } });
  m.querySelector('#cm-drop').onclick = async () => {
    const inp = document.createElement('input'); inp.type = 'file'; inp.accept = 'image/*';
    inp.onchange = async () => {
      const f = inp.files[0]; if (!f) return;
      const data = await fileToDataUrl(f);
      const r = await P('/admin/upload/category_icon', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ data }) });
      if (r.ok) { m.querySelector('#cm-icon').value = r.url; const p = m.querySelector('#cm-prev'); p.src = r.url; p.classList.remove('hidden'); toast('图标已上传'); }
      else toast(r.msg, 1);
    };
    inp.click();
  };
  m.querySelector('#cm-save').onclick = async () => {
    const body = { name: m.querySelector('#cm-name').value.trim(), icon: m.querySelector('#cm-icon').value.trim() || null, sort: Number(m.querySelector('#cm-sort').value) || 0 };
    if (!body.name) return toast('请填写名称', 1);
    const r = cat ? await A(`/categories/${cat.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      : await A('/categories', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    if (r.ok) { toast('已保存'); m.remove(); showPage('categories'); } else toast(r.msg, 1);
  };
}

// ---------- users ----------
async function pageUsers() {
  const s = ADMIN.users;
  const qs = new URLSearchParams({ page: s.page, size: 20 });
  if (s.q) qs.set('q', s.q);
  if (s.status) qs.set('status', s.status);
  const r = await A('/users?' + qs);
  if (!r.ok) { toast(r.msg, 1); return; }
  const st = { active: '<span class="badge green">正常</span>', banned: '<span class="badge red">已封禁</span>', disabled: '<span class="badge gray">已禁用</span>' };
  $main().innerHTML = `
    <div class="page-title">👥 用户管理</div>
    <div class="toolbar">
      <input id="u-q" placeholder="搜索用户名/邮箱/手机号/UID" value="${esc(s.q)}" style="width:230px">
      <select id="u-status"><option value="">全部状态</option><option value="active" ${s.status === 'active' ? 'selected' : ''}>正常</option><option value="banned" ${s.status === 'banned' ? 'selected' : ''}>已封禁</option><option value="disabled" ${s.status === 'disabled' ? 'selected' : ''}>已禁用</option></select>
      <button class="btn" id="u-search">搜索</button>
      <button class="btn primary" id="u-add">➕ 新增账号</button>
      <span class="spacer"></span>
      <a class="btn" href="/api/admin/users/export.csv" download="users.csv">⬇ 导出 CSV</a>
      <span style="font-size:13px;color:#8a90a2">共 ${r.total} 人</span>
    </div>
    <table class="data"><thead><tr><th>UID</th><th>用户名</th><th>邮箱</th><th>手机号</th><th>角色</th><th>${esc(window.COIN_NAME || '金币')}</th><th>状态</th><th>注册时间</th><th>操作</th></tr></thead><tbody>
    ${r.list.length ? r.list.map(u => `<tr>
      <td><span class="uid-tag">${esc(u.uid)}</span></td>
      <td>${esc(u.username)}</td><td>${esc(u.email || '—')}</td><td>${esc(u.phone || '—')}</td>
      <td>${u.role === 'admin' ? '<span class="badge orange">管理员</span>' : '<span class="badge gray">用户</span>'}</td>
      <td>${u.coins}</td><td>${st[u.status] || u.status}</td>
      <td>${fmtTime(u.created_at)}</td>
      <td style="white-space:nowrap">
        <button class="btn mini" data-act="pw" data-uid="${u.uid}">改密码</button>
        <button class="btn mini" data-act="coins" data-uid="${u.uid}" data-name="${esc(u.username)}">加${esc(window.COIN_NAME || '金币')}</button>
        ${u.uid !== '000000000001' ? `<button class="btn mini ${u.status === 'active' ? 'danger' : ''}" data-act="status" data-uid="${u.uid}" data-cur="${u.status}">${u.status === 'active' ? '封禁' : '解封'}</button>` : ''}
      </td></tr>`).join('') : '<tr><td colspan="9" class="empty-row">暂无用户</td></tr>'}
    </tbody></table>
    <div class="pager" id="u-pager">${pagerHtml(r.total, 20, s.page)}</div>`;
  document.getElementById('u-search').onclick = () => { s.q = document.getElementById('u-q').value.trim(); s.status = document.getElementById('u-status').value; s.page = 1; showPage('users'); };
  document.getElementById('u-add').onclick = addUserModal;
  document.getElementById('u-pager').querySelectorAll('button').forEach(b => b.onclick = () => { s.page = Number(b.dataset.p); showPage('users'); });
  $main().querySelectorAll('[data-act]').forEach(btn => btn.addEventListener('click', () => {
    const uid = btn.dataset.uid;
    const act = btn.dataset.act;
    if (act === 'pw') passwordModal(uid);
    else if (act === 'coins') addCoinsModal(uid, btn.dataset.name);
    else if (act === 'status') {
      const cur = btn.dataset.cur;
      if (cur === 'active') banUserModal(uid);
      else confirmBox('确定解封该用户？', async () => { const r2 = await A(`/users/${uid}/status`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: 'active' }) }); r2.ok ? toast('已解封') : toast(r2.msg, 1); showPage('users'); });
    }
  }));
}

function addUserModal() {
  const m = modal(`<h3>➕ 新增账号</h3>
    <div class="field"><label>用户名 *</label><input id="au-username"></div>
    <div class="row2">
      <div class="field"><label>邮箱（与手机号至少填一项）</label><input id="au-email"></div>
      <div class="field"><label>手机号（与邮箱至少填一项）</label><input id="au-phone"></div>
    </div>
    <div class="row2">
      <div class="field"><label>密码 *</label><input id="au-password" type="password"></div>
      <div class="field"><label>角色</label><select id="au-role"><option value="user">普通用户</option><option value="admin">管理员</option></select></div>
    </div>
    <div class="field"><label>密保问题 *</label><input id="au-sq" placeholder="例如：你的宠物名字？"></div>
    <div class="field"><label>密保答案 *</label><input id="au-sa"></div>
    <div class="field"><label>初始${esc(window.COIN_NAME || '金币')}</label><input id="au-coins" type="number" value="0" min="0"></div>
    <div class="modal-actions"><button class="btn" id="au-cancel">取消</button><button class="btn primary" id="au-save">创建</button></div>`);
  m.querySelector('#au-cancel').onclick = () => m.remove();
  m.querySelector('#au-save').onclick = async () => {
    const body = {
      username: m.querySelector('#au-username').value.trim(),
      email: m.querySelector('#au-email').value.trim(),
      phone: m.querySelector('#au-phone').value.trim(),
      password: m.querySelector('#au-password').value,
      role: m.querySelector('#au-role').value,
      security_question: m.querySelector('#au-sq').value.trim(),
      security_answer: m.querySelector('#au-sa').value.trim(),
      coins: Number(m.querySelector('#au-coins').value) || 0
    };
    const r = await A('/users', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    if (r.ok) { toast('账号已创建'); m.remove(); showPage('users'); } else toast(r.msg, 1);
  };
}

function passwordModal(uid) {
  const m = modal(`<h3>修改用户密码</h3><div class="field"><label>新密码（至少 6 位）</label><input id="pm-pw" type="password"></div>
    <div class="modal-actions"><button class="btn" id="pm-cancel">取消</button><button class="btn primary" id="pm-save">保存</button></div>`);
  m.querySelector('#pm-cancel').onclick = () => m.remove();
  m.querySelector('#pm-save').onclick = async () => {
    const r = await A(`/users/${uid}/password`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: m.querySelector('#pm-pw').value }) });
    if (r.ok) { toast('密码已修改'); m.remove(); } else toast(r.msg, 1);
  };
}

function addCoinsModal(uid, name) {
  const m = modal(`<h3>给 ${esc(name)} 加${esc(window.COIN_NAME || '金币')}</h3>
    <div class="field"><label>变动数量（负数为扣除）</label><input id="acn-n" type="number" placeholder="例如 100 或 -50"></div>
    <div class="modal-actions"><button class="btn" id="acn-cancel">取消</button><button class="btn primary" id="acn-save">确定</button></div>`);
  m.querySelector('#acn-cancel').onclick = () => m.remove();
  m.querySelector('#acn-save').onclick = async () => {
    const r = await A(`/users/${uid}/coins`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ change: Number(m.querySelector('#acn-n').value) }) });
    if (r.ok) { toast('操作成功'); m.remove(); showPage('users'); } else toast(r.msg, 1);
  };
}

function banUserModal(uid) {
  const m = modal(`<h3>封禁账号</h3>
    <div class="field"><label>封禁原因</label><input id="bu-reason" placeholder="例如：违规发布"></div>
    <div class="row2">
      <div class="field"><label>时效</label><select id="bu-dur"><option value="0">永久</option><option value="1">1 小时</option><option value="2">2 小时</option><option value="24">1 天</option><option value="72">3 天</option><option value="168">7 天</option><option value="custom">自定义</option></select></div>
      <div class="field hidden" id="bu-custom"><label>自定义时长</label><input id="bu-n" type="number" placeholder="数字"></div>
    </div>
    <div class="field"><label>封禁方式</label><select id="bu-mode"><option value="ban">封禁（可解封）</option><option value="disable">禁用</option></select></div>
    <div class="modal-actions"><button class="btn" id="bu-cancel">取消</button><button class="btn danger" id="bu-save">确定封禁</button></div>`);
  m.querySelector('#bu-cancel').onclick = () => m.remove();
  m.querySelector('#bu-dur').addEventListener('change', () => { m.querySelector('#bu-custom').classList.toggle('hidden', m.querySelector('#bu-dur').value !== 'custom'); });
  m.querySelector('#bu-save').onclick = async () => {
    const dur = m.querySelector('#bu-dur').value;
    let status = m.querySelector('#bu-mode').value === 'disable' ? 'disabled' : 'banned';
    const body = { status, reason: m.querySelector('#bu-reason').value.trim() };
    if (dur === 'custom') { /* 仅记录，时效在封禁管理里 */ }
    const r = await A(`/users/${uid}/status`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    if (r.ok) { toast('已封禁'); m.remove(); showPage('users'); } else toast(r.msg, 1);
  };
}

// ---------- comments ----------
async function pageComments() {
  const s = ADMIN.comments;
  const qs = new URLSearchParams({ page: s.page, size: 20 });
  if (s.q) qs.set('q', s.q);
  const r = await A('/comments?' + qs);
  if (!r.ok) { toast(r.msg, 1); return; }
  $main().innerHTML = `
    <div class="page-title">💬 评论管理</div>
    <div class="toolbar"><input id="c-q" placeholder="搜索评论内容" value="${esc(s.q)}" style="width:240px"><button class="btn" id="c-search">搜索</button><span class="spacer"></span><span style="font-size:13px;color:#8a90a2">共 ${r.total} 条</span></div>
    <table class="data"><thead><tr><th>UID</th><th>用户</th><th>内容</th><th>图纸</th><th>时间</th><th>操作</th></tr></thead><tbody>
    ${r.list.length ? r.list.map(c => `<tr>
      <td><span class="uid-tag">${esc(c.uid)}</span></td><td>${esc(c.username)}</td>
      <td style="max-width:260px">${esc(c.content)}</td>
      <td style="max-width:140px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(c.pattern_title || '—')}</td>
      <td>${fmtTime(c.created_at)}</td>
      <td><button class="btn mini danger" data-id="${c.id}">删除</button></td></tr>`).join('') : '<tr><td colspan="6" class="empty-row">暂无评论</td></tr>'}
    </tbody></table>
    <div class="pager" id="c-pager">${pagerHtml(r.total, 20, s.page)}</div>`;
  document.getElementById('c-search').onclick = () => { s.q = document.getElementById('c-q').value.trim(); s.page = 1; showPage('comments'); };
  document.getElementById('c-pager').querySelectorAll('button').forEach(b => b.onclick = () => { s.page = Number(b.dataset.p); showPage('comments'); });
  $main().querySelectorAll('[data-id]').forEach(btn => btn.addEventListener('click', () => confirmBox('确定删除该评论？', async () => { const r2 = await A(`/comments/${btn.dataset.id}`, { method: 'DELETE' }); r2.ok ? toast('已删除') : toast(r2.msg, 1); showPage('comments'); })));
}

// ---------- bans ----------
async function pageBans() {
  const s = ADMIN.bans;
  const qs = new URLSearchParams({ page: s.page, size: 20 });
  if (s.q) qs.set('q', s.q);
  if (s.type) qs.set('type', s.type);
  if (s.status) qs.set('status', s.status);
  const r = await A('/bans?' + qs);
  if (!r.ok) { toast(r.msg, 1); return; }
  $main().innerHTML = `
    <div class="page-title">🚫 封禁管理</div>
    <div class="toolbar">
      <input id="b-q" placeholder="搜索 IP / UID / 用户名" value="${esc(s.q)}" style="width:220px">
      <select id="b-type"><option value="">全部类型</option><option value="ip" ${s.type === 'ip' ? 'selected' : ''}>IP 封禁</option><option value="uid" ${s.type === 'uid' ? 'selected' : ''}>账号封禁</option></select>
      <select id="b-status"><option value="">全部状态</option><option value="active" ${s.status === 'active' ? 'selected' : ''}>生效中</option><option value="expired" ${s.status === 'expired' ? 'selected' : ''}>已失效</option></select>
      <button class="btn" id="b-search">搜索</button>
      <button class="btn primary" id="b-add">➕ 新增封禁</button>
    </div>
    <table class="data"><thead><tr><th>类型</th><th>目标</th><th>原因</th><th>到期</th><th>状态</th><th>创建</th><th>操作</th></tr></thead><tbody>
    ${r.list.length ? r.list.map(b => `<tr>
      <td>${b.type === 'ip' ? '<span class="badge gray">IP</span>' : '<span class="badge orange">账号</span>'}</td>
      <td><span class="uid-tag">${esc(b.display)}</span></td>
      <td style="max-width:200px">${esc(b.reason || '—')}</td>
      <td>${b.expires_at ? fmtTime(b.expires_at) : '永久'}</td>
      <td>${b.active ? '<span class="badge green">生效中</span>' : '<span class="badge gray">已失效</span>'}</td>
      <td>${fmtTime(b.created_at)}<br><small style="color:#999">${esc(b.created_by)}</small></td>
      <td>${b.active ? `<button class="btn mini" data-id="${b.id}">解封</button>` : '—'}</td></tr>`).join('') : '<tr><td colspan="7" class="empty-row">暂无封禁记录</td></tr>'}
    </tbody></table>
    <div class="pager" id="b-pager">${pagerHtml(r.total, 20, s.page)}</div>`;
  document.getElementById('b-search').onclick = () => { s.q = document.getElementById('b-q').value.trim(); s.type = document.getElementById('b-type').value; s.status = document.getElementById('b-status').value; s.page = 1; showPage('bans'); };
  document.getElementById('b-add').onclick = addBanModal;
  document.getElementById('b-pager').querySelectorAll('button').forEach(b => b.onclick = () => { s.page = Number(b.dataset.p); showPage('bans'); });
  $main().querySelectorAll('[data-id]').forEach(btn => btn.addEventListener('click', () => confirmBox('确定解封该记录？', async () => { const r2 = await A(`/bans/${btn.dataset.id}/unban`, { method: 'POST' }); r2.ok ? toast('已解封') : toast(r2.msg, 1); showPage('bans'); })));
}

function addBanModal() {
  const m = modal(`<h3>➕ 新增封禁</h3>
    <div class="field"><label>类型</label><select id="nb-type"><option value="ip">封 IP 地址</option><option value="uid">封账号（按 UID 或用户名）</option></select></div>
    <div class="field"><label>目标 *</label><input id="nb-target" placeholder="IP 如 1.2.3.4 / 用户名或 UID"></div>
    <div class="field"><label>封禁原因</label><input id="nb-reason"></div>
    <div class="row2">
      <div class="field"><label>时长</label><input id="nb-dur" type="number" min="0" placeholder="0 = 永久"></div>
      <div class="field"><label>单位</label><select id="nb-unit"><option value="hour">小时</option><option value="day">天</option></select></div>
    </div>
    <div class="modal-actions"><button class="btn" id="nb-cancel">取消</button><button class="btn danger" id="nb-save">确定封禁</button></div>`);
  m.querySelector('#nb-cancel').onclick = () => m.remove();
  m.querySelector('#nb-save').onclick = async () => {
    const dur = Number(m.querySelector('#nb-dur').value) || 0;
    const body = {
      type: m.querySelector('#nb-type').value,
      target: m.querySelector('#nb-target').value.trim(),
      reason: m.querySelector('#nb-reason').value.trim(),
      duration: dur > 0 ? dur : 0,
      unit: dur > 0 ? m.querySelector('#nb-unit').value : ''
    };
    const r = await A('/bans', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    if (r.ok) { toast('封禁成功'); m.remove(); showPage('bans'); } else toast(r.msg, 1);
  };
}

// ---------- notices ----------
async function pageNotices() {
  const r = await A('/notices');
  if (!r.ok) { toast(r.msg, 1); return; }
  $main().innerHTML = `
    <div class="page-title">📢 公告管理</div>
    <div class="toolbar"><button class="btn primary" id="n-add">➕ 发布公告</button><span style="font-size:13px;color:#8a90a2">最新一条启用中的公告会显示在前台顶部</span></div>
    <table class="data"><thead><tr><th>标题</th><th>内容</th><th>状态</th><th>时间</th><th>操作</th></tr></thead><tbody>
    ${r.list.length ? r.list.map(n => `<tr>
      <td><b>${esc(n.title)}</b></td><td style="max-width:300px">${esc(n.content)}</td>
      <td>${n.active ? '<span class="badge green">启用中</span>' : '<span class="badge gray">已停用</span>'}</td>
      <td>${fmtTime(n.created_at)}</td>
      <td style="white-space:nowrap">
        <button class="btn mini" data-act="toggle" data-id="${n.id}">${n.active ? '停用' : '启用'}</button>
        <button class="btn mini" data-act="edit" data-id="${n.id}">编辑</button>
        <button class="btn mini danger" data-act="del" data-id="${n.id}">删除</button></td></tr>`).join('') : '<tr><td colspan="5" class="empty-row">暂无公告</td></tr>'}
    </tbody></table>`;
  document.getElementById('n-add').onclick = () => noticeModal(null);
  $main().querySelectorAll('[data-act]').forEach(btn => btn.addEventListener('click', async () => {
    const n = r.list.find(x => String(x.id) === btn.dataset.id);
    if (btn.dataset.act === 'del') confirmBox('确定删除该公告？', async () => { const r2 = await A(`/notices/${n.id}`, { method: 'DELETE' }); r2.ok ? toast('已删除') : toast(r2.msg, 1); showPage('notices'); });
    else if (btn.dataset.act === 'toggle') { const r2 = await A(`/notices/${n.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ active: !n.active }) }); r2.ok ? toast('已更新') : toast(r2.msg, 1); showPage('notices'); }
    else noticeModal(n);
  }));
}

function noticeModal(n) {
  const m = modal(`<h3>${n ? '编辑公告' : '发布公告'}</h3>
    <div class="field"><label>标题 *</label><input id="nm-title" value="${n ? esc(n.title) : ''}"></div>
    <div class="field"><label>内容 *</label><textarea id="nm-content">${n ? esc(n.content) : ''}</textarea></div>
    <div class="field"><label><input type="checkbox" id="nm-active" ${!n || n.active ? 'checked' : ''} style="width:auto"> 启用</label></div>
    <div class="modal-actions"><button class="btn" id="nm-cancel">取消</button><button class="btn primary" id="nm-save">保存</button></div>`);
  m.querySelector('#nm-cancel').onclick = () => m.remove();
  m.querySelector('#nm-save').onclick = async () => {
    const body = { title: m.querySelector('#nm-title').value.trim(), content: m.querySelector('#nm-content').value.trim(), active: m.querySelector('#nm-active').checked ? 1 : 0 };
    if (!body.title || !body.content) return toast('标题和内容必填', 1);
    const r = n ? await A(`/notices/${n.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      : await A('/notices', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    if (r.ok) { toast('已保存'); m.remove(); showPage('notices'); } else toast(r.msg, 1);
  };
}

// ---------- orders ----------
async function pageOrders() {
  const s = ADMIN.orders;
  const qs = new URLSearchParams({ page: s.page, size: 20 });
  if (s.status) qs.set('status', s.status);
  const r = await A('/orders?' + qs);
  if (!r.ok) { toast(r.msg, 1); return; }
  const stb = { pending: '<span class="badge orange">待审核</span>', approved: '<span class="badge green">已通过</span>', rejected: '<span class="badge red">已驳回</span>' };
  $main().innerHTML = `
    <div class="page-title">💰 金币订单审核</div>
    <div class="toolbar"><select id="o-status"><option value="">全部状态</option><option value="pending" ${s.status === 'pending' ? 'selected' : ''}>待审核</option><option value="approved" ${s.status === 'approved' ? 'selected' : ''}>已通过</option><option value="rejected" ${s.status === 'rejected' ? 'selected' : ''}>已驳回</option></select><button class="btn" id="o-filter">筛选</button><span class="spacer"></span><span style="font-size:13px;color:#8a90a2">共 ${r.total} 单</span></div>
    <table class="data"><thead><tr><th>UID</th><th>用户</th><th>商户订单号</th><th>数量</th><th>优惠</th><th>状态</th><th>提交时间</th><th>操作</th></tr></thead><tbody>
    ${r.list.length ? r.list.map(o => `<tr>
      <td><span class="uid-tag">${esc(o.user_uid)}</span></td><td>${esc(o.username)}</td>
      <td>${esc(o.merchant_no)}</td><td>+${o.coins}</td>
      <td>${esc(o.note || '—')}</td><td>${stb[o.status] || o.status}</td>
      <td>${fmtTime(o.created_at)}</td>
      <td>${o.status === 'pending' ? `<button class="btn mini primary" data-id="${o.id}" data-act="ok">通过</button> <button class="btn mini danger" data-id="${o.id}" data-act="no">驳回</button>` : '—'}</td></tr>`).join('') : '<tr><td colspan="8" class="empty-row">暂无订单</td></tr>'}
    </tbody></table>
    <div class="pager" id="o-pager">${pagerHtml(r.total, 20, s.page)}</div>`;
  document.getElementById('o-filter').onclick = () => { s.status = document.getElementById('o-status').value; s.page = 1; showPage('orders'); };
  document.getElementById('o-pager').querySelectorAll('button').forEach(b => b.onclick = () => { s.page = Number(b.dataset.p); showPage('orders'); });
  $main().querySelectorAll('[data-act]').forEach(btn => btn.addEventListener('click', async () => {
    const approve = btn.dataset.act === 'ok';
    confirmBox(approve ? '确定通过该订单并为用户加币？' : '确定驳回该订单？', async () => {
      const r2 = await A(`/orders/${btn.dataset.id}/review`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ approve }) });
      r2.ok ? toast('已处理') : toast(r2.msg, 1);
      showPage('orders');
    });
  }));
}

// ---------- coupons ----------
async function pageCoupons() {
  const [cp, rd] = await Promise.all([A('/coupons'), A('/redeem_codes')]);
  if (!cp.ok || !rd.ok) { toast('加载失败', 1); return; }
  $main().innerHTML = `
    <div class="page-title">🎟 优惠码 / 激活码</div>
    <div class="setting-grid" style="grid-template-columns:1fr 1fr;align-items:start">
      <div>
        <div class="toolbar"><button class="btn primary" id="cp-add">➕ 新增优惠码</button></div>
        <table class="data"><thead><tr><th>优惠码</th><th>折扣</th><th>已用/上限</th><th>状态</th><th>操作</th></tr></thead><tbody>
        ${cp.list.length ? cp.list.map(c => `<tr><td><b>${esc(c.code)}</b></td><td>${(c.discount * 10).toFixed(1)} 折</td><td>${c.used_count}/${c.max_uses || '∞'}</td><td>${c.active ? '<span class="badge green">启用</span>' : '<span class="badge gray">停用</span>'}</td><td><button class="btn mini" data-code="${esc(c.code)}">${c.active ? '停用' : '启用'}</button></td></tr>`).join('') : '<tr><td colspan="5" class="empty-row">暂无优惠码</td></tr>'}
        </tbody></table>
      </div>
      <div>
        <div class="toolbar"><button class="btn primary" id="rd-gen">🎟 生成激活码</button></div>
        <table class="data"><thead><tr><th>激活码</th><th>面值</th><th>状态</th></tr></thead><tbody>
        ${rd.list.length ? rd.list.map(c => `<tr><td><b>${esc(c.code)}</b></td><td>${c.coins}</td><td>${c.used ? `<span class="badge gray">已被 ${esc(c.used_name || '用户')} 使用</span>` : '<span class="badge green">未使用</span>'}</td></tr>`).join('') : '<tr><td colspan="3" class="empty-row">暂无激活码</td></tr>'}
        </tbody></table>
      </div>
    </div>`;
  document.getElementById('cp-add').onclick = () => {
    const m = modal(`<h3>新增优惠码</h3>
      <div class="field"><label>优惠码 *</label><input id="ca-code" placeholder="例如 NEWYEAR"></div>
      <div class="field"><label>折扣（0.8 = 打八折）*</label><input id="ca-disc" type="number" step="0.05" min="0.1" max="1" value="0.9"></div>
      <div class="field"><label>最多可用次数（0 = 无限）</label><input id="ca-max" type="number" value="0" min="0"></div>
      <div class="modal-actions"><button class="btn" id="ca-cancel">取消</button><button class="btn primary" id="ca-save">保存</button></div>`);
    m.querySelector('#ca-cancel').onclick = () => m.remove();
    m.querySelector('#ca-save').onclick = async () => {
      const r = await A('/coupons', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code: m.querySelector('#ca-code').value.trim(), discount: Number(m.querySelector('#ca-disc').value), max_uses: Number(m.querySelector('#ca-max').value) }) });
      if (r.ok) { toast('已创建'); m.remove(); showPage('coupons'); } else toast(r.msg, 1);
    };
  };
  document.getElementById('rd-gen').onclick = () => {
    const m = modal(`<h3>生成激活码</h3>
      <div class="field"><label>面值（${esc(window.COIN_NAME || '金币')}）*</label><input id="rc-coins" type="number" min="1" placeholder="例如 100"></div>
      <div class="field"><label>生成数量（1-50）</label><input id="rc-count" type="number" value="1" min="1" max="50"></div>
      <div id="rc-result" style="font-size:13px;color:#1e9e50;margin-top:8px;word-break:break-all"></div>
      <div class="modal-actions"><button class="btn" id="rc-cancel">关闭</button><button class="btn primary" id="rc-save">生成</button></div>`);
    m.querySelector('#rc-cancel').onclick = () => m.remove();
    m.querySelector('#rc-save').onclick = async () => {
      const r = await A('/redeem_codes', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ coins: Number(m.querySelector('#rc-coins').value), count: Number(m.querySelector('#rc-count').value) }) });
      if (r.ok) { m.querySelector('#rc-result').textContent = '生成成功：' + r.codes.join(', '); showPage('coupons'); } else toast(r.msg, 1);
    };
  };
  $main().querySelectorAll('[data-code]').forEach(btn => btn.addEventListener('click', async () => {
    const r = await A(`/coupons/${btn.dataset.code}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ active: btn.textContent.trim() === '停用' ? false : true }) });
    r.ok ? toast('已更新') : toast(r.msg, 1);
    showPage('coupons');
  }));
}

// ---------- settings ----------
async function pageSettings() {
  const [s, fonts, stars, coins] = await Promise.all([A('/settings'), A('/fonts'), A('/stars'), A('/coin_icons')]);
  if (!s.ok) { toast(s.msg, 1); return; }
  const st = s.settings;
  window.COIN_NAME = st.coin_name || '金币';
  const fontOptions = (fonts.ok ? fonts.fonts : []).map(f => `<option value="${esc(f.url)}" ${st.font_url === f.url ? 'selected' : ''}>${esc(f.name)}</option>`).join('');
  const starList = (stars.ok ? stars.list : []).map(x => `<option value="${esc(x.url)}" ${st.star_img === x.url ? 'selected' : ''}>星星图 ${x.id}</option>`).join('');
  const coinList = (coins.ok ? coins.list : []).map(x => `<option value="${esc(x.url)}" ${st.coin_icon === x.url ? 'selected' : ''}>金币图标 ${x.id}</option>`).join('');
  $main().innerHTML = `
    <div class="page-title">🎨 主题设置</div>
    <div class="setting-grid">
      <div class="set-card">
        <h4>基础信息</h4>
        <div class="field"><label>网站名称</label><input id="set-name" value="${esc(st.site_name)}"></div>
        <div class="field"><label>网站描述</label><input id="set-desc" value="${esc(st.site_desc)}"></div>
        <div class="field"><label>主色调</label><div class="color-row"><input type="color" id="set-color" value="${esc(st.theme_color)}"><input type="text" id="set-color-text" value="${esc(st.theme_color)}"></div></div>
        <div class="field"><label>封面背景图（上传后前台头部生效）</label><div class="drop-zone" id="set-bg-drop">点击上传背景图</div>${st.cover_bg ? `<img class="qr-prev" src="${esc(st.cover_bg)}" id="set-bg-prev">` : '<img class="qr-prev hidden" id="set-bg-prev">'}</div>
        <button class="btn primary" id="set-save-basic">保存基础设置</button>
      </div>
      <div class="set-card">
        <h4>字体</h4>
        <div class="field"><label>字体来源</label><select id="set-font-type"><option value="default" ${st.font_type === 'default' ? 'selected' : ''}>系统默认字体</option><option value="custom" ${st.font_type === 'custom' ? 'selected' : ''}>自定义 TTF</option></select></div>
        <div class="field"><label>选择已上传的 TTF</label><select id="set-font-url"><option value="">（无）</option>${fontOptions}</select></div>
        <div class="drop-zone" id="set-font-drop">点击上传 TTF 字体文件</div>
        <p style="font-size:12px;color:#999;margin:8px 0">内置字体：默认 sans-serif；上传后自动启用</p>
        <button class="btn primary" id="set-save-font">保存字体设置</button>
      </div>
      <div class="set-card">
        <h4>星星与金币图标</h4>
        <div class="field"><label>星星图片（评分用，PNG）</label><div class="drop-zone" id="set-star-drop">点击上传星星图片</div><input type="url" id="set-star-url" value="${esc(st.star_img)}" placeholder="或输入图片 URL"></div>
        <div class="field"><label>当前星星</label>${st.star_img ? `<img src="${esc(st.star_img)}" style="width:26px;height:26px">` : '<span style="color:#999">默认金色星星</span>'}</div>
        <div class="field"><label>金币图标（可上传 PNG/SVG）</label><div class="drop-zone" id="set-coin-drop">点击上传金币图标</div><input type="url" id="set-coin-url" value="${esc(st.coin_icon)}" placeholder="或输入图片 URL"></div>
        <div class="field"><label>当前金币图标</label><img src="${esc(st.coin_icon)}" style="width:26px;height:26px"></div>
        <div class="field"><label>金币名称</label><input id="set-coin-name" value="${esc(st.coin_name)}"></div>
        <button class="btn primary" id="set-save-icons">保存图标与金币设置</button>
      </div>
      <div class="set-card">
        <h4>收款码</h4>
        <div class="field"><label>微信收款码</label><div class="drop-zone" id="set-wx-drop">点击上传</div>${st.wechat_qr ? `<img class="qr-prev" src="${esc(st.wechat_qr)}">` : ''}</div>
        <div class="field"><label>支付宝收款码</label><div class="drop-zone" id="set-ali-drop">点击上传</div>${st.alipay_qr ? `<img class="qr-prev" src="${esc(st.alipay_qr)}">` : ''}</div>
      </div>
    </div>`;
  const colorI = document.getElementById('set-color'), colorT = document.getElementById('set-color-text');
  colorI.addEventListener('input', () => colorT.value = colorI.value);
  colorT.addEventListener('input', () => { if (/^#[0-9a-fA-F]{6}$/.test(colorT.value)) colorI.value = colorT.value; });
  document.getElementById('set-save-basic').onclick = async () => {
    const r = await A('/settings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ site_name: document.getElementById('set-name').value.trim(), site_desc: document.getElementById('set-desc').value.trim(), theme_color: colorT.value.trim() }) });
    r.ok ? toast('已保存，前台刷新即生效') : toast(r.msg, 1);
  };
  document.getElementById('set-bg-drop').onclick = async () => {
    const inp = document.createElement('input'); inp.type = 'file'; inp.accept = 'image/*';
    inp.onchange = async () => {
      const f = inp.files[0]; if (!f) return;
      const data = await fileToDataUrl(f);
      const r = await P('/admin/upload/cover_bg', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ data }) });
      if (r.ok) { toast('背景图已更新'); const p = document.getElementById('set-bg-prev'); p.src = r.url; p.classList.remove('hidden'); }
      else toast(r.msg, 1);
    };
    inp.click();
  };
  document.getElementById('set-save-font').onclick = async () => {
    const type = document.getElementById('set-font-type').value;
    const url = document.getElementById('set-font-url').value;
    const name = url ? decodeURIComponent(url.split('/').pop() || '').replace(/\.ttf$/i, '') : '';
    const r = await A('/settings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ font_type: type === 'custom' && url ? 'custom' : type, font_url: type === 'custom' ? url : '', font_name: type === 'custom' ? name : '' }) });
    r.ok ? toast('字体设置已保存') : toast(r.msg, 1);
  };
  document.getElementById('set-font-drop').onclick = async () => {
    const inp = document.createElement('input'); inp.type = 'file'; inp.accept = '.ttf';
    inp.onchange = async () => {
      const f = inp.files[0]; if (!f) return;
      const data = await fileToDataUrl(f);
      const r = await P('/admin/upload/font', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ data, name: f.name }) });
      if (r.ok) { toast('字体已上传并启用'); showPage('settings'); }
      else toast(r.msg, 1);
    };
    inp.click();
  };
  document.getElementById('set-star-drop').onclick = async () => {
    const inp = document.createElement('input'); inp.type = 'file'; inp.accept = 'image/png';
    inp.onchange = async () => {
      const f = inp.files[0]; if (!f) return;
      if (!f.name.toLowerCase().endsWith('.png')) return toast('星星图片需为 PNG', 1);
      const data = await fileToDataUrl(f);
      const r = await P('/admin/upload/star', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ data }) });
      if (r.ok) { toast('星星图片已更新，前台刷新生效'); showPage('settings'); } else toast(r.msg, 1);
    };
    inp.click();
  };
  document.getElementById('set-coin-drop').onclick = async () => {
    const inp = document.createElement('input'); inp.type = 'file'; inp.accept = 'image/*';
    inp.onchange = async () => {
      const f = inp.files[0]; if (!f) return;
      const data = await fileToDataUrl(f);
      const r = await P('/admin/upload/coin_icon', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ data }) });
      if (r.ok) { toast('金币图标已更新'); showPage('settings'); } else toast(r.msg, 1);
    };
    inp.click();
  };
  document.getElementById('set-save-icons').onclick = async () => {
    const r = await A('/settings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ coin_name: document.getElementById('set-coin-name').value.trim() || '金币', star_img: document.getElementById('set-star-url').value.trim(), coin_icon: document.getElementById('set-coin-url').value.trim() }) });
    r.ok ? toast('已保存') : toast(r.msg, 1);
  };
  const bindQr = (id, which) => {
    document.getElementById(id).onclick = async () => {
      const inp = document.createElement('input'); inp.type = 'file'; inp.accept = 'image/*';
      inp.onchange = async () => {
        const f = inp.files[0]; if (!f) return;
        const data = await fileToDataUrl(f);
        const r = await P('/admin/upload/qr', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ data, which }) });
        if (r.ok) { toast('收款码已更新'); showPage('settings'); } else toast(r.msg, 1);
      };
      inp.click();
    };
  };
  bindQr('set-wx-drop', 'wechat_qr'); bindQr('set-ali-drop', 'alipay_qr');
}

// ---------- maintenance ----------
async function pageMaintenance() {
  const s = await A('/settings');
  if (!s.ok) { toast(s.msg, 1); return; }
  const on = s.settings.maintenance === '1';
  $main().innerHTML = `
    <div class="page-title">🛠 维护模式</div>
    <div class="set-card" style="max-width:520px">
      <h4>开启后普通用户将无法访问前台，管理员可正常登录后台</h4>
      <div class="sw-row"><div class="sw ${on ? 'on' : ''}" id="mt-sw"></div><span id="mt-text">${on ? '已开启' : '已关闭'}</span></div>
      <p style="font-size:13px;color:#999;margin-top:14px">开启时前台显示维护提示页；登录接口仍可用，管理员账号可进入后台关闭维护。</p>
    </div>`;
  document.getElementById('mt-sw').onclick = async () => {
    const nv = !on;
    const r = await A('/settings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ maintenance: nv ? '1' : '0' }) });
    if (r.ok) { toast(nv ? '维护模式已开启' : '维护模式已关闭'); showPage('maintenance'); } else toast(r.msg, 1);
  };
}

// ---------- files ----------
async function pageFiles() {
  const r = await P('/files');
  if (!r.ok) { toast(r.msg, 1); return; }
  $main().innerHTML = `
    <div class="page-title">📦 文件下载</div>
    <div class="toolbar"><span style="font-size:13px;color:#8a90a2">上传的文件（图标、收款码、字体等）会显示在这里，可生成外链下载</span></div>
    <table class="data"><thead><tr><th>文件</th><th>标题</th><th>大小</th><th>时间</th><th>外链</th></tr></thead><tbody>
    ${r.list.length ? r.list.map(f => `<tr><td>${esc(f.filename)}</td><td>${esc(f.title)}</td><td>${(f.size / 1024).toFixed(1)} KB</td><td>${fmtTime(f.uploaded_at)}</td><td><a class="btn mini" href="${esc(f.url)}" download>下载</a></td></tr>`).join('') : '<tr><td colspan="5" class="empty-row">暂无文件</td></tr>'}
    </tbody></table>`;
}

// ---------- boot ----------
document.addEventListener('DOMContentLoaded', async () => {
  document.getElementById('admin-login-btn').onclick = adminLogin;
  document.getElementById('admin-password').addEventListener('keydown', e => { if (e.key === 'Enter') adminLogin(); });
  document.querySelectorAll('#admin-nav a').forEach(a => a.addEventListener('click', () => showPage(a.dataset.page)));
  refreshCaptcha();
  const me = await P('/auth/me');
  if (me.ok && me.user && me.user.role === 'admin') {
    window.COIN_NAME = me.coin_name || '金币';
    document.getElementById('login-mask').classList.add('hidden');
    document.getElementById('admin-app').classList.remove('hidden');
    showPage('dashboard');
  } else if (me.ok && me.user) {
    document.getElementById('admin-login-msg').textContent = '当前账号不是管理员，请用管理员账号登录';
  }
  const s = await P('/site');
  if (s.ok) window.COIN_NAME = s.coin_name || window.COIN_NAME;
});

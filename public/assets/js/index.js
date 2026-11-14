/* home page: hero stats, categories, pattern grid, pager */
let state = { q: '', category: '', sort: 'new', page: 1 };
const PAGE_SIZE = 24;

async function loadStats() {
  try {
    const r = await API('/stats');
    if (r.ok) {
      const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
      set('st-patterns', r.patterns); set('st-users', r.users); set('st-comments', r.comments);
    }
  } catch (e) {}
}

async function loadCategories() {
  try {
    const r = await API('/categories');
    const bar = document.getElementById('category-bar');
    if (!r.ok || !bar) return;
    let html = `<div class="cat-card ${!state.category ? 'active' : ''}" data-id="">🧩 全部</div>`;
    for (const c of r.list) {
      const icon = c.icon ? `<img src="${esc(c.icon)}" alt="">` : '📁';
      html += `<div class="cat-card ${state.category == c.id ? 'active' : ''}" data-id="${c.id}">${icon} ${esc(c.name)}</div>`;
    }
    bar.innerHTML = html;
    bar.querySelectorAll('.cat-card').forEach(el => el.addEventListener('click', () => {
      state.category = el.dataset.id; state.page = 1;
      loadCategories(); loadPatterns();
    }));
  } catch (e) {}
}

function cardHtml(p) {
  const diffName = { easy: '简单', medium: '中等', hard: '困难' }[p.difficulty] || p.difficulty;
  const cover = p.cover ? esc(p.cover) : '/assets/icons/placeholder.svg';
  const priceHtml = (SITE && SITE.coins_enabled && p.price > 0) ? `<span class="p-price">${esc(window.COIN_NAME || '金币')} ${p.price}</span>` : '';
  return `<div class="p-card" data-id="${p.id}">
    <div class="p-cover"><img src="${cover}" loading="lazy" onerror="this.src='/assets/icons/placeholder.svg'"></div>
    <div class="p-body">
      <div class="p-title">${esc(p.title)}</div>
      <div class="p-meta">
        ${p.category ? `<span class="tag">${esc(p.category)}</span>` : ''}
        <span class="tag">${diffName}</span>
        <span class="p-rating">${starsHtml(p.rating.avg, window.STAR_IMG)} ${p.rating.n ? p.rating.avg.toFixed(1) : ''}</span>
        ${priceHtml}
      </div>
      <div class="p-meta"><span>UID ${esc(p.author_uid)}</span><span>${fmtTime(p.created_at)}</span></div>
    </div>
  </div>`;
}

async function loadPatterns() {
  try {
    const qs = new URLSearchParams();
    if (state.q) qs.set('q', state.q);
    if (state.category) qs.set('category', state.category);
    qs.set('sort', state.sort); qs.set('page', state.page); qs.set('size', PAGE_SIZE);
    const r = await API('/patterns?' + qs.toString());
    const grid = document.getElementById('pattern-grid');
    const pager = document.getElementById('pager');
    const empty = document.getElementById('empty-tip');
    if (!r.ok) { toast(r.msg || '加载失败', 1); return; }
    grid.innerHTML = r.list.map(cardHtml).join('');
    grid.querySelectorAll('.p-card').forEach(el => el.addEventListener('click', () => location.href = '/pattern?id=' + el.dataset.id));
    empty.classList.toggle('hidden', r.list.length > 0);
    const lt = document.getElementById('list-title');
    if (lt) lt.textContent = state.q ? `“${state.q}” 的搜索结果（${r.total}）` : (state.sort === 'hot' ? '热门图纸' : '最新图纸');
    const pages = Math.max(1, Math.ceil(r.total / PAGE_SIZE));
    let ph = '';
    if (pages > 1) {
      ph += `<button data-p="1" ${state.page === 1 ? 'class="cur"' : ''}>1</button>`;
      if (state.page > 3) ph += `<span>…</span>`;
      for (let i = Math.max(2, state.page - 1); i <= Math.min(pages - 1, state.page + 1); i++) ph += `<button data-p="${i}" ${i === state.page ? 'class="cur"' : ''}>${i}</button>`;
      if (state.page < pages - 2) ph += `<span>…</span>`;
      ph += `<button data-p="${pages}" ${state.page === pages ? 'class="cur"' : ''}>${pages}</button>`;
    }
    pager.innerHTML = ph;
    pager.querySelectorAll('button').forEach(b => b.addEventListener('click', () => { state.page = Number(b.dataset.p); loadPatterns(); window.scrollTo({ top: 0 }); }));
  } catch (e) { toast('加载失败，请稍后重试', 1); }
}

document.addEventListener('DOMContentLoaded', () => {
  loadStats(); loadCategories(); loadPatterns();
  document.querySelectorAll('.sort-tabs button').forEach(b => b.addEventListener('click', () => {
    document.querySelectorAll('.sort-tabs button').forEach(x => x.classList.remove('active'));
    b.classList.add('active');
    state.sort = b.dataset.sort; state.page = 1;
    loadPatterns();
  }));
  const gs = document.getElementById('global-search');
  let timer = null;
  gs.addEventListener('input', () => {
    clearTimeout(timer);
    timer = setTimeout(() => { state.q = gs.value.trim(); state.page = 1; loadPatterns(); }, 300);
  });
});

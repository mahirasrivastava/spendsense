/* SpendSense — vanilla JS frontend. Talks to the Express JSON API in /api. */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];

const view = $('#view');
const modalRoot = $('#modalRoot');

const money = (n) => {
  const v = Number(n || 0);
  // paise only matter on small amounts; big figures read better rounded
  return '₹' + v.toLocaleString('en-IN', { maximumFractionDigits: Math.abs(v) >= 1000 || v % 1 === 0 ? 0 : 2 });
};
// local-time formatting: toISOString() would shift these back a day in UTC+ zones
const pad2 = (n) => String(n).padStart(2, '0');
const thisMonth = () => { const d = new Date(); return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}`; };
const today = () => { const d = new Date(); return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`; };
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const icon = (name, cls = 'ico') => window.icon(name, cls);
const monthLabel = (m) => {
  const [y, mo] = m.split('-');
  return new Date(y, mo - 1, 1).toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });
};
const dayLabel = (d) => new Date(d + 'T00:00:00').toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });

const state = { month: thisMonth(), tab: 'dashboard' };
const PAGES = {
  dashboard: ['Dashboard', 'An overview of where your money went'],
  expenses: ['Expenses', 'Every transaction you logged this month'],
  budgets: ['Budgets & goals', 'Set the limits that keep your month on track'],
  recurring: ['Recurring', 'Rent, subscriptions and fees that repeat'],
  roommates: ['Roommates', 'Split shared costs and settle up'],
  import: ['Import statement', 'Turn a bank statement into expenses'],
};

let charts = {};
let catCache = [];

/* ---------- AJAX helpers ---------- */
function handleAuthLoss(r) {
  if (r.status !== 401) return false;
  window.location.href = '/login?next=' + encodeURIComponent('/app');
  return true;
}

async function apiGet(path) {
  const r = await fetch('/api/' + path, { credentials: 'same-origin' });
  if (handleAuthLoss(r)) throw new Error('Session expired');
  const d = await r.json();
  if (!r.ok) throw new Error(d.error || 'Error');
  return d;
}

async function apiPost(file, data) {
  const r = await fetch('/api/' + file, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'same-origin',
    body: JSON.stringify(data),
  });
  if (handleAuthLoss(r)) throw new Error('Session expired');
  const d = await r.json();
  if (!r.ok) throw new Error(d.error || 'Error');
  return d;
}

/* ---------- chrome ---------- */
const toast = (msg, type = 'success') => window.ssToast(msg, type);

function closeModal() { modalRoot.innerHTML = ''; document.removeEventListener('keydown', escClose); }
function escClose(e) { if (e.key === 'Escape') closeModal(); }
function openModal(title, html, onReady) {
  modalRoot.innerHTML = `<div class="modal-bg"><div class="modal" role="dialog" aria-modal="true">
    <div class="modal-head"><h2>${esc(title)}</h2><button class="x" aria-label="Close">${icon('x')}</button></div>
    <div class="modal-body">${html}</div></div></div>`;
  $('.modal-bg').addEventListener('click', (e) => { if (e.target.classList.contains('modal-bg')) closeModal(); });
  $('.x').onclick = closeModal;
  document.addEventListener('keydown', escClose);
  onReady && onReady();
  const first = $('.modal-body input, .modal-body select');
  first && first.focus();
}

function emptyState(title, note) {
  return `<div class="empty empty-card">${icon('receipt')}<strong>${esc(title)}</strong><span>${esc(note)}</span></div>`;
}

function destroyCharts() { Object.values(charts).forEach((c) => c.destroy()); charts = {}; }

/* charts read their colours from CSS variables, so redraw on theme change */
document.addEventListener('ss:theme', () => render());

/* sidebar budget widget */
function paintSidebar(f) {
  const el = $('#sidebarStat');
  if (!f || !(f.budget > 0)) {
    el.innerHTML = `<div class="mini-label">This month</div>
      <div class="mini-value">${money(f ? f.spent : 0)}</div>
      <div class="mini-foot">Set a monthly budget in Budgets to track how much is left.</div>`;
    return;
  }
  const pct = Math.min(100, (f.spent / f.budget) * 100);
  const cls = pct >= 100 ? 'over' : pct >= 80 ? 'warn' : '';
  const left = f.budget - f.spent;
  el.innerHTML = `<div class="mini-label">Budget used</div>
    <div class="mini-value">${Math.round(pct)}%</div>
    <div class="mini-bar ${cls}"><div style="width:${pct}%"></div></div>
    <div class="mini-foot">${left >= 0 ? `${money(left)} left of ${money(f.budget)}` : `${money(-left)} over ${money(f.budget)}`}</div>`;
}

/* ---------- boot ---------- */
$('#monthPicker').value = state.month;
$('#monthPicker').onchange = (e) => { state.month = e.target.value || thisMonth(); render(); };
$$('#tabs .nav-item').forEach((t) => t.onclick = () => {
  if (state.tab === t.dataset.tab) return;
  state.tab = t.dataset.tab;
  $$('#tabs .nav-item').forEach((x) => x.classList.toggle('active', x === t));
  render();
});

function setHeader() {
  const [title, sub] = PAGES[state.tab];
  $('#pageTitle').textContent = title;
  $('#pageSub').textContent = sub;
}

function showSkeleton() {
  view.innerHTML = `<div class="skeleton hero-sk"></div>
    <div class="tiles">${'<div class="skeleton tile-sk"></div>'.repeat(4)}</div>
    <div class="skeleton card-sk"></div>`;
}

async function render() {
  destroyCharts();
  setHeader();
  showSkeleton();
  try {
    const [cats, ins] = await Promise.all([
      apiGet('categories?month=' + state.month),
      apiGet('insights?month=' + state.month),
    ]);
    catCache = cats;
    paintSidebar(ins.forecast);
    if (state.tab === 'dashboard') return renderDashboard(ins);
    if (state.tab === 'expenses') return renderExpenses();
    if (state.tab === 'budgets') return renderBudgets();
    if (state.tab === 'recurring') return renderRecurring();
    if (state.tab === 'roommates') return renderRoommates();
    if (state.tab === 'import') return renderImport();
  } catch (e) {
    view.innerHTML = `<div class="empty empty-card">${icon('alert-triangle')}<strong>Could not load data</strong><span>${esc(e.message)}</span></div>`;
  }
}

/* ---------- DASHBOARD ---------- */
function renderDashboard(ins) {
  const f = ins.forecast;
  const headline = {
    on_track: 'You are on track',
    tight: 'Cutting it close',
    over: 'Heading over budget',
    none: 'No budget set yet',
  }[f.status];
  const body = f.status === 'none'
    ? `You have spent ${money(f.spent)} so far in ${monthLabel(state.month)}. Set a monthly budget to unlock forecasts and alerts.`
    : f.is_current
      ? `At ${money(f.daily_avg)} a day, you are projected to spend ${money(f.projected)} by month-end` +
        (f.status === 'over' ? ` — ${money(f.over_by)} over your ${money(f.budget)} budget.` : `, against a ${money(f.budget)} budget.`)
      : `You spent ${money(f.spent)} in ${monthLabel(state.month)}, against a ${money(f.budget)} budget.`;

  const pct = f.budget > 0 ? Math.min(100, (f.spent / f.budget) * 100) : 0;
  const pcls = pct >= 100 ? 'over' : pct >= 80 ? 'warn' : '';
  const left = f.budget - f.spent;

  view.innerHTML = `
    <section class="hero ${f.status}">
      <div class="hero-inner">
        <div>
          <span class="hero-eyebrow">${icon('trending-up', 'ico ico-sm')} Smart forecast</span>
          <h2>${headline}</h2>
          <p>${body}</p>
        </div>
        ${f.budget > 0 ? `<div class="hero-badge">
          <div class="k">${left >= 0 ? 'Left to spend' : 'Over budget'}</div>
          <div class="v">${money(Math.abs(left))}</div>
        </div>` : ''}
      </div>
    </section>

    <div class="tiles">
      <div class="tile"><div class="l">Spent</div><div class="n grad">${money(f.spent)}</div><div class="f">in ${monthLabel(state.month)}</div></div>
      <div class="tile"><div class="l">Remaining</div><div class="n ${left < 0 ? 'bad' : 'good'}">${money(left)}</div><div class="f">${f.budget > 0 ? `of ${money(f.budget)}` : 'no budget set'}</div></div>
      <div class="tile"><div class="l">Projected</div><div class="n">${money(f.projected)}</div><div class="f">by month-end</div></div>
      <div class="tile"><div class="l">Transactions</div><div class="n">${ins.count}</div><div class="f">${f.daily_avg ? `${money(f.daily_avg)} a day` : 'nothing logged yet'}</div></div>
      <div class="tile"><div class="l">Top category</div><div class="n sm">${ins.top_category ? esc(ins.top_category.name) : '—'}</div><div class="f">${ins.top_category ? money(ins.top_category.total || 0) + ' spent' : 'no data'}</div></div>
    </div>

    ${f.budget > 0 ? `<div class="card">
      <div class="card-head"><h3>${icon('target')} Budget used</h3><span class="small muted num">${money(f.spent)} / ${money(f.budget)} · ${Math.round(pct)}%</span></div>
      <div class="progress ${pcls}"><div style="width:${pct}%"></div></div>
    </div>` : ''}

    ${ins.alerts.length ? `<div class="card">
      <div class="card-head"><h3>${icon('alert-triangle')} Alerts</h3><span class="chip">${ins.alerts.length}</span></div>
      <div class="mt">${ins.alerts.map((a) => `<div class="alert ${a.level}">${icon('alert-triangle', 'ico ico-sm')}<span>${esc(a.msg)}</span></div>`).join('')}</div>
    </div>` : ''}

    ${ins.unusual.length ? `<div class="card">
      <div class="card-head"><div><h3>${icon('zap')} Unusual spending</h3><div class="card-sub">Charges well above your usual pattern</div></div></div>
      <div class="mt">${ins.unusual.map((u) => `
        <div class="list-item">
          <div class="item-ico bad">${icon(u.icon || 'package')}</div>
          <div class="item-body"><strong>${esc(u.description)}</strong>
            <div class="meta">${esc(u.reason)} · ${dayLabel(u.date)}</div></div>
          <div class="item-amt">${money(u.amount)}</div>
        </div>`).join('')}</div>
    </div>` : ''}

    <div class="charts">
      <div class="chart-card"><h3>Spending by category</h3><div class="chart-box"><canvas id="catChart"></canvas></div></div>
      <div class="chart-card"><h3>Last 7 days</h3><div class="chart-box"><canvas id="weekChart"></canvas></div></div>
      <div class="chart-card full"><h3>Monthly trend</h3><div class="chart-box"><canvas id="monthChart"></canvas></div></div>
    </div>`;

  drawCharts(ins);
}

/* ---------- charts ---------- */
function chartTheme() {
  const css = getComputedStyle(document.documentElement);
  const v = (n) => css.getPropertyValue(n).trim();
  const dark = document.documentElement.dataset.theme === 'dark';
  return {
    ink: v('--ink-2'), muted: v('--muted'),
    grid: dark ? 'rgba(255,255,255,.07)' : 'rgba(18,20,45,.07)',
    tipBg: dark ? '#1b1f36' : '#14162b',
    palette: ['#3b82f6', '#06b6d4', '#4f46e5', '#8b5cf6', '#f59e0b', '#10b981', '#f43f5e', '#0ea5e9'],
  };
}

function baseOpts(t) {
  return {
    maintainAspectRatio: false,
    plugins: {
      legend: { display: false },
      tooltip: {
        backgroundColor: t.tipBg, padding: 11, cornerRadius: 10, displayColors: false,
        titleFont: { family: 'Inter', size: 12, weight: '600' },
        bodyFont: { family: 'Inter', size: 13, weight: '700' },
        callbacks: { label: (c) => money(c.parsed.y ?? c.parsed) },
      },
    },
    scales: {
      x: { grid: { display: false }, border: { display: false },
        ticks: { color: t.muted, font: { family: 'Inter', size: 11, weight: '500' } } },
      y: { beginAtZero: true, border: { display: false },
        grid: { color: t.grid, drawTicks: false },
        ticks: { color: t.muted, padding: 8, font: { family: 'Inter', size: 11 }, callback: (val) => '₹' + Number(val).toLocaleString('en-IN') } },
    },
  };
}

function vGradient(ctx, area, from, to) {
  const g = ctx.createLinearGradient(0, area.top, 0, area.bottom);
  g.addColorStop(0, from); g.addColorStop(1, to);
  return g;
}

function drawCharts(ins) {
  const t = chartTheme();

  if (ins.byCategory.length) {
    charts.cat = new Chart($('#catChart'), {
      type: 'doughnut',
      data: {
        labels: ins.byCategory.map((c) => c.name),
        datasets: [{
          data: ins.byCategory.map((c) => c.total),
          backgroundColor: t.palette, borderWidth: 0, hoverOffset: 8, spacing: 2,
        }],
      },
      options: {
        maintainAspectRatio: false, cutout: '66%',
        plugins: {
          legend: { position: 'bottom', labels: { boxWidth: 8, boxHeight: 8, usePointStyle: true, pointStyle: 'circle',
            padding: 14, color: t.ink, font: { family: 'Inter', size: 11.5, weight: '500' } } },
          tooltip: { backgroundColor: t.tipBg, padding: 11, cornerRadius: 10, displayColors: false,
            bodyFont: { family: 'Inter', size: 13, weight: '600' },
            callbacks: { label: (c) => `${c.label} · ${money(c.parsed)}` } },
        },
      },
    });
  } else {
    $('#catChart').parentElement.innerHTML = `<div class="empty">${icon('receipt')}<strong>Nothing logged yet</strong><span>Add an expense to see the breakdown</span></div>`;
  }

  charts.week = new Chart($('#weekChart'), {
    type: 'bar',
    data: {
      labels: ins.weekly.map((w) => w.label),
      datasets: [{
        data: ins.weekly.map((w) => w.total),
        borderRadius: 7, maxBarThickness: 34,
        backgroundColor: (c) => c.chart.chartArea ? vGradient(c.chart.ctx, c.chart.chartArea, '#22d3ee', '#3b82f6') : '#3b82f6',
      }],
    },
    options: baseOpts(t),
  });

  charts.month = new Chart($('#monthChart'), {
    type: 'line',
    data: {
      labels: ins.monthly.map((m) => m.label),
      datasets: [{
        data: ins.monthly.map((m) => m.total),
        borderColor: '#3b82f6', borderWidth: 2.5, tension: .38, fill: true,
        backgroundColor: (c) => c.chart.chartArea ? vGradient(c.chart.ctx, c.chart.chartArea, 'rgba(59,130,246,.30)', 'rgba(59,130,246,0)') : 'transparent',
        pointRadius: 0, pointHoverRadius: 6, pointHoverBackgroundColor: '#3b82f6',
        pointHoverBorderColor: '#fff', pointHoverBorderWidth: 2,
      }],
    },
    options: { ...baseOpts(t), interaction: { mode: 'index', intersect: false } },
  });
}

/* ---------- EXPENSES ---------- */
async function renderExpenses() {
  const exp = await apiGet('expenses?month=' + state.month);
  const total = exp.reduce((s, e) => s + Number(e.amount), 0);
  view.innerHTML = `
    <div class="toolbar">
      <div class="search">${icon('search')}<input id="expSearch" placeholder="Search description or category…" /></div>
      <div class="actions">
        <button class="btn" id="exportBtn">${icon('download')} Export CSV</button>
        <button class="btn primary" id="addExp">${icon('plus')} Add expense</button>
      </div>
    </div>
    <div class="spread small muted" style="margin-bottom:12px">
      <span><strong class="num" style="color:var(--ink)">${exp.length}</strong> transactions in ${monthLabel(state.month)}</span>
      <span>Total <strong class="num" style="color:var(--ink)">${money(total)}</strong></span>
    </div>
    <div id="expList"></div>`;

  $('#addExp').onclick = expenseModal;
  $('#exportBtn').onclick = () => window.open('/api/export?month=' + state.month, '_blank');

  const list = $('#expList');
  const paint = (items) => {
    if (!items.length) { list.innerHTML = emptyState('No expenses found', 'Try a different search, or add your first expense.'); return; }
    list.innerHTML = items.map((e) => `
      <div class="exp">
        <div class="exp-icon">${icon(e.icon || 'package')}</div>
        <div class="exp-main">
          <strong>${esc(e.description)}</strong>
          <div class="exp-meta">
            <span class="chip brand">${esc(e.category || 'Uncategorized')}</span>
            <span>${dayLabel(e.date)}</span>
            ${e.note ? `<span class="dot"></span><span>${esc(e.note)}</span>` : ''}
          </div>
        </div>
        <div class="exp-right">
          <div class="exp-amt">${money(e.amount)}</div>
          <button class="btn-icon" data-del="${e.id}" aria-label="Delete expense">${icon('trash')}</button>
        </div>
      </div>`).join('');
    $$('[data-del]', list).forEach((b) => b.onclick = async () => {
      await apiPost('expenses', { action: 'delete', id: b.dataset.del });
      toast('Expense deleted'); renderExpenses();
    });
  };
  paint(exp);

  $('#expSearch').oninput = (e) => {
    const q = e.target.value.toLowerCase();
    paint(exp.filter((x) => (x.description + ' ' + (x.category || '')).toLowerCase().includes(q)));
  };
}

function catOptions(selected) {
  return catCache.map((c) => `<option value="${c.id}" ${c.id == selected ? 'selected' : ''}>${esc(c.name)}</option>`).join('');
}

function expenseModal() {
  openModal('Add expense', `
    <div class="field"><label class="fld">Description</label><input id="xDesc" placeholder="e.g. Canteen lunch" /></div>
    <div class="row">
      <div class="field grow"><label class="fld">Amount (₹)</label><input id="xAmt" type="number" min="0" step="any" placeholder="0" /></div>
      <div class="field grow"><label class="fld">Date</label><input id="xDate" type="date" value="${today()}" /></div>
    </div>
    <div class="field"><label class="fld">Category</label><select id="xCat">${catOptions()}</select></div>
    <div class="field"><label class="fld">Note <span class="muted" style="font-weight:500">(optional)</span></label><input id="xNote" placeholder="Anything worth remembering" /></div>
    <button class="btn primary block" id="xSave">${icon('plus')} Add expense</button>
    <div class="err" id="xErr"></div>`,
    () => {
      $('#xSave').onclick = async () => {
        try {
          await apiPost('expenses', {
            action: 'add', description: $('#xDesc').value, amount: $('#xAmt').value,
            category_id: $('#xCat').value, date: $('#xDate').value, note: $('#xNote').value,
          });
          closeModal(); toast('Expense added'); render();
        } catch (e) { $('#xErr').textContent = e.message; }
      };
    });
}

/* ---------- BUDGETS ---------- */
async function renderBudgets() {
  const b = await apiGet('budget?month=' + state.month);
  view.innerHTML = `
    <div class="card">
      <div class="card-head"><div><h3>${icon('piggy-bank')} Monthly budget & savings goal</h3>
        <div class="card-sub">These drive your forecast, alerts and progress bars.</div></div></div>
      <div class="row wrap mt">
        <div class="field grow" style="min-width:200px"><label class="fld">Overall monthly budget (₹)</label><input id="bBudget" type="number" min="0" placeholder="0" value="${b.budget || ''}" /></div>
        <div class="field grow" style="min-width:200px"><label class="fld">Monthly savings goal (₹)</label><input id="bGoal" type="number" min="0" placeholder="0" value="${b.savings_goal || ''}" /></div>
      </div>
      <div class="spread">
        <button class="btn primary" id="bSave">${icon('check')} Save changes</button>
        ${b.savings_goal > 0 ? `<span class="small muted">Keep spending under <strong style="color:var(--ink)">${money(b.budget - b.savings_goal)}</strong> to hit your ${money(b.savings_goal)} goal.</span>` : ''}
      </div>
    </div>

    <div class="card">
      <div class="card-head"><div><h3>${icon('target')} Category limits</h3>
        <div class="card-sub">Edit a limit and click away to save it.</div></div>
        <button class="btn sm" id="addCat">${icon('plus')} Add category</button></div>
      <div class="table-wrap mt">
        <table>
          <thead><tr><th>Category</th><th>Spent</th><th>Progress</th><th>Limit (₹)</th><th></th></tr></thead>
          <tbody id="catRows"></tbody>
        </table>
      </div>
    </div>`;

  $('#bSave').onclick = async () => {
    await apiPost('budget', { action: 'set', budget: $('#bBudget').value || 0, savings_goal: $('#bGoal').value || 0 });
    toast('Budget saved'); render();
  };
  $('#addCat').onclick = addCategoryModal;

  const rows = $('#catRows');
  rows.innerHTML = catCache.map((c) => {
    const lim = Number(c.monthly_limit) || 0;
    const pct = lim > 0 ? Math.min(100, (c.spent / lim) * 100) : 0;
    const cls = pct >= 100 ? 'over' : pct >= 80 ? 'warn' : '';
    return `<tr>
      <td><div class="cell-cat"><span class="em">${icon(c.icon)}</span>${esc(c.name)}</div></td>
      <td class="num ${lim > 0 && c.spent > lim ? 'neg' : ''}">${money(c.spent)}</td>
      <td style="min-width:120px">${lim > 0
        ? `<div class="progress thin ${cls}" style="margin:0"><div style="width:${pct}%"></div></div>`
        : '<span class="small muted">No limit</span>'}</td>
      <td><input type="number" min="0" value="${lim}" data-lim="${c.id}" style="width:104px" /></td>
      <td class="right"><button class="btn-icon" data-cdel="${c.id}" aria-label="Delete category">${icon('trash')}</button></td>
    </tr>`;
  }).join('') || `<tr><td colspan="5">${emptyState('No categories yet', 'Add one to start setting limits.')}</td></tr>`;

  $$('[data-lim]', rows).forEach((i) => i.onblur = async () => {
    const c = catCache.find((x) => x.id == i.dataset.lim);
    if (Number(i.value) === Number(c.monthly_limit)) return;
    await apiPost('categories', { action: 'update', id: i.dataset.lim, monthly_limit: i.value, icon: c.icon });
    toast('Limit updated'); render();
  });
  $$('[data-cdel]', rows).forEach((b) => b.onclick = async () => {
    if (!confirm('Delete this category? Its expenses stay but become uncategorized.')) return;
    await apiPost('categories', { action: 'delete', id: b.dataset.cdel });
    toast('Category deleted'); render();
  });
}

function addCategoryModal() {
  let chosen = 'package';
  openModal('Add category', `
    <div class="field"><label class="fld">Name</label><input id="cName" placeholder="e.g. Fitness" /></div>
    <div class="field">
      <label class="fld">Icon</label>
      <div class="icon-pick" id="cIcons">${window.CATEGORY_ICONS.map((n) => `
        <button type="button" class="icon-pick-btn ${n === chosen ? 'on' : ''}" data-ico="${n}" aria-label="${n}">${icon(n)}</button>`).join('')}</div>
    </div>
    <div class="field"><label class="fld">Monthly limit (₹) <span class="muted" style="font-weight:500">(optional)</span></label><input id="cLim" type="number" min="0" value="0" /></div>
    <button class="btn primary block" id="cSave">${icon('plus')} Add category</button>
    <div class="err" id="cErr"></div>`,
    () => {
      $$('#cIcons [data-ico]').forEach((b) => b.onclick = () => {
        chosen = b.dataset.ico;
        $$('#cIcons [data-ico]').forEach((x) => x.classList.toggle('on', x === b));
      });
      $('#cSave').onclick = async () => {
        try {
          await apiPost('categories', { action: 'add', name: $('#cName').value, icon: chosen, monthly_limit: $('#cLim').value });
          closeModal(); toast('Category added'); render();
        } catch (e) { $('#cErr').textContent = e.message; }
      };
    });
}

/* ---------- RECURRING ---------- */
async function renderRecurring() {
  const rec = await apiGet('recurring');
  view.innerHTML = `
    <div class="toolbar">
      <p class="toolbar-note">Rent, subscriptions and mess fees. <strong>Post due now</strong> turns anything that has come due into a real expense.</p>
      <div class="actions">
        <button class="btn" id="runDue">${icon('repeat')} Post due now</button>
        <button class="btn primary" id="addRec">${icon('plus')} Add recurring</button>
      </div>
    </div>
    <div id="recList"></div>`;

  $('#addRec').onclick = recurringModal;
  $('#runDue').onclick = async () => {
    const r = await apiPost('recurring', { action: 'run' });
    toast(r.created ? `Posted ${r.created} expense${r.created > 1 ? 's' : ''}` : 'Nothing due yet');
    render();
  };

  const list = $('#recList');
  if (!rec.length) { list.innerHTML = emptyState('No recurring expenses', 'Add the bills that repeat every week or month.'); return; }
  list.innerHTML = rec.map((r) => `
    <div class="exp">
      <div class="exp-icon">${icon(r.icon || 'repeat')}</div>
      <div class="exp-main">
        <strong>${esc(r.description)}</strong>
        <div class="exp-meta">
          <span class="chip brand">${esc(r.category || 'Uncategorized')}</span>
          <span>${r.period === 'weekly' ? 'Every week' : 'Every month'}</span>
          <span class="dot"></span><span>Next ${dayLabel(r.next_date)}</span>
        </div>
      </div>
      <div class="exp-right">
        <div class="exp-amt">${money(r.amount)}</div>
        <button class="btn-icon" data-rdel="${r.id}" aria-label="Remove recurring expense">${icon('trash')}</button>
      </div>
    </div>`).join('');

  $$('[data-rdel]', list).forEach((b) => b.onclick = async () => {
    await apiPost('recurring', { action: 'delete', id: b.dataset.rdel });
    toast('Recurring removed'); render();
  });
}

function recurringModal() {
  openModal('Add recurring expense', `
    <div class="field"><label class="fld">Description</label><input id="rDesc" placeholder="e.g. Hostel mess fee" /></div>
    <div class="row">
      <div class="field grow"><label class="fld">Amount (₹)</label><input id="rAmt" type="number" min="0" step="any" placeholder="0" /></div>
      <div class="field grow"><label class="fld">Repeats</label><select id="rPeriod"><option value="monthly">Monthly</option><option value="weekly">Weekly</option></select></div>
    </div>
    <div class="row">
      <div class="field grow"><label class="fld">Category</label><select id="rCat">${catOptions()}</select></div>
      <div class="field grow"><label class="fld">First / next date</label><input id="rDate" type="date" value="${today()}" /></div>
    </div>
    <button class="btn primary block" id="rSave">${icon('check')} Save recurring</button>
    <div class="err" id="rErr"></div>`,
    () => {
      $('#rSave').onclick = async () => {
        try {
          await apiPost('recurring', {
            action: 'add', description: $('#rDesc').value, amount: $('#rAmt').value,
            category_id: $('#rCat').value, period: $('#rPeriod').value, next_date: $('#rDate').value,
          });
          closeModal(); toast('Recurring saved'); render();
        } catch (e) { $('#rErr').textContent = e.message; }
      };
    });
}

/* ---------- IMPORT STATEMENT ---------- */
const imp = { text: '', fileName: '', data: null, chosen: new Set() };

function renderImport() {
  view.innerHTML = `
    <div class="card">
      <div class="card-head"><div><h3>${icon('download')} Import a bank statement</h3>
        <div class="card-sub">Download a CSV statement from your net banking, then drop it here. Nothing is uploaded anywhere — it is parsed by your own SpendSense server.</div></div></div>
      <div class="dropzone" id="dropzone" tabindex="0" role="button" aria-label="Choose a statement file">
        <div class="dz-ico">${icon('receipt')}</div>
        <strong>Drop your CSV statement here</strong>
        <span class="small muted">or click to choose a file · .csv, .txt</span>
        <input type="file" id="fileInput" accept=".csv,.txt,text/csv,text/plain" hidden />
      </div>
      <details class="paste-wrap">
        <summary>Or paste the rows instead ${icon('chevron-down', 'ico ico-sm')}</summary>
        <textarea id="pasteBox" rows="5" placeholder="Date,Description,Amount&#10;2026-10-28,Coffee,-180"></textarea>
        <button class="btn sm mt" id="pasteBtn">${icon('check')} Parse pasted text</button>
      </details>
      <div class="err" id="impErr"></div>
    </div>
    <div id="impResult"></div>`;

  const dz = $('#dropzone'), input = $('#fileInput');
  dz.onclick = () => input.click();
  dz.onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); input.click(); } };
  input.onchange = () => input.files[0] && readFile(input.files[0]);
  ['dragenter', 'dragover'].forEach((ev) => dz.addEventListener(ev, (e) => {
    e.preventDefault(); dz.classList.add('over');
  }));
  ['dragleave', 'drop'].forEach((ev) => dz.addEventListener(ev, (e) => {
    e.preventDefault(); if (ev === 'dragleave' && dz.contains(e.relatedTarget)) return;
    dz.classList.remove('over');
  }));
  dz.addEventListener('drop', (e) => { const f = e.dataTransfer.files[0]; if (f) readFile(f); });
  $('#pasteBtn').onclick = () => {
    const t = $('#pasteBox').value.trim();
    if (!t) return;
    imp.text = t; imp.fileName = 'pasted rows'; analyze();
  };
}

function readFile(file) {
  if (file.size > 3_000_000) { $('#impErr').textContent = 'That file is larger than 3 MB.'; return; }
  const fr = new FileReader();
  fr.onload = () => { imp.text = String(fr.result || ''); imp.fileName = file.name; analyze(); };
  fr.onerror = () => { $('#impErr').textContent = 'Could not read that file.'; };
  fr.readAsText(file);
}

async function analyze(overrides = {}) {
  const box = $('#impResult');
  $('#impErr').textContent = '';
  box.innerHTML = `<div class="skeleton card-sk"></div>`;
  try {
    imp.data = await apiPost('import/analyze', {
      text: imp.text,
      mapping: overrides.mapping,
      dayFirst: overrides.dayFirst,
    });
    imp.chosen = new Set(imp.data.rows
      .map((r, i) => (r.direction === 'debit' && !r.duplicate ? i : -1)).filter((i) => i >= 0));
    paintPreview();
  } catch (e) {
    box.innerHTML = '';
    $('#impErr').textContent = e.message;
  }
}

function paintPreview() {
  const d = imp.data;
  const dupes = d.rows.filter((r) => r.duplicate).length;
  const credits = d.rows.filter((r) => r.direction === 'credit').length;
  const opt = (sel, val) => `<option value="${val || ''}" ${sel === val ? 'selected' : ''}>${esc(val || '— none —')}</option>`;
  const colSelect = (id, key) => `<select id="${id}" data-map="${key}">
      ${['', ...d.headers].map((h) => opt(d.mapping[key] || '', h)).join('')}</select>`;

  $('#impResult').innerHTML = `
    <div class="card">
      <div class="card-head"><div><h3>${icon('settings')} Column mapping</h3>
        <div class="card-sub">Read <strong>${esc(imp.fileName)}</strong> · ${d.totalRows} rows found. Adjust if a column was guessed wrong.</div></div></div>
      <div class="map-grid mt">
        <label class="fld">Date${colSelect('mDate', 'date')}</label>
        <label class="fld">Description${colSelect('mDesc', 'description')}</label>
        <label class="fld">Money out${colSelect('mDebit', 'debit')}</label>
        <label class="fld">Money in${colSelect('mCredit', 'credit')}</label>
        <label class="fld">Single amount${colSelect('mAmount', 'amount')}</label>
        <label class="fld">Date order
          <select id="mDayFirst">
            <option value="true" ${d.dayFirst ? 'selected' : ''}>Day first (31/12/2026)</option>
            <option value="false" ${!d.dayFirst ? 'selected' : ''}>Month first (12/31/2026)</option>
          </select></label>
      </div>
      ${d.skipped.noDate || d.skipped.noAmount ? `<div class="alert warn mt">${icon('alert-triangle', 'ico ico-sm')}
        <span>${d.skipped.noDate} row(s) had no readable date and ${d.skipped.noAmount} had no amount. They were left out.</span></div>` : ''}
    </div>

    <div class="card">
      <div class="card-head"><div><h3>${icon('receipt')} Preview</h3>
        <div class="card-sub">Only money-out rows are ticked by default. ${dupes ? `${dupes} look like expenses you already have.` : ''} ${credits ? `${credits} incoming payment(s) were left out.` : ''}</div></div>
        <div class="actions">
          <button class="btn sm ghost" id="selAll">Select all</button>
          <button class="btn sm ghost" id="selNone">Clear</button>
        </div>
      </div>
      <div class="table-wrap mt">
        <table>
          <thead><tr><th style="width:34px"></th><th>Date</th><th>Description</th><th class="right">Amount</th><th>Category</th><th></th></tr></thead>
          <tbody id="impRows"></tbody>
        </table>
      </div>
      ${d.truncated ? `<p class="small muted mt">Showing the first 500 rows.</p>` : ''}
    </div>

    <div class="import-bar">
      <div><strong id="impCount">0</strong> <span class="muted small">selected</span>
        <span class="muted small">·</span> <strong id="impTotal" class="num">₹0</strong></div>
      <button class="btn primary" id="impGo">${icon('check')} Import selected</button>
    </div>`;

  const tbody = $('#impRows');
  tbody.innerHTML = d.rows.map((r, i) => `
    <tr class="${r.duplicate ? 'is-dupe' : ''} ${r.direction === 'credit' ? 'is-credit' : ''}">
      <td><input type="checkbox" data-row="${i}" ${imp.chosen.has(i) ? 'checked' : ''} /></td>
      <td class="num">${dayLabel(r.date)}</td>
      <td>${esc(r.description)}</td>
      <td class="right num"><strong>${money(r.amount)}</strong></td>
      <td><select data-cat="${i}">
        <option value="">Uncategorised</option>
        ${catCache.map((c) => `<option value="${c.id}" ${c.id == r.category_id ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}
      </select></td>
      <td>${r.duplicate ? `<span class="chip">Already added</span>`
            : r.direction === 'credit' ? `<span class="chip">Money in</span>` : ''}</td>
    </tr>`).join('');

  $$('[data-row]', tbody).forEach((cb) => cb.onchange = () => {
    const i = Number(cb.dataset.row);
    cb.checked ? imp.chosen.add(i) : imp.chosen.delete(i);
    updateBar();
  });
  $$('[data-cat]', tbody).forEach((sel) => sel.onchange = () => {
    d.rows[Number(sel.dataset.cat)].category_id = sel.value ? Number(sel.value) : null;
  });
  $('#selAll').onclick = () => { d.rows.forEach((_, i) => imp.chosen.add(i)); repaintChecks(); };
  $('#selNone').onclick = () => { imp.chosen.clear(); repaintChecks(); };
  $$('[data-map]').forEach((sel) => sel.onchange = () => {
    const mapping = {};
    $$('[data-map]').forEach((x) => { mapping[x.dataset.map] = x.value || null; });
    analyze({ mapping, dayFirst: $('#mDayFirst').value === 'true' });
  });
  $('#mDayFirst').onchange = () => {
    const mapping = {};
    $$('[data-map]').forEach((x) => { mapping[x.dataset.map] = x.value || null; });
    analyze({ mapping, dayFirst: $('#mDayFirst').value === 'true' });
  };
  $('#impGo').onclick = commitImport;
  updateBar();
}

function repaintChecks() {
  $$('[data-row]').forEach((cb) => { cb.checked = imp.chosen.has(Number(cb.dataset.row)); });
  updateBar();
}

function updateBar() {
  const rows = [...imp.chosen].map((i) => imp.data.rows[i]).filter(Boolean);
  const total = rows.reduce((s, r) => s + r.amount, 0);
  $('#impCount').textContent = rows.length;
  $('#impTotal').textContent = money(total);
  $('#impGo').disabled = !rows.length;
}

async function commitImport() {
  const rows = [...imp.chosen].map((i) => imp.data.rows[i]).filter(Boolean)
    .map((r) => ({ date: r.date, description: r.description, amount: r.amount, category_id: r.category_id }));
  if (!rows.length) return;
  const btn = $('#impGo');
  btn.classList.add('loading'); btn.disabled = true;
  try {
    const res = await apiPost('import/commit', { rows });
    toast(`Imported ${res.imported} expense${res.imported === 1 ? '' : 's'}`);
    imp.data = null; imp.text = '';
    state.tab = 'expenses';
    $$('#tabs .nav-item').forEach((x) => x.classList.toggle('active', x.dataset.tab === 'expenses'));
    render();
  } catch (e) {
    btn.classList.remove('loading'); btn.disabled = false;
    toast(e.message, 'error');
  }
}

/* ---------- ROOMMATES ---------- */
async function renderRoommates() {
  const d = await apiGet('shared');
  view.innerHTML = `
    <div class="toolbar">
      <div class="pills">${d.members.map((m) => `<span class="pill"><span class="avatar sm">${esc(m.name[0].toUpperCase())}</span>${esc(m.name)}</span>`).join('')
        || '<span class="small muted">No members yet — add two to start splitting.</span>'}</div>
      <div class="actions">
        <button class="btn" id="addMem">${icon('users')} Add member</button>
        <button class="btn primary" id="addShared">${icon('plus')} Shared expense</button>
      </div>
    </div>

    <div class="card">
      <div class="card-head"><h3>${icon('split')} Who owes what</h3></div>
      <div class="mt" id="balList"></div>
    </div>

    ${d.settle.length ? `<div class="card">
      <div class="card-head"><div><h3>${icon('check')} Simplest way to settle up</h3>
        <div class="card-sub">${d.settle.length} transfer${d.settle.length > 1 ? 's' : ''} clear${d.settle.length > 1 ? '' : 's'} every balance.</div></div></div>
      <div class="mt">${d.settle.map((t) => `<div class="settle-row">
        <span class="avatar sm">${esc(t.from[0].toUpperCase())}</span><strong>${esc(t.from)}</strong>
        ${icon('arrow-right', 'ico ico-sm')}
        <span class="avatar sm">${esc(t.to[0].toUpperCase())}</span><strong>${esc(t.to)}</strong>
        <span class="grow"></span><span class="amt">${money(t.amount)}</span></div>`).join('')}</div>
    </div>` : ''}

    <div class="card">
      <div class="card-head"><h3>${icon('receipt')} Shared expenses</h3></div>
      <div class="mt" id="sharedList"></div>
    </div>`;

  $('#addMem').onclick = () => openModal('Add member', `
    <div class="field"><label class="fld">Name</label><input id="mName" placeholder="e.g. Rohan" /></div>
    <button class="btn primary block" id="mSave">${icon('plus')} Add member</button>
    <div class="err" id="mErr"></div>`, () => {
    $('#mSave').onclick = async () => {
      if (!$('#mName').value.trim()) { $('#mErr').textContent = 'Enter a name.'; return; }
      try {
        await apiPost('shared', { action: 'add_member', name: $('#mName').value });
        closeModal(); toast('Member added'); render();
      } catch (e) { $('#mErr').textContent = e.message; }
    };
  });
  $('#addShared').onclick = () => sharedExpenseModal(d.members);

  $('#balList').innerHTML = d.balances.map((b) => {
    const cls = b.net > 0.01 ? 'pos' : b.net < -0.01 ? 'neg' : 'zero';
    const txt = b.net > 0.01 ? `gets back ${money(b.net)}` : b.net < -0.01 ? `owes ${money(-b.net)}` : 'all settled';
    return `<div class="bal">
      <div class="who-row"><span class="avatar">${esc(b.name[0].toUpperCase())}</span>${esc(b.name)}</div>
      <span class="bal-amt ${cls}">${txt}</span></div>`;
  }).join('') || emptyState('Nothing to split yet', 'Add members, then log a shared expense.');

  const sl = $('#sharedList');
  sl.innerHTML = d.expenses.map((e) => `
    <div class="exp">
      <div class="exp-icon">${icon('users')}</div>
      <div class="exp-main"><strong>${esc(e.description)}</strong>
        <div class="exp-meta"><span class="chip">${esc(e.paid_by_name)} paid</span><span>${dayLabel(e.date)}</span></div></div>
      <div class="exp-right">
        <div class="exp-amt">${money(e.amount)}</div>
        <button class="btn-icon" data-sdel="${e.id}" aria-label="Delete shared expense">${icon('trash')}</button>
      </div>
    </div>`).join('') || emptyState('No shared expenses', 'Split a pizza night or the electricity bill.');

  $$('[data-sdel]', sl).forEach((b) => b.onclick = async () => {
    await apiPost('shared', { action: 'delete_expense', id: b.dataset.sdel });
    toast('Shared expense deleted'); render();
  });
}

function sharedExpenseModal(members) {
  if (members.length < 2) { toast('Add at least 2 members first'); return; }
  openModal('Add shared expense', `
    <div class="field"><label class="fld">Description</label><input id="hDesc" placeholder="e.g. Pizza night" /></div>
    <div class="row">
      <div class="field grow"><label class="fld">Amount (₹)</label><input id="hAmt" type="number" min="0" step="any" placeholder="0" /></div>
      <div class="field grow"><label class="fld">Paid by</label><select id="hPaid">${members.map((m) => `<option value="${m.id}">${esc(m.name)}</option>`).join('')}</select></div>
    </div>
    <div class="field"><label class="fld">Split equally between</label>
      <div class="who">${members.map((m) => `<label><input type="checkbox" value="${m.id}" checked /> ${esc(m.name)}</label>`).join('')}</div></div>
    <button class="btn primary block" id="hSave">${icon('plus')} Add shared expense</button>
    <div class="err" id="hErr"></div>`,
    () => {
      $('#hSave').onclick = async () => {
        const ids = $$('.who input:checked').map((c) => c.value);
        try {
          await apiPost('shared', {
            action: 'add_expense', description: $('#hDesc').value, amount: $('#hAmt').value,
            paid_by: $('#hPaid').value, member_ids: ids,
          });
          closeModal(); toast('Shared expense added'); render();
        } catch (e) { $('#hErr').textContent = e.message; }
      };
    });
}

render();

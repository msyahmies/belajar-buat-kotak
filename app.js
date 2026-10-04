// Shop Sales Tracker — data is kept in localStorage and (optionally) synced
// to Google Sheet through Google Apps Script (see apps-script/Code.gs).

const CATEGORIES = ['Work Shirt', 'Family Day Shirt', 'Sports Shirt', 'Birthday Shirt'];
const PRINTINGS = ['DTF', 'Sublimation'];
// Operation costs are bought as needed (daily); overheads are fixed monthly costs.
const OPERATION_COSTS = ['Blank Shirts', 'DTF Sticker / Film', 'Sublimation Paper & Ink', 'Ink', 'Plastic / Packaging', 'Delivery / Postage', 'Advertising / Ads', 'Machine Maintenance', 'Other Operation Cost'];
const OVERHEAD_COSTS = ['Shop Rent', 'Staff Salary', 'Electricity & Water', 'Internet & Phone', 'Other Overhead'];
const SOURCES = ['WhatsApp', 'Facebook', 'Instagram', 'TikTok', 'Walk-in', 'Referral', 'Returning Customer', 'Others'];

// Names used by the earlier Malay version, so records saved before still group correctly.
const LEGACY_NAMES = {
  'Baju Pekerja': 'Work Shirt', 'Baju Family Day': 'Family Day Shirt', 'Baju Sukan': 'Sports Shirt', 'Baju Birthday': 'Birthday Shirt',
  'Customer Lama': 'Returning Customer', 'Lain-lain': 'Others',
  'Sewa Kedai': 'Shop Rent', 'Gaji Staff': 'Staff Salary', 'Bil Elektrik & Air': 'Electricity & Water', 'Internet & Telefon': 'Internet & Phone',
  'Baju Kosong / Bahan': 'Blank Shirts', 'Blank Shirts / Materials': 'Blank Shirts', 'Ink & Film': 'DTF Sticker / Film', 'Iklan / Ads': 'Advertising / Ads', 'Penghantaran / Pos': 'Delivery / Postage',
  'Penyelenggaraan Mesin': 'Machine Maintenance',
};
const rename = v => LEGACY_NAMES[v] ?? v;

// All dates and times follow Kuala Lumpur time (GMT+8), whatever the device clock is set to.
const TIME_ZONE = 'Asia/Kuala_Lumpur';
const klDate = d => new Intl.DateTimeFormat('en-CA', { timeZone: TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);

// Google Sheet may turn "2026-10-02" into a full date string; bring it back to yyyy-mm-dd.
function normDate(v) {
  const s = String(v ?? '');
  if (!s || /^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const d = new Date(s);
  return isNaN(d) ? s : klDate(d);
}

function normalizeEntries(list) {
  list.forEach(e => {
    e.date = normDate(e.date);
    e.createdAt = String(e.createdAt ?? '');
    e.lines.forEach(l => { l.category = rename(l.category); l.source = rename(l.source); l.delivery = normDate(l.delivery); l.orderDate = normDate(l.orderDate); });
  });
  return list;
}
function normalizeExpenses(list) {
  list.forEach(x => { x.date = normDate(x.date); x.createdAt = String(x.createdAt ?? ''); x.category = rename(x.category); });
  return list;
}

const LS_ENTRIES = 'sales.entries';
const LS_SETTINGS = 'sales.settings';
const LS_EXPENSES = 'sales.expenses';
const LS_JOBS = 'sales.jobs';
const LS_OVERHEAD = 'sales.overhead';
const LS_PIN = 'sales.pinHash';
const LS_KEEP_UNLOCKED = 'sales.keepUnlocked';
const SS_UNLOCKED = 'sales.unlocked';
const OWNER_TABS = ['expenses', 'overhead', 'reports', 'leads', 'settings'];
const OVERHEAD_FIELDS = [
  { key: 'rent', label: 'Shop rent' },
  { key: 'salary', label: 'Staff salary' },
  { key: 'statutory', label: 'EPF (KWSP) + SOCSO/EIS' },
  { key: 'electric', label: 'Electricity' },
  { key: 'shop', label: 'Shop expenses' },
  { key: 'ads', label: 'Advertising (leave 0 if keyed daily in Expenses)' },
  { key: 'owner', label: 'Your own salary' },
];
const STATUTORY_RATE = 0.13 + 0.0125; // employer EPF 13% + SOCSO/EIS ~1.25%

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

const rm = n => 'RM ' + (Number(n) || 0).toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const newId = () => crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random().toString(16).slice(2);

function todayStr() {
  return klDate(new Date());
}

function load(key, fallback) {
  try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; }
}
function save(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* storage full or blocked */ }
}

let entries = normalizeEntries(load(LS_ENTRIES, []));
let settings = load(LS_SETTINGS, { target: 0, syncUrl: '' });
let expenses = normalizeExpenses(load(LS_EXPENSES, []));
let jobs = load(LS_JOBS, {});
// Starting overhead for this shop; replaced as soon as the owner saves their own figures.
const DEFAULT_OVERHEAD = {
  rent: 650, salary: 3400, electric: 400, shop: 300, ads: 0, owner: 2500,
  items: [{ name: 'TEKUN loan', amount: 500 }], margin: 0,
};
let overhead = load(LS_OVERHEAD, null);
if (!overhead || !('rent' in overhead)) overhead = structuredClone(DEFAULT_OVERHEAD);

// Each overhead line with its amount, statutory contributions worked out from staff salary.
function overheadLines(o = overhead) {
  const v = k => Number(o[k]) || 0;
  const lines = OVERHEAD_FIELDS.map(f => ({ label: f.label, amount: f.key === 'statutory' ? Math.round(v('salary') * STATUTORY_RATE * 100) / 100 : v(f.key) }));
  return lines.concat((o.items || []).filter(i => i.name).map(i => ({ label: i.name, amount: Number(i.amount) || 0 })));
}

// ---------- Sync (Google Apps Script) ----------

async function remote(payload) {
  // text/plain avoids a CORS preflight, which Apps Script does not support.
  let data;
  try {
    const res = await fetch(settings.syncUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(payload),
    });
    data = await res.json();
  } catch {
    throw new Error('Cannot reach Google Sheet. Open the Apps Script URL in a new tab: it should say "Shop Sales Tracker is connected". If not, redeploy the latest Code.gs (see README).');
  }
  if (!data.ok) throw new Error(data.error || 'Server error');
  return data;
}

function setSyncStatus(text, isErr = false) {
  const el = $('#sync-status');
  el.textContent = text;
  el.style.color = isErr ? 'var(--danger)' : '';
}

async function pull() {
  if (!settings.syncUrl) { setSyncStatus('Offline mode (data saved on this device)'); return; }
  setSyncStatus('Loading data…');
  try {
    const data = await remote({ action: 'list' });
    entries = normalizeEntries(data.entries);
    expenses = normalizeExpenses(data.expenses || []);
    save(LS_EXPENSES, expenses);
    if (data.jobs) { jobs = data.jobs; save(LS_JOBS, jobs); }
    if (data.overhead && typeof data.overhead === 'object' && 'rent' in data.overhead) {
      overhead = { items: [], ...data.overhead };
      save(LS_OVERHEAD, overhead);
      setPinHash(data.overhead.pinHash || ''); // the sheet decides the PIN once it is synced
    }
    if (data.target != null) settings.target = Number(data.target) || 0;
    save(LS_ENTRIES, entries);
    save(LS_SETTINGS, settings);
    setSyncStatus('Synced ' + new Date().toLocaleTimeString('en-MY', { timeZone: TIME_ZONE }));
  } catch (e) {
    setSyncStatus('Sync failed: ' + e.message, true);
  }
  renderAll();
}

// ---------- Calculations ----------

function entryTotals(e) {
  return e.lines.reduce((t, l) => ({ pcs: t.pcs + Number(l.qty), sales: t.sales + Number(l.amount) }), { pcs: 0, sales: 0 });
}

function summarize(list) {
  const out = { sales: 0, pcs: 0, leads: 0, converted: 0, deposit: 0, byCategory: {}, byPrinting: {}, bySource: {} };
  CATEGORIES.forEach(c => out.byCategory[c] = { pcs: 0, sales: 0 });
  PRINTINGS.forEach(p => out.byPrinting[p] = { pcs: 0, sales: 0 });
  for (const e of list) {
    out.leads += Number(e.leads) || 0;
    out.converted += Number(e.converted) || 0;
    e.lines.forEach((l, i) => {
      const qty = Number(l.qty) || 0, amt = Number(l.amount) || 0;
      out.pcs += qty;
      out.sales += amt;
      (out.byCategory[l.category] ??= { pcs: 0, sales: 0 });
      out.byCategory[l.category].pcs += qty;
      out.byCategory[l.category].sales += amt;
      (out.byPrinting[l.printing] ??= { pcs: 0, sales: 0 });
      out.byPrinting[l.printing].pcs += qty;
      out.byPrinting[l.printing].sales += amt;
      out.deposit += lineDeposit(e, i);
      const src = l.source || 'None';
      (out.bySource[src] ??= { orders: 0, sales: 0 });
      out.bySource[src].orders += 1;
      out.bySource[src].sales += amt;
    });
  }
  return out;
}

// ---------- Dashboard ----------

const convRate = s => s.leads ? (s.converted / s.leads * 100).toFixed(1) + '%' : '-';

function renderDashboard() {
  const date = $('#dash-date').value || todayStr();
  const month = date.slice(0, 7);

  const day = summarize(entries.filter(e => e.date === date));
  $('#d-pcs').textContent = day.pcs;
  $('#d-orders').textContent = entries.filter(e => e.date === date).reduce((n, e) => n + e.lines.length, 0);

  const mon = summarize(entries.filter(e => e.date.startsWith(month)));
  const target = Number(settings.target) || 0;
  const balance = Math.max(target - mon.sales, 0);

  const [y, m, d] = date.split('-').map(Number);
  const daysInMonth = new Date(y, m, 0).getDate();
  const daysLeft = daysInMonth - d + 1; // including the selected day

  $('#m-label').textContent = new Date(y, m - 1, 1).toLocaleDateString('en-MY', { month: 'long', year: 'numeric' });
  $('#m-target').textContent = target ? rm(target) : 'Not set';
  $('#m-sales').textContent = rm(mon.sales);
  $('#m-deposit').textContent = rm(mon.deposit);
  $('#m-owed').textContent = rm(mon.sales - mon.deposit);
  $('#m-days').textContent = daysLeft;
  $('#m-balance').textContent = !target ? '-' : balance ? rm(balance) : 'Target reached!';
  $('#m-balance-sub').textContent = target ? `of ${rm(target)} target` : 'Set a target in the Settings tab';

  // Daily target = remaining target at the start of the selected day, divided by days left (including today).
  const salesBefore = summarize(entries.filter(e => e.date.startsWith(month) && e.date < date)).sales;
  const dailyTarget = target ? Math.max(target - salesBefore, 0) / daysLeft : 0;
  const dayBalance = Math.max(dailyTarget - day.sales, 0);
  const ratio = dailyTarget ? day.sales / dailyTarget : 1;

  $('#d-sales').textContent = rm(day.sales);
  $('#d-sales-sub').textContent = `${day.pcs} pcs`
    + (dailyTarget ? ` · ${Math.round(ratio * 100)}% of today's target` : '');
  $('#d-target').textContent = target ? rm(dailyTarget) : '-';
  $('#d-target-sub').textContent = target ? `${daysLeft} days left this month` : '';
  $('#d-balance').textContent = !target ? '-' : dayBalance ? rm(dayBalance) : "Today's target reached!";
  $('#d-balance-sub').textContent = !target ? '' : ratio >= 1 ? 'Well done!' : ratio >= 2 / 3 ? 'Almost there' : 'Keep pushing';
  const card = $('#d-balance-card');
  card.classList.toggle('c-green', !!target && ratio >= 1);
  card.classList.toggle('c-yellow', !!target && ratio >= 2 / 3 && ratio < 1);
  card.classList.toggle('c-red', !!target && ratio < 2 / 3);

  const pct = target ? Math.min(mon.sales / target * 100, 100) : 0;
  const bar = $('#m-bar');
  bar.style.width = pct + '%';
  bar.classList.toggle('done', pct >= 100);
  $('#m-pct').textContent = target ? `${(mon.sales / target * 100).toFixed(1)}% of target` : 'Set a target in the Settings tab.';

  const rows = obj => Object.entries(obj).map(([k, v]) =>
    `<tr><td>${esc(k)}</td><td class="num">${v.pcs}</td><td class="num">${rm(v.sales)}</td></tr>`).join('');
  $('#t-category tbody').innerHTML = rows(mon.byCategory);
  $('#t-printing tbody').innerHTML = rows(mon.byPrinting);
}

// ---------- Reports ----------

let reportMode = 'month';

const addDays = (d, n) => { const t = new Date(d + 'T00:00:00Z'); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10); };
const daysInMonthOf = d => new Date(Number(d.slice(0, 4)), Number(d.slice(5, 7)), 0).getDate();
const fmtDate = (d, opts) => new Date(d + 'T00:00:00Z').toLocaleDateString('en-MY', { timeZone: 'UTC', ...opts });

function reportRange() {
  const a = $('#rep-anchor').value || todayStr();
  if (reportMode === 'day') return { from: a, to: a, title: fmtDate(a, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }) };
  if (reportMode === 'week') {
    const dow = (new Date(a + 'T00:00:00Z').getUTCDay() + 6) % 7; // Monday = 0
    const from = addDays(a, -dow), to = addDays(from, 6);
    return { from, to, title: `Week ${fmtDate(from, { day: 'numeric', month: 'short' })} – ${fmtDate(to, { day: 'numeric', month: 'short', year: 'numeric' })}` };
  }
  if (reportMode === 'month') {
    const from = a.slice(0, 7) + '-01';
    return { from, to: a.slice(0, 7) + '-' + String(daysInMonthOf(a)).padStart(2, '0'), title: fmtDate(from, { month: 'long', year: 'numeric' }) };
  }
  if (reportMode === 'year') return { from: a.slice(0, 4) + '-01-01', to: a.slice(0, 4) + '-12-31', title: 'Year ' + a.slice(0, 4) };
  let from = $('#rep-from').value || todayStr(), to = $('#rep-to').value || from;
  if (to < from) [from, to] = [to, from];
  return { from, to, title: `${fmtDate(from, { day: 'numeric', month: 'short', year: 'numeric' })} – ${fmtDate(to, { day: 'numeric', month: 'short', year: 'numeric' })}` };
}

// Costs for one day: daily expenses that day + that day's share of monthly expenses and of the overhead.
function buildReport() {
  const { from, to, title } = reportRange();
  const inRange = d => d >= from && d <= to;
  const overheadTotal = sumAmount(overheadLines());
  const monthly = expenses.filter(x => x.kind === 'bulanan');
  const days = [];
  for (let d = from; d <= to; d = addDays(d, 1)) days.push(d);
  const byMonth = days.length > 62;
  const periods = {};
  const costs = { 'Operation costs': 0, 'Monthly expenses (share)': 0, 'Overhead (share)': 0 };
  const costByCat = {};

  const today = todayStr();
  for (const d of days) {
    const key = byMonth ? d.slice(0, 7) : d;
    const p = (periods[key] ??= { orders: 0, pcs: 0, sales: 0, costs: 0 });
    if (d > today) continue; // fixed costs are only counted for days that have happened
    const dim = daysInMonthOf(d);
    const share = sumAmount(monthly.filter(x => x.date.slice(0, 7) === d.slice(0, 7))) / dim;
    const oh = overheadTotal / dim;
    p.costs += share + oh;
    costs['Monthly expenses (share)'] += share;
    costs['Overhead (share)'] += oh;
  }
  const list = entries.filter(e => inRange(e.date));
  for (const e of list) {
    const p = periods[byMonth ? e.date.slice(0, 7) : e.date];
    p.orders += e.lines.length;
    e.lines.forEach(l => { p.pcs += Number(l.qty) || 0; p.sales += Number(l.amount) || 0; });
  }
  for (const x of expenses.filter(x => x.kind !== 'bulanan' && inRange(x.date))) {
    periods[byMonth ? x.date.slice(0, 7) : x.date].costs += Number(x.amount) || 0;
    costs['Operation costs'] += Number(x.amount) || 0;
    costByCat[x.category] = (costByCat[x.category] || 0) + (Number(x.amount) || 0);
  }
  const sum = summarize(list);
  const totalCost = Object.values(costs).reduce((a, b) => a + b, 0);
  return { from, to, title, byMonth, periods, sum, list, costs, costByCat, totalCost, net: sum.sales - totalCost,
    orders: list.reduce((n, e) => n + e.lines.length, 0) };
}

function renderReport() {
  const r = buildReport();
  const periodLabel = k => (r.byMonth ? fmtDate(k + '-01', { month: 'short', year: 'numeric' }) : fmtDate(k, { weekday: 'short', day: 'numeric', month: 'short' }));
  $('#rep-title').textContent = r.title;
  $('#rep-net-label').textContent = r.net >= 0 ? 'Net Profit' : 'Net Loss';
  $('#rep-net').textContent = rm(Math.abs(r.net));
  $('#rep-net-sub').textContent = `Sales ${rm(r.sum.sales)} − costs ${rm(r.totalCost)}` + (r.sum.sales ? ` · margin ${(r.net / r.sum.sales * 100).toFixed(1)}%` : '');
  setProfitCard($('#rep-net-card'), r.net);
  $('#rep-sales').textContent = rm(r.sum.sales);
  $('#rep-sales-sub').textContent = `${r.orders} orders`;
  $('#rep-cost').textContent = rm(r.totalCost);
  $('#rep-cost-sub').textContent = `Operation ${rm(r.costs['Operation costs'])} · overhead ${rm(r.costs['Overhead (share)'] + r.costs['Monthly expenses (share)'])}`;
  $('#rep-deposit').textContent = rm(r.sum.deposit);
  $('#rep-owed').textContent = `Balance unpaid ${rm(r.sum.sales - r.sum.deposit)}`;
  $('#rep-orders').textContent = r.orders;
  $('#rep-pcs').textContent = r.sum.pcs;
  $('#rep-leads').textContent = `${r.sum.leads} / ${r.sum.converted}`;
  $('#rep-rate').textContent = convRate(r.sum);

  $('#rep-break-title').textContent = r.byMonth ? 'By Month' : 'By Day';
  const rows = Object.entries(r.periods);
  const tot = rows.reduce((t, [, v]) => ({ orders: t.orders + v.orders, pcs: t.pcs + v.pcs, sales: t.sales + v.sales, costs: t.costs + v.costs }), { orders: 0, pcs: 0, sales: 0, costs: 0 });
  const row = (label, v, cls = '') => `<tr class="${cls}"><td>${label}</td><td class="num">${v.orders}</td><td class="num">${v.pcs}</td><td class="num">${rm(v.sales)}</td><td class="num">${rm(v.costs)}</td><td class="num${v.sales - v.costs < 0 ? ' neg' : ''}">${v.sales - v.costs < 0 ? '−' : ''}${rm(Math.abs(v.sales - v.costs))}</td></tr>`;
  $('#t-rep-period tbody').innerHTML = rows.map(([k, v]) => row(periodLabel(k), v)).join('') + row('Total', tot, 'total');

  const pcsRows = obj => Object.entries(obj).filter(([, v]) => v.pcs || v.sales)
    .map(([k, v]) => `<tr><td>${esc(k)}</td><td class="num">${v.pcs}</td><td class="num">${rm(v.sales)}</td></tr>`).join('') || '<tr><td colspan="3" class="muted">No sales.</td></tr>';
  $('#t-rep-cat tbody').innerHTML = pcsRows(r.sum.byCategory);
  $('#t-rep-print tbody').innerHTML = pcsRows(r.sum.byPrinting);
  $('#t-rep-source tbody').innerHTML = Object.entries(r.sum.bySource).sort((a, b) => b[1].sales - a[1].sales)
    .map(([k, v]) => `<tr><td>${esc(k)}</td><td class="num">${v.orders}</td><td class="num">${rm(v.sales)}</td></tr>`).join('') || '<tr><td colspan="3" class="muted">No orders.</td></tr>';
  const costRows = Object.entries(r.costByCat).sort((a, b) => b[1] - a[1]).map(([k, v]) => [k, v])
    .concat([['Monthly expenses (share)', r.costs['Monthly expenses (share)']], ['Overhead (share)', r.costs['Overhead (share)']]]).filter(([, v]) => v);
  $('#t-rep-costs tbody').innerHTML = costRows.map(([k, v]) => `<tr><td>${esc(k)}</td><td class="num">${rm(v)}</td></tr>`).join('')
    + `<tr><td><b>Total</b></td><td class="num"><b>${rm(r.totalCost)}</b></td></tr>`;
  $('#rep-note').textContent = 'Overhead is spread evenly over each day of the month (amounts from the Overhead tab) and only counted up to today.';
}

function setReportMode(mode) {
  reportMode = mode;
  $$('#rep-mode button').forEach(b => b.classList.toggle('on', b.dataset.mode === mode));
  $('#rep-anchor-wrap').hidden = mode === 'custom';
  $('#rep-from-wrap').hidden = $('#rep-to-wrap').hidden = mode !== 'custom';
  renderReport();
}

function exportReportCsv() {
  const r = buildReport();
  const out = [['Report', r.title], ['From', r.from], ['To', r.to], [],
    ['Sales (RM)', r.sum.sales.toFixed(2)], ['Total costs (RM)', r.totalCost.toFixed(2)], ['Net profit (RM)', r.net.toFixed(2)],
    ['Orders', r.orders], ['Shirts sold', r.sum.pcs], ['Deposits (RM)', r.sum.deposit.toFixed(2)], ['Balance unpaid (RM)', (r.sum.sales - r.sum.deposit).toFixed(2)],
    ['Leads in', r.sum.leads], ['Leads converted', r.sum.converted], ['Conversion rate', convRate(r.sum)], [],
    [r.byMonth ? 'Month' : 'Date', 'Orders', 'Pcs', 'Sales (RM)', 'Costs (RM)', 'Profit (RM)']];
  Object.entries(r.periods).forEach(([k, v]) => out.push([k, v.orders, v.pcs, v.sales.toFixed(2), v.costs.toFixed(2), (v.sales - v.costs).toFixed(2)]));
  out.push([], ['Order date', 'Customer', 'Phone No.', 'Category', 'Printing', 'Qty', 'Total (RM)', 'Deposit (RM)', 'Lead source']);
  r.list.forEach(e => e.lines.forEach((l, i) => out.push([e.date, l.customer || '', l.phone ? `="${l.phone}"` : '', l.category, l.printing, l.qty, l.amount, lineDeposit(e, i), l.source || ''])));
  const csv = out.map(row => row.map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\r\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob(['\ufeff' + csv], { type: 'text/csv' }));
  a.download = `report-${r.from}-to-${r.to}.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
}

// ---------- Ads tab (ad spend + leads) ----------

function renderLeads() {
  const date = $('#leads-form').date.value || todayStr();
  renderAds(date);
  const month = date.slice(0, 7);
  const [y, m] = month.split('-').map(Number);
  const day = summarize(entries.filter(e => e.date === date));
  const monList = entries.filter(e => e.date.startsWith(month));
  const mon = summarize(monList);

  $('#ld-leads').textContent = day.leads;
  $('#ld-conv').textContent = day.converted;
  $('#ld-rate').textContent = convRate(day);
  $('#lm-label').textContent = new Date(y, m - 1, 1).toLocaleDateString('en-MY', { month: 'long', year: 'numeric' });
  $('#lm-leads').textContent = mon.leads;
  $('#lm-conv').textContent = mon.converted;
  $('#lm-rate').textContent = convRate(mon);

  // One row per day that has leads (older key-ins may carry leads together with orders).
  const byDay = {};
  monList.filter(e => Number(e.leads) || Number(e.converted)).forEach(e => {
    const d = (byDay[e.date] ??= { leads: 0, converted: 0, ids: [] });
    d.leads += Number(e.leads) || 0;
    d.converted += Number(e.converted) || 0;
    if (isLeadsOnly(e)) d.ids.push(e.id);
  });
  const days = Object.entries(byDay).sort((a, b) => b[0].localeCompare(a[0]));
  $('#t-leads tbody').innerHTML = days.length
    ? days.map(([d, v]) => `<tr><td>${d}</td><td class="num">${v.leads}</td><td class="num">${v.converted}</td><td class="num">${convRate(v)}</td>
        <td class="btn-cell"><button type="button" class="edit-btn" data-edit-day="${d}">✏️ Edit</button> ${v.ids.map(id => `<button class="danger" data-del="${esc(id)}">Delete</button>`).join('')}</td></tr>`).join('')
    : '<tr><td colspan="5" class="muted">No leads recorded this month.</td></tr>';

  const sources = Object.entries(mon.bySource).sort((a, b) => b[1].sales - a[1].sales);
  $('#t-source tbody').innerHTML = sources.length
    ? sources.map(([k, v]) => `<tr><td>${esc(k)}</td><td class="num">${v.orders}</td><td class="num">${rm(v.sales)}</td></tr>`).join('')
    : '<tr><td colspan="3" class="muted">No orders yet.</td></tr>';
}

// ---------- Key In form ----------

function addLine() {
  const node = $('#line-tpl').content.firstElementChild.cloneNode(true);
  $('[name=category]', node).innerHTML = CATEGORIES.map(c => `<option>${c}</option>`).join('');
  $('[name=printing]', node).innerHTML = PRINTINGS.map(p => `<option>${p}</option>`).join('');
  $('[name=source]', node).innerHTML = SOURCES.map(s => `<option>${s}</option>`).join('');
  $('.remove', node).addEventListener('click', () => {
    if ($$('#lines .line').length > 1) node.remove();
    updateFormTotal();
  });
  $('#lines').appendChild(node);
}

function readLines() {
  return $$('#lines .line').map(n => ({
    customer: $('[name=customer]', n).value.trim(),
    phone: $('[name=phone]', n).value.trim(),
    category: $('[name=category]', n).value,
    printing: $('[name=printing]', n).value,
    qty: Number($('[name=qty]', n).value) || 0,
    amount: Number($('[name=amount]', n).value) || 0,
    deposit: Number($('[name=deposit]', n).value) || 0,
    source: $('[name=source]', n).value,
    delivery: $('[name=delivery]', n).value,
    notes: $('[name=notes]', n).value.trim(),
  }));
}

function updateConvRate() {
  const f = $('#leads-form');
  f.convRate.value = convRate({ leads: Number(f.leads.value) || 0, converted: Number(f.converted.value) || 0 });
}

// ---------- Daily leads (kept apart from sales) ----------
// A leads record is a sale entry with no order rows; one per date.

const isLeadsOnly = e => !e.lines.length;
const leadsFor = date => entries.find(e => isLeadsOnly(e) && e.date === date);

// Ad spend keyed in on the Ads tab is one expense per date with id "ads-<date>".
// Other ads expenses that day (Meta auto import, Telegram, Expenses tab) are added on top.
const adSpendId = date => 'ads-' + date;
const adSpendFor = date => expenses.find(x => x.id === adSpendId(date));

// Lists the day's other ad spend records, each with its own Edit button.
function showOtherAdSpend(date) {
  const other = expenses.filter(x => x.date === date && x.category === ADS_CATEGORY && x.id !== adSpendId(date));
  $('#ads-other').innerHTML = other.length
    ? `Also recorded for this date (added on top):<br>` + other.map(x =>
      `${rm(x.amount)}${x.notes ? ` · ${esc(x.notes)}` : ''} <button type="button" class="edit-btn" data-edit-exp="${esc(x.id)}">✏️ Edit</button>`).join('<br>')
    : '';
}

function fillLeadsForm() {
  const f = $('#leads-form');
  const rec = leadsFor(f.date.value);
  const spend = adSpendFor(f.date.value);
  f.adSpend.value = spend ? spend.amount : 0;
  f.leads.value = rec ? rec.leads : 0;
  f.converted.value = rec ? rec.converted : 0;
  $('#leads-msg').className = 'msg';
  $('#leads-msg').textContent = rec || spend
    ? `Already saved for this date: ad spend ${rm(spend ? spend.amount : 0)}, ${rec ? rec.leads : 0} leads in, ${rec ? rec.converted : 0} converted.` : '';
  showOtherAdSpend(f.date.value);
  updateConvRate();
}

// Replace the day's ad spend expense: delete the old one, then add the new amount (if any).
async function saveAdSpend(date, amount) {
  const old = adSpendFor(date);
  if (old && Number(old.amount) === amount) return;
  if (old) {
    if (settings.syncUrl) await remote({ action: 'deleteExpense', id: old.id });
    expenses = expenses.filter(x => x.id !== old.id);
  }
  if (amount > 0) {
    const x = { id: adSpendId(date), date, kind: 'harian', category: ADS_CATEGORY, amount, notes: 'Ads tab', createdAt: new Date().toISOString() };
    if (settings.syncUrl) await remote({ action: 'addExpense', expense: x });
    expenses.push(x);
  }
  save(LS_EXPENSES, expenses);
}

async function onSubmitLeads(ev) {
  ev.preventDefault();
  const f = ev.target;
  const msg = $('#leads-msg');
  const existing = leadsFor(f.date.value);
  const rec = {
    id: existing ? existing.id : newId(),
    date: f.date.value,
    leads: Number(f.leads.value) || 0,
    converted: Number(f.converted.value) || 0,
    lines: [],
    createdAt: existing ? existing.createdAt : new Date().toISOString(),
  };
  const spend = Math.round((Number(f.adSpend.value) || 0) * 100) / 100;
  const btn = $('button[type=submit]', f);
  btn.disabled = true;
  try {
    await saveAdSpend(rec.date, spend);
    // No leads record yet and nothing to put in one: only the ad spend was keyed in.
    if (existing || rec.leads || rec.converted) {
      if (settings.syncUrl) await remote({ action: existing ? 'update' : 'add', entry: rec });
      entries = existing ? entries.map(e => (e.id === rec.id ? rec : e)) : [...entries, rec];
      save(LS_ENTRIES, entries);
    }
    renderAll();
    msg.className = 'msg ok';
    msg.textContent = `Saved for ${rec.date}: ad spend ${rm(spend)}, ${rec.leads} leads in, ${rec.converted} converted (${convRate(rec)}).`;
  } catch (e) {
    msg.className = 'msg err';
    msg.textContent = /Invalid action/.test(e.message)
      ? 'Not saved: update Code.gs in Google Sheet to the latest version first.'
      : 'Save failed: ' + e.message;
  } finally {
    btn.disabled = false;
  }
}

function updateFormTotal() {
  const t = entryTotals({ lines: readLines() });
  $('#f-pcs').textContent = t.pcs;
  $('#f-sales').textContent = rm(t.sales);
  for (const n of $$('#lines .line')) {
    const bal = (Number($('[name=amount]', n).value) || 0) - (Number($('[name=deposit]', n).value) || 0);
    const out = $('[name=balance]', n);
    out.value = rm(bal);
    out.classList.toggle('neg', bal < 0);
  }
}

function resetForm(keep) {
  const f = $('#entry-form');
  f.reset();
  f.date.value = keep?.date || todayStr();
  $('#lines').innerHTML = '';
  addLine();
  updateFormTotal();
}

async function onSubmitEntry(ev) {
  ev.preventDefault();
  const f = ev.target;
  const msg = $('#form-msg');
  const entry = {
    id: newId(),
    date: f.date.value,
    leads: 0,
    converted: 0,
    lines: readLines().map(l => ({ ...l, orderDate: f.date.value })),
    createdAt: new Date().toISOString(),
  };

  const btn = $('button[type=submit]', f);
  btn.disabled = true;
  try {
    if (settings.syncUrl) await remote({ action: 'add', entry });
    entries.push(entry);
    save(LS_ENTRIES, entries);
    msg.className = 'msg ok';
    msg.textContent = `Saved: ${rm(entryTotals(entry).sales)} for ${entry.date}`;
    resetForm();
    renderAll();
    $('#job-filter').value = entry.lines.some(l => l.deposit > 0) ? 'active' : 'waiting';
    renderJobs();
    showTab('jobs');
  } catch (e) {
    msg.className = 'msg err';
    msg.textContent = 'Save failed: ' + e.message;
  } finally {
    btn.disabled = false;
  }
}

// ---------- History ----------

function monthEntries() {
  const month = $('#hist-month').value || todayStr().slice(0, 7);
  return entries
    .filter(e => e.date.startsWith(month) && !isLeadsOnly(e))
    .sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt));
}

function lineDetail(l, deposit) {
  const parts = [
    `${l.customer ? `<b>${esc(l.customer)}</b>` : ''}${l.phone ? ` (${esc(l.phone)})` : ''}`,
    `${l.qty} × ${esc(l.category)} (${esc(l.printing)})${l.orderDate ? ` · ordered ${esc(l.orderDate)}` : ''}`,
    `Total ${rm(l.amount)} · Deposit ${rm(deposit)} · Balance ${rm((Number(l.amount) || 0) - deposit)}`,
  ];
  if (l.source) parts.push(`Source: ${esc(l.source)}`);
  if (l.delivery) parts.push(`Delivery: ${esc(l.delivery)}`);
  if (l.notes) parts.push(`Notes: ${esc(l.notes)}`);
  return parts.filter(Boolean).join('<br>');
}

function renderHistory() {
  const list = monthEntries();
  const tbody = $('#t-history tbody');
  if (!list.length) {
    tbody.innerHTML = '<tr><td colspan="4" class="muted">No sales for this month.</td></tr>';
    return;
  }
  tbody.innerHTML = list.map(e => {
    const t = entryTotals(e);
    const detail = e.lines.map((l, i) => lineDetail(l, lineDeposit(e, i))
      + ` <button type="button" class="edit-btn" data-edit="${esc(jobKey(e, i))}">✏️ Edit</button>`
      + ` <button type="button" class="danger small" data-del-line="${esc(jobKey(e, i))}">Delete</button>`).join('<hr>');
    return `<tr>
      <td>${e.date}</td>
      <td class="num">${t.pcs}</td><td class="num">${rm(t.sales)}</td>
      <td class="muted">${detail}</td>
    </tr>`;
  }).join('');
}

async function onDelete(id) {
  if (!isUnlocked()) { askPin(null); return; }
  const e = entries.find(x => x.id === id);
  if (!e || !confirm(`Delete record ${e.date} (${rm(entryTotals(e).sales)})?`)) return;
  try {
    if (settings.syncUrl) await remote({ action: 'delete', id });
    entries = entries.filter(x => x.id !== id);
    save(LS_ENTRIES, entries);
    renderAll();
  } catch (err) {
    alert('Delete failed: ' + err.message);
  }
}

// Delete one order (one job). A key-in can hold several orders, so the others stay;
// job progress is stored by row index, so the later rows' progress moves up one place.
async function onDeleteLine(key) {
  if (!isUnlocked()) { askPin(null); return; }
  const found = findLine(key);
  if (!found) return;
  const { entry, index, line } = found;
  if (!confirm(`Delete this order/job?\n${line.customer || '(no name)'} · ${line.qty} × ${line.category} · ${rm(line.amount)}\n\nThe sale is removed from the totals too.`)) return;
  const n = entry.lines.length;
  try {
    if (n === 1) {
      if (settings.syncUrl) await remote({ action: 'delete', id: entry.id });
      entries = entries.filter(e => e.id !== entry.id);
    } else {
      const updated = { ...entry, lines: entry.lines.filter((_, i) => i !== index) };
      if (settings.syncUrl) await remote({ action: 'update', entry: updated });
      entries = entries.map(e => (e.id === entry.id ? updated : e));
    }
    save(LS_ENTRIES, entries);
    const moved = [];
    for (let i = index; i < n - 1; i++) {
      const next = jobs[jobKey(entry, i + 1)];
      if (next) { jobs[jobKey(entry, i)] = next; moved.push(jobKey(entry, i)); } else delete jobs[jobKey(entry, i)];
    }
    delete jobs[jobKey(entry, n - 1)];
    save(LS_JOBS, jobs);
    renderAll();
    if (settings.syncUrl) {
      for (const k of moved) await saveJob(k, {});
      // Older Code.gs has no deleteJob; a leftover row there is harmless (no order uses that index any more).
      await remote({ action: 'deleteJob', id: jobKey(entry, n - 1) }).catch(() => {});
    }
  } catch (err) {
    alert(/Invalid action/.test(err.message)
      ? 'Not deleted: update Code.gs in Google Sheet to the latest version first (Deploy > Manage deployments > New version).'
      : 'Delete failed: ' + err.message);
  }
}

function exportCsv() {
  const header = ['Date', 'Order Date', 'Customer Name', 'Phone No.', 'Category', 'Printing', 'Quantity', 'Total (RM)', 'Deposit (RM)', 'Balance (RM)', 'Lead Source', 'Expected Delivery', 'Notes'];
  const rows = [header];
  // Phone is written as ="012..." so Excel keeps the leading 0.
  for (const e of monthEntries().reverse()) {
    e.lines.forEach((l, i) => rows.push([e.date, l.orderDate || e.date, l.customer || '', l.phone ? `="${l.phone}"` : '', l.category, l.printing, l.qty, l.amount, lineDeposit(e, i), (Number(l.amount) || 0) - lineDeposit(e, i), l.source || '', l.delivery || '', l.notes || '']));
  }
  const csv = rows.map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\r\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv' }));
  a.download = `sales-${$('#hist-month').value}.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
}

// ---------- Expenses / Profit & Loss ----------

const sumAmount = list => list.reduce((t, x) => t + (Number(x.amount) || 0), 0);

function setProfitCard(card, value) {
  card.classList.toggle('c-green', value >= 0);
  card.classList.toggle('c-red', value < 0);
}

function renderExpenses() {
  const date = $('#exp-date').value || todayStr();
  const month = date.slice(0, 7);
  const [y, m] = date.split('-').map(Number);
  const daysInMonth = new Date(y, m, 0).getDate();
  const monthName = new Date(y, m - 1, 1).toLocaleDateString('en-MY', { month: 'long', year: 'numeric' });

  const monExp = expenses.filter(x => x.date.startsWith(month));
  const monSales = summarize(entries.filter(e => e.date.startsWith(month))).sales;
  const monCost = sumAmount(monExp);
  const monProfit = monSales - monCost;

  $('#p-month-label').textContent = `${monProfit >= 0 ? 'Profit' : 'Loss'} for ${monthName}`;
  $('#p-month').textContent = rm(Math.abs(monProfit));
  $('#p-month-sub').textContent = `Sales ${rm(monSales)} − Expenses ${rm(monCost)}`
    + (monSales ? ` · margin ${(monProfit / monSales * 100).toFixed(1)}%` : '');
  setProfitCard($('#p-month-card'), monProfit);
  $('#p-sales').textContent = rm(monSales);
  $('#p-cost').textContent = rm(monCost);

  // Daily profit: that day's sales − that day's daily expenses − one day's share of monthly costs.
  // Expense kind is stored as 'harian' (daily) or 'bulanan' (monthly), as in earlier records.
  const daySales = summarize(entries.filter(e => e.date === date)).sales;
  const dayCost = sumAmount(monExp.filter(x => x.kind !== 'bulanan' && x.date === date));
  const overheadPerDay = sumAmount(monExp.filter(x => x.kind === 'bulanan')) / daysInMonth;
  const dayProfit = daySales - dayCost - overheadPerDay;
  $('#p-day-label').textContent = `${dayProfit >= 0 ? 'Profit' : 'Loss'} Today`;
  $('#p-day').textContent = rm(Math.abs(dayProfit));
  $('#p-day-sub').textContent = `Sales ${rm(daySales)} − expenses ${rm(dayCost)} − overhead ${rm(overheadPerDay)}/day`;
  setProfitCard($('#p-day-card'), dayProfit);

  const byCat = {};
  monExp.forEach(x => byCat[x.category] = (byCat[x.category] || 0) + (Number(x.amount) || 0));
  const cats = Object.entries(byCat).sort((a, b) => b[1] - a[1]);
  $('#t-exp-cat tbody').innerHTML = cats.length
    ? cats.map(([k, v]) => `<tr><td>${esc(k)}</td><td class="num">${rm(v)}</td></tr>`).join('')
    : '<tr><td colspan="2" class="muted">No expenses yet.</td></tr>';

  const list = [...monExp].sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt));
  $('#t-expenses tbody').innerHTML = list.length
    ? list.map(x => `<tr>
        <td>${esc(x.date)}</td><td>${x.kind === 'bulanan' ? 'Monthly' : 'Daily'}</td><td>${esc(x.category)}</td>
        <td class="num">${rm(x.amount)}</td><td class="muted">${esc(x.notes || '')}</td>
        <td>${/^https:\/\/(drive|docs)\.google\.com\//.test(x.receipt || '') ? `<a href="${esc(x.receipt)}" target="_blank" rel="noopener">View</a>` : ''}</td>
        <td class="btn-cell"><button type="button" class="edit-btn" data-edit-exp="${esc(x.id)}">✏️ Edit</button> <button class="danger" data-del-exp="${esc(x.id)}">Delete</button></td>
      </tr>`).join('')
    : '<tr><td colspan="7" class="muted">No expenses for this month.</td></tr>';
}

// ---------- Ads performance ----------
// Spend = expenses in the ads category. Leads come from the Ads tab form, purchases are order rows.

const ADS_CATEGORY = 'Advertising / Ads';
const roas = (sales, spend) => spend ? (sales / spend).toFixed(2) + 'x' : '-';
const perUnit = (spend, n) => spend && n ? rm(spend / n) : '-';

function adsStats(spendList, entryList) {
  const s = summarize(entryList);
  return { spend: sumAmount(spendList), leads: s.leads, orders: entryList.reduce((t, e) => t + e.lines.length, 0), sales: s.sales };
}

function renderAds(date) {
  const month = date.slice(0, 7);
  const adsExp = expenses.filter(x => x.date.startsWith(month) && x.category === ADS_CATEGORY);
  const monEntries = entries.filter(e => e.date.startsWith(month));
  const mon = adsStats(adsExp, monEntries);
  const day = adsStats(adsExp.filter(x => x.date === date), monEntries.filter(e => e.date === date));

  $('#ads-month').textContent = `(${new Date(month + '-01T00:00').toLocaleDateString('en-MY', { month: 'long', year: 'numeric' })})`;
  $('#ads-spend').textContent = rm(mon.spend);
  $('#ads-spend-sub').textContent = `Selected day ${rm(day.spend)}`;
  $('#ads-cpl').textContent = perUnit(mon.spend, mon.leads);
  $('#ads-cpl-sub').textContent = `${mon.leads} leads · day ${perUnit(day.spend, day.leads)}`;
  $('#ads-cpp').textContent = perUnit(mon.spend, mon.orders);
  $('#ads-cpp-sub').textContent = `${mon.orders} purchases · day ${perUnit(day.spend, day.orders)}`;
  $('#ads-roas').textContent = roas(mon.sales, mon.spend);
  $('#ads-roas-sub').textContent = `Sales ${rm(mon.sales)} · day ${roas(day.sales, day.spend)}`;
  // Below 1x the ads cost more than the sales they brought in.
  const card = $('#ads-roas-card');
  card.classList.toggle('c-green', mon.spend > 0 && mon.sales >= mon.spend);
  card.classList.toggle('c-red', mon.spend > 0 && mon.sales < mon.spend);

  const days = [...new Set([...adsExp.map(x => x.date), ...monEntries.map(e => e.date)])].sort().reverse();
  const rows = days.map(d => [d, adsStats(adsExp.filter(x => x.date === d), monEntries.filter(e => e.date === d))])
    .filter(([, r]) => r.spend || r.leads || r.orders);
  $('#t-ads tbody').innerHTML = rows.length
    ? rows.map(([d, r]) => `<tr><td>${d}</td><td class="num">${rm(r.spend)}</td><td class="num">${r.leads}</td><td class="num">${r.orders}</td>
        <td class="num">${rm(r.sales)}</td><td class="num">${perUnit(r.spend, r.leads)}</td><td class="num">${perUnit(r.spend, r.orders)}</td>
        <td class="num${r.spend && r.sales < r.spend ? ' neg' : ''}">${roas(r.sales, r.spend)}</td>
        <td><button type="button" class="edit-btn" data-edit-day="${d}">✏️ Edit</button></td></tr>`).join('')
    : '<tr><td colspan="9" class="muted">No ad spend, leads or orders this month.</td></tr>';
}

async function onSubmitExpense(ev) {
  ev.preventDefault();
  const f = ev.target;
  const msg = $('#expense-msg');
  const expense = {
    id: newId(),
    date: f.date.value,
    kind: f.kind.value,
    category: f.category.value,
    amount: Number(f.amount.value) || 0,
    notes: f.notes.value.trim(),
    createdAt: new Date().toISOString(),
  };
  const btn = $('button[type=submit]', f);
  btn.disabled = true;
  try {
    if (settings.syncUrl) await remote({ action: 'addExpense', expense });
    expenses.push(expense);
    save(LS_EXPENSES, expenses);
    msg.className = 'msg ok';
    msg.textContent = `Saved: ${expense.category} ${rm(expense.amount)}`;
    f.amount.value = '';
    f.notes.value = '';
    renderExpenses();
  } catch (e) {
    msg.className = 'msg err';
    msg.textContent = 'Save failed: ' + e.message;
  } finally {
    btn.disabled = false;
  }
}

let editingExpense = null;

function openExpenseEdit(id) {
  const x = expenses.find(e => e.id === id);
  if (!x) return;
  editingExpense = id;
  const f = $('#exp-edit-form');
  const known = [...OPERATION_COSTS, ...OVERHEAD_COSTS];
  f.category.innerHTML = `<optgroup label="Operation cost">${OPERATION_COSTS.map(c => `<option>${c}</option>`).join('')}</optgroup>`
    + `<optgroup label="Overhead (monthly)">${OVERHEAD_COSTS.map(c => `<option>${c}</option>`).join('')}</optgroup>`
    + (known.includes(x.category) ? '' : `<option>${esc(x.category)}</option>`);
  f.date.value = x.date;
  f.category.value = x.category;
  f.kind.value = x.kind === 'bulanan' ? 'bulanan' : 'harian';
  f.amount.value = x.amount;
  f.notes.value = x.notes || '';
  $('#exp-edit-msg').textContent = '';
  $('#exp-edit-modal').hidden = false;
  f.amount.focus();
}

async function onSaveExpenseEdit(ev) {
  ev.preventDefault();
  const old = expenses.find(e => e.id === editingExpense);
  if (!old) return;
  const f = ev.target;
  const msg = $('#exp-edit-msg');
  const x = { ...old, date: f.date.value, kind: f.kind.value, category: f.category.value, amount: Number(f.amount.value) || 0, notes: f.notes.value.trim() };
  const btn = $('button[type=submit]', f);
  btn.disabled = true;
  try {
    if (settings.syncUrl) await remote({ action: 'updateExpense', expense: x });
    expenses = expenses.map(e => (e.id === x.id ? x : e));
    save(LS_EXPENSES, expenses);
    $('#exp-edit-modal').hidden = true;
    renderAll();
  } catch (e) {
    msg.className = 'msg err';
    msg.textContent = /Invalid action/.test(e.message)
      ? 'Not saved: update Code.gs in Google Sheet to the latest version first (Deploy > Manage deployments > New version).'
      : 'Not saved: ' + e.message;
  } finally {
    btn.disabled = false;
  }
}

async function onDeleteExpense(id) {
  const x = expenses.find(e => e.id === id);
  if (!x || !confirm(`Delete expense ${x.category} ${rm(x.amount)} (${x.date})?`)) return;
  try {
    if (settings.syncUrl) await remote({ action: 'deleteExpense', id });
    expenses = expenses.filter(e => e.id !== id);
    save(LS_EXPENSES, expenses);
    renderExpenses();
  } catch (err) {
    alert('Delete failed: ' + err.message);
  }
}

// ---------- Job Status ----------

// Every order row with a deposit becomes a job. Job progress is stored by key "<entry id>:<row index>".
const JOB_STAGES = [
  { key: 'design', label: 'Design', options: ['Done', 'Needs Revision', 'Waiting Decision'], done: ['Done'] },
  { key: 'order', label: 'Shirt Order', options: ['Ordered', 'Not Ordered'], done: ['Ordered'] },
  { key: 'shirt', label: 'Shirt Status', options: ['Need to Order', 'Not Picked Up', 'Picked Up'], done: ['Picked Up'] },
  { key: 'print', label: 'Print DTF', options: ['Sent', 'Arrived'], done: ['Arrived'] },
  { key: 'heatpress', label: 'Heat Press', options: ['Not Started', 'In Progress', 'Done'], done: ['Done'] },
  { key: 'packing', label: 'Packing', options: ['Not Yet', 'Done'], done: ['Done'] },
  { key: 'method', label: 'Post / Pickup', options: ['Post', 'Pickup'], done: ['Post', 'Pickup'] },
  { key: 'ship', label: 'Post Status', options: ['Not Sent', 'Sent'], done: ['Sent'] },
];
// The last stage depends on whether the order is posted or picked up.
const PICKUP_STAGE = { key: 'ship', label: 'Pickup Status', options: ['Not Collected', 'Collected'], done: ['Collected'] };

function stagesFor(job) {
  const stages = JOB_STAGES.map(s => s.key === 'print' && job.printing === 'Sublimation' ? { ...s, label: 'Print Sublimation' } : s);
  if (job.method === 'Pickup') stages[stages.length - 1] = PICKUP_STAGE;
  return stages;
}

const jobKey = (entry, i) => `${entry.id}:${i}`;
const lineDeposit = (entry, i) => Number(entry.lines[i].deposit) || Number(jobs[jobKey(entry, i)]?.deposit) || 0;

// All order rows, joined with their saved job progress.
function allJobs() {
  const out = [];
  for (const e of entries) {
    e.lines.forEach((l, i) => {
      const key = jobKey(e, i);
      const job = { ...l, ...(jobs[key] || {}), key, date: l.orderDate || e.date, deposit: lineDeposit(e, i) };
      job.stages = stagesFor(job);
      job.doneCount = job.stages.filter(s => s.done.includes(job[s.key])).length;
      job.current = job.stages.find(s => !s.done.includes(job[s.key]));
      job.complete = !job.current;
      out.push(job);
    });
  }
  return out;
}

function dueLabel(job) {
  if (!job.delivery || job.complete) return '';
  const days = Math.round((new Date(job.delivery) - new Date(todayStr())) / 86400000);
  if (days < 0) return `<span class="badge red">Overdue ${-days} day${days === -1 ? '' : 's'}</span>`;
  if (days === 0) return '<span class="badge yellow">Due today</span>';
  return `<span class="badge${days <= 2 ? ' yellow' : ''}">Due in ${days} day${days === 1 ? '' : 's'}</span>`;
}

// How long a job has been open: 0-3 days green, 4-6 days yellow, 7+ days red.
function jobAge(job) {
  const days = Math.max(0, Math.round((new Date(todayStr()) - new Date(job.date)) / 86400000));
  return { days, level: days >= 7 ? 'red' : days >= 4 ? 'yellow' : 'green' };
}

function jobCard(job) {
  const pct = Math.round(job.doneCount / job.stages.length * 100);
  const balance = (Number(job.amount) || 0) - job.deposit;
  const selects = job.stages.map(s => `
    <label class="${s.done.includes(job[s.key]) ? 'stage-done' : job.current === s ? 'stage-now' : ''}">${s.label}
      <select data-job="${esc(job.key)}" data-stage="${s.key}">
        <option value="">—</option>
        ${s.options.map(o => `<option${job[s.key] === o ? ' selected' : ''}>${o}</option>`).join('')}
      </select>
    </label>`).join('');
  const age = jobAge(job);
  return `<div class="job${job.complete ? ' complete' : ` age-${age.level}`}">
    <div class="job-head">
      <div>
        <strong>${esc(job.customer || '(no name)')}</strong>${job.phone ? ` · ${esc(job.phone)}` : ''}
        <div class="muted">${job.qty} × ${esc(job.category)} (${esc(job.printing)}) · ordered ${esc(job.date)}${job.delivery ? ` · delivery ${esc(job.delivery)}` : ''}</div>
        <div class="muted">Total ${rm(job.amount)} · Deposit ${rm(job.deposit)} · Balance ${rm(balance)}</div>
        ${job.notes ? `<div class="muted">Notes: ${esc(job.notes)}</div>` : ''}
      </div>
      <div class="job-status">
        ${job.complete ? '<span class="badge blue">Completed</span>' : `<span class="badge navy">${job.current.label}</span>`}
        ${job.complete ? '' : `<span class="badge age ${age.level}">${age.days === 0 ? 'New today' : `Day ${age.days}`}</span>`}
        ${dueLabel(job)}
        <button type="button" class="edit-btn" data-edit="${esc(job.key)}">✏️ Edit</button>
        <button type="button" class="danger small" data-del-line="${esc(job.key)}">Delete</button>
      </div>
    </div>
    <div class="progress"><div style="width:${pct}%" class="${job.complete ? 'done' : ''}"></div></div>
    <div class="stages">${selects}</div>
  </div>`;
}

function waitingCard(job) {
  return `<div class="job waiting">
    <div class="job-head">
      <div>
        <strong>${esc(job.customer || '(no name)')}</strong>${job.phone ? ` · ${esc(job.phone)}` : ''}
        <div class="muted">${job.qty} × ${esc(job.category)} (${esc(job.printing)}) · ${rm(job.amount)} · ordered ${esc(job.date)}</div>
      </div>
      <div class="job-status"><button type="button" class="edit-btn" data-edit="${esc(job.key)}">✏️ Edit</button>
        <button type="button" class="danger small" data-del-line="${esc(job.key)}">Delete</button></div>
      <form class="deposit-form" data-job="${esc(job.key)}">
        <input type="number" name="deposit" min="0.01" step="0.01" placeholder="Deposit (RM)" required>
        <button type="submit">Deposit Paid</button>
      </form>
    </div>
  </div>`;
}

function renderJobs() {
  const filter = $('#job-filter').value;
  const q = $('#job-search').value.trim().toLowerCase();
  const list = allJobs();
  const started = list.filter(j => j.deposit > 0);
  const active = started.filter(j => !j.complete);

  // Counts per current stage, for the summary chips.
  const counts = {};
  active.forEach(j => counts[j.current.label] = (counts[j.current.label] || 0) + 1);
  $('#job-summary').innerHTML = [
    `<div class="card"><span>Active Jobs</span><strong>${active.length}</strong></div>`,
    `<div class="card c-red"><span>Overdue</span><strong>${active.filter(j => j.delivery && j.delivery < todayStr()).length}</strong></div>`,
    `<div class="card c-green"><span>Completed</span><strong>${started.length - active.length}</strong></div>`,
    `<div class="card c-yellow"><span>Waiting Deposit</span><strong>${list.length - started.length}</strong></div>`,
  ].join('');
  $('#job-stages').innerHTML = Object.entries(counts).map(([k, v]) => `<span class="chip">${esc(k)}: <b>${v}</b></span>`).join('');

  const match = j => !q || `${j.customer} ${j.phone}`.toLowerCase().includes(q);
  let shown;
  if (filter === 'waiting') shown = list.filter(j => j.deposit <= 0);
  else if (filter === 'complete') shown = started.filter(j => j.complete);
  else if (filter === 'all') shown = list;
  else shown = active;
  shown = shown.filter(match).sort((a, b) =>
    (a.delivery || '9999').localeCompare(b.delivery || '9999') || a.date.localeCompare(b.date));

  $('#job-list').innerHTML = shown.length
    ? shown.map(j => j.deposit > 0 ? jobCard(j) : waitingCard(j)).join('')
    : '<p class="muted">No jobs here.</p>';
}

// ---------- Edit a job's order details ----------

let editingKey = null;

function findLine(key) {
  const i = key.lastIndexOf(':');
  const entry = entries.find(e => e.id === key.slice(0, i));
  const index = Number(key.slice(i + 1));
  return entry && entry.lines[index] ? { entry, index, line: entry.lines[index] } : null;
}

function openEdit(key) {
  const found = findLine(key);
  if (!found) return;
  editingKey = key;
  const f = $('#edit-form');
  const l = found.line;
  const opts = (list, cur) => [...new Set([...list, cur].filter(Boolean))].map(v => `<option${v === cur ? ' selected' : ''}>${esc(v)}</option>`).join('');
  f.category.innerHTML = opts(CATEGORIES, l.category);
  f.printing.innerHTML = opts(PRINTINGS, l.printing);
  f.source.innerHTML = opts(SOURCES, l.source);
  f.orderDate.value = l.orderDate || found.entry.date;
  f.customer.value = l.customer || '';
  f.phone.value = l.phone || '';
  f.qty.value = l.qty || '';
  f.amount.value = l.amount || '';
  f.deposit.value = lineDeposit(found.entry, found.index) || '';
  f.delivery.value = l.delivery || '';
  f.notes.value = l.notes || '';
  $('#edit-msg').textContent = '';
  $('#edit-modal').hidden = false;
  f.customer.focus();
}

async function onSaveEdit(ev) {
  ev.preventDefault();
  const found = findLine(editingKey);
  if (!found) return;
  const f = ev.target;
  const msg = $('#edit-msg');
  const line = {
    ...found.line,
    orderDate: f.orderDate.value || found.entry.date,
    customer: f.customer.value.trim(),
    phone: f.phone.value.trim(),
    category: f.category.value,
    printing: f.printing.value,
    qty: Number(f.qty.value) || 0,
    amount: Number(f.amount.value) || 0,
    deposit: Number(f.deposit.value) || 0,
    source: f.source.value,
    delivery: f.delivery.value,
    notes: f.notes.value.trim(),
  };
  const updated = { ...found.entry, lines: found.entry.lines.map((l, i) => (i === found.index ? line : l)) };
  const btn = $('button[type=submit]', f);
  btn.disabled = true;
  try {
    if (settings.syncUrl) await remote({ action: 'update', entry: updated });
    entries = entries.map(e => (e.id === updated.id ? updated : e));
    save(LS_ENTRIES, entries);
    $('#edit-modal').hidden = true;
    renderAll();
    // Keep the Jobs sheet in step (name, phone, deposit) and redraw.
    if (jobs[editingKey] || line.deposit) saveJob(editingKey, { deposit: line.deposit });
  } catch (e) {
    msg.className = 'msg err';
    msg.textContent = /Invalid action/.test(e.message)
      ? 'Not saved: update Code.gs in Google Sheet to the latest version first (Deploy > Manage deployments > New version).'
      : 'Not saved: ' + e.message;
  } finally {
    btn.disabled = false;
  }
}

async function saveJob(key, changes) {
  jobs[key] = { ...(jobs[key] || {}), ...changes, updatedAt: new Date().toISOString() };
  save(LS_JOBS, jobs);
  renderJobs();
  renderDashboard();
  if (!settings.syncUrl) return;
  const full = allJobs().find(j => j.key === key);
  try {
    await remote({ action: 'saveJob', job: { ...jobs[key], id: key, customer: full.customer, phone: full.phone, category: full.category,
      printing: full.printing, qty: full.qty, delivery: full.delivery, status: full.complete ? 'Completed' : full.current.label } });
  } catch (e) {
    alert('Saved on this device, but failed to send to the server: ' + e.message);
  }
}

// ---------- Overhead / Break-even ----------

function renderOverhead() {
  const date = $('#oh-date').value || todayStr();
  const month = date.slice(0, 7);
  const [y, m, d] = date.split('-').map(Number);
  const daysLeft = new Date(y, m, 0).getDate() - d + 1;
  const monthName = new Date(y, m - 1, 1).toLocaleDateString('en-MY', { month: 'long', year: 'numeric' });

  const lines = overheadLines();
  const total = sumAmount(lines);
  const sales = summarize(entries.filter(e => e.date.startsWith(month))).sales;
  const monExp = expenses.filter(x => x.date.startsWith(month));
  const opCost = sumAmount(monExp.filter(x => x.kind !== 'bulanan'));
  const recordedOverhead = sumAmount(monExp.filter(x => x.kind === 'bulanan'));
  const gross = sales - opCost;
  const net = gross - total;

  // Margin: real one once there are sales and operation costs this month, otherwise the estimate.
  const realMargin = sales > 0 && opCost > 0 ? gross / sales : null;
  const margin = realMargin ?? (Number(overhead.margin) || 0) / 100;
  const breakEven = margin > 0 ? total / margin : null;
  const needed = breakEven == null ? null : Math.max(breakEven - sales, 0);

  $('#oh-net-label').textContent = `${net >= 0 ? 'Net Profit' : 'Net Loss'} for ${monthName}`;
  $('#oh-net').textContent = rm(Math.abs(net));
  $('#oh-net-sub').textContent = `Sales ${rm(sales)} − operation costs ${rm(opCost)} − overhead ${rm(total)}`;
  setProfitCard($('#oh-net-card'), net);

  $('#oh-total').textContent = rm(total);
  $('#oh-total-sub').textContent = total ? `${rm(total / new Date(y, m, 0).getDate())} per day` : 'Fill in your overhead below';
  $('#oh-breakeven').textContent = breakEven == null ? '-' : rm(breakEven);
  $('#oh-breakeven-sub').textContent = breakEven == null
    ? (margin < 0 ? 'Operation costs are higher than sales' : 'Set an estimated margin below')
    : `Sales needed this month at ${(margin * 100).toFixed(1)}% margin${realMargin == null ? ' (estimate)' : ''}`;

  const card = $('#oh-needed-card');
  card.classList.toggle('c-green', needed === 0 && total > 0);
  card.classList.toggle('c-red', needed > 0);
  $('#oh-needed').textContent = !total || needed == null ? '-' : needed ? rm(needed) : 'Overhead covered!';
  $('#oh-needed-sub').textContent = needed > 0 && daysLeft > 0
    ? `${rm(needed / daysLeft)} per day for ${daysLeft} day${daysLeft === 1 ? '' : 's'} left` : '';

  $('#pnl-sales').textContent = rm(sales);
  $('#pnl-cost').textContent = '− ' + rm(opCost);
  $('#pnl-gross').textContent = rm(gross);
  $('#pnl-margin').textContent = sales ? `(${(gross / sales * 100).toFixed(1)}% margin)` : '';
  $('#pnl-overhead').textContent = '− ' + rm(total);
  $('#pnl-net').innerHTML = `<b>${net < 0 ? '−' : ''}${rm(Math.abs(net))}</b>`;
  $('#pnl-net').style.color = net < 0 ? 'var(--red)' : 'var(--green)';
  $('#t-overhead tbody').innerHTML = lines.filter(l => l.amount).map(l =>
    `<tr><td>${esc(l.label)}</td><td class="num">${rm(l.amount)}</td></tr>`).join('')
    + `<tr class="total"><td>Total overhead per month</td><td class="num">${rm(total)}</td></tr>`;
  $('#oh-note').textContent = recordedOverhead
    ? `Note: ${rm(recordedOverhead)} of Monthly-type costs is also recorded in Expenses this month. To avoid counting rent or salary twice, keep fixed costs here and record only operation costs in Expenses.`
    : '';
}

function addOverheadItem(item = {}) {
  const node = $('#oh-item-tpl').content.firstElementChild.cloneNode(true);
  $('[name=name]', node).value = item.name || '';
  $('[name=amount]', node).value = item.amount || '';
  $('.remove', node).addEventListener('click', () => node.remove());
  $('#oh-items').appendChild(node);
}

function fillOverheadForm() {
  const f = $('#overhead-form');
  OVERHEAD_FIELDS.forEach(({ key }) => { if (f[key]) f[key].value = overhead[key] || ''; });
  $('#oh-items').innerHTML = '';
  (overhead.items || []).forEach(addOverheadItem);
  f.margin.value = overhead.margin || '';
}

function readOverheadForm() {
  const f = $('#overhead-form');
  const o = { margin: Number(f.margin.value) || 0 };
  OVERHEAD_FIELDS.forEach(({ key }) => { if (f[key]) o[key] = Number(f[key].value) || 0; });
  o.items = $$('#oh-items .oh-item')
    .map(n => ({ name: $('[name=name]', n).value.trim(), amount: Number($('[name=amount]', n).value) || 0 }))
    .filter(i => i.name);
  o.pinHash = pinHash; // the owner PIN travels with the overhead record
  return o;
}

async function onSubmitOverhead(ev) {
  ev.preventDefault();
  const msg = $('#overhead-msg');
  overhead = readOverheadForm();
  save(LS_OVERHEAD, overhead);
  renderOverhead();
  try {
    if (settings.syncUrl) await remote({ action: 'setOverhead', overhead });
    msg.className = 'msg ok';
    msg.textContent = `Saved: ${rm(sumAmount(overheadLines()))} overhead per month.`;
  } catch (e) {
    msg.className = 'msg err';
    msg.textContent = 'Saved on this device only. To share it, update Code.gs in Google Sheet to the latest version. (' + e.message + ')';
  }
}

// ---------- Owner PIN ----------
// The PIN only hides owner pages inside the app; it is not real security, since the
// page code and the Google Sheet link can still be read by someone determined.

let pinHash = load(LS_PIN, '');

function hashPin(pin) {
  // FNV-1a over a salted string; the same on every device and browser.
  let h = 0x811c9dc5;
  for (const ch of 'shop-sales-tracker:' + pin) { h ^= ch.charCodeAt(0); h = Math.imul(h, 0x01000193) >>> 0; }
  return h.toString(16).padStart(8, '0');
}

function sessionGet(k) { try { return sessionStorage.getItem(k); } catch { return null; } }
function sessionSet(k, v) { try { v == null ? sessionStorage.removeItem(k) : sessionStorage.setItem(k, v); } catch { /* blocked */ } }

const isUnlocked = () => !pinHash || sessionGet(SS_UNLOCKED) === pinHash || load(LS_KEEP_UNLOCKED, '') === pinHash;

function setPinHash(h) {
  if (h === pinHash) return;
  pinHash = h;
  save(LS_PIN, pinHash);
  applyLock();
}

function applyLock() {
  const locked = !isUnlocked();
  document.body.classList.toggle('locked', locked);
  $$('nav button').forEach(b => b.classList.toggle('locked', locked && OWNER_TABS.includes(b.dataset.tab)));
  const btn = $('#lock-btn');
  btn.hidden = !pinHash;
  btn.textContent = locked ? '🔒 Owner' : '🔓 Lock';
  $('#pin-state').textContent = pinHash ? 'A PIN is set.' : 'No PIN set. Anyone using the app can open every tab.';
  $('#pin-save').textContent = pinHash ? 'Change PIN' : 'Set PIN';
  $('#pin-remove').hidden = !pinHash;
  const current = $('nav button.active')?.dataset.tab;
  if (locked && OWNER_TABS.includes(current)) showTab('dashboard');
}

let pendingTab = null;
function askPin(tab) {
  pendingTab = tab;
  const f = $('#unlock-form');
  f.reset();
  $('#unlock-msg').textContent = '';
  $('#pin-modal').hidden = false;
  f.pin.focus();
}

function onUnlock(ev) {
  ev.preventDefault();
  const f = ev.target;
  if (hashPin(f.pin.value.trim()) !== pinHash) {
    $('#unlock-msg').textContent = 'Wrong PIN. Try again.';
    f.pin.select();
    return;
  }
  sessionSet(SS_UNLOCKED, pinHash);
  if (f.keep.checked) save(LS_KEEP_UNLOCKED, pinHash);
  $('#pin-modal').hidden = true;
  applyLock();
  if (pendingTab) showTab(pendingTab);
}

function lockNow() {
  sessionSet(SS_UNLOCKED, null);
  try { localStorage.removeItem(LS_KEEP_UNLOCKED); } catch { /* blocked */ }
  applyLock();
}

async function storePin(newHash, okText) {
  const msg = $('#pin-msg');
  setPinHash(newHash);
  if (newHash) sessionSet(SS_UNLOCKED, newHash);
  overhead = { ...overhead, pinHash: newHash };
  save(LS_OVERHEAD, overhead);
  applyLock();
  try {
    if (settings.syncUrl) await remote({ action: 'setOverhead', overhead });
    msg.className = 'msg ok';
    msg.textContent = okText;
  } catch (e) {
    msg.className = 'msg err';
    msg.textContent = 'Saved on this device only. Update Code.gs in Google Sheet to the latest version so staff devices get the PIN. (' + e.message + ')';
  }
}

function onSubmitPin(ev) {
  ev.preventDefault();
  const f = ev.target;
  const pin = f.pin.value.trim();
  if (!/^\d{4,8}$/.test(pin)) { $('#pin-msg').className = 'msg err'; $('#pin-msg').textContent = 'Use 4 to 8 digits.'; return; }
  if (pin !== f.pin2.value.trim()) { $('#pin-msg').className = 'msg err'; $('#pin-msg').textContent = 'The two PINs do not match.'; return; }
  f.reset();
  storePin(hashPin(pin), 'PIN saved. Staff devices lock the owner pages the next time they sync.');
}

let removeArmed = false;
function onRemovePin() {
  const btn = $('#pin-remove');
  if (!removeArmed) { removeArmed = true; btn.textContent = 'Tap again to remove PIN'; setTimeout(() => { removeArmed = false; btn.textContent = 'Remove PIN'; }, 4000); return; }
  removeArmed = false;
  btn.textContent = 'Remove PIN';
  storePin('', 'PIN removed. Every tab is open to everyone.');
}

// ---------- Settings ----------

async function onSubmitSettings(ev) {
  ev.preventDefault();
  const f = ev.target;
  const msg = $('#settings-msg');
  const urlChanged = f.syncUrl.value.trim() !== settings.syncUrl;
  settings.target = Number(f.target.value) || 0;
  settings.syncUrl = f.syncUrl.value.trim();
  save(LS_SETTINGS, settings);
  try {
    if (settings.syncUrl && !urlChanged) await remote({ action: 'setTarget', target: settings.target });
    msg.className = 'msg ok';
    msg.textContent = 'Settings saved.';
  } catch (e) {
    msg.className = 'msg err';
    msg.textContent = 'Saved on this device, but failed to send to the server: ' + e.message;
  }
  if (urlChanged) await pull(); else renderAll();
}

// ---------- Init ----------

function renderAll() {
  renderDashboard();
  renderHistory();
  renderExpenses();
  renderJobs();
  renderOverhead();
  renderLeads();
  renderReport();
  if (document.activeElement?.form !== $('#leads-form')) fillLeadsForm();
  if (!$('#tab-overhead').classList.contains('active')) fillOverheadForm();
  const f = $('#settings-form');
  f.target.value = settings.target || '';
  f.syncUrl.value = settings.syncUrl || '';
}

function showTab(name) {
  if (OWNER_TABS.includes(name) && !isUnlocked()) { askPin(name); return; }
  $$('nav button').forEach(b => b.classList.toggle('active', b.dataset.tab === name));
  $$('.tab').forEach(t => t.classList.toggle('active', t.id === 'tab-' + name));
  if (['dashboard', 'expenses', 'jobs', 'overhead', 'leads', 'reports'].includes(name) && settings.syncUrl) pull();
}

$$('nav button').forEach(b => b.addEventListener('click', () => showTab(b.dataset.tab)));
$('#dash-date').value = todayStr();
$('#dash-date').addEventListener('change', renderDashboard);
$('#hist-month').value = todayStr().slice(0, 7);
$('#hist-month').addEventListener('change', renderHistory);
$('#add-line').addEventListener('click', () => { addLine(); updateFormTotal(); });
$('#lines').addEventListener('input', updateFormTotal);
$('#leads-form').leads.addEventListener('input', updateConvRate);
$('#leads-form').converted.addEventListener('input', updateConvRate);
$('#leads-form').date.addEventListener('change', () => { fillLeadsForm(); renderLeads(); });
$('#t-leads').addEventListener('click', ev => { const id = ev.target.dataset?.del; if (id) onDelete(id); });
// Edit on a day in the Ads tab tables: load that day into the form above.
$('#tab-leads').addEventListener('click', ev => {
  const exp = ev.target.dataset?.editExp;
  if (exp) { openExpenseEdit(exp); return; }
  const day = ev.target.dataset?.editDay;
  if (!day) return;
  const f = $('#leads-form');
  f.date.value = day;
  fillLeadsForm();
  renderLeads();
  $('#leads-msg').className = 'msg';
  $('#leads-msg').textContent = `Editing ${day}: change the numbers and press Save.`;
  f.scrollIntoView({ behavior: 'smooth' });
  f.adSpend.focus({ preventScroll: true });
});
$('#leads-form').addEventListener('submit', onSubmitLeads);
$('#leads-form').date.value = todayStr();
$('#entry-form').addEventListener('submit', onSubmitEntry);
$('#settings-form').addEventListener('submit', onSubmitSettings);
$('#export-csv').addEventListener('click', exportCsv);
$('#rep-anchor').value = todayStr();
$('#rep-from').value = todayStr().slice(0, 8) + '01';
$('#rep-to').value = todayStr();
$('#rep-mode').addEventListener('click', ev => { const m = ev.target.dataset?.mode; if (m) setReportMode(m); });
['#rep-anchor', '#rep-from', '#rep-to'].forEach(id => $(id).addEventListener('change', renderReport));
$('#rep-csv').addEventListener('click', exportReportCsv);
$('#rep-print').addEventListener('click', () => window.print());
$('#oh-date').value = todayStr();
$('#oh-date').addEventListener('change', renderOverhead);
$('#oh-add').addEventListener('click', () => addOverheadItem());
// Recalculate as the owner types; Save shares it to Google Sheet.
$('#overhead-form').addEventListener('input', () => { overhead = readOverheadForm(); save(LS_OVERHEAD, overhead); renderOverhead(); });
$('#oh-items').addEventListener('click', ev => { if (ev.target.closest('.remove')) setTimeout(() => { overhead = readOverheadForm(); save(LS_OVERHEAD, overhead); renderOverhead(); }); });
$('#overhead-form').addEventListener('submit', onSubmitOverhead);
$('#exp-date').value = todayStr();
$('#exp-date').addEventListener('change', renderExpenses);

$('#expense-form').date.value = todayStr();
$('#expense-form').category.innerHTML =
  `<optgroup label="Operation cost">${OPERATION_COSTS.map(c => `<option>${c}</option>`).join('')}</optgroup>`
  + `<optgroup label="Overhead (monthly)">${OVERHEAD_COSTS.map(c => `<option>${c}</option>`).join('')}</optgroup>`;
$('#expense-form').category.addEventListener('change', ev => {
  ev.target.form.kind.value = OVERHEAD_COSTS.includes(ev.target.value) ? 'bulanan' : 'harian';
});
$('#expense-form').addEventListener('submit', onSubmitExpense);
$('#t-expenses').addEventListener('click', ev => {
  const id = ev.target.dataset?.delExp;
  if (id) onDeleteExpense(id);
  const edit = ev.target.dataset?.editExp;
  if (edit) openExpenseEdit(edit);
});
$('#exp-edit-form').addEventListener('submit', onSaveExpenseEdit);
$('#exp-edit-cancel').addEventListener('click', () => { $('#exp-edit-modal').hidden = true; });
$('#exp-edit-form').category.addEventListener('change', ev => {
  ev.target.form.kind.value = OVERHEAD_COSTS.includes(ev.target.value) ? 'bulanan' : 'harian';
});
$('#job-filter').addEventListener('change', renderJobs);
$('#job-search').addEventListener('input', renderJobs);
$('#job-list').addEventListener('change', ev => {
  const { job, stage } = ev.target.dataset;
  if (job && stage) saveJob(job, { [stage]: ev.target.value });
});
$('#job-list').addEventListener('click', ev => {
  const btn = ev.target.closest('[data-edit]');
  if (btn) openEdit(btn.dataset.edit);
  const del = ev.target.dataset?.delLine;
  if (del) onDeleteLine(del);
});
$('#edit-form').addEventListener('submit', onSaveEdit);
$('#edit-cancel').addEventListener('click', () => { $('#edit-modal').hidden = true; });
$('#job-list').addEventListener('submit', ev => {
  ev.preventDefault();
  const form = ev.target;
  saveJob(form.dataset.job, { deposit: Number(form.deposit.value) || 0 });
});
$('#unlock-form').addEventListener('submit', onUnlock);
$('#unlock-cancel').addEventListener('click', () => { $('#pin-modal').hidden = true; });
$('#lock-btn').addEventListener('click', () => (isUnlocked() ? lockNow() : askPin('settings')));
$('#pin-form').addEventListener('submit', onSubmitPin);
$('#pin-remove').addEventListener('click', onRemovePin);
$('#t-history').addEventListener('click', ev => {
  const id = ev.target.dataset?.del;
  if (id) onDelete(id);
  const edit = ev.target.closest('[data-edit]');
  if (edit) openEdit(edit.dataset.edit);
  const del = ev.target.dataset?.delLine;
  if (del) onDeleteLine(del);
});

// Makes the app installable (Add to Home Screen / Install app).
if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(() => {});

resetForm();
applyLock();
renderAll();
pull();

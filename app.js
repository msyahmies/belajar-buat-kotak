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

function normalizeEntries(list) {
  list.forEach(e => e.lines.forEach(l => { l.category = rename(l.category); l.source = rename(l.source); }));
  return list;
}
function normalizeExpenses(list) {
  list.forEach(x => { x.category = rename(x.category); });
  return list;
}

const LS_ENTRIES = 'sales.entries';
const LS_SETTINGS = 'sales.settings';
const LS_EXPENSES = 'sales.expenses';

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

const rm = n => 'RM ' + (Number(n) || 0).toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const newId = () => crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random().toString(16).slice(2);

function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
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

// ---------- Sync (Google Apps Script) ----------

async function remote(payload) {
  // text/plain avoids a CORS preflight, which Apps Script does not support.
  const res = await fetch(settings.syncUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify(payload),
  });
  const data = await res.json();
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
    if (data.target != null) settings.target = Number(data.target) || 0;
    save(LS_ENTRIES, entries);
    save(LS_SETTINGS, settings);
    setSyncStatus('Synced ' + new Date().toLocaleTimeString('en-MY'));
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
    for (const l of e.lines) {
      const qty = Number(l.qty) || 0, amt = Number(l.amount) || 0;
      out.pcs += qty;
      out.sales += amt;
      (out.byCategory[l.category] ??= { pcs: 0, sales: 0 });
      out.byCategory[l.category].pcs += qty;
      out.byCategory[l.category].sales += amt;
      (out.byPrinting[l.printing] ??= { pcs: 0, sales: 0 });
      out.byPrinting[l.printing].pcs += qty;
      out.byPrinting[l.printing].sales += amt;
      out.deposit += Number(l.deposit) || 0;
      const src = l.source || 'None';
      (out.bySource[src] ??= { orders: 0, sales: 0 });
      out.bySource[src].orders += 1;
      out.bySource[src].sales += amt;
    }
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
  $('#d-leads').textContent = day.leads;
  $('#d-conv').textContent = day.converted;
  $('#d-rate').textContent = convRate(day);

  const mon = summarize(entries.filter(e => e.date.startsWith(month)));
  const target = Number(settings.target) || 0;
  const balance = Math.max(target - mon.sales, 0);

  const [y, m, d] = date.split('-').map(Number);
  const daysInMonth = new Date(y, m, 0).getDate();
  const daysLeft = daysInMonth - d + 1; // including the selected day

  $('#m-label').textContent = new Date(y, m - 1, 1).toLocaleDateString('en-MY', { month: 'long', year: 'numeric' });
  $('#m-target').textContent = target ? rm(target) : 'Not set';
  $('#m-sales').textContent = rm(mon.sales);
  $('#m-leads').textContent = mon.leads;
  $('#m-conv').textContent = mon.converted;
  $('#m-rate').textContent = convRate(mon);
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
  $('#d-sales-sub').textContent = `${day.pcs} pcs · ${day.converted} leads converted`
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
  const f = $('#entry-form');
  f.convRate.value = convRate({ leads: Number(f.leads.value) || 0, converted: Number(f.converted.value) || 0 });
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
  updateConvRate();
}

async function onSubmitEntry(ev) {
  ev.preventDefault();
  const f = ev.target;
  const msg = $('#form-msg');
  const entry = {
    id: newId(),
    date: f.date.value,
    leads: Number(f.leads.value) || 0,
    converted: Number(f.converted.value) || 0,
    lines: readLines(),
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
    resetForm({ date: entry.date });
    renderAll();
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
    .filter(e => e.date.startsWith(month))
    .sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt));
}

function lineDetail(l) {
  const parts = [
    `${l.customer ? `<b>${esc(l.customer)}</b>` : ''}${l.phone ? ` (${esc(l.phone)})` : ''}`,
    `${l.qty} × ${esc(l.category)} (${esc(l.printing)})`,
    `Total ${rm(l.amount)} · Deposit ${rm(l.deposit)} · Balance ${rm((Number(l.amount) || 0) - (Number(l.deposit) || 0))}`,
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
    tbody.innerHTML = '<tr><td colspan="8" class="muted">No records for this month.</td></tr>';
    return;
  }
  tbody.innerHTML = list.map(e => {
    const t = entryTotals(e);
    const detail = e.lines.map(lineDetail).join('<hr>');
    return `<tr>
      <td>${e.date}</td><td class="num">${e.leads || 0}</td><td class="num">${e.converted || 0}</td><td class="num">${convRate({ leads: Number(e.leads) || 0, converted: Number(e.converted) || 0 })}</td>
      <td class="num">${t.pcs}</td><td class="num">${rm(t.sales)}</td>
      <td class="muted">${detail}</td>
      <td><button class="danger" data-del="${esc(e.id)}">Delete</button></td>
    </tr>`;
  }).join('');
}

async function onDelete(id) {
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

function exportCsv() {
  const header = ['Date', 'Leads In', 'Leads Converted', '% Leads Converted', 'Customer Name', 'Phone No.', 'Category', 'Printing', 'Quantity', 'Total (RM)', 'Deposit (RM)', 'Balance (RM)', 'Lead Source', 'Expected Delivery', 'Notes'];
  const rows = [header];
  // Phone is written as ="012..." so Excel keeps the leading 0.
  for (const e of monthEntries().reverse()) {
    e.lines.forEach((l, i) => rows.push([e.date, i === 0 ? e.leads || 0 : 0, i === 0 ? e.converted || 0 : 0, i === 0 ? convRate({ leads: Number(e.leads) || 0, converted: Number(e.converted) || 0 }) : '', l.customer || '', l.phone ? `="${l.phone}"` : '', l.category, l.printing, l.qty, l.amount, l.deposit || 0, (Number(l.amount) || 0) - (Number(l.deposit) || 0), l.source || '', l.delivery || '', l.notes || '']));
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
        <td><button class="danger" data-del-exp="${esc(x.id)}">Delete</button></td>
      </tr>`).join('')
    : '<tr><td colspan="6" class="muted">No expenses for this month.</td></tr>';
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
  const f = $('#settings-form');
  f.target.value = settings.target || '';
  f.syncUrl.value = settings.syncUrl || '';
}

function showTab(name) {
  $$('nav button').forEach(b => b.classList.toggle('active', b.dataset.tab === name));
  $$('.tab').forEach(t => t.classList.toggle('active', t.id === 'tab-' + name));
  if ((name === 'dashboard' || name === 'expenses') && settings.syncUrl) pull();
}

$$('nav button').forEach(b => b.addEventListener('click', () => showTab(b.dataset.tab)));
$('#dash-date').value = todayStr();
$('#dash-date').addEventListener('change', renderDashboard);
$('#hist-month').value = todayStr().slice(0, 7);
$('#hist-month').addEventListener('change', renderHistory);
$('#add-line').addEventListener('click', () => { addLine(); updateFormTotal(); });
$('#lines').addEventListener('input', updateFormTotal);
$('#entry-form').leads.addEventListener('input', updateConvRate);
$('#entry-form').converted.addEventListener('input', updateConvRate);
$('#entry-form').addEventListener('submit', onSubmitEntry);
$('#settings-form').addEventListener('submit', onSubmitSettings);
$('#export-csv').addEventListener('click', exportCsv);
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
});
$('#t-history').addEventListener('click', ev => {
  const id = ev.target.dataset?.del;
  if (id) onDelete(id);
});

resetForm();
renderAll();
pull();

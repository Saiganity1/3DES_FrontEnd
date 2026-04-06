/* global API_BASE_URL */

const STORAGE_KEYS = {
  access: "inventory.accessToken",
  refresh: "inventory.refreshToken",
  mainView: "inventory.mainView", // items | manage
  manageMode: "inventory.manageMode", // categories | addItem
};

function $(id) {
  return document.getElementById(id);
}

function setHidden(el, hidden) {
  el.hidden = !!hidden;
}

function showError(el, message) {
  if (!message) {
    el.hidden = true;
    el.textContent = "";
    return;
  }
  el.hidden = false;
  el.textContent = message;
}

function toast(message, { type = "info", timeoutMs = 3200 } = {}) {
  const stack = $("toastStack");
  if (!stack) return;

  const t = document.createElement("div");
  t.className = `toast toast-${type}`;

  const msg = document.createElement("div");
  msg.className = "toast-message";
  msg.textContent = String(message || "");

  const close = document.createElement("button");
  close.type = "button";
  close.className = "toast-close";
  close.textContent = "Close";

  const remove = () => {
    t.classList.remove("toast-show");
    window.setTimeout(() => t.remove(), 200);
  };

  close.addEventListener("click", remove);
  t.appendChild(msg);
  t.appendChild(close);
  stack.appendChild(t);

  // trigger transition
  requestAnimationFrame(() => t.classList.add("toast-show"));

  if (timeoutMs > 0) {
    window.setTimeout(remove, timeoutMs);
  }
}

function safeJsonParse(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

const apiBaseUrl = String(window.API_BASE_URL || "").trim().replace(/\/+$/, "");
let accessToken = localStorage.getItem(STORAGE_KEYS.access) || "";
let refreshToken = localStorage.getItem(STORAGE_KEYS.refresh) || "";
let me = null;
let categories = [];
let items = [];
let archivedItems = [];
let itemViewMode = "active"; // active | archived

let mainViewMode = localStorage.getItem(STORAGE_KEYS.mainView) || "manage"; // items | manage
let manageMode = localStorage.getItem(STORAGE_KEYS.manageMode) || "categories"; // categories | addItem

let itemsSearchQuery = "";
let itemsCategoryQuery = "__all__";

let itemsPage = 1;
let itemsPageSize = 25;

let accounts = [];
let accountsFilter = "active"; // active | taken_down | all

function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

function safeNumber(v, fallback = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function isLowStock(it) {
  const qty = safeNumber(it?.quantity, 0);
  const minQty = safeNumber(it?.min_quantity, 0);
  return minQty > 0 && qty <= minQty;
}

function escapeCsvCell(value) {
  if (value === null || value === undefined) return "";
  const s = String(value);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function downloadTextFile(filename, content, mimeType = "text/plain;charset=utf-8") {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function isStaff() {
  return !!(me && (me.is_staff || me.is_superuser));
}

function isAdmin() {
  return !!(me && me.is_superuser);
}

function canDecrypt() {
  return !!(me && me.can_decrypt_item_details);
}

function normalizeMainViewMode(value) {
  return value === "manage" ? "manage" : "items";
}

function setMainViewMode(mode) {
  mainViewMode = normalizeMainViewMode(mode);
  localStorage.setItem(STORAGE_KEYS.mainView, mainViewMode);
  updateAppVisibility();
}

function normalizeManageMode(value) {
  return value === "addItem" ? "addItem" : "categories";
}

function setManageMode(mode) {
  manageMode = normalizeManageMode(mode);
  localStorage.setItem(STORAGE_KEYS.manageMode, manageMode);
  updateAppVisibility();
}

function normalizeText(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase();
}

function getFilteredItems(list) {
  const q = normalizeText(itemsSearchQuery);
  const cat = String(itemsCategoryQuery || "__all__");
  return (list || []).filter((it) => {
    if (cat && cat !== "__all__") {
      if (String(it.category_name || "") !== cat) return false;
    }
    if (!q) return true;

    const hay = [
      it.name,
      it.category_name,
      it.created_by,
      it.location,
      it.serial_number,
      it.notes,
    ]
      .map(normalizeText)
      .join("\n");
    return hay.includes(q);
  });
}

function getPagedItems(list) {
  const total = (list || []).length;
  const pageCount = Math.max(1, Math.ceil(total / Math.max(1, itemsPageSize)));
  itemsPage = clamp(itemsPage, 1, pageCount);
  const start = (itemsPage - 1) * itemsPageSize;
  const end = start + itemsPageSize;
  return {
    total,
    pageCount,
    pageItems: (list || []).slice(start, end),
  };
}

function updatePagerUi(total, pageCount) {
  const info = $("pageInfo");
  const prev = $("prevPageBtn");
  const next = $("nextPageBtn");

  if (info) info.textContent = `${itemsPage} / ${pageCount} · ${total} rows`;
  if (prev) prev.disabled = itemsPage <= 1;
  if (next) next.disabled = itemsPage >= pageCount;
}

function getDistinctCategoryCountFromItems(list) {
  const s = new Set();
  for (const it of list || []) {
    const name = String(it?.category_name || "").trim();
    if (name) s.add(name);
  }
  return s.size;
}

function renderDashboard() {
  const dash = $("dashboard");
  if (!dash) return;

  const activeList = items || [];
  const archivedList = archivedItems || [];

  const activeCount = activeList.length;
  const archivedCount = archivedList.length;
  const lowCount = activeList.filter(isLowStock).length;
  const categoriesCount = (categories && categories.length) ? categories.length : getDistinctCategoryCountFromItems(activeList);

  const totalEl = $("statTotalItems");
  const catEl = $("statCategories");
  const lowEl = $("statLowStock");
  const archEl = $("statArchived");
  if (totalEl) totalEl.textContent = String(activeCount);
  if (catEl) catEl.textContent = String(categoriesCount);
  if (lowEl) lowEl.textContent = String(lowCount);
  if (archEl) archEl.textContent = String(archivedCount);

  setHidden(dash, false);
}

async function fetchActivity() {
  const card = $("activityCard");
  const list = $("activityList");
  const err = $("activityError");
  if (!card || !list) return;

  if (!isAdmin()) {
    setHidden(card, true);
    return;
  }

  setHidden(card, false);
  showError(err, "");
  list.innerHTML = '<div class="muted small">Loading…</div>';

  try {
    const res = await apiGet("/activity/");
    const feed = Array.isArray(res) ? res : (res && res.results) ? res.results : [];

    list.innerHTML = "";
    if (!feed.length) {
      list.innerHTML = '<div class="muted small">No activity yet.</div>';
      return;
    }

    for (const ev of feed.slice(0, 12)) {
      const row = document.createElement("div");
      row.className = "activity-item";
      const when = ev?.created_at ? formatDateTime(ev.created_at) : "";
      const who = ev?.actor ? `@${ev.actor}` : "";
      const msg = ev?.message ? String(ev.message) : String(ev?.action || "").replace(/_/g, " ");
      const target = ev?.item_name ? ` — ${ev.item_name}` : "";
      row.innerHTML = `
        <div class="activity-main">${escapeText(msg)}${escapeText(target)}</div>
        <div class="activity-meta muted small">${escapeText(who)} ${escapeText(when)}</div>
      `;
      list.appendChild(row);
    }
  } catch (e) {
    list.innerHTML = "";
    showError(err, e?.message || String(e));
  }
}

function exportCsvFromCurrentView() {
  const list = itemViewMode === "archived" ? (archivedItems || []) : (items || []);
  const filtered = getFilteredItems(list);

  const rows = [
    [
      "id",
      "name",
      "quantity",
      "min_quantity",
      "is_low_stock",
      "category",
      "location",
      "serial_number",
      "notes",
      "created_by",
      "created_at",
      "updated_by",
      "updated_at",
      "is_archived",
      "photo_url",
    ].join(","),
  ];

  for (const it of filtered) {
    rows.push(
      [
        it.id,
        it.name,
        it.quantity,
        it.min_quantity ?? "",
        isLowStock(it) ? "true" : "false",
        it.category_name || "",
        it.location || "",
        it.serial_number || "",
        it.notes || "",
        it.created_by || "",
        it.created_at || "",
        it.updated_by || "",
        it.updated_at || "",
        it.is_archived ? "true" : "false",
        it.photo_url || "",
      ]
        .map(escapeCsvCell)
        .join(",")
    );
  }

  const stamp = new Date().toISOString().slice(0, 10);
  downloadTextFile(`inventory_export_${stamp}.csv`, rows.join("\n"), "text/csv;charset=utf-8");
  toast("CSV exported.", { type: "success" });
}

function renderItemFilters(list) {
  const sel = $("itemsCategoryFilter");
  if (!sel) return;

  const current = itemsCategoryQuery || "__all__";
  const categoriesSet = new Set();
  for (const it of list || []) {
    const name = String(it.category_name || "").trim();
    if (name) categoriesSet.add(name);
  }
  const options = ["__all__", ...Array.from(categoriesSet).sort((a, b) => a.localeCompare(b))];

  sel.innerHTML = "";
  for (const value of options) {
    const opt = document.createElement("option");
    opt.value = value;
    opt.textContent = value === "__all__" ? "All categories" : value;
    sel.appendChild(opt);
  }
  sel.value = options.includes(current) ? current : "__all__";
  itemsCategoryQuery = sel.value;
}

function setPage(page) {
  const inventoryPage = $("inventoryPage");
  const accountsPage = $("accountsPage");
  if (!inventoryPage || !accountsPage) return;

  if (page === "accounts") {
    setHidden(inventoryPage, true);
    setHidden(accountsPage, false);
    if (location.hash !== "#accounts") location.hash = "#accounts";
  } else {
    setHidden(accountsPage, true);
    setHidden(inventoryPage, false);
    if (location.hash === "#accounts") location.hash = "#inventory";
  }
}

function getInitialPage() {
  return location.hash === "#accounts" ? "accounts" : "inventory";
}

async function request(url, options = {}, { retryOn401 = true } = {}) {
  const headers = new Headers(options.headers || {});
  if (!headers.has("Content-Type") && options.body != null) {
    headers.set("Content-Type", "application/json");
  }
  if (accessToken) {
    headers.set("Authorization", `Bearer ${accessToken}`);
  }

  const res = await fetch(url, { ...options, headers });
  if (res.status !== 401 || !retryOn401 || !refreshToken) {
    return res;
  }

  const refreshed = await tryRefreshToken();
  if (!refreshed) {
    return res;
  }

  const retryHeaders = new Headers(options.headers || {});
  if (!retryHeaders.has("Content-Type") && options.body != null) {
    retryHeaders.set("Content-Type", "application/json");
  }
  retryHeaders.set("Authorization", `Bearer ${accessToken}`);
  return fetch(url, { ...options, headers: retryHeaders });
}

async function jsonOrText(res) {
  const text = await res.text();
  const asJson = safeJsonParse(text);
  return asJson ?? text;
}

async function tryRefreshToken() {
  try {
    const res = await fetch(`${apiBaseUrl}/auth/token/refresh/`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refresh: refreshToken }),
    });
    if (!res.ok) return false;
    const data = await res.json();
    accessToken = data.access;
    localStorage.setItem(STORAGE_KEYS.access, accessToken);
    updateSessionBar();
    return true;
  } catch {
    return false;
  }
}

async function apiGet(path) {
  const res = await request(`${apiBaseUrl}${path}`);
  if (!res.ok) throw await buildApiError(res);
  return res.json();
}

async function apiPost(path, body, { allowUnauthed = false } = {}) {
  if (allowUnauthed) {
    const res = await fetch(`${apiBaseUrl}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw await buildApiError(res);
    return res.json();
  }

  const res = await request(`${apiBaseUrl}${path}`, {
    method: "POST",
    body: JSON.stringify(body),
  });
  if (!res.ok) throw await buildApiError(res);
  return res.json();
}

async function apiPatch(path, body) {
  const res = await request(`${apiBaseUrl}${path}`, {
    method: "PATCH",
    body: JSON.stringify(body),
  });
  if (!res.ok) throw await buildApiError(res);
  return res.json();
}

async function apiDelete(path) {
  const res = await request(`${apiBaseUrl}${path}`, { method: "DELETE" });
  if (!res.ok) throw await buildApiError(res);
}

async function buildApiError(res) {
  const payload = await jsonOrText(res);
  const detail =
    typeof payload === "string"
      ? payload
      : payload && typeof payload === "object"
        ? payload.detail || JSON.stringify(payload)
        : String(payload);

  const err = new Error(detail || `Request failed (${res.status})`);
  err.status = res.status;
  err.payload = payload;
  return err;
}

function setAuthMode(mode) {
  const loginPanel = $("loginPanel");
  const registerPanel = $("registerPanel");
  const tabLogin = $("tabLogin");
  const tabRegister = $("tabRegister");
  const auth = $("auth");

  if (!loginPanel || !registerPanel || !tabLogin || !tabRegister || !auth) return;

  if (mode === "register") {
    auth.dataset.mode = "register";
    loginPanel.classList.remove("auth-panel-active");
    registerPanel.classList.add("auth-panel-active");
    loginPanel.setAttribute("aria-hidden", "true");
    registerPanel.setAttribute("aria-hidden", "false");
    tabLogin.classList.remove("tab-active");
    tabRegister.classList.add("tab-active");
  } else {
    auth.dataset.mode = "login";
    registerPanel.classList.remove("auth-panel-active");
    loginPanel.classList.add("auth-panel-active");
    registerPanel.setAttribute("aria-hidden", "true");
    loginPanel.setAttribute("aria-hidden", "false");
    tabRegister.classList.remove("tab-active");
    tabLogin.classList.add("tab-active");
  }
  showError($("authError"), "");
  showError($("registerError"), "");
}

function updateSessionBar() {
  const sessionBar = $("sessionBar");
  if (!sessionBar) return;
  const who = me ? `${me.username}${isAdmin() ? " (admin)" : isStaff() ? " (staff)" : " (viewer)"}` : "signed out";
  sessionBar.textContent = `Session: ${who}`;
}

function updateAppVisibility() {
  const authed = !!accessToken;
  setHidden($("auth"), authed);
  setHidden($("app"), !authed);

  const staff = authed && isStaff();

  const managePanel = $("managePanel");
  const itemsPanel = $("itemsPanel");
  const categoriesViewBtn = $("categoriesViewBtn");
  const itemsViewBtn = $("itemsViewBtn");

  if (categoriesViewBtn) setHidden(categoriesViewBtn, !staff);
  if (itemsViewBtn) setHidden(itemsViewBtn, !staff);

  const effectiveMainView = staff ? normalizeMainViewMode(mainViewMode) : "items";

  if (managePanel || itemsPanel) {
    if (managePanel) setHidden(managePanel, !staff || effectiveMainView !== "manage");
    if (itemsPanel) setHidden(itemsPanel, !authed || (staff && effectiveMainView !== "items"));

    if (categoriesViewBtn && itemsViewBtn) {
      const manageActive = effectiveMainView === "manage";
      categoriesViewBtn.classList.toggle("btn-primary", manageActive);
      itemsViewBtn.classList.toggle("btn-primary", !manageActive);
    }

    if (staff && effectiveMainView === "manage") {
      const m = normalizeManageMode(manageMode);
      setHidden($("staffArea"), m !== "categories");
      setHidden($("addItemSection"), m !== "addItem");

      const manageCategoriesBtn = $("manageCategoriesBtn");
      const manageAddItemBtn = $("manageAddItemBtn");
      if (manageCategoriesBtn && manageAddItemBtn) {
        manageCategoriesBtn.classList.toggle("btn-primary", m === "categories");
        manageAddItemBtn.classList.toggle("btn-primary", m === "addItem");
      }
    }
  } else {
    setHidden($("staffArea"), !staff);
    setHidden($("addItemSection"), !staff);
  }

  setHidden($("accountsBtn"), !authed || !isAdmin());
  if (!authed || !isAdmin()) setPage("inventory");

  const itemsActionsTh = $("itemsActionsTh");
  if (itemsActionsTh) {
    setHidden(itemsActionsTh, !authed || !isStaff());
  }

  const archivedBtn = $("showArchivedBtn");
  if (archivedBtn) {
    const staff = authed && isStaff();
    archivedBtn.disabled = !staff;
    archivedBtn.title = staff ? "" : "Staff/Admin only";
  }

  updateSessionBar();
}

async function loadMe() {
  if (!accessToken) {
    me = null;
    updateAppVisibility();
    updateRoleUi();
    return;
  }

  try {
    me = await apiGet("/auth/me/");
  } catch {
    me = null;
  }

  updateAppVisibility();
  $("meInfo").textContent =
    me ? `Signed in as ${me.username}. Role: ${isStaff() ? "Staff/Admin" : "Viewer"}.` : "";

  updateRoleUi();
}

function renderCategorySelect() {
  const sel = $("categorySelect");
  sel.innerHTML = "";
  for (const c of categories) {
    const opt = document.createElement("option");
    opt.value = String(c.id);
    opt.textContent = c.name;
    sel.appendChild(opt);
  }
}

function escapeText(s) {
  return String(s ?? "");
}

function formatDateTime(value) {
  const s = String(value ?? "").trim();
  if (!s) return "";
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return s;
  return d.toLocaleString();
}

function createActionButton(label, onClick, { primary = false, danger = false } = {}) {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = primary
    ? "btn btn-small btn-primary"
    : danger
      ? "btn btn-small btn-danger"
      : "btn btn-small";
  btn.textContent = label;
  btn.addEventListener("click", onClick);
  return btn;
}

function createBadge(text, className) {
  const span = document.createElement("span");
  span.className = className ? `badge ${className}` : "badge";
  span.textContent = text;
  return span;
}

function updateRoleUi() {
  const banner = $("roleBanner");
  if (!banner) return;

  const authed = !!accessToken;
  const viewer = authed && me && !isStaff();
  const staff = authed && me && isStaff() && !isAdmin();
  const admin = authed && me && isAdmin();

  document.body.classList.toggle("role-viewer", !!viewer);
  document.body.classList.toggle("role-staff", !!staff);
  document.body.classList.toggle("role-admin", !!admin);

  if (!authed || !me) {
    setHidden(banner, true);
    banner.textContent = "";
    return;
  }

  banner.textContent = "";

  if (admin) {
    banner.appendChild(createBadge("Admin", "badge-primary"));
  } else if (staff) {
    banner.appendChild(createBadge("Staff", "badge-muted"));
  } else {
    banner.appendChild(createBadge("Viewer", "badge-muted"));
  }

  const msg = document.createElement("span");
  if (admin) {
    msg.textContent = "Full access — you can manage inventory and accounts.";
  } else if (staff) {
    msg.textContent = "Staff access — you can add, edit, archive, and restore items.";
  } else {
    msg.textContent = "Read-only access — you can browse items, but cannot add, edit, archive, or restore.";
  }
  banner.appendChild(msg);

  setHidden(banner, false);
}

function formatRole(u) {
  if (u.is_superuser) return "Admin";
  if (u.is_staff) return "Staff";
  return "Viewer";
}

function formatStatus(u) {
  return u.is_active ? "Active" : "Taken down";
}

function renderAccountsTable() {
  const tbody = $("accountsTbody");
  tbody.innerHTML = "";

  const filtered = (() => {
    if (accountsFilter === "taken_down") return accounts.filter((u) => !u.is_active);
    if (accountsFilter === "all") return accounts;
    return accounts.filter((u) => u.is_active);
  })();

  if (filtered.length === 0) {
    const tr = document.createElement("tr");
    tr.className = "empty-row";
    const td = document.createElement("td");
    td.colSpan = 6;
    td.textContent = "No accounts match this filter.";
    tr.appendChild(td);
    tbody.appendChild(tr);
    return;
  }

  for (const u of filtered) {
    const tr = document.createElement("tr");

    const tdUser = document.createElement("td");
    tdUser.dataset.label = "Username";
    tdUser.textContent = escapeText(u.username);

    const tdName = document.createElement("td");
    tdName.dataset.label = "Name";
    tdName.textContent = `${escapeText(u.first_name || "")} ${escapeText(u.last_name || "")}`.trim();

    const tdEmail = document.createElement("td");
    tdEmail.dataset.label = "Email";
    tdEmail.textContent = escapeText(u.email || "");

    const tdRole = document.createElement("td");
    tdRole.dataset.label = "Role";
    {
      const role = formatRole(u);
      const badgeClass = role === "Admin" ? "badge-primary" : "badge-muted";
      tdRole.appendChild(createBadge(role, badgeClass));
    }

    const tdStatus = document.createElement("td");
    tdStatus.dataset.label = "Status";
    {
      const status = formatStatus(u);
      tdStatus.appendChild(createBadge(status, u.is_active ? "badge-muted" : "badge-danger"));
    }

    const tdActions = document.createElement("td");
    tdActions.dataset.label = "Actions";
    const actions = document.createElement("div");
    actions.className = "actions";

    if (!u.is_superuser) {
      // If taken down, disable any mutating actions.
      if (!u.is_active) {
        const disabledBtn = createActionButton("Promote to staff", () => {}, { primary: true });
        disabledBtn.disabled = true;
        actions.appendChild(disabledBtn);
      } else {
        if (!u.is_staff) {
          actions.appendChild(createActionButton("Promote to staff", () => promoteAccount(u), { primary: true }));
        }

        // Admin -> Accounts: grant/revoke decrypt permission for selected users.
        if (u.can_decrypt_item_details) {
          actions.appendChild(createActionButton("Revoke decrypt", () => revokeDecrypt(u)));
        } else {
          actions.appendChild(createActionButton("Allow decrypt", () => grantDecrypt(u)));
        }

        actions.appendChild(createActionButton("Take down", () => takeDownAccount(u), { danger: true }));
      }
    }

    tdActions.appendChild(actions);

    tr.appendChild(tdUser);
    tr.appendChild(tdName);
    tr.appendChild(tdEmail);
    tr.appendChild(tdRole);
    tr.appendChild(tdStatus);
    tr.appendChild(tdActions);
    tbody.appendChild(tr);
  }
}

async function loadAccounts() {
  showError($("accountsError"), "");
  try {
    accounts = await apiGet("/accounts/");
    renderAccountsTable();
  } catch (e) {
    showError($("accountsError"), e.message || String(e));
  }
}

function setAccountsFilter(value) {
  accountsFilter = value || "active";
  renderAccountsTable();
}

async function promoteAccount(u) {
  showError($("accountsError"), "");
  try {
    await apiPost(`/accounts/${u.id}/promote/`, {}, { allowUnauthed: false });
    await loadAccounts();
  } catch (e) {
    showError($("accountsError"), e.message || String(e));
  }
}

async function takeDownAccount(u) {
  if (!confirm(`Take down account '${u.username}'?`)) return;
  showError($("accountsError"), "");
  try {
    await apiPost(`/accounts/${u.id}/take_down/`, {}, { allowUnauthed: false });
    await loadAccounts();
  } catch (e) {
    showError($("accountsError"), e.message || String(e));
  }
}

async function grantDecrypt(u) {
  showError($("accountsError"), "");
  try {
    await apiPost(`/accounts/${u.id}/grant_decrypt/`, {}, { allowUnauthed: false });
    await loadAccounts();
  } catch (e) {
    showError($("accountsError"), e.message || String(e));
  }
}

async function revokeDecrypt(u) {
  showError($("accountsError"), "");
  try {
    await apiPost(`/accounts/${u.id}/revoke_decrypt/`, {}, { allowUnauthed: false });
    await loadAccounts();
  } catch (e) {
    showError($("accountsError"), e.message || String(e));
  }
}

function renderItemsTable() {
  const tbody = $("itemsTbody");
  tbody.innerHTML = "";
  const list = itemViewMode === "archived" ? archivedItems : items;
  const filtered = getFilteredItems(list);
  renderItemFilters(list);

  const { total, pageCount, pageItems } = getPagedItems(filtered);
  updatePagerUi(total, pageCount);

  if (!list || list.length === 0) {
    const tr = document.createElement("tr");
    tr.className = "empty-row";
    const td = document.createElement("td");
    td.colSpan = isStaff() || canDecrypt() ? 9 : 8;
    if (itemViewMode === "archived" && !isStaff()) {
      td.textContent = "Archived items are staff/admin only.";
    } else {
      td.textContent = "No items to display.";
    }
    tr.appendChild(td);
    tbody.appendChild(tr);
    return;
  }

  if (!filtered || filtered.length === 0) {
    const tr = document.createElement("tr");
    tr.className = "empty-row";
    const td = document.createElement("td");
    td.colSpan = isStaff() || canDecrypt() ? 9 : 8;
    td.textContent = "No matching items.";
    tr.appendChild(td);
    tbody.appendChild(tr);
    return;
  }

  for (const it of pageItems) {
    const tr = document.createElement("tr");
    tr.dataset.itemId = String(it.id);

    if (isLowStock(it) && itemViewMode === "active") {
      tr.classList.add("row-low");
    }

    if (!isStaff()) {
      tr.tabIndex = 0;
      tr.setAttribute("role", "button");
      tr.setAttribute("aria-label", `View details for ${String(it.name || "item")}`);
    }

    const tdName = document.createElement("td");
    tdName.dataset.label = "Name";
    tdName.textContent = escapeText(it.name);
    tdName.title = tdName.textContent;

    const tdQty = document.createElement("td");
    tdQty.dataset.label = "Qty";
    tdQty.textContent = escapeText(it.quantity);

    const tdCat = document.createElement("td");
    tdCat.dataset.label = "Category";
    tdCat.textContent = escapeText(it.category_name || "");
    tdCat.title = tdCat.textContent;

    const tdPostedBy = document.createElement("td");
    tdPostedBy.dataset.label = "Posted by";
    tdPostedBy.textContent = escapeText(it.created_by || "");
    tdPostedBy.title = tdPostedBy.textContent;

    const tdPostedAt = document.createElement("td");
    tdPostedAt.dataset.label = "Posted at";
    tdPostedAt.textContent = formatDateTime(it.created_at);
    tdPostedAt.title = tdPostedAt.textContent;

    const tdLoc = document.createElement("td");
    tdLoc.dataset.label = "Location";
    tdLoc.textContent = escapeText(it.location || "");
    tdLoc.className = "cell cell-truncate cell-mono";
    tdLoc.title = tdLoc.textContent;

    const tdSer = document.createElement("td");
    tdSer.dataset.label = "Serial";
    tdSer.textContent = escapeText(it.serial_number || "");
    tdSer.className = "cell cell-truncate cell-mono";
    tdSer.title = tdSer.textContent;

    const tdNotes = document.createElement("td");
    tdNotes.dataset.label = "Notes";
    tdNotes.textContent = escapeText(it.notes || "");
    tdNotes.className = "cell cell-truncate";
    tdNotes.title = tdNotes.textContent;

    tr.appendChild(tdName);
    tr.appendChild(tdQty);
    tr.appendChild(tdCat);
    tr.appendChild(tdPostedBy);
    tr.appendChild(tdPostedAt);
    tr.appendChild(tdLoc);
    tr.appendChild(tdSer);
    tr.appendChild(tdNotes);

    if (isStaff() || canDecrypt()) {
      const tdActions = document.createElement("td");
      tdActions.dataset.label = "Actions";
      const actions = document.createElement("div");
      actions.className = "actions";

      if (isStaff()) {
        if (itemViewMode === "active") {
          actions.appendChild(createActionButton("Edit", () => editItem(it), { primary: false }));
          actions.appendChild(createActionButton("Archive", () => archiveItem(it), { primary: false }));
        } else {
          actions.appendChild(createActionButton("Restore", () => restoreItem(it), { primary: true }));
        }
      } else {
        // Approved viewer: decrypt on demand.
        actions.appendChild(
          createActionButton(
            "Decrypt",
            async () => {
              try {
                const dec = await apiGet(`/items/${it.id}/decrypt/`);
                openItemDetails(dec);
              } catch (e) {
                toast(e.message || String(e), { type: "danger" });
              }
            },
            { primary: true }
          )
        );
      }

      tdActions.appendChild(actions);
      tr.appendChild(tdActions);
    }

    tbody.appendChild(tr);
  }
}

function buildDetailsRow(label, value) {
  const labelEl = document.createElement("div");
  labelEl.className = "details-label";
  labelEl.textContent = label;

  const valueEl = document.createElement("div");
  valueEl.className = "details-value";
  valueEl.textContent = String(value ?? "");

  return [labelEl, valueEl];
}

function openItemDetails(it) {
  const modal = $("itemDetailsModal");
  const title = $("itemDetailsTitle");
  const body = $("itemDetailsBody");
  const closeBtn = $("itemDetailsCloseBtn");
  if (!modal || !title || !body || !closeBtn) return;

  const previouslyFocused = document.activeElement;

  title.textContent = it?.name ? `Item: ${it.name}` : "Item details";
  body.innerHTML = "";

  const grid = document.createElement("div");
  grid.className = "details-grid";

  const rows = [
    ["Name", it?.name || ""],
    ["Quantity", it?.quantity ?? ""],
    ["Min qty (low stock)", it?.min_quantity ?? ""],
    ["Category", it?.category_name || ""],
    ["Posted by", it?.created_by || ""],
    ["Posted at", formatDateTime(it?.created_at)],
    ["Last updated by", it?.updated_by || ""],
    ["Last updated at", formatDateTime(it?.updated_at)],
    ["Location", it?.location || ""],
    ["Serial", it?.serial_number || ""],
    ["Notes", it?.notes || ""],
    ["Photo URL", it?.photo_url || ""],
  ];

  for (const [label, value] of rows) {
    const [l, v] = buildDetailsRow(label, value);
    grid.appendChild(l);
    grid.appendChild(v);
  }

  body.appendChild(grid);

  modal.hidden = false;
  modal.setAttribute("aria-hidden", "false");

  const focusableSelector =
    'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';
  const focusables = Array.from(modal.querySelectorAll(focusableSelector)).filter(
    (el) => el && !el.hasAttribute("disabled") && el.getAttribute("aria-hidden") !== "true"
  );
  const first = focusables[0] || closeBtn;
  const last = focusables[focusables.length - 1] || closeBtn;

  const onKeyDown = (e) => {
    if (e.key === "Escape") {
      e.preventDefault();
      closeItemDetails();
      return;
    }
    if (e.key !== "Tab") return;

    if (focusables.length === 0) {
      e.preventDefault();
      closeBtn.focus();
      return;
    }

    if (e.shiftKey) {
      if (document.activeElement === first) {
        e.preventDefault();
        last.focus();
      }
    } else {
      if (document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
  };

  modal._onKeyDown = onKeyDown;
  modal._previouslyFocused = previouslyFocused;
  modal.addEventListener("keydown", onKeyDown);

  closeBtn.focus();
}

function closeItemDetails() {
  const modal = $("itemDetailsModal");
  if (!modal) return;
  modal.hidden = true;
  modal.setAttribute("aria-hidden", "true");

  if (modal._onKeyDown) {
    modal.removeEventListener("keydown", modal._onKeyDown);
    modal._onKeyDown = null;
  }

  const prev = modal._previouslyFocused;
  modal._previouslyFocused = null;
  if (prev && typeof prev.focus === "function") {
    prev.focus();
  }
}

async function refreshAll() {
  showError($("itemsError"), "");
  try {
    if (isStaff()) {
      categories = await apiGet("/categories/");
      renderCategorySelect();
    } else {
      categories = [];
      $("categorySelect").innerHTML = "";
    }

    if (itemViewMode === "archived") {
      archivedItems = isStaff() ? await apiGet("/items/archived/") : [];
      items = [];
    } else {
      items = await apiGet("/items/");
      archivedItems = isStaff() ? await apiGet("/items/archived/") : [];
    }

    renderItemsTable();
    renderDashboard();
    fetchActivity();
  } catch (e) {
    const msg = String(e?.message || e);
    if (/Failed to fetch|NetworkError|ECONNREFUSED|ENOTFOUND/i.test(msg)) {
      showError(
        $("itemsError"),
        `Cannot reach backend at ${apiBaseUrl}.\n\nStart Django, or set the API Base URL.`
      );
    } else {
      showError($("itemsError"), msg);
    }
  }
}

async function handleLogin() {
  showError($("authError"), "");
  const username = $("loginUsername").value.trim();
  const password = $("loginPassword").value;
  if (!username || !password) {
    showError($("authError"), "Username and password are required.");
    return;
  }

  try {
    const tokens = await apiPost(
      "/auth/token/",
      { username, password },
      { allowUnauthed: true }
    );
    accessToken = tokens.access;
    refreshToken = tokens.refresh;
    localStorage.setItem(STORAGE_KEYS.access, accessToken);
    localStorage.setItem(STORAGE_KEYS.refresh, refreshToken);
    $("loginPassword").value = "";

    await loadMe();
    await refreshAll();
  } catch (e) {
    if (e?.status === 401) {
      showError($("authError"), "Invalid username or password.");
    } else {
      showError($("authError"), String(e?.message || e));
    }
  }
}

async function handleRegister() {
  showError($("registerError"), "");
  const username = $("regUsername").value.trim();
  const password = $("regPassword").value;
  const email = $("regEmail").value.trim();
  const first_name = $("regFirstName").value.trim();
  const last_name = $("regLastName").value.trim();

  if (!username || !password) {
    showError($("registerError"), "Username and password are required.");
    return;
  }

  try {
    await apiPost(
      "/auth/register/",
      { username, password, email, first_name, last_name },
      { allowUnauthed: true }
    );

    setAuthMode("login");
    $("loginUsername").value = username;
    $("loginPassword").value = "";
    showError($("authError"), "Account created. You can sign in now.");
  } catch (e) {
    const payload = e?.payload;
    if (payload && typeof payload === "object") {
      showError($("registerError"), JSON.stringify(payload, null, 2));
    } else {
      showError($("registerError"), String(e?.message || e));
    }
  }
}

function handleLogout() {
  accessToken = "";
  refreshToken = "";
  me = null;
  categories = [];
  items = [];
  archivedItems = [];
  localStorage.removeItem(STORAGE_KEYS.mainView);
  localStorage.removeItem(STORAGE_KEYS.manageMode);
  mainViewMode = "manage";
  manageMode = "categories";
  localStorage.removeItem(STORAGE_KEYS.access);
  localStorage.removeItem(STORAGE_KEYS.refresh);
  updateAppVisibility();
  updateRoleUi();
  setAuthMode("login");
}

async function addCategory() {
  const name = $("newCategoryName").value.trim();
  if (!name) return;

  try {
    await apiPost("/categories/", { name });
    $("newCategoryName").value = "";
    await refreshAll();
    toast("Category created.", { type: "success" });
  } catch (e) {
    toast(String(e?.message || e), { type: "danger" });
  }
}

async function addItem() {
  const name = $("itemName").value.trim();
  const quantity = Number($("itemQuantity").value || "1");
  const min_quantity = Number($("itemMinQuantity")?.value || "0");
  const location = $("itemLocation").value.trim();
  const serial_number = $("itemSerial").value.trim();
  const notes = $("itemNotes").value.trim();
  const photo_url = $("itemPhotoUrl")?.value.trim() || "";

  if (!name) {
    toast("Item name is required.", { type: "danger" });
    return;
  }

  const body = {
    name,
    quantity: Number.isFinite(quantity) ? quantity : 1,
    min_quantity: Number.isFinite(min_quantity) ? min_quantity : 0,
    photo_url,
    location,
    serial_number,
    notes,
  };

  if (isStaff()) {
    const sel = $("categorySelect");
    const category = sel.value ? Number(sel.value) : null;
    if (category) body.category = category;
  }

  try {
    await apiPost("/items/", body);
    $("itemName").value = "";
    $("itemQuantity").value = "1";
    if ($("itemMinQuantity")) $("itemMinQuantity").value = "0";
    $("itemLocation").value = "";
    $("itemSerial").value = "";
    if ($("itemPhotoUrl")) $("itemPhotoUrl").value = "";
    $("itemNotes").value = "";
    await refreshAll();
    toast("Item added.", { type: "success" });
  } catch (e) {
    toast(String(e?.message || e), { type: "danger" });
  }
}

async function archiveItem(it) {
  if (!confirm(`Archive item "${it.name}"?`)) return;
  try {
    await apiDelete(`/items/${it.id}/`);
    await refreshAll();
    toast("Item archived.", { type: "success" });
  } catch (e) {
    toast(String(e?.message || e), { type: "danger" });
  }
}

async function restoreItem(it) {
  try {
    await apiPost(`/items/${it.id}/restore/`, {});
    await refreshAll();
    toast("Item restored.", { type: "success" });
  } catch (e) {
    toast(String(e?.message || e), { type: "danger" });
  }
}

async function editItem(it) {
  const name = prompt("Name:", it.name);
  if (name == null) return;
  const quantityStr = prompt("Quantity:", String(it.quantity ?? 1));
  if (quantityStr == null) return;
  const minQtyStr = prompt("Min qty (low stock):", String(it.min_quantity ?? 0));
  if (minQtyStr == null) return;
  const location = prompt("Location:", it.location || "") ?? "";
  const serial_number = prompt("Serial number:", it.serial_number || "") ?? "";
  const notes = prompt("Notes:", it.notes || "") ?? "";
  const photo_url = prompt("Photo URL (optional):", it.photo_url || "") ?? "";

  const body = {
    name: name.trim(),
    quantity: Number(quantityStr || "1"),
    min_quantity: Number(minQtyStr || "0"),
    location,
    serial_number,
    notes,
    photo_url,
  };

  try {
    await apiPatch(`/items/${it.id}/`, body);
    await refreshAll();
    toast("Item updated.", { type: "success" });
  } catch (e) {
    toast(String(e?.message || e), { type: "danger" });
  }
}

function setItemViewMode(mode) {
  itemViewMode = mode;
  const activeBtn = $("showActiveBtn");
  const archivedBtn = $("showArchivedBtn");

  if (mode === "archived") {
    activeBtn.classList.remove("btn-primary");
    archivedBtn.classList.add("btn-primary");
  } else {
    archivedBtn.classList.remove("btn-primary");
    activeBtn.classList.add("btn-primary");
  }

  refreshAll();
}

function init() {
  // Tabs
  $("tabLogin").addEventListener("click", () => setAuthMode("login"));
  $("tabRegister").addEventListener("click", () => setAuthMode("register"));

  // Auth
  $("loginBtn").addEventListener("click", handleLogin);
  $("registerBtn").addEventListener("click", handleRegister);

  // App
  $("logoutBtn").addEventListener("click", handleLogout);
  $("refreshBtn").addEventListener("click", refreshAll);

  const categoriesViewBtn = $("categoriesViewBtn");
  if (categoriesViewBtn) {
    categoriesViewBtn.addEventListener("click", () => {
      if (!isStaff()) return;
      setMainViewMode("manage");
    });
  }

  const itemsViewBtn = $("itemsViewBtn");
  if (itemsViewBtn) {
    itemsViewBtn.addEventListener("click", () => {
      if (!isStaff()) return;
      setMainViewMode("items");
    });
  }

  const manageCategoriesBtn = $("manageCategoriesBtn");
  if (manageCategoriesBtn) {
    manageCategoriesBtn.addEventListener("click", () => {
      if (!isStaff()) return;
      setManageMode("categories");
    });
  }

  const manageAddItemBtn = $("manageAddItemBtn");
  if (manageAddItemBtn) {
    manageAddItemBtn.addEventListener("click", () => {
      if (!isStaff()) return;
      setManageMode("addItem");
    });
  }

  // Viewer: click item row to view details
  const tbody = $("itemsTbody");
  if (tbody) {
    tbody.addEventListener("click", (e) => {
      if (isStaff()) return;
      const target = e.target;
      if (target && target.closest && target.closest("button")) return;
      const tr = target && target.closest ? target.closest("tr") : null;
      const itemId = tr && tr.dataset ? tr.dataset.itemId : "";
      if (!itemId) return;

      const list = itemViewMode === "archived" ? archivedItems : items;
      const it = (list || []).find((x) => String(x.id) === String(itemId));
      if (!it) return;
      openItemDetails(it);
    });

    tbody.addEventListener("keydown", (e) => {
      if (isStaff()) return;
      if (e.key !== "Enter" && e.key !== " ") return;
      const target = e.target;
      const tr = target && target.closest ? target.closest("tr") : null;
      const itemId = tr && tr.dataset ? tr.dataset.itemId : "";
      if (!itemId) return;
      e.preventDefault();

      const list = itemViewMode === "archived" ? archivedItems : items;
      const it = (list || []).find((x) => String(x.id) === String(itemId));
      if (!it) return;
      openItemDetails(it);
    });
  }

  const detailsClose = $("itemDetailsCloseBtn");
  if (detailsClose) {
    detailsClose.addEventListener("click", closeItemDetails);
  }

  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    const modal = $("itemDetailsModal");
    if (modal && !modal.hidden) closeItemDetails();
  });

  // Accounts (admin)
  $("accountsBtn").addEventListener("click", async () => {
    if (!isAdmin()) return;
    setPage("accounts");
    await loadAccounts();
  });
  $("accountsBackBtn").addEventListener("click", () => setPage("inventory"));
  $("accountsRefreshBtn").addEventListener("click", loadAccounts);
  $("accountsFilter").addEventListener("change", (e) => setAccountsFilter(e.target.value));

  window.addEventListener("hashchange", () => {
    if (!accessToken || !isAdmin()) {
      setPage("inventory");
      return;
    }
    setPage(getInitialPage());
    if (location.hash === "#accounts") loadAccounts();
  });

  // Staff
  $("addCategoryBtn").addEventListener("click", addCategory);

  // Items
  $("addItemBtn").addEventListener("click", addItem);
  const exportCsvBtn = $("exportCsvBtn");
  if (exportCsvBtn) {
    exportCsvBtn.addEventListener("click", () => {
      try {
        exportCsvFromCurrentView();
      } catch (e) {
        toast(String(e?.message || e), { type: "danger" });
      }
    });
  }

  const prevPageBtn = $("prevPageBtn");
  if (prevPageBtn) {
    prevPageBtn.addEventListener("click", () => {
      itemsPage = Math.max(1, itemsPage - 1);
      renderItemsTable();
    });
  }

  const nextPageBtn = $("nextPageBtn");
  if (nextPageBtn) {
    nextPageBtn.addEventListener("click", () => {
      itemsPage = itemsPage + 1;
      renderItemsTable();
    });
  }

  const pageSizeSelect = $("pageSizeSelect");
  if (pageSizeSelect) {
    itemsPageSize = safeNumber(pageSizeSelect.value, 25);
    pageSizeSelect.addEventListener("change", (e) => {
      itemsPageSize = safeNumber(e.target.value, 25);
      itemsPage = 1;
      renderItemsTable();
    });
  }

  const activityRefreshBtn = $("activityRefreshBtn");
  if (activityRefreshBtn) {
    activityRefreshBtn.addEventListener("click", fetchActivity);
  }

  $("showActiveBtn").addEventListener("click", () => setItemViewMode("active"));
  $("showArchivedBtn").addEventListener("click", () => {
    if (!isStaff()) {
      toast("Archived view is staff/admin only.", { type: "danger" });
      return;
    }
    setItemViewMode("archived");
  });

  const itemsSearch = $("itemsSearch");
  if (itemsSearch) {
    itemsSearch.addEventListener("input", (e) => {
      itemsSearchQuery = e.target.value || "";
      itemsPage = 1;
      renderItemsTable();
    });
  }

  const itemsCategoryFilter = $("itemsCategoryFilter");
  if (itemsCategoryFilter) {
    itemsCategoryFilter.addEventListener("change", (e) => {
      itemsCategoryQuery = e.target.value || "__all__";
      itemsPage = 1;
      renderItemsTable();
    });
  }

  updateAppVisibility();

  // Ensure initial page is consistent with URL hash.
  if (accessToken && isAdmin()) {
    setPage(getInitialPage());
  } else {
    setPage("inventory");
  }

  // Default Accounts view filter
  setAccountsFilter("active");

  // If token exists, load initial data
  if (accessToken) {
    loadMe().then(refreshAll);
  }
}

init();

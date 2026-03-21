/* global API_BASE_URL */

const STORAGE_KEYS = {
  access: "inventory.accessToken",
  refresh: "inventory.refreshToken",
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

let accounts = [];
let accountsFilter = "active"; // active | taken_down | all

function isStaff() {
  return !!(me && (me.is_staff || me.is_superuser));
}

function isAdmin() {
  return !!(me && me.is_superuser);
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
  setHidden($("staffArea"), !authed || !isStaff());
  setHidden($("addItemSection"), !authed || !isStaff());
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

function renderItemsTable() {
  const tbody = $("itemsTbody");
  tbody.innerHTML = "";
  const list = itemViewMode === "archived" ? archivedItems : items;

  if (!list || list.length === 0) {
    const tr = document.createElement("tr");
    tr.className = "empty-row";
    const td = document.createElement("td");
    td.colSpan = isStaff() ? 9 : 8;
    if (itemViewMode === "archived" && !isStaff()) {
      td.textContent = "Archived items are staff/admin only.";
    } else {
      td.textContent = "No items to display.";
    }
    tr.appendChild(td);
    tbody.appendChild(tr);
    return;
  }

  for (const it of list) {
    const tr = document.createElement("tr");

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

    if (isStaff()) {
      const tdActions = document.createElement("td");
      tdActions.dataset.label = "Actions";
      const actions = document.createElement("div");
      actions.className = "actions";

      if (itemViewMode === "active") {
        actions.appendChild(createActionButton("Edit", () => editItem(it), { primary: false }));
        actions.appendChild(createActionButton("Archive", () => archiveItem(it), { primary: false }));
      } else {
        actions.appendChild(createActionButton("Restore", () => restoreItem(it), { primary: true }));
      }

      tdActions.appendChild(actions);
      tr.appendChild(tdActions);
    }

    tbody.appendChild(tr);
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
      archivedItems = [];
    }

    renderItemsTable();
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
  } catch (e) {
    alert(String(e?.message || e));
  }
}

async function addItem() {
  const name = $("itemName").value.trim();
  const quantity = Number($("itemQuantity").value || "1");
  const location = $("itemLocation").value.trim();
  const serial_number = $("itemSerial").value.trim();
  const notes = $("itemNotes").value.trim();

  if (!name) {
    alert("Item name is required.");
    return;
  }

  const body = {
    name,
    quantity: Number.isFinite(quantity) ? quantity : 1,
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
    $("itemLocation").value = "";
    $("itemSerial").value = "";
    $("itemNotes").value = "";
    await refreshAll();
  } catch (e) {
    alert(String(e?.message || e));
  }
}

async function archiveItem(it) {
  if (!confirm(`Archive item "${it.name}"?`)) return;
  try {
    await apiDelete(`/items/${it.id}/`);
    await refreshAll();
  } catch (e) {
    alert(String(e?.message || e));
  }
}

async function restoreItem(it) {
  try {
    await apiPost(`/items/${it.id}/restore/`, {});
    await refreshAll();
  } catch (e) {
    alert(String(e?.message || e));
  }
}

async function editItem(it) {
  const name = prompt("Name:", it.name);
  if (name == null) return;
  const quantityStr = prompt("Quantity:", String(it.quantity ?? 1));
  if (quantityStr == null) return;
  const location = prompt("Location:", it.location || "") ?? "";
  const serial_number = prompt("Serial number:", it.serial_number || "") ?? "";
  const notes = prompt("Notes:", it.notes || "") ?? "";

  const body = {
    name: name.trim(),
    quantity: Number(quantityStr || "1"),
    location,
    serial_number,
    notes,
  };

  try {
    await apiPatch(`/items/${it.id}/`, body);
    await refreshAll();
  } catch (e) {
    alert(String(e?.message || e));
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
  $("showActiveBtn").addEventListener("click", () => setItemViewMode("active"));
  $("showArchivedBtn").addEventListener("click", () => {
    if (!isStaff()) {
      alert("Archived view is staff/admin only.");
      return;
    }
    setItemViewMode("archived");
  });

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

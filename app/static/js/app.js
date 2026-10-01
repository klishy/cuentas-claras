const API = ""; // mismo origen
let token = localStorage.getItem("token") || sessionStorage.getItem("token");
let currentUser = JSON.parse(localStorage.getItem("user") || sessionStorage.getItem("user") || "null");
let currentGroupId = null;
let currentGroupMembers = [];
let categories = [];

// ---------- Helpers ----------
async function apiFetch(path, options = {}) {
  const headers = { "Content-Type": "application/json", ...(options.headers || {}) };
  if (token) headers["Authorization"] = `Bearer ${token}`;
  const res = await fetch(API + path, { ...options, headers });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: "Error desconocido" }));
    throw new Error(err.detail || "Error");
  }
  if (res.status === 204) return null;
  return res.json();
}

function show(id) {
  document.body.classList.toggle("auth-mode", id === "auth-screen");
  document.querySelectorAll(".screen").forEach((el) => el.classList.add("hidden"));
  document.getElementById(id).classList.remove("hidden");
}

function fmt(n) {
  return new Intl.NumberFormat("es-CL", { style: "currency", currency: "CLP" }).format(n);
}

function categoryIcon(key) {
  const cat = categories.find((c) => c.key === key);
  if (!cat) return `<span class="category-badge" style="background:#9ca3af">OT</span>`;
  return `<span class="category-badge" style="background:${cat.color}">${cat.abbr}</span>`;
}


// ---------- Montos con puntos automáticos (1.500.000) ----------
function formatMoneyInput(input) {
  const digits = input.value.replace(/\D/g, "").replace(/^0+(?=\d)/, "");
  input.value = digits ? Number(digits).toLocaleString("es-CL") : "";
}
function moneyValue(input) {
  return parseInt(input.value.replace(/\D/g, ""), 10) || 0;
}
function attachMoney(input) {
  input.addEventListener("input", () => formatMoneyInput(input));
}
document.querySelectorAll("input.money").forEach(attachMoney);

// ---------- Tabs de login/registro ----------
document.querySelectorAll(".tab-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".tab-btn").forEach((b) => b.classList.remove("active"));
    document.querySelectorAll(".tab-content").forEach((c) => c.classList.remove("active"));
    btn.classList.add("active");
    document.getElementById(btn.dataset.tab + "-form").classList.add("active");
  });
});

// ---------- Auth ----------
document.getElementById("login-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const email = document.getElementById("login-email").value;
  const password = document.getElementById("login-password").value;
  try {
    const data = await apiFetch("/auth/login", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    });
    onAuthSuccess(data, document.getElementById("remember").checked);
  } catch (err) {
    document.getElementById("login-error").textContent = err.message;
  }
});

document.getElementById("register-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const name = document.getElementById("register-name").value;
  const email = document.getElementById("register-email").value;
  const password = document.getElementById("register-password").value;
  try {
    const data = await apiFetch("/auth/register", {
      method: "POST",
      body: JSON.stringify({ name, email, password, birth_date: document.getElementById("register-birth").value, avatar: avatarData }),
    });
    onAuthSuccess(data);
  } catch (err) {
    document.getElementById("register-error").textContent = err.message;
  }
});

function onAuthSuccess(data, remember = true) {
  token = data.access_token;
  currentUser = data.user;
  const st = remember ? localStorage : sessionStorage;
  st.setItem("token", token);
  st.setItem("user", JSON.stringify(currentUser));
  initAfterLogin();
}

document.getElementById("logout-btn").addEventListener("click", () => {
  ["token", "user"].forEach((k) => { localStorage.removeItem(k); sessionStorage.removeItem(k); });
  token = null;
  currentUser = null;
  document.getElementById("user-info").classList.add("hidden");
  document.getElementById("menu-btn").classList.add("hidden");
  closeDrawer();
  show("auth-screen");
});

async function initAfterLogin() {
  document.getElementById("user-info").classList.remove("hidden");
  document.getElementById("menu-btn").classList.remove("hidden");
  document.getElementById("user-name-display").textContent = `Hola, ${currentUser.name}`;
  await loadCategories();
  await loadLayout();
  renderHomeHeader();
  await loadGroups();
  await loadReminderBanner();
  if (!(await showPendingJoin())) show("groups-screen");
}

async function loadCategories() {
  if (categories.length) return;
  categories = await apiFetch("/categories");
  const select = document.getElementById("expense-category");
  select.innerHTML = categories.filter((c) => c.key !== "pago").map((c) => `<option value="${c.key}">${c.label}</option>`).join("");
}

function capitalize(s) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// ---------- Aviso de deudas pendientes ----------
async function loadReminderBanner() {
  const container = document.getElementById("reminder-banner-container");
  container.innerHTML = "";
  try {
    const resumen = await apiFetch("/groups/resumen/pendientes");
    renderBell(resumen);
    const neto = resumen.total_le_deben - resumen.total_debe;

    if (resumen.total_le_deben < 0.5 && resumen.total_debe < 0.5) {
      container.innerHTML = `
        <div class="reminder-banner owed">
          <p class="balance-hero-label">Tu saldo neto</p>
          <p class="balance-hero-number">${fmt(0)}</p>
          <h3>Estás al día en todos tus grupos</h3>
        </div>
      `;
      return;
    }

    let cls = "mixed";
    if (neto < 0) cls = "owe";
    if (neto > 0) cls = "owed";

    const lines = resumen.detalle.map((d) => {
      const texto = d.balance > 0
        ? `En <strong>${d.group_name}</strong> te deben ${fmt(d.balance)}`
        : `En <strong>${d.group_name}</strong> debes ${fmt(-d.balance)}`;
      return `<li>${texto}</li>`;
    }).join("");

    const label = neto >= 0 ? "En total te deben" : "En total debes";

    container.innerHTML = `
      <div class="reminder-banner ${cls}">
        <p class="balance-hero-label">${label}</p>
        <p class="balance-hero-number">${fmt(Math.abs(neto))}</p>
        <h3>Detalle por grupo</h3>
        <ul>${lines}</ul>
      </div>
    `;
  } catch (err) {
    // silencioso: si falla el resumen, no bloquea el resto de la app
  }
}

// ---------- Grupos ----------
document.getElementById("create-group-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const name = document.getElementById("new-group-name").value;
  try {
    const ng = await apiFetch("/groups/", { method: "POST", body: JSON.stringify({ name }) });
    if (ng && ng.id) { layout.assign[ng.id] = currentSectionId; saveLayout(); }
    document.getElementById("new-group-name").value = "";
    document.getElementById("group-error").textContent = "";
    loadGroups();
  } catch (err) {
    document.getElementById("group-error").textContent = err.message;
  }
});

async function loadGroups() {
  allGroups = await apiFetch("/groups/");
  renderGroupLists();
}

document.getElementById("back-to-groups").addEventListener("click", () => {
  show(currentSectionId ? "section-screen" : "groups-screen");
  loadGroups();
  loadReminderBanner();
});

async function openGroup(groupId) {
  currentGroupId = groupId;
  renderGroupLists();
  await refreshGroupDetail();
  prepareInvite();
  show("group-detail-screen");
}

async function refreshGroupDetail() {
  const group = await apiFetch(`/groups/${currentGroupId}`);
  currentGroupMembers = group.members;
  document.getElementById("group-detail-name").textContent = group.name;

  const chips = document.getElementById("members-chips");
  chips.innerHTML = "";
  group.members.forEach((m) => {
    const chip = document.createElement("span");
    chip.className = "chip";
    chip.innerHTML = `<span class="avatar">${m.name.charAt(0).toUpperCase()}</span>${m.name}`;
    chips.appendChild(chip);
  });

  const payerSelect = document.getElementById("expense-payer");
  payerSelect.innerHTML = "";
  group.members.forEach((m) => {
    const opt = document.createElement("option");
    opt.value = m.id;
    opt.textContent = m.name;
    payerSelect.appendChild(opt);
  });

  buildManualSplitBox();

  await loadExpenses();
  await loadBalances();
  await loadIncomes();
}

document.getElementById("add-member-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const email = document.getElementById("new-member-email").value;
  try {
    await apiFetch(`/groups/${currentGroupId}/members`, {
      method: "POST",
      body: JSON.stringify({ email }),
    });
    document.getElementById("new-member-email").value = "";
    document.getElementById("member-error").textContent = "";
    refreshGroupDetail();
  } catch (err) {
    document.getElementById("member-error").textContent = err.message;
  }
});

// ---------- Sueldos ----------
document.getElementById("income-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const income = moneyValue(document.getElementById("my-income"));
  try {
    await apiFetch(`/groups/${currentGroupId}/my-income`, {
      method: "PUT",
      body: JSON.stringify({ income }),
    });
    document.getElementById("income-error").textContent = "";
    await loadIncomes();
  } catch (err) {
    document.getElementById("income-error").textContent = err.message;
  }
});

async function loadIncomes() {
  const incomes = await apiFetch(`/groups/${currentGroupId}/incomes`);
  const list = document.getElementById("incomes-list");
  list.innerHTML = "";
  incomes.forEach((inc) => {
    const li = document.createElement("li");
    const isMine = inc.user_id === currentUser.id;
    const value = inc.income != null ? fmt(inc.income) : (isMine ? "—" : "No declarado");
    li.innerHTML = `<span>${inc.user_name}${isMine ? " (tú)" : ""}</span><span>${value}</span>`;
    list.appendChild(li);
  });
}

// ---------- División manual / porcentajes / partes ----------
const SPLIT_INPUT_METHODS = ["manual", "percent", "shares"];
document.getElementById("expense-split-method").addEventListener("change", () => {
  buildManualSplitBox();
});
document.getElementById("expense-amount").addEventListener("input", () => {
  updateManualSplitTotal();
});

function buildManualSplitBox() {
  const method = document.getElementById("expense-split-method").value;
  const box = document.getElementById("manual-split-box");

  if (!SPLIT_INPUT_METHODS.includes(method) || !currentGroupMembers.length) {
    box.classList.remove("visible");
    box.innerHTML = "";
    return;
  }

  box.classList.add("visible");
  box.innerHTML = currentGroupMembers.map((m) => `
    <div class="manual-split-row">
      <label>${m.name}</label>
      <input type="text" inputmode="numeric" class="money manual-share-input" data-user-id="${m.id}" placeholder="${{ manual: "Monto", percent: "%", shares: "Partes" }[method]}">
    </div>
  `).join("") + `<div class="manual-split-total" id="manual-split-total"></div>`;

  box.querySelectorAll(".manual-share-input").forEach((input) => {
    attachMoney(input);
    input.addEventListener("input", updateManualSplitTotal);
  });
  updateManualSplitTotal();
}

function updateManualSplitTotal() {
  const box = document.getElementById("manual-split-box");
  if (!box.classList.contains("visible")) return;

  const inputs = box.querySelectorAll(".manual-share-input");
  let sum = 0;
  inputs.forEach((i) => { sum += moneyValue(i); });

  const method = document.getElementById("expense-split-method").value;
  if (method !== "manual") {
    const t = document.getElementById("manual-split-total");
    if (method === "percent") {
      t.textContent = sum === 100 ? "Suma: 100% (correcto)" : `Suma: ${sum}% · ${sum < 100 ? "faltan " + (100 - sum) : "sobran " + (sum - 100)}% para llegar a 100%`;
      t.style.color = sum === 100 ? "var(--success)" : "var(--danger)";
    } else {
      const amt = moneyValue(document.getElementById("expense-amount"));
      t.textContent = sum ? `Total: ${sum} partes · cada parte = ${fmt(amt / sum)}` : "Indica cuántas partes le toca a cada uno";
      t.style.color = "var(--muted)";
    }
    return;
  }

  const amount = moneyValue(document.getElementById("expense-amount"));
  const totalDiv = document.getElementById("manual-split-total");
  const diff = amount - sum;

  if (Math.abs(diff) < 0.5) {
    totalDiv.textContent = `Suma: ${fmt(sum)} (coincide con el total)`;
    totalDiv.style.color = "var(--success)";
  } else {
    totalDiv.textContent = `Suma: ${fmt(sum)} · Faltan ${fmt(diff)} para llegar al total (${fmt(amount)})`;
    totalDiv.style.color = "var(--danger)";
  }
}

// ---------- Gastos ----------
document.getElementById("add-expense-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const description = document.getElementById("expense-desc").value;
  const amount = moneyValue(document.getElementById("expense-amount"));
  const paid_by_id = parseInt(document.getElementById("expense-payer").value);
  const split_method = document.getElementById("expense-split-method").value;
  const category = document.getElementById("expense-category").value;

  const payload = { description, amount, paid_by_id, split_method, category };

  if (SPLIT_INPUT_METHODS.includes(split_method)) {
    const inputs = document.querySelectorAll(".manual-share-input");
    payload.manual_shares = Array.from(inputs).map((i) => ({
      user_id: parseInt(i.dataset.userId),
      amount: moneyValue(i),
    }));
  }

  try {
    await apiFetch(`/groups/${currentGroupId}/expenses/${editingExpenseId || ""}`, {
      method: editingExpenseId ? "PUT" : "POST",
      body: JSON.stringify(payload),
    });
    stopEditExpense();
    document.getElementById("expense-desc").value = "";
    document.getElementById("expense-amount").value = "";
    document.getElementById("expense-split-method").value = "equal";
    buildManualSplitBox();
    document.getElementById("expense-error").textContent = "";
    await loadExpenses();
    await loadBalances();
  } catch (err) {
    document.getElementById("expense-error").textContent = err.message;
  }
});

async function loadExpenses() {
  const expenses = await apiFetch(`/groups/${currentGroupId}/expenses/`);
  const list = document.getElementById("expenses-list");
  list.innerHTML = "";
  if (expenses.length === 0) {
    list.innerHTML = "<li>No hay gastos registrados aún.</li>";
  }
  const methodLabels = { equal: "partes iguales", income: "proporcional al sueldo", manual: "montos manuales", percent: "por porcentajes", shares: "por partes" };
  renderCatChart(expenses);

  expenses.slice().reverse().forEach((exp, i) => {
    const li = document.createElement("li");
    li.style.animationDelay = `${i * 0.04}s`;
    const methodLabel = methodLabels[exp.split_method] || exp.split_method;
    const icon = categoryIcon(exp.category);

    const mySplit = exp.splits.find((s) => s.user_id === currentUser.id);
    let myStatusHtml = "";
    if (mySplit && !mySplit.settled) {
      myStatusHtml = `<button class="mark-paid-btn" data-split-id="${mySplit.id}">Marcar como pagado</button>`;
    } else if (mySplit && mySplit.settled) {
      myStatusHtml = `<span class="settled-badge">Pagado</span>`;
    }

    li.innerHTML = `
      <div class="expense-row">
        ${icon}
        <div>
          <strong>${exp.description}</strong><br>
          <small>${txCode(exp.id)} · Pagó ${exp.paid_by_name} · ${fmt(exp.amount)} · ${methodLabel}</small>
        </div>
      </div>
      <div style="display:flex; align-items:center; gap:8px;">
        ${myStatusHtml}
        ${exp.category !== "pago" ? `<button class="icon-btn edit-btn" title="Editar gasto" aria-label="Editar gasto"><svg class="ic" style="width:18px;height:18px"><use href="#i-pen"/></svg></button>` : ""}
        <button class="delete-btn" data-id="${exp.id}" title="Eliminar gasto">×</button>
      </div>
    `;
    li.querySelector(".delete-btn").addEventListener("click", async () => {
      await apiFetch(`/groups/${currentGroupId}/expenses/${exp.id}`, { method: "DELETE" });
      await loadExpenses();
      await loadBalances();
      await loadReminderBanner();
    });
    const editBtn = li.querySelector(".edit-btn");
    if (editBtn) editBtn.addEventListener("click", () => startEditExpense(exp));
    const cm = document.createElement("div");
    cm.style.flexBasis = "100%";
    const cmBtn = document.createElement("button");
    cmBtn.type = "button";
    cmBtn.className = "link-btn cm-btn";
    cmBtn.textContent = `Comentarios (${exp.comments_count || 0})`;
    const cmBox = document.createElement("div");
    cmBox.className = "comments-box";
    cmBox.style.display = "none";
    cmBtn.addEventListener("click", async () => {
      if (cmBox.style.display !== "none") { cmBox.style.display = "none"; return; }
      cmBox.style.display = "block";
      await renderComments(exp, cmBtn, cmBox);
    });
    cm.append(cmBtn, cmBox);
    li.appendChild(cm);
    const paidBtn = li.querySelector(".mark-paid-btn");
    if (paidBtn) {
      paidBtn.addEventListener("click", async () => {
        const splitId = paidBtn.dataset.splitId;
        await apiFetch(`/groups/${currentGroupId}/expenses/${exp.id}/settle/${splitId}`, { method: "POST" });
        await loadExpenses();
        await loadBalances();
        await loadReminderBanner();
      });
    }
    list.appendChild(li);
  });
}

// ---------- Balances ----------
async function loadBalances() {
  const balances = await apiFetch(`/groups/${currentGroupId}/balances/`);
  const list = document.getElementById("balances-list");
  list.innerHTML = "";
  balances.forEach((b) => {
    const li = document.createElement("li");
    let cls = "balance-zero";
    let label = "está al día";
    if (b.balance > 0.5) { cls = "balance-positive"; label = `le deben ${fmt(b.balance)}`; }
    else if (b.balance < -0.5) { cls = "balance-negative"; label = `debe ${fmt(-b.balance)}`; }
    li.innerHTML = `<span>${b.user_name}</span><span class="${cls}">${label}</span>`;
    list.appendChild(li);
  });

  const simplified = await apiFetch(`/groups/${currentGroupId}/balances/simplified`);
  const simplifiedList = document.getElementById("simplified-list");
  simplifiedList.innerHTML = "";
  if (simplified.length === 0) {
    simplifiedList.innerHTML = "<li>Todas las cuentas están saldadas</li>";
  }
  simplified.forEach((tx) => {
    const li = document.createElement("li");
    li.innerHTML = `<span>${tx.from_user} → ${tx.to_user}</span><span class="debt-right"><strong>${fmt(tx.amount)}</strong></span>`;
    const btn = document.createElement("button");
    btn.className = "mark-paid-btn";
    btn.textContent = "Registrar pago";
    btn.addEventListener("click", () => recordPayment(tx));
    li.querySelector(".debt-right").appendChild(btn);
    simplifiedList.appendChild(li);
  });
}

// ---------- Menú lateral y favoritos ----------
let allGroups = [];
const STAR = '<svg viewBox="0 0 24 24" width="22" height="22"><path d="M12 2.5l2.9 6.1 6.6.8-4.9 4.6 1.3 6.6L12 17.3l-5.9 3.3 1.3-6.6-4.9-4.6 6.6-.8z"/></svg>';
const drawer = document.getElementById("drawer");
const overlay = document.getElementById("drawer-overlay");
function openDrawer() { drawer.classList.add("open"); overlay.classList.add("open"); }
function closeDrawer() { drawer.classList.remove("open"); overlay.classList.remove("open"); }
document.getElementById("menu-btn").addEventListener("click", openDrawer);
document.getElementById("drawer-close").addEventListener("click", closeDrawer);
overlay.addEventListener("click", closeDrawer);
document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeDrawer(); });

function favKey() { return "favs_" + (currentUser ? currentUser.id : ""); }
function getFavs() {
  try { return new Set(JSON.parse(localStorage.getItem(favKey()) || "[]")); } catch { return new Set(); }
}
function toggleFav(id) {
  const f = getFavs();
  if (f.has(id)) f.delete(id); else f.add(id);
  localStorage.setItem(favKey(), JSON.stringify([...f]));
  renderGroupLists();
}
function groupRow(g, favs, inDrawer) {
  const li = document.createElement("li");
  li.className = "group-item" + (g.id === currentGroupId ? " current" : "");
  const name = document.createElement("span");
  name.textContent = g.name;
  const right = document.createElement("span");
  right.className = "g-right";
  if (!inDrawer) {
    const n = document.createElement("span");
    n.textContent = `${g.members.length} ${g.members.length === 1 ? "integrante" : "integrantes"}`;
    right.appendChild(n);
  }
  const star = document.createElement("button");
  const isFav = favs.has(g.id);
  star.className = "star-btn" + (isFav ? " on" : "");
  star.innerHTML = STAR;
  star.setAttribute("aria-label", isFav ? "Quitar de favoritos" : "Marcar como favorito");
  star.addEventListener("click", (e) => { e.stopPropagation(); toggleFav(g.id); });
  right.appendChild(star);
  li.append(name, right);
  li.addEventListener("click", () => { closeDrawer(); currentSectionId = sectionOf(g); openGroup(g.id); });
  return li;
}
function renderGroupLists() {
  const favs = getFavs();
  const sorted = allGroups.filter((g) => !currentSectionId || sectionOf(g) === currentSectionId).sort((a, b) => favs.has(b.id) - favs.has(a.id));
  const list = document.getElementById("groups-list");
  list.innerHTML = "";
  renderTiles();
  if (!sorted.length) list.innerHTML = "<li>Aún no tienes grupos. ¡Crea el primero!</li>";
  sorted.forEach((g) => list.appendChild(groupRow(g, favs, false)));

  const body = document.getElementById("drawer-body");
  body.innerHTML = "";
  const favList = allGroups.filter((g) => favs.has(g.id));
  const others = allGroups.filter((g) => !favs.has(g.id));
  const section = (title, arr) => {
    if (!arr.length) return;
    const h = document.createElement("h4");
    h.textContent = title;
    const ul = document.createElement("ul");
    ul.className = "list";
    arr.forEach((g) => ul.appendChild(groupRow(g, favs, true)));
    body.append(h, ul);
  };
  section("Favoritos", favList);
  section(favList.length ? "Otros grupos" : "Todos los grupos", others);
  if (!allGroups.length) body.innerHTML = '<p class="hint-text">Aún no tienes grupos.</p>';
}

// ---------- Registro: foto, pestañas y login ----------
let avatarData = null;
document.getElementById("avatar-input").addEventListener("change", (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const img = new Image();
  const url = URL.createObjectURL(file);
  img.onload = () => {
    const c = document.createElement("canvas");
    c.width = c.height = 256;
    const s = Math.min(img.width, img.height);
    c.getContext("2d").drawImage(img, (img.width - s) / 2, (img.height - s) / 2, s, s, 0, 0, 256, 256);
    avatarData = c.toDataURL("image/jpeg", 0.8);
    const p = document.getElementById("avatar-preview");
    p.src = avatarData; p.hidden = false;
    document.querySelector(".silhouette").style.display = "none";
    URL.revokeObjectURL(url);
  };
  img.src = url;
});
document.querySelectorAll(".tab-btn").forEach((b) => b.addEventListener("click", () => {
  document.querySelector(".glass").classList.toggle("register-mode", b.dataset.tab === "register");
}));
document.getElementById("forgot").addEventListener("click", (e) => {
  e.preventDefault();
  document.getElementById("login-error").textContent = "Recuperar contraseña estará disponible pronto.";
});

// ---------- Ventanas (secciones) personalizables ----------
const DEFAULT_SECTIONS = [
  { id: "s-hogar", name: "Hogar", icon: "home" },
  { id: "s-salidas", name: "Salidas", icon: "out" },
  { id: "s-fijos", name: "Gastos continuos", icon: "repeat" },
  { id: "s-imprevistos", name: "Imprevistos", icon: "bolt" },
];
let layout = { sections: DEFAULT_SECTIONS.map((s) => ({ ...s })), assign: {}, active: null };
let currentSectionId = null;
let editMode = false;

async function loadLayout() {
  try {
    const r = await apiFetch("/auth/me/layout");
    if (r.layout) layout = JSON.parse(r.layout);
  } catch (e) { /* usa la distribución por defecto */ }
}
function saveLayout() {
  apiFetch("/auth/me/layout", { method: "PUT", body: JSON.stringify({ layout: JSON.stringify(layout) }) }).catch(() => {});
}
function sectionOf(g) {
  const id = layout.assign[g.id];
  return layout.sections.some((s) => s.id === id) ? id : (layout.sections[0] || {}).id;
}
function renderHomeHeader() {
  const box = document.getElementById("home-avatar");
  box.innerHTML = "";
  if (currentUser.avatar) {
    const im = document.createElement("img");
    im.src = currentUser.avatar;
    box.appendChild(im);
  } else {
    box.textContent = currentUser.name.charAt(0).toUpperCase();
  }
}
function renderTiles() {
  const grid = document.getElementById("tiles");
  grid.innerHTML = "";
  grid.classList.toggle("editing", editMode);
  document.getElementById("edit-tiles").textContent = editMode ? "Listo" : "Editar";
  layout.sections.forEach((s, i) => {
    const n = allGroups.filter((g) => sectionOf(g) === s.id).length;
    const t = document.createElement("div");
    t.className = "tile" + (s.id === layout.active ? " active" : "");
    t.dataset.id = s.id;
    t.style.order = i;
    t.innerHTML = `<svg class="ic tile-ic"><use href="#t-${s.icon || "folder"}"/></svg><strong></strong><small>${n} ${n === 1 ? "grupo" : "grupos"}</small>`;
    t.querySelector("strong").textContent = s.name;
    if (editMode) {
      t.insertAdjacentHTML("beforeend", `<button class="tile-act" data-a="ren" style="right:44px" aria-label="Renombrar"><svg class="ic" width="16" height="16"><use href="#i-pen"/></svg></button><button class="tile-act" data-a="del" style="right:8px" aria-label="Eliminar">&times;</button>`);
      t.querySelector('[data-a="ren"]').addEventListener("click", () => {
        const name = (prompt("Nuevo nombre de la ventana", s.name) || "").trim();
        if (name) { s.name = name; saveLayout(); renderTiles(); }
      });
      t.querySelector('[data-a="del"]').addEventListener("click", () => {
        if (layout.sections.length < 2) return alert("Debe quedar al menos una ventana.");
        if (!confirm(`¿Eliminar "${s.name}"? Sus grupos pasarán a la primera ventana.`)) return;
        layout.sections = layout.sections.filter((x) => x.id !== s.id);
        saveLayout(); renderTiles();
      });
    } else {
      t.addEventListener("click", () => openSection(s.id));
    }
    grid.appendChild(t);
  });
  const add = document.createElement("div");
  add.className = "tile tile-add";
  add.textContent = "+ Nueva ventana";
  add.addEventListener("click", () => {
    const name = (prompt("Nombre de la nueva ventana (ej: Viajes)") || "").trim();
    if (!name) return;
    layout.sections.push({ id: "s-" + Date.now(), name, icon: "folder" });
    saveLayout(); renderTiles();
  });
  grid.appendChild(add);
}
function openSection(id) {
  currentSectionId = id;
  layout.active = id;
  saveLayout();
  document.getElementById("section-name").textContent = layout.sections.find((s) => s.id === id).name;
  renderGroupLists();
  renderSubs();
  show("section-screen");
}
document.getElementById("back-home").addEventListener("click", () => {
  currentSectionId = null;
  renderGroupLists();
  loadReminderBanner();
  show("groups-screen");
});
document.getElementById("edit-tiles").addEventListener("click", () => { editMode = !editMode; renderTiles(); });

// Arrastrar ventanas (mouse y touch) en modo edición
(function enableTileDrag() {
  const grid = document.getElementById("tiles");
  let el = null, sx = 0, sy = 0;
  grid.addEventListener("pointerdown", (e) => {
    if (!editMode || e.target.closest(".tile-act")) return;
    const t = e.target.closest(".tile[data-id]");
    if (!t) return;
    el = t; sx = e.clientX; sy = e.clientY;
    t.setPointerCapture(e.pointerId);
    t.classList.add("dragging");
  });
  grid.addEventListener("pointermove", (e) => {
    if (!el) return;
    el.style.pointerEvents = "none";
    const over = document.elementFromPoint(e.clientX, e.clientY)?.closest(".tile[data-id]");
    if (over && over !== el) {
      const a = el.getBoundingClientRect();
      const tmp = over.style.order;
      over.style.order = el.style.order;
      el.style.order = tmp;
      const b = el.getBoundingClientRect();
      sx += b.left - a.left; sy += b.top - a.top;
    }
    el.style.transform = `translate(${e.clientX - sx}px, ${e.clientY - sy}px)`;
  });
  const end = () => {
    if (!el) return;
    const ids = [...grid.querySelectorAll(".tile[data-id]")].sort((a, b) => a.style.order - b.style.order).map((t) => t.dataset.id);
    layout.sections.sort((a, b) => ids.indexOf(a.id) - ids.indexOf(b.id));
    el = null;
    saveLayout(); renderTiles();
  };
  grid.addEventListener("pointerup", end);
  grid.addEventListener("pointercancel", end);
})();

// ---------- Suscripciones (ventana "Gastos continuos") ----------
const SUB_PRESETS = { "Spotify": "#1DB954", "Netflix": "#E50914", "Disney+": "#113CCF", "HBO Max": "#5A2D91", "YouTube Premium": "#FF0000", "Amazon Prime": "#00A8E1", "Apple Music": "#FA243C", "iCloud": "#3693F5", "ChatGPT": "#10A37F", "Canva": "#00C4CC" };
const SUB_FALLBACK = ["#7A3B72", "#F0606B", "#F9A66C", "#9A6FC3", "#C96B9E"];
let subImg = null;
document.getElementById("sub-presets").innerHTML = Object.keys(SUB_PRESETS).map((n) => `<option value="${n}">`).join("");

document.getElementById("sub-img").addEventListener("change", (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const img = new Image();
  const url = URL.createObjectURL(file);
  img.onload = () => {
    const c = document.createElement("canvas");
    c.width = c.height = 64;
    const s = Math.min(img.width, img.height);
    c.getContext("2d").drawImage(img, (img.width - s) / 2, (img.height - s) / 2, s, s, 0, 0, 64, 64);
    subImg = c.toDataURL("image/jpeg", 0.75);
    document.getElementById("sub-img-label").textContent = "Imagen lista ✓";
    URL.revokeObjectURL(url);
  };
  img.src = url;
});

document.getElementById("sub-form").addEventListener("submit", (e) => {
  e.preventDefault();
  const raw = document.getElementById("sub-name").value.trim();
  const amount = moneyValue(document.getElementById("sub-amount"));
  if (!raw || amount <= 0) return;
  const preset = Object.keys(SUB_PRESETS).find((k) => k.toLowerCase() === raw.toLowerCase());
  const name = preset || raw;
  const color = preset ? SUB_PRESETS[preset] : SUB_FALLBACK[name.length % SUB_FALLBACK.length];
  layout.subs = layout.subs || [];
  layout.subs.push({ id: "u" + Date.now(), name, amount, color, logo: subImg });
  saveLayout();
  e.target.reset();
  subImg = null;
  document.getElementById("sub-img-label").textContent = "Imagen (opcional)";
  renderSubs();
});

function renderSubs() {
  const card = document.getElementById("subs-card");
  const visible = currentSectionId === "s-fijos";
  card.classList.toggle("hidden", !visible);
  if (!visible) return;
  const subs = layout.subs || [];
  document.getElementById("subs-total").textContent = fmt(subs.reduce((t, s) => t + s.amount, 0));
  const ul = document.getElementById("subs-list");
  ul.innerHTML = "";
  if (!subs.length) ul.innerHTML = "<li>Aún no agregas suscripciones.</li>";
  subs.forEach((s) => {
    const li = document.createElement("li");
    const row = document.createElement("div");
    row.className = "sub-row";
    const badge = document.createElement("span");
    badge.className = "category-badge sub-badge";
    badge.style.background = s.color;
    if (s.logo) { const im = document.createElement("img"); im.src = s.logo; badge.appendChild(im); }
    else badge.textContent = s.name.charAt(0).toUpperCase();
    const nm = document.createElement("strong");
    nm.textContent = s.name;
    row.append(badge, nm);
    const right = document.createElement("div");
    right.style.cssText = "display:flex;align-items:center;gap:6px";
    const amt = document.createElement("span");
    amt.className = "sub-amount";
    amt.textContent = fmt(s.amount) + " /mes";
    const del = document.createElement("button");
    del.className = "delete-btn";
    del.innerHTML = "&times;";
    del.setAttribute("aria-label", "Eliminar suscripción");
    del.addEventListener("click", () => {
      layout.subs = layout.subs.filter((x) => x.id !== s.id);
      saveLayout(); renderSubs();
    });
    right.append(amt, del);
    li.append(row, right);
    ul.appendChild(li);
  });
}

// ---------- Navegación del menú ----------
document.addEventListener("click", (e) => {
  const b = e.target.closest("[data-go]");
  if (!b) return;
  const target = b.dataset.go;
  closeDrawer();
  if (target === "groups-screen") { currentSectionId = null; renderGroupLists(); loadReminderBanner(); }
  if (target === "moves-screen") loadMoves();
  show(target);
});

// ---------- Notificaciones (campanita) ----------
const notifPanel = document.getElementById("notif-panel");
let notifSig = "";
function renderBell(resumen) {
  const items = resumen.detalle.map((d) => d.balance > 0
    ? `En ${d.group_name} te deben ${fmt(d.balance)}`
    : `En ${d.group_name} debes ${fmt(-d.balance)}`);
  notifSig = JSON.stringify(items);
  const ul = document.getElementById("notif-list");
  ul.innerHTML = "";
  if (!items.length) ul.innerHTML = "<li>No tienes notificaciones.</li>";
  items.forEach((t) => { const li = document.createElement("li"); li.textContent = t; ul.appendChild(li); });
  const seen = localStorage.getItem("notif_seen_" + currentUser.id) === notifSig;
  const badge = document.getElementById("bell-badge");
  badge.textContent = items.length;
  badge.classList.toggle("hidden", !items.length || seen);
}
document.getElementById("bell-btn").addEventListener("click", (e) => {
  e.stopPropagation();
  notifPanel.classList.toggle("hidden");
  if (!notifPanel.classList.contains("hidden")) {
    localStorage.setItem("notif_seen_" + currentUser.id, notifSig);
    document.getElementById("bell-badge").classList.add("hidden");
  }
});
document.addEventListener("click", (e) => { if (!e.target.closest("#notif-panel")) notifPanel.classList.add("hidden"); });

// ---------- Movimientos de plata y buscador ----------
const txCode = (id) => "FA-" + String(id).padStart(5, "0");
let movesData = [];
async function loadMoves() {
  const lists = await Promise.all(allGroups.map((g) =>
    apiFetch(`/groups/${g.id}/expenses/`).then((ex) => ex.map((e) => ({ ...e, group_name: g.name }))).catch(() => [])));
  movesData = lists.flat().sort((a, b) => b.id - a.id);
  renderMoves();
}
function renderMoves() {
  const q = document.getElementById("moves-search").value.trim().toLowerCase().replace(/\./g, "");
  const rows = movesData.filter((e) => !q || [txCode(e.id), e.description, e.group_name, e.paid_by_name, Math.round(e.amount)].join(" ").toLowerCase().includes(q));
  const total = rows.reduce((t, e) => t + e.amount, 0);
  document.getElementById("moves-summary").textContent = `${rows.length} ${rows.length === 1 ? "movimiento" : "movimientos"} · ${fmt(total)}`;
  const ul = document.getElementById("moves-list");
  ul.innerHTML = "";
  if (!rows.length) ul.innerHTML = `<li>${movesData.length ? "Sin resultados para tu búsqueda." : "Aún no hay movimientos."}</li>`;
  rows.forEach((e) => {
    const mine = e.splits.find((s) => s.user_id === currentUser.id);
    const li = document.createElement("li");
    const date = new Date(e.created_at).toLocaleDateString("es-CL");
    li.innerHTML = `<div class="expense-row">${categoryIcon(e.category)}<div><strong class="m-desc"></strong><br><small class="m-meta"></small></div></div><div class="m-amt"><strong>${fmt(e.amount)}</strong>${mine ? `<br><small>Tu parte ${fmt(mine.amount_owed)}</small>` : ""}</div>`;
    li.querySelector(".m-desc").textContent = e.description;
    li.querySelector(".m-meta").textContent = `${txCode(e.id)} · ${e.group_name} · ${date}`;
    ul.appendChild(li);
  });
}
document.getElementById("moves-search").addEventListener("input", renderMoves);

// ---------- Ajustes: brillo y color de fondo (se guardan en este dispositivo) ----------
const BGS = { Lavanda: ["#f1ecf7", "#fbe3e6", "#e7dcf5"], Menta: ["#eaf6f2", "#d6f1e6", "#e3f0fa"], Durazno: ["#fbf0e8", "#fde0d0", "#f7e4ee"], Cielo: ["#eaf1fb", "#d9e6fa", "#ece6fa"], Gris: ["#f1f2f4", "#e8eaee", "#f6f6f8"] };
let settings = JSON.parse(localStorage.getItem("settings") || "null") || { brightness: 100, bg: BGS.Lavanda };
function applySettings() {
  const r = document.documentElement;
  r.style.setProperty("--bg", settings.bg[0]);
  r.style.setProperty("--g1", settings.bg[1]);
  r.style.setProperty("--g2", settings.bg[2]);
  r.style.filter = settings.brightness === 100 ? "" : `brightness(${settings.brightness}%)`;
  document.getElementById("set-brightness").value = settings.brightness;
  document.getElementById("set-brightness-val").textContent = settings.brightness + "%";
  document.querySelectorAll(".swatch").forEach((s) => s.classList.toggle("on", s.dataset.c === settings.bg.join()));
}
function saveSettings() { localStorage.setItem("settings", JSON.stringify(settings)); applySettings(); }
Object.entries(BGS).forEach(([name, c]) => {
  const b = document.createElement("button");
  b.type = "button"; b.className = "swatch"; b.title = name; b.dataset.c = c.join();
  b.style.background = `linear-gradient(135deg, ${c[1]}, ${c[2]})`;
  b.addEventListener("click", () => { settings.bg = c; saveSettings(); });
  document.getElementById("bg-swatches").appendChild(b);
});
document.getElementById("set-brightness").addEventListener("input", (e) => { settings.brightness = +e.target.value; saveSettings(); });
document.getElementById("bg-custom").addEventListener("input", (e) => { const c = e.target.value; settings.bg = [c, c, c]; saveSettings(); });
document.getElementById("set-reset").addEventListener("click", () => { settings = { brightness: 100, bg: BGS.Lavanda }; saveSettings(); });
applySettings();

// ---------- Invitación por enlace (WhatsApp) ----------
const pendingKey = "pending_join";
(function captureInvite() {
  const t = new URLSearchParams(location.search).get("join");
  if (t) { localStorage.setItem(pendingKey, t); history.replaceState(null, "", location.pathname); }
})();
let lastInvite = null;
const inviteLink = (t) => `${location.origin}/?join=${encodeURIComponent(t)}`;

async function prepareInvite(regenerate = false) {
  const gid = currentGroupId;
  const a = document.getElementById("invite-wa");
  const note = document.getElementById("invite-note");
  a.removeAttribute("href");
  try {
    const inv = await apiFetch(`/groups/${gid}/invite${regenerate ? "?regenerate=true" : ""}`, { method: "POST" });
    if (gid !== currentGroupId) return;
    lastInvite = inv;
    const name = document.getElementById("group-detail-name").textContent;
    a.href = "https://wa.me/?text=" + encodeURIComponent(`Te invito al grupo "${name}" en fasti para dividir gastos: ${inviteLink(inv.token)}`);
    note.textContent = regenerate ? "Enlace nuevo listo. El anterior ya no funciona." : "El enlace vence en 7 días. Quien lo reciba podrá unirse al grupo.";
  } catch (err) { note.textContent = err.message; }
}
document.getElementById("invite-copy").addEventListener("click", async () => {
  if (!lastInvite) return;
  const note = document.getElementById("invite-note");
  try { await navigator.clipboard.writeText(inviteLink(lastInvite.token)); note.textContent = "Enlace copiado."; }
  catch (e) { note.textContent = inviteLink(lastInvite.token); }
});
document.getElementById("invite-reset").addEventListener("click", () => {
  if (confirm("El enlace anterior dejará de funcionar. ¿Generar uno nuevo?")) prepareInvite(true);
});

async function showPendingJoin() {
  const t = localStorage.getItem(pendingKey);
  if (!t) return false;
  const accept = document.getElementById("join-accept");
  document.getElementById("join-error").textContent = "";
  try {
    const info = await apiFetch(`/groups/invite/${encodeURIComponent(t)}`);
    document.getElementById("join-title").textContent = `Te invitaron a ${info.group_name}`;
    document.getElementById("join-sub").textContent = `${info.members} ${info.members === 1 ? "integrante" : "integrantes"} en el grupo.`;
    accept.style.display = "";
  } catch (e) {
    document.getElementById("join-title").textContent = "Invitación no disponible";
    document.getElementById("join-sub").textContent = e.message;
    accept.style.display = "none";
  }
  show("join-screen");
  return true;
}
document.getElementById("join-accept").addEventListener("click", async () => {
  try {
    const g = await apiFetch(`/groups/invite/${encodeURIComponent(localStorage.getItem(pendingKey))}`, { method: "POST" });
    localStorage.removeItem(pendingKey);
    await loadGroups();
    currentSectionId = sectionOf(g);
    await openGroup(g.id);
  } catch (e) { document.getElementById("join-error").textContent = e.message; }
});
document.getElementById("join-cancel").addEventListener("click", () => {
  localStorage.removeItem(pendingKey);
  currentSectionId = null; renderGroupLists(); show("groups-screen");
});
async function showInviteBanner() {
  const t = localStorage.getItem(pendingKey);
  if (!t) return;
  const el = document.getElementById("auth-invite");
  try {
    const i = await apiFetch(`/groups/invite/${encodeURIComponent(t)}`);
    el.textContent = `Te invitaron a "${i.group_name}". Crea tu cuenta o inicia sesión para unirte.`;
    document.querySelector("[data-tab=register]").click();
  } catch (e) { el.textContent = e.message; localStorage.removeItem(pendingKey); }
  el.classList.remove("hidden");
}

// ---------- Editar gasto y comentarios ----------
let editingExpenseId = null;
function startEditExpense(exp) {
  editingExpenseId = exp.id;
  document.getElementById("expense-desc").value = exp.description;
  document.getElementById("expense-amount").value = Math.round(exp.amount).toLocaleString("es-CL");
  document.getElementById("expense-category").value = exp.category;
  document.getElementById("expense-payer").value = exp.paid_by_id;
  const keep = ["equal", "income"].includes(exp.split_method);
  document.getElementById("expense-split-method").value = keep ? exp.split_method : "manual";
  buildManualSplitBox();
  if (!keep) {
    const inputs = [...document.querySelectorAll(".manual-share-input")];
    const vals = inputs.map((i) => { const s = exp.splits.find((x) => x.user_id === +i.dataset.userId); return s ? Math.round(s.amount_owed) : 0; });
    const last = vals.map((v) => v > 0).lastIndexOf(true);
    if (last >= 0) vals[last] += Math.round(exp.amount) - vals.reduce((a, b) => a + b, 0);
    inputs.forEach((i, k) => { i.value = vals[k] ? vals[k].toLocaleString("es-CL") : ""; });
  }
  updateManualSplitTotal();
  document.getElementById("expense-submit").textContent = "Guardar cambios";
  document.getElementById("expense-cancel-edit").style.display = "";
  document.getElementById("add-expense-form").scrollIntoView({ behavior: "smooth", block: "center" });
}
function stopEditExpense() {
  editingExpenseId = null;
  document.getElementById("expense-submit").textContent = "Agregar gasto";
  document.getElementById("expense-cancel-edit").style.display = "none";
}
document.getElementById("expense-cancel-edit").addEventListener("click", () => {
  stopEditExpense();
  document.getElementById("expense-desc").value = "";
  document.getElementById("expense-amount").value = "";
  document.getElementById("expense-split-method").value = "equal";
  buildManualSplitBox();
});

async function renderComments(exp, btn, box) {
  const base = `/groups/${currentGroupId}/expenses/${exp.id}/comments`;
  const list = await apiFetch(base);
  box.innerHTML = "";
  list.forEach((c) => {
    const p = document.createElement("p");
    p.className = "comment";
    const who = document.createElement("strong");
    who.textContent = c.user_name;
    const when = document.createElement("small");
    when.textContent = " · " + new Date(c.created_at + "Z").toLocaleString("es-CL", { dateStyle: "short", timeStyle: "short" });
    const txt = document.createElement("span");
    txt.textContent = c.text;
    p.append(who, when, document.createElement("br"), txt);
    box.appendChild(p);
  });
  if (!list.length) box.insertAdjacentHTML("afterbegin", '<p class="hint-text">Aún no hay comentarios.</p>');
  const form = document.createElement("div");
  form.className = "comment-form";
  const input = document.createElement("input");
  input.type = "text"; input.maxLength = 500; input.placeholder = "Escribe un comentario";
  const send = document.createElement("button");
  send.type = "button"; send.textContent = "Enviar";
  const go = async () => {
    const text = input.value.trim();
    if (!text) return;
    try {
      await apiFetch(base, { method: "POST", body: JSON.stringify({ text }) });
      exp.comments_count = (exp.comments_count || 0) + 1;
      btn.textContent = `Comentarios (${exp.comments_count})`;
      await renderComments(exp, btn, box);
    } catch (e) { alert(e.message); }
  };
  send.addEventListener("click", go);
  input.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); go(); } });
  form.append(input, send);
  box.appendChild(form);
}

// ---------- Registrar pago, gráfico por categoría y exportar CSV ----------
async function recordPayment(tx) {
  const from = currentGroupMembers.find((m) => m.name === tx.from_user);
  const to = currentGroupMembers.find((m) => m.name === tx.to_user);
  if (!from || !to) return alert("No se pudo identificar a los participantes del pago.");
  const raw = prompt(`¿Cuánto pagó ${from.name} a ${to.name}?`, Math.round(tx.amount).toLocaleString("es-CL"));
  const amount = parseInt((raw || "").replace(/\D/g, ""), 10) || 0;
  if (amount <= 0) return;
  try {
    await apiFetch(`/groups/${currentGroupId}/expenses/`, { method: "POST", body: JSON.stringify({
      description: `Pago de ${from.name} a ${to.name}`, amount, paid_by_id: from.id, category: "pago",
      split_method: "manual", split_between_ids: [to.id], manual_shares: [{ user_id: to.id, amount }] }) });
    await refreshGroupDetail();
  } catch (e) { alert(e.message); }
}

function renderCatChart(expenses) {
  const box = document.getElementById("cat-chart");
  const totals = {};
  expenses.filter((e) => e.category !== "pago").forEach((e) => { totals[e.category] = (totals[e.category] || 0) + e.amount; });
  const entries = Object.entries(totals).sort((a, b) => b[1] - a[1]);
  box.innerHTML = "";
  if (!entries.length) { box.innerHTML = '<p class="hint-text">Aún no hay gastos para graficar.</p>'; return; }
  const sum = entries.reduce((t, [, v]) => t + v, 0);
  const total = document.createElement("p");
  total.className = "hint-text";
  total.textContent = `Total gastado: ${fmt(sum)}`;
  box.appendChild(total);
  entries.forEach(([key, v]) => {
    const c = categories.find((x) => x.key === key) || { label: key, color: "#A99AB5" };
    const row = document.createElement("div");
    row.className = "cat-row";
    row.innerHTML = '<div class="cat-top"><span></span><strong></strong></div><div class="cat-bar"><i></i></div>';
    row.querySelector("span").textContent = c.label;
    row.querySelector("strong").textContent = `${fmt(v)} · ${Math.round((v / sum) * 100)}%`;
    const bar = row.querySelector("i");
    bar.style.width = (v / entries[0][1]) * 100 + "%";
    bar.style.background = c.color;
    box.appendChild(row);
  });
}

document.getElementById("moves-export").addEventListener("click", () => {
  const q = document.getElementById("moves-search").value.trim().toLowerCase();
  const rows = movesData.filter((e) => !q || [txCode(e.id), e.description, e.group_name, e.paid_by_name, Math.round(e.amount)].join(" ").toLowerCase().includes(q));
  const methods = { equal: "partes iguales", income: "proporcional al sueldo", manual: "montos manuales", percent: "por porcentajes", shares: "por partes" };
  const esc = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const lines = [["Código", "Fecha", "Grupo", "Descripción", "Categoría", "Pagó", "Monto", "División"].map(esc).join(";")];
  rows.forEach((e) => lines.push([txCode(e.id), String(e.created_at).slice(0, 10), e.group_name, e.description, e.category, e.paid_by_name, Math.round(e.amount), methods[e.split_method] || e.split_method].map(esc).join(";")));
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob(["\ufeff" + lines.join("\r\n")], { type: "text/csv;charset=utf-8" }));
  a.download = "fasti-movimientos.csv";
  a.click();
  URL.revokeObjectURL(a.href);
});

// ---------- Inicio ----------
if (token && currentUser) {
  initAfterLogin();
} else {
  show("auth-screen");
  showInviteBanner();
}

const API = ""; // mismo origen
let token = localStorage.getItem("token");
let currentUser = JSON.parse(localStorage.getItem("user") || "null");
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
  document.querySelectorAll(".screen").forEach((el) => el.classList.add("hidden"));
  document.getElementById(id).classList.remove("hidden");
}

function fmt(n) {
  return new Intl.NumberFormat("es-CL", { style: "currency", currency: "CLP" }).format(n);
}

function categoryIcon(key) {
  const cat = categories.find((c) => c.key === key);
  return cat ? cat.icon : "📦";
}

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
    onAuthSuccess(data);
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
      body: JSON.stringify({ name, email, password }),
    });
    onAuthSuccess(data);
  } catch (err) {
    document.getElementById("register-error").textContent = err.message;
  }
});

function onAuthSuccess(data) {
  token = data.access_token;
  currentUser = data.user;
  localStorage.setItem("token", token);
  localStorage.setItem("user", JSON.stringify(currentUser));
  initAfterLogin();
}

document.getElementById("logout-btn").addEventListener("click", () => {
  localStorage.removeItem("token");
  localStorage.removeItem("user");
  token = null;
  currentUser = null;
  document.getElementById("user-info").classList.add("hidden");
  show("auth-screen");
});

async function initAfterLogin() {
  document.getElementById("user-info").classList.remove("hidden");
  document.getElementById("user-name-display").textContent = `Hola, ${currentUser.name}`;
  await loadCategories();
  await loadGroups();
  await loadReminderBanner();
  show("groups-screen");
}

async function loadCategories() {
  if (categories.length) return;
  categories = await apiFetch("/categories");
  const select = document.getElementById("expense-category");
  select.innerHTML = categories.map((c) => `<option value="${c.key}">${c.icon} ${capitalize(c.key)}</option>`).join("");
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
    if (resumen.total_le_deben < 0.5 && resumen.total_debe < 0.5) return;

    let cls = "mixed";
    if (resumen.total_debe > 0 && resumen.total_le_deben === 0) cls = "owe";
    if (resumen.total_le_deben > 0 && resumen.total_debe === 0) cls = "owed";

    const lines = resumen.detalle.map((d) => {
      const texto = d.balance > 0
        ? `En <strong>${d.group_name}</strong> te deben ${fmt(d.balance)}`
        : `En <strong>${d.group_name}</strong> debes ${fmt(-d.balance)}`;
      return `<li>${texto}</li>`;
    }).join("");

    container.innerHTML = `
      <div class="reminder-banner ${cls}">
        <h3>📋 Resumen de tus cuentas pendientes</h3>
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
    await apiFetch("/groups/", { method: "POST", body: JSON.stringify({ name }) });
    document.getElementById("new-group-name").value = "";
    document.getElementById("group-error").textContent = "";
    loadGroups();
  } catch (err) {
    document.getElementById("group-error").textContent = err.message;
  }
});

async function loadGroups() {
  const groups = await apiFetch("/groups/");
  const list = document.getElementById("groups-list");
  list.innerHTML = "";
  if (groups.length === 0) {
    list.innerHTML = "<li>Aún no tienes grupos. ¡Crea el primero!</li>";
  }
  groups.forEach((g) => {
    const li = document.createElement("li");
    li.className = "group-item";
    li.innerHTML = `<span>${g.name}</span><span>${g.members.length} integrantes →</span>`;
    li.addEventListener("click", () => openGroup(g.id));
    list.appendChild(li);
  });
}

document.getElementById("back-to-groups").addEventListener("click", () => {
  show("groups-screen");
  loadGroups();
  loadReminderBanner();
});

async function openGroup(groupId) {
  currentGroupId = groupId;
  await refreshGroupDetail();
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
    chip.textContent = m.name;
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
  const income = parseFloat(document.getElementById("my-income").value);
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

// ---------- División manual ----------
document.getElementById("expense-split-method").addEventListener("change", () => {
  buildManualSplitBox();
});
document.getElementById("expense-amount").addEventListener("input", () => {
  updateManualSplitTotal();
});

function buildManualSplitBox() {
  const method = document.getElementById("expense-split-method").value;
  const box = document.getElementById("manual-split-box");

  if (method !== "manual" || !currentGroupMembers.length) {
    box.classList.remove("visible");
    box.innerHTML = "";
    return;
  }

  box.classList.add("visible");
  box.innerHTML = currentGroupMembers.map((m) => `
    <div class="manual-split-row">
      <label>${m.name}</label>
      <input type="number" min="0" class="manual-share-input" data-user-id="${m.id}" placeholder="0" value="0">
    </div>
  `).join("") + `<div class="manual-split-total" id="manual-split-total"></div>`;

  box.querySelectorAll(".manual-share-input").forEach((input) => {
    input.addEventListener("input", updateManualSplitTotal);
  });
  updateManualSplitTotal();
}

function updateManualSplitTotal() {
  const box = document.getElementById("manual-split-box");
  if (!box.classList.contains("visible")) return;

  const inputs = box.querySelectorAll(".manual-share-input");
  let sum = 0;
  inputs.forEach((i) => { sum += parseFloat(i.value) || 0; });

  const amount = parseFloat(document.getElementById("expense-amount").value) || 0;
  const totalDiv = document.getElementById("manual-split-total");
  const diff = amount - sum;

  if (Math.abs(diff) < 0.5) {
    totalDiv.textContent = `✅ Suma: ${fmt(sum)} (coincide con el total)`;
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
  const amount = parseFloat(document.getElementById("expense-amount").value);
  const paid_by_id = parseInt(document.getElementById("expense-payer").value);
  const split_method = document.getElementById("expense-split-method").value;
  const category = document.getElementById("expense-category").value;

  const payload = { description, amount, paid_by_id, split_method, category };

  if (split_method === "manual") {
    const inputs = document.querySelectorAll(".manual-share-input");
    payload.manual_shares = Array.from(inputs).map((i) => ({
      user_id: parseInt(i.dataset.userId),
      amount: parseFloat(i.value) || 0,
    }));
  }

  try {
    await apiFetch(`/groups/${currentGroupId}/expenses/`, {
      method: "POST",
      body: JSON.stringify(payload),
    });
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
  const methodLabels = { equal: "partes iguales", income: "proporcional al sueldo", manual: "montos manuales" };

  expenses.slice().reverse().forEach((exp) => {
    const li = document.createElement("li");
    const methodLabel = methodLabels[exp.split_method] || exp.split_method;
    const icon = categoryIcon(exp.category);

    const mySplit = exp.splits.find((s) => s.user_id === currentUser.id);
    let myStatusHtml = "";
    if (mySplit && !mySplit.settled) {
      myStatusHtml = `<button class="mark-paid-btn" data-split-id="${mySplit.id}">Marcar como pagado</button>`;
    } else if (mySplit && mySplit.settled) {
      myStatusHtml = `<span class="settled-badge">✅ Pagado</span>`;
    }

    li.innerHTML = `
      <div class="expense-row">
        <div class="expense-icon">${icon}</div>
        <div>
          <strong>${exp.description}</strong><br>
          <small>Pagó ${exp.paid_by_name} · ${fmt(exp.amount)} · ${methodLabel}</small>
        </div>
      </div>
      <div style="display:flex; align-items:center; gap:8px;">
        ${myStatusHtml}
        <button class="delete-btn" data-id="${exp.id}">🗑</button>
      </div>
    `;
    li.querySelector(".delete-btn").addEventListener("click", async () => {
      await apiFetch(`/groups/${currentGroupId}/expenses/${exp.id}`, { method: "DELETE" });
      await loadExpenses();
      await loadBalances();
      await loadReminderBanner();
    });
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
    simplifiedList.innerHTML = "<li>Todas las cuentas están saldadas ✅</li>";
  }
  simplified.forEach((tx) => {
    const li = document.createElement("li");
    li.innerHTML = `<span>${tx.from_user} → ${tx.to_user}</span><span>${fmt(tx.amount)}</span>`;
    simplifiedList.appendChild(li);
  });
}

// ---------- Inicio ----------
if (token && currentUser) {
  initAfterLogin();
} else {
  show("auth-screen");
}

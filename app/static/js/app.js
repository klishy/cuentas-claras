const API = ""; // mismo origen
let token = localStorage.getItem("token");
let currentUser = JSON.parse(localStorage.getItem("user") || "null");
let currentGroupId = null;

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

function initAfterLogin() {
  document.getElementById("user-info").classList.remove("hidden");
  document.getElementById("user-name-display").textContent = `Hola, ${currentUser.name}`;
  loadGroups();
  show("groups-screen");
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
    li.innerHTML = `<span>${g.name} ${g.is_premium ? "⭐" : ""}</span><span>${g.members.length} integrantes →</span>`;
    li.addEventListener("click", () => openGroup(g.id));
    list.appendChild(li);
  });
}

document.getElementById("back-to-groups").addEventListener("click", () => {
  show("groups-screen");
  loadGroups();
});

async function openGroup(groupId) {
  currentGroupId = groupId;
  await refreshGroupDetail();
  show("group-detail-screen");
}

async function refreshGroupDetail() {
  const group = await apiFetch(`/groups/${currentGroupId}`);
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

  await loadExpenses();
  await loadBalances();
  await loadIncomes();
}

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

// ---------- Gastos ----------
document.getElementById("add-expense-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const description = document.getElementById("expense-desc").value;
  const amount = parseFloat(document.getElementById("expense-amount").value);
  const paid_by_id = parseInt(document.getElementById("expense-payer").value);
  const split_method = document.getElementById("expense-split-method").value;
  try {
    await apiFetch(`/groups/${currentGroupId}/expenses/`, {
      method: "POST",
      body: JSON.stringify({ description, amount, paid_by_id, split_method }),
    });
    document.getElementById("expense-desc").value = "";
    document.getElementById("expense-amount").value = "";
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
  expenses.slice().reverse().forEach((exp) => {
    const li = document.createElement("li");
    const methodLabel = exp.split_method === "income" ? "proporcional al sueldo" : "partes iguales";
    li.innerHTML = `
      <div>
        <strong>${exp.description}</strong><br>
        <small>Pagó ${exp.paid_by_name} · ${fmt(exp.amount)} · ${methodLabel}</small>
      </div>
      <button class="delete-btn" data-id="${exp.id}">🗑</button>
    `;
    li.querySelector(".delete-btn").addEventListener("click", async () => {
      await apiFetch(`/groups/${currentGroupId}/expenses/${exp.id}`, { method: "DELETE" });
      await loadExpenses();
      await loadBalances();
    });
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

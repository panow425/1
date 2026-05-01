const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
const app = $("#app");

const KIND_LABEL = {
  zimo: "自摸",
  gang_chagang: "插杠",
  gang_angang: "暗杠",
  gang_others: "杠别人",
  huangzhuang: "黄庄",
};

const state = {
  config: {
    amounts: [2, 4, 6, 8, 10, 12, 14],
    default_players: ["东家", "南家", "西家", "北家"],
    gang_fixed: { gang_chagang: 1, gang_angang: 2, gang_others: 3 },
  },
  view: "home",
  sessionId: null,
  selectedWinner: null,
  selectedAmount: 2,
  selectedKind: "zimo",
  selectedPayer: null,
  players: [],
};

async function api(path, opts = {}) {
  const res = await fetch(path, {
    headers: { "Content-Type": "application/json" },
    ...opts,
  });
  if (!res.ok) {
    let msg = "请求失败";
    try { msg = (await res.json()).error || msg; } catch {}
    alert(msg);
    throw new Error(msg);
  }
  return res.json();
}

function fmtTime(iso) {
  if (!iso) return "";
  const d = new Date(iso.replace(" ", "T"));
  if (isNaN(d.getTime())) return iso;
  const pad = (n) => String(n).padStart(2, "0");
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function mount(templateId) {
  const tpl = document.getElementById(templateId);
  app.innerHTML = "";
  app.appendChild(tpl.content.cloneNode(true));
}

async function showHome() {
  state.view = "home";
  state.sessionId = null;
  mount("tpl-home");

  state.config.default_players.forEach((n, i) => {
    const inp = $(`.new-player[data-i="${i}"]`);
    inp.placeholder = n;
  });

  $("#btn-create").onclick = async () => {
    const players = $$(".new-player").map((el, i) =>
      el.value.trim() || state.config.default_players[i]
    );
    const name = $("#new-name").value.trim();
    const { id } = await api("/api/sessions", {
      method: "POST",
      body: JSON.stringify({ name, players }),
    });
    showSession(id);
  };

  const sessions = await api("/api/sessions");
  const list = $("#session-list");
  if (!sessions.length) {
    list.innerHTML = `<div class="muted">还没有牌局，开一局吧。</div>`;
    return;
  }
  list.innerHTML = "";
  for (const s of sessions) {
    const div = document.createElement("div");
    div.className = "session-item";
    const status = s.ended_at ? "已结束" : "进行中";
    const players = s.players.map(p => p.name).join(" · ");
    div.innerHTML = `
      <div>
        <div><b>${s.name}</b> <span class="muted">[${status}]</span></div>
        <div class="meta">${players} · ${s.hand_count} 盘 · ${fmtTime(s.created_at)}</div>
      </div>
      <div style="display:flex;gap:6px">
        <button class="ghost" data-act="open">打开</button>
        <button class="danger" data-act="del">删</button>
      </div>
    `;
    div.querySelector('[data-act="open"]').onclick = () => showSession(s.id);
    div.querySelector('[data-act="del"]').onclick = async () => {
      if (!confirm(`确定删除「${s.name}」的所有记录？`)) return;
      await api(`/api/sessions/${s.id}`, { method: "DELETE" });
      showHome();
    };
    list.appendChild(div);
  }
}

async function showSession(sid) {
  state.view = "session";
  state.sessionId = sid;
  state.selectedWinner = null;
  state.selectedAmount = state.config.amounts[0];
  state.selectedKind = "zimo";
  state.selectedPayer = null;
  mount("tpl-session");
  await refreshSession();

  $("#btn-end").onclick = async () => {
    if (!confirm("结束本牌局？结束后仍可查看记录。")) return;
    await api(`/api/sessions/${sid}/end`, { method: "POST" });
    await refreshSession();
  };

  $("#btn-record").onclick = async () => {
    const k = state.selectedKind;
    if (!state.selectedWinner) {
      $("#hand-hint").textContent = "请先选谁赢的 / 杠的。";
      return;
    }
    const body = { kind: k, winner_id: state.selectedWinner };
    if (k === "zimo") {
      if (!state.config.amounts.includes(state.selectedAmount)) {
        $("#hand-hint").textContent = "请选金额。";
        return;
      }
      body.amount = state.selectedAmount;
    } else if (k === "gang_others") {
      if (!state.selectedPayer) {
        $("#hand-hint").textContent = "请选谁给的杠。";
        return;
      }
      body.loser_id = state.selectedPayer;
    }
    await api(`/api/sessions/${sid}/hands`, {
      method: "POST",
      body: JSON.stringify(body),
    });
    state.selectedWinner = null;
    state.selectedPayer = null;
    await refreshSession();
  };

  $("#btn-huang").onclick = async () => {
    if (!confirm("记一盘黄庄（流局，不计分）？")) return;
    await api(`/api/sessions/${sid}/hands`, {
      method: "POST",
      body: JSON.stringify({ kind: "huangzhuang" }),
    });
    await refreshSession();
  };
}

function renderKindPicker() {
  $$("#kind-pick .pick").forEach(el => {
    el.classList.toggle("selected", el.dataset.kind === state.selectedKind);
    el.onclick = () => {
      state.selectedKind = el.dataset.kind;
      state.selectedPayer = null;
      renderKindPicker();
      renderConditional();
    };
  });
}

function renderConditional() {
  const k = state.selectedKind;
  $("#amount-row").classList.toggle("hidden", k !== "zimo");
  $("#payer-row").classList.toggle("hidden", k !== "gang_others");

  if (k === "gang_others") renderPayerPicker();
}

function renderPayerPicker() {
  const wrap = $("#payer-pick");
  wrap.innerHTML = "";
  for (const p of state.players) {
    if (p.id === state.selectedWinner) continue;
    const el = document.createElement("div");
    el.className = "pick" + (state.selectedPayer === p.id ? " selected" : "");
    el.textContent = p.name;
    el.onclick = () => {
      state.selectedPayer = p.id;
      renderPayerPicker();
      $("#hand-hint").textContent = "";
    };
    wrap.appendChild(el);
  }
  if (!wrap.children.length) {
    wrap.innerHTML = `<div class="muted">先选赢家</div>`;
  }
}

async function refreshSession() {
  const s = await api(`/api/sessions/${state.sessionId}`);
  state.players = s.players;

  $("#s-name").textContent = s.name + (s.ended_at ? "（已结束）" : "");
  $("#s-meta").textContent =
    `开局 ${fmtTime(s.created_at)} · 共 ${s.hands.length} 盘`;

  const balances = $("#balances");
  balances.innerHTML = "";
  for (const b of s.balances) {
    const cls = b.balance > 0 ? "win" : b.balance < 0 ? "lose" : "flat";
    const sign = b.balance > 0 ? "+" : "";
    const div = document.createElement("div");
    div.className = `bal ${cls}`;
    div.innerHTML = `<div class="name">${b.name}</div><div class="amount">${sign}${b.balance}</div>`;
    balances.appendChild(div);
  }

  const winners = $("#winner-pick");
  winners.innerHTML = "";
  for (const p of s.players) {
    const el = document.createElement("div");
    el.className = "pick" + (state.selectedWinner === p.id ? " selected" : "");
    el.textContent = p.name;
    el.onclick = () => {
      state.selectedWinner = p.id;
      if (state.selectedPayer === p.id) state.selectedPayer = null;
      $$("#winner-pick .pick").forEach(n => n.classList.remove("selected"));
      el.classList.add("selected");
      $("#hand-hint").textContent = "";
      if (state.selectedKind === "gang_others") renderPayerPicker();
    };
    winners.appendChild(el);
  }

  const amounts = $("#amount-pick");
  amounts.innerHTML = "";
  for (const v of state.config.amounts) {
    const el = document.createElement("div");
    el.className = "pick" + (state.selectedAmount === v ? " selected" : "");
    el.textContent = `${v} 块`;
    el.onclick = () => {
      state.selectedAmount = v;
      $$("#amount-pick .pick").forEach(n => n.classList.remove("selected"));
      el.classList.add("selected");
      $("#hand-hint").textContent = "";
    };
    amounts.appendChild(el);
  }

  renderKindPicker();
  renderConditional();

  const hands = $("#hands");
  hands.innerHTML = "";
  if (!s.hands.length) {
    hands.innerHTML = `<div class="muted">还没有记录。</div>`;
  }
  const playerById = Object.fromEntries(s.players.map(p => [p.id, p]));
  for (const h of s.hands) {
    const div = document.createElement("div");
    const w = h.winner_id ? playerById[h.winner_id] : null;
    const l = h.loser_id ? playerById[h.loser_id] : null;
    let title = "", detail = "", amt = "";

    if (h.kind === "huangzhuang") {
      div.className = "hand huang";
      title = "黄庄";
      detail = "流局，不计分";
      amt = "—";
    } else if (h.kind === "zimo") {
      div.className = "hand";
      title = `<span class="winner">${w ? w.name : "?"}</span> 自摸`;
      detail = `三家各付 ${h.amount}`;
      amt = `+${h.amount * 3}`;
    } else if (h.kind === "gang_chagang") {
      div.className = "hand gang";
      title = `<span class="winner">${w ? w.name : "?"}</span> 插杠`;
      detail = `三家各 1`;
      amt = `+3`;
    } else if (h.kind === "gang_angang") {
      div.className = "hand gang";
      title = `<span class="winner">${w ? w.name : "?"}</span> 暗杠`;
      detail = `三家各 2`;
      amt = `+6`;
    } else if (h.kind === "gang_others") {
      div.className = "hand gang";
      title = `<span class="winner">${w ? w.name : "?"}</span> 杠 ${l ? l.name : "?"}`;
      detail = `${l ? l.name : "?"} 给 3`;
      amt = `+3`;
    }

    div.innerHTML = `
      <div class="left">
        <div>${title}</div>
        <div class="when">${fmtTime(h.created_at)} · ${detail}</div>
      </div>
      <div class="right">
        <div class="amt">${amt}</div>
        <button class="danger" data-act="del">撤销</button>
      </div>`;
    div.querySelector('[data-act="del"]').onclick = async () => {
      if (!confirm("撤销这一盘？")) return;
      await api(`/api/sessions/${state.sessionId}/hands/${h.id}`, { method: "DELETE" });
      await refreshSession();
    };
    hands.appendChild(div);
  }
}

document.getElementById("btn-home").onclick = () => showHome();

(async function init() {
  try {
    const cfg = await api("/api/config");
    state.config = { ...state.config, ...cfg };
    state.selectedAmount = state.config.amounts[0];
  } catch {}
  showHome();
})();

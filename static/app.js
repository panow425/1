const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
const app = $("#app");

const KIND_LABEL = {
  zimo: "自摸",
  gang_chagang: "插杠",
  gang_angang: "暗杠",
  gang_others: "杠别人",
  huangzhuang: "黄庄",
};

const SEAT_NAMES = ["东", "南", "西", "北"];

const state = {
  config: {
    amounts: [2, 4, 6, 8, 10, 12, 14],
    default_players: ["东家", "南家", "西家", "北家"],
    gang_fixed: { gang_chagang: 1, gang_angang: 2, gang_others: 3 },
  },
  view: "home",
  sessionId: null,
  data: null,                 // last fetched session data
  selectedAmount: 2,
  pollTimer: null,
  lastSeenHandIds: new Set(),
  myPlayerId: null,           // for current session, on this device
};

/* ---------------- localStorage helpers ---------------- */
const meKey = (sid) => `mahjong:me:session:${sid}`;
function getMe(sid) {
  const v = localStorage.getItem(meKey(sid));
  return v ? Number(v) : null;
}
function setMe(sid, pid) {
  if (pid == null) localStorage.removeItem(meKey(sid));
  else localStorage.setItem(meKey(sid), String(pid));
}

/* ---------------- net ---------------- */
async function api(path, opts = {}) {
  const res = await fetch(path, {
    headers: { "Content-Type": "application/json" },
    ...opts,
  });
  if (!res.ok) {
    let msg = "请求失败";
    try { msg = (await res.json()).error || msg; } catch {}
    toast(msg);
    throw new Error(msg);
  }
  return res.json();
}

/* ---------------- ui helpers ---------------- */
function fmtTime(iso) {
  if (!iso) return "";
  const d = new Date(iso.replace(" ", "T"));
  if (isNaN(d.getTime())) return iso;
  const pad = (n) => String(n).padStart(2, "0");
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
function fmtTimeShort(iso) {
  if (!iso) return "";
  const d = new Date(iso.replace(" ", "T"));
  if (isNaN(d.getTime())) return iso;
  const pad = (n) => String(n).padStart(2, "0");
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
function mount(templateId) {
  const tpl = document.getElementById(templateId);
  app.innerHTML = "";
  app.appendChild(tpl.content.cloneNode(true));
}
function toast(msg) {
  const stack = $("#toast-stack");
  const el = document.createElement("div");
  el.className = "toast";
  el.textContent = msg;
  stack.appendChild(el);
  setTimeout(() => el.remove(), 2700);
}
function stopPolling() {
  if (state.pollTimer) {
    clearInterval(state.pollTimer);
    state.pollTimer = null;
  }
}

/* ============================================================
   HOME
============================================================ */
async function showHome() {
  state.view = "home";
  state.sessionId = null;
  state.data = null;
  state.lastSeenHandIds = new Set();
  stopPolling();
  mount("tpl-home");

  $("#btn-create").onclick = async () => {
    const { id } = await api("/api/sessions", {
      method: "POST",
      body: JSON.stringify({}),
    });
    showSession(id);
  };

  const sessions = await api("/api/sessions");
  const list = $("#session-list");
  if (!sessions.length) {
    list.innerHTML = `<div class="muted small">还没有牌局，点上面按钮开一局。</div>`;
    return;
  }
  list.innerHTML = "";
  for (const s of sessions) {
    const div = document.createElement("div");
    div.className = "session-item";
    const status = s.ended_at
      ? `<span class="ended">已结束</span>`
      : `<span style="color: var(--green)">进行中</span>`;
    const players = s.players.map(p => p.name).join(" · ");
    div.innerHTML = `
      <div style="min-width:0; flex:1">
        <div class="title">${s.name} ${status}</div>
        <div class="meta">${players} · ${s.hand_count} 盘 · ${fmtTime(s.created_at)}</div>
      </div>
      <div style="display:flex; gap:6px; flex-shrink:0">
        <button class="ghost" data-act="open">打开</button>
        <button class="ghost" data-act="del" style="color: var(--red)">删</button>
      </div>
    `;
    div.querySelector('[data-act="open"]').onclick = () => showSession(s.id);
    div.querySelector('[data-act="del"]').onclick = async () => {
      if (!confirm(`删除「${s.name}」？所有记录会清掉。`)) return;
      await api(`/api/sessions/${s.id}`, { method: "DELETE" });
      showHome();
    };
    list.appendChild(div);
  }
}

/* ============================================================
   PICK ME (one-time per session per device)
============================================================ */
function showPickMe(sessionData) {
  mount("tpl-pick-me");
  const grid = $("#pick-me-grid");
  grid.innerHTML = "";
  sessionData.players.forEach((p, i) => {
    const el = document.createElement("div");
    el.className = "pick";
    el.innerHTML = `${p.name}<span class="seat">${SEAT_NAMES[i]}家</span>`;
    el.onclick = () => {
      setMe(sessionData.id, p.id);
      state.myPlayerId = p.id;
      renderSession(sessionData);
      startPolling();
    };
    grid.appendChild(el);
  });
  $("#pick-me-skip").onclick = () => {
    state.myPlayerId = null;
    renderSession(sessionData);
    startPolling();
  };
}

/* ============================================================
   SESSION
============================================================ */
async function showSession(sid) {
  state.view = "session";
  state.sessionId = sid;
  state.lastSeenHandIds = new Set();
  state.selectedAmount = state.config.amounts[0];
  stopPolling();

  const data = await api(`/api/sessions/${sid}`);
  state.data = data;
  state.myPlayerId = getMe(sid);

  if (state.myPlayerId == null) {
    showPickMe(data);
    return;
  }
  // verify the stored player still exists on this session
  if (!data.players.find(p => p.id === state.myPlayerId)) {
    setMe(sid, null);
    showPickMe(data);
    return;
  }

  mount("tpl-session");
  renderSession(data);
  startPolling();
}

function startPolling() {
  stopPolling();
  state.pollTimer = setInterval(async () => {
    if (state.view !== "session" || state.sessionId == null) return;
    try {
      const data = await api(`/api/sessions/${state.sessionId}`);
      const prevIds = state.lastSeenHandIds;
      const currIds = new Set(data.hands.map(h => h.id));
      // detect newly added hands (not from our own immediate action)
      const newOnes = data.hands.filter(h => !prevIds.has(h.id));
      state.data = data;
      renderSession(data);
      // toast for new hands made by others (skip on first poll)
      if (prevIds.size > 0) {
        for (const h of newOnes.reverse()) {
          toast(handToast(h, data.players));
        }
      }
      state.lastSeenHandIds = currIds;
    } catch (e) {
      // swallow polling errors quietly
    }
  }, 2000);
}

function handToast(h, players) {
  const byId = Object.fromEntries(players.map(p => [p.id, p.name]));
  if (h.kind === "huangzhuang") return "🟡 黄庄";
  if (h.kind === "zimo") return `🎉 ${byId[h.winner_id]} 自摸 +${h.amount * 3}`;
  if (h.kind === "gang_chagang") return `⚡ ${byId[h.winner_id]} 插杠 +3`;
  if (h.kind === "gang_angang") return `⚡ ${byId[h.winner_id]} 暗杠 +6`;
  if (h.kind === "gang_others") return `⚡ ${byId[h.winner_id]} 杠 ${byId[h.loser_id]} +3`;
  return "";
}

function renderSession(s) {
  // Topbar title
  $("#topbar-title").textContent = `🀄 ${s.name}`;

  // Header
  $("#s-name").textContent = s.name + (s.ended_at ? "（已结束）" : "");
  $("#s-meta").textContent = `开局 ${fmtTime(s.created_at)} · 共 ${s.hands.length} 盘`;

  // Me tag
  const me = s.players.find(p => p.id === state.myPlayerId);
  $("#me-tag").innerHTML = me
    ? `我是 <b style="color:var(--cyan)">${me.name}</b> · <span class="edit-me" style="cursor:pointer; text-decoration:underline">换位</span>`
    : `<span class="edit-me" style="cursor:pointer; text-decoration:underline">点这里选我是哪一家</span>`;
  $(".edit-me").onclick = () => {
    setMe(s.id, null);
    state.myPlayerId = null;
    showPickMe(s);
  };

  // End / reopen button
  const btnEnd = $("#btn-end");
  btnEnd.textContent = s.ended_at ? "重开" : "结束";
  btnEnd.onclick = async () => {
    if (s.ended_at) {
      await api(`/api/sessions/${s.id}/reopen`, { method: "POST" });
    } else {
      if (!confirm("结束本牌局？随时可重开。")) return;
      await api(`/api/sessions/${s.id}/end`, { method: "POST" });
    }
    refreshOnce();
  };
  $("#btn-settle").onclick = () => openSettlement(s);

  // Balances + streaks
  const bals = $("#balances");
  bals.innerHTML = "";
  s.balances.forEach((b, i) => {
    const cls =
      b.balance > 0 ? "win" : b.balance < 0 ? "lose" : "flat";
    const meCls = b.player_id === state.myPlayerId ? " me" : "";
    const sign = b.balance > 0 ? "+" : "";
    const div = document.createElement("div");
    div.className = `bal ${cls}${meCls}`;
    let streakHtml = `<div class="streak none">—</div>`;
    if (b.streak.kind === "win" && b.streak.count > 1) {
      streakHtml = `<div class="streak win">🔥 连胜 ${b.streak.count}</div>`;
    } else if (b.streak.kind === "lose" && b.streak.count > 1) {
      streakHtml = `<div class="streak lose">💧 连败 ${b.streak.count}</div>`;
    } else if (b.streak.kind === "win") {
      streakHtml = `<div class="streak win">刚赢</div>`;
    } else if (b.streak.kind === "lose") {
      streakHtml = `<div class="streak lose">刚输</div>`;
    }
    div.innerHTML = `
      <div class="name">
        <span class="seat">${SEAT_NAMES[i]}</span>
        <span class="pname">${b.name}</span>
        ${b.player_id === state.myPlayerId ? '<span class="me-badge">我</span>' : ''}
        <span class="edit" data-pid="${b.player_id}">改名</span>
      </div>
      <div class="amount">${sign}${b.balance}</div>
      ${streakHtml}
    `;
    div.querySelector(".edit").onclick = (e) => {
      e.stopPropagation();
      const cur = b.name;
      const next = prompt(`改名（${SEAT_NAMES[i]}家）：`, cur);
      if (next == null) return;
      const trimmed = next.trim();
      if (!trimmed || trimmed === cur) return;
      api(`/api/sessions/${s.id}/players/${b.player_id}`, {
        method: "PUT",
        body: JSON.stringify({ name: trimmed }),
      }).then(refreshOnce);
    };
    bals.appendChild(div);
  });

  // Amount strip
  const strip = $("#amount-strip");
  strip.innerHTML = "";
  for (const v of state.config.amounts) {
    const el = document.createElement("div");
    el.className = "a" + (state.selectedAmount === v ? " selected" : "");
    el.textContent = v;
    el.onclick = () => {
      state.selectedAmount = v;
      $$("#amount-strip .a").forEach(n => n.classList.remove("selected"));
      el.classList.add("selected");
    };
    strip.appendChild(el);
  }

  // Record actions
  const btnZimo = $("#btn-zimo");
  const btnHuang = $("#btn-huang");
  const btnUndo = $("#btn-undo");
  const btnOtherWin = $("#btn-other-win");
  const gangBtns = $$(".gang-row .gang");

  const recordCard = $("#record-card");
  const lastHand = s.hands[0];

  if (s.ended_at) {
    recordCard.style.opacity = "0.4";
    recordCard.style.pointerEvents = "none";
  } else {
    recordCard.style.opacity = "";
    recordCard.style.pointerEvents = "";
  }

  btnZimo.onclick = () => {
    if (state.myPlayerId == null) {
      toast("先点上方「选我是哪一家」");
      return;
    }
    addHand({
      kind: "zimo",
      winner_id: state.myPlayerId,
      amount: state.selectedAmount,
    });
  };

  for (const g of gangBtns) {
    g.onclick = () => {
      const act = g.dataset.act;
      if (state.myPlayerId == null) {
        toast("先点上方「选我是哪一家」");
        return;
      }
      if (act === "gang_others_pick") {
        openPickModal({
          title: "我杠了谁？",
          choices: s.players.filter(p => p.id !== state.myPlayerId),
          onOk: (pid) => {
            addHand({
              kind: "gang_others",
              winner_id: state.myPlayerId,
              loser_id: pid,
            });
          },
        });
      } else {
        addHand({ kind: act, winner_id: state.myPlayerId });
      }
    };
  }

  btnOtherWin.onclick = () => {
    openPickModal({
      title: "谁赢了？",
      choices: s.players,
      withAmount: true,
      onOk: (pid, amt) => {
        addHand({ kind: "zimo", winner_id: pid, amount: amt });
      },
    });
  };

  btnHuang.onclick = () => {
    if (!confirm("记一盘黄庄（流局，不计分）？")) return;
    addHand({ kind: "huangzhuang" });
  };

  btnUndo.onclick = async () => {
    if (!lastHand) {
      toast("还没有可撤销的记录");
      return;
    }
    if (!confirm("撤销最近一盘？")) return;
    await api(`/api/sessions/${s.id}/hands/${lastHand.id}`, { method: "DELETE" });
    refreshOnce();
  };

  // Hands list
  const hands = $("#hands");
  hands.innerHTML = "";
  if (!s.hands.length) {
    hands.innerHTML = `<div class="muted small">还没有记录。</div>`;
  }
  const playerById = Object.fromEntries(s.players.map(p => [p.id, p]));
  for (const h of s.hands) {
    const w = h.winner_id ? playerById[h.winner_id] : null;
    const l = h.loser_id ? playerById[h.loser_id] : null;
    const div = document.createElement("div");
    let title = "", detail = "", amt = "";
    if (h.kind === "huangzhuang") {
      div.className = "hand huang";
      title = "黄庄";
      detail = "流局";
      amt = "—";
    } else if (h.kind === "zimo") {
      div.className = "hand";
      title = `<span class="winner">${w ? w.name : "?"}</span> 自摸`;
      detail = `三家各 ${h.amount}`;
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
        <div class="when">${fmtTimeShort(h.created_at)} · ${detail}</div>
      </div>
      <div class="right">
        <div class="amt">${amt}</div>
        <button class="ghost" data-act="del" style="color: var(--red)">撤</button>
      </div>`;
    div.querySelector('[data-act="del"]').onclick = async () => {
      if (!confirm("撤销这一盘？")) return;
      await api(`/api/sessions/${s.id}/hands/${h.id}`, { method: "DELETE" });
      refreshOnce();
    };
    hands.appendChild(div);
  }
}

async function refreshOnce() {
  if (state.sessionId == null) return;
  const data = await api(`/api/sessions/${state.sessionId}`);
  state.data = data;
  state.lastSeenHandIds = new Set(data.hands.map(h => h.id));
  renderSession(data);
}

async function addHand(body) {
  await api(`/api/sessions/${state.sessionId}/hands`, {
    method: "POST",
    body: JSON.stringify(body),
  });
  // update lastSeen optimistically so we don't toast our own action
  await refreshOnce();
}

/* ============================================================
   MODAL: pick winner / payer (+ optional amount)
============================================================ */
function openPickModal({ title, choices, withAmount = false, onOk }) {
  const tpl = document.getElementById("tpl-modal-pick");
  const node = tpl.content.cloneNode(true);
  document.body.appendChild(node);
  const back = document.body.lastElementChild;

  $("#modal-title", back).textContent = title;
  let selected = null;
  let amt = state.selectedAmount;

  const grid = $("#modal-grid", back);
  grid.innerHTML = "";
  for (const p of choices) {
    const el = document.createElement("div");
    el.className = "pick";
    el.textContent = p.name;
    el.onclick = () => {
      selected = p.id;
      $$(".pick", grid).forEach(n => n.classList.remove("selected"));
      el.classList.add("selected");
    };
    grid.appendChild(el);
  }

  if (withAmount) {
    $("#modal-amount", back).classList.remove("hidden");
    const strip = $("#modal-amount-strip", back);
    strip.innerHTML = "";
    for (const v of state.config.amounts) {
      const el = document.createElement("div");
      el.className = "a" + (amt === v ? " selected" : "");
      el.textContent = v;
      el.onclick = () => {
        amt = v;
        $$(".a", strip).forEach(n => n.classList.remove("selected"));
        el.classList.add("selected");
      };
      strip.appendChild(el);
    }
  }

  const close = () => back.remove();
  $("#modal-cancel", back).onclick = close;
  $("#modal-ok", back).onclick = async () => {
    if (selected == null) {
      toast("请选一个");
      return;
    }
    close();
    onOk(selected, amt);
  };
}

/* ============================================================
   MODAL: settlement
============================================================ */
function openSettlement(s) {
  const tpl = document.getElementById("tpl-modal-settle");
  const node = tpl.content.cloneNode(true);
  document.body.appendChild(node);
  const back = document.body.lastElementChild;

  const total = s.hands.length;
  $("#settle-summary", back).textContent =
    `共 ${total} 盘 · 谁转给谁，转完账就两清`;

  const list = $("#settle-list", back);
  list.innerHTML = "";
  if (!s.settlement.length) {
    list.innerHTML = `<div class="settle-empty">还不需要转账（都是 0 或还没记录）</div>`;
  } else {
    for (const t of s.settlement) {
      const row = document.createElement("div");
      row.className = "settle-row";
      row.innerHTML = `
        <div class="who">
          <span class="from">${t.from}</span>
          <span class="arrow">→</span>
          <span class="to">${t.to}</span>
        </div>
        <div class="amt">${t.amount} 块</div>
      `;
      list.appendChild(row);
    }
  }

  $("#settle-close", back).onclick = () => back.remove();
}

/* ============================================================
   Boot
============================================================ */
$("#btn-home").onclick = () => showHome();

(async function init() {
  try {
    const cfg = await api("/api/config");
    state.config = { ...state.config, ...cfg };
    state.selectedAmount = state.config.amounts[0];
  } catch {}
  showHome();
})();

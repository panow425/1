const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
const app = $("#app");

const SEAT_NAMES = ["东", "南", "西", "北"];

const THEMES = [
  { key: "neon",    name: "霓光黑", emoji: "🌃", title: "🌃 麻将",    hero: "🀄", heroTitle: "霓光夜局",       heroSub: "赛博朋克 · 麻将" },
  { key: "luxe",    name: "Luxe 留白", emoji: "❖", title: "❖  麻将",  hero: "🀄", heroTitle: "Quiet Mahjong",  heroSub: "极简 · 留白 · 仪式感" },
  { key: "green",   name: "自然绿", emoji: "🌿", title: "🌿 麻将",    hero: "🀄", heroTitle: "搓一把",         heroSub: "正宗中国风" },
  { key: "bamboo",  name: "竹韵绿", emoji: "🎋", title: "🎋 麻将",    hero: "🎋", heroTitle: "竹影摇曳",       heroSub: "清新如新茶" },
  { key: "purple",  name: "暮夜紫", emoji: "🌌", title: "🌌 麻将",    hero: "🏮", heroTitle: "灯火夜",         heroSub: "千灯映夜" },
  { key: "orange",  name: "夕阳橙", emoji: "🌅", title: "🌅 麻将",    hero: "🌅", heroTitle: "落日局",         heroSub: "山间黄昏" },
  { key: "bp",      name: "BLACKPINK", emoji: "🖤💖", title: "🖤💖 麻将", hero: "💖", heroTitle: "BORN PINK 局", heroSub: "DDU-DU 来打个麻将" },
];

const state = {
  config: {
    amounts: [2, 4, 6, 8, 10, 12, 14],
    amount_labels: ["无马", "1个马", "2个马", "3个马", "4个马", "5个马", "6个马"],
    default_players: ["东家", "南家", "西家", "北家"],
    gang_fixed: { gang_chagang: 1, gang_angang: 2, gang_others: 3 },
  },
  view: "home",
  sessionId: null,
  data: null,
  selectedAmount: 2,
  pollTimer: null,
  lastSeenHandIds: new Set(),
  myPlayerId: null,
  prevBalances: {},   // for pulse animation
  loginName: null,    // optional saved name for "login"
};

/* ============== localStorage ============== */
const meKey = (sid) => `mahjong:me:session:${sid}`;
const themeKey = "mahjong:theme";
const loginKey = "mahjong:login";
const soundKey = "mahjong:sound";
function getMe(sid) { const v = localStorage.getItem(meKey(sid)); return v ? Number(v) : null; }
function setMe(sid, pid) {
  if (pid == null) localStorage.removeItem(meKey(sid));
  else localStorage.setItem(meKey(sid), String(pid));
}
function getTheme() {
  const v = localStorage.getItem(themeKey);
  if (v && THEMES.find(t => t.key === v)) return v;
  return "neon";
}
function setTheme(k) { localStorage.setItem(themeKey, k); applyTheme(k); }
function getLogin() { return localStorage.getItem(loginKey) || null; }
function setLogin(name) {
  if (!name) localStorage.removeItem(loginKey);
  else localStorage.setItem(loginKey, name);
  state.loginName = name;
}
function getSoundOn() {
  const v = localStorage.getItem(soundKey);
  return v == null ? true : v === "1";
}
function setSoundOn(on) {
  localStorage.setItem(soundKey, on ? "1" : "0");
  SoundFx.enabled = on;
  $("#btn-sound").textContent = on ? "🔊" : "🔇";
}

/* ============== sound + haptic ============== */
const SoundFx = {
  ctx: null,
  enabled: true,
  init() {
    if (this.ctx) return;
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    try { this.ctx = new Ctx(); } catch {}
  },
  resume() {
    if (this.ctx && this.ctx.state === "suspended") this.ctx.resume();
  },
  beep(freq, dur, type = "sine", vol = 0.18, when = 0) {
    if (!this.enabled || !this.ctx) return;
    const t0 = this.ctx.currentTime + when;
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t0);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(vol, t0 + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g).connect(this.ctx.destination);
    o.start(t0);
    o.stop(t0 + dur + 0.02);
  },
  pick()  { this.beep(880, 0.06, "triangle", 0.18); },
  click() { this.beep(640, 0.04, "square",   0.12); },
  win() {
    // bright arpeggio
    [523, 659, 784, 1046].forEach((f, i) => this.beep(f, 0.18, "triangle", 0.22, i * 0.07));
  },
  gang() {
    this.beep(660,  0.10, "sawtooth", 0.18);
    this.beep(1320, 0.10, "sawtooth", 0.18, 0.09);
  },
  huang() {
    this.beep(180, 0.30, "sine", 0.20);
  },
  undo() {
    this.beep(500, 0.06, "triangle", 0.14);
    this.beep(300, 0.07, "triangle", 0.14, 0.06);
  },
  zinged() {
    // descending "ouch" — for getting gang-ed
    this.beep(440, 0.08, "sawtooth", 0.16);
    this.beep(220, 0.14, "sawtooth", 0.16, 0.08);
  },
};

function buzz(ms = 15) {
  if (typeof navigator !== "undefined" && navigator.vibrate) {
    try { navigator.vibrate(ms); } catch {}
  }
}

const LIGHT_CARD_THEMES = new Set(["green", "bamboo", "orange", "luxe"]);

function applyTheme(key) {
  const t = THEMES.find(x => x.key === key) || THEMES[0];
  document.body.setAttribute("data-theme", t.key);
  document.body.classList.toggle("lightcards", LIGHT_CARD_THEMES.has(t.key));
  $("#topbar-title").textContent = t.title;
  // Update home hero if visible
  const heroEmoji = $("#hero-emoji");
  if (heroEmoji) heroEmoji.textContent = t.hero;
  const heroTitle = $("#hero-title");
  if (heroTitle) heroTitle.textContent = t.heroTitle;
  const heroSub = $("#hero-sub");
  if (heroSub) heroSub.textContent = t.heroSub;
}

/* ============== api ============== */
async function api(path, opts = {}) {
  const res = await fetch(path, {
    headers: { "Content-Type": "application/json" }, ...opts,
  });
  if (!res.ok) {
    let msg = "请求失败";
    try { msg = (await res.json()).error || msg; } catch {}
    toast(msg);
    throw new Error(msg);
  }
  return res.json();
}

/* ============== ui helpers ============== */
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
  setTimeout(() => el.remove(), 2900);
}
function stopPolling() {
  if (state.pollTimer) { clearInterval(state.pollTimer); state.pollTimer = null; }
}
function maLabel(amount) {
  const i = state.config.amounts.indexOf(amount);
  return i >= 0 ? state.config.amount_labels[i] : `${amount} 块`;
}

/* ============== confetti ============== */
const COLORS = ["#ff2e63", "#25f4ee", "#b14bff", "#ffd23f", "#06ffa5", "#ff9b3f", "#ff66c4"];
function confetti(burst = 36) {
  const stage = $("#confetti-stage");
  for (let i = 0; i < burst; i++) {
    const el = document.createElement("div");
    el.className = "confetti-piece";
    const left = Math.random() * 100;
    const dx = (Math.random() - 0.5) * 200;
    const dur = 1.6 + Math.random() * 1.6;
    const delay = Math.random() * 0.2;
    el.style.left = left + "vw";
    el.style.setProperty("--dx", dx + "px");
    el.style.background = COLORS[Math.floor(Math.random() * COLORS.length)];
    el.style.animationDuration = dur + "s";
    el.style.animationDelay = delay + "s";
    stage.appendChild(el);
    setTimeout(() => el.remove(), (dur + delay) * 1000 + 50);
  }
}

/* ============== funny toast ============== */
function pickRandom(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

const PHRASES = {
  // I won zimo
  zimo_me: [
    "🔥 牛！+{n}",
    "🎉 +{n} 到账",
    "✨ 手感来了 +{n}",
    "🤑 +{n} 再来一把",
    "稳如老狗",
    "今晚我请客",
    "暴富快乐",
    "麻将天才说的就是我",
    "+{n}，开心",
  ],
  // I won zimo on a streak
  zimo_me_streak: [
    "🔥🔥 连赢 {streak} 把，麻将天才本人",
    "✨ 我自己看着都怕",
    "稳如老狗 ×{streak}",
    "+{n}，连赢 {streak} 把！",
    "🙏 拜托别让对手投降",
    "状态来了挡不住",
  ],
  // others won zimo (general)
  zimo_other: [
    "😭 {who} 又自摸 +{n}",
    "💸 {who} 自摸 +{n}",
    "{who} +{n}！",
    "太好了，我们输了 🙃",
    "{who} 牌运也太好了",
    "破防了",
    "下次借点运气",
    "{who} 自摸，三家又出血",
    "{who} 是不是上香了",
  ],
  // others won zimo on a streak (the suspicious mode 😄)
  zimo_other_streak: [
    "👀 重点关注 {who} 的手",
    "怎么总是 {who} 在赢，你们不行吗？",
    "{who} 是麻将天才",
    "{who} 你别玩了让别人玩",
    "{who} 是不是开挂了",
    "麻将之神附体了 🙏",
    "{who} 已经连赢 {streak} 把，离谱",
    "{who} 牌堆是不是有问题",
    "服了，{who} 赢麻了",
    "{who} 今晚必须请客",
  ],
  // gang
  gang_chagang_me: ["⚡ 我插杠 +3", "💪 插杠！", "+3 拿来", "顺便赚点零花"],
  gang_angang_me:  ["⚡ 我暗杠 +6", "💪 暗杠 +6", "稳赚 6 块", "暗杠不亏"],
  gang_others_me:  ["⚡ 我杠了 {who}！+3", "💀 {who} 给我 3 块", "杠出强势", "{who} 倒霉"],
  gang_chagang_other: ["⚡ {who} 插杠 +3", "{who} 又杠了"],
  gang_angang_other:  ["⚡ {who} 暗杠 +6", "{who} 暗杠真财迷"],
  gang_others_other:  ["⚡ {who} 杠了 {loser}", "{loser} 倒霉，被 {who} 杠"],
  gang_others_iam_loser: ["💀 被 {who} 杠了 -3", "倒霉，给 {who} 3 块", "{who} 你够狠"],
  // huangzhuang
  huangzhuang: [
    "🟡 黄庄，大家都没赢",
    "🟡 流局了，喘口气",
    "🟡 没人胡，重新来",
    "🟡 安全下庄",
  ],
  // 跟庄
  genzhuang_iam_loser: [
    "💀 我跟庄了 -3",
    "倒霉，跟庄罚 3 块",
    "起手就翻车",
    "跟庄送钱 -3",
  ],
  genzhuang_other_loser: [
    "💸 {who} 跟庄 -3",
    "{who} 起手就送钱",
    "{who} 跟庄了，三家各 +1",
    "{who} 翻车了",
  ],
  genzhuang_iam_winner: [
    "🤑 {who} 跟庄，我 +1",
    "天降一块",
    "白嫖 +1",
    "{who} 送的，谢谢",
  ],
};

function fillPhrase(tpl, vars) {
  return tpl.replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? "");
}

function toastForHand(h, data, isMe) {
  const players = data.players;
  const balances = data.balances || [];
  const byId = Object.fromEntries(players.map(p => [p.id, p.name]));
  const w = byId[h.winner_id];
  const l = byId[h.loser_id];
  const winnerBal = balances.find(b => b.player_id === h.winner_id);
  const winnerStreak = winnerBal?.streak?.kind === "win" ? winnerBal.streak.count : 0;

  if (h.kind === "huangzhuang") {
    return pickRandom(PHRASES.huangzhuang);
  }
  if (h.kind === "genzhuang") {
    if (h.loser_id === state.myPlayerId) {
      return fillPhrase(pickRandom(PHRASES.genzhuang_iam_loser), {});
    }
    if (state.myPlayerId != null) {
      return fillPhrase(pickRandom(PHRASES.genzhuang_iam_winner), { who: l });
    }
    return fillPhrase(pickRandom(PHRASES.genzhuang_other_loser), { who: l });
  }
  if (h.kind === "zimo") {
    const n = h.amount * 3;
    let pool;
    if (isMe) {
      pool = winnerStreak >= 2 ? PHRASES.zimo_me_streak : PHRASES.zimo_me;
    } else {
      pool = winnerStreak >= 2 ? PHRASES.zimo_other_streak : PHRASES.zimo_other;
    }
    return fillPhrase(pickRandom(pool), { who: w, n, streak: winnerStreak });
  }
  if (h.kind === "gang_chagang") {
    return fillPhrase(pickRandom(isMe ? PHRASES.gang_chagang_me : PHRASES.gang_chagang_other), { who: w });
  }
  if (h.kind === "gang_angang") {
    return fillPhrase(pickRandom(isMe ? PHRASES.gang_angang_me : PHRASES.gang_angang_other), { who: w });
  }
  if (h.kind === "gang_others") {
    if (isMe) {
      return fillPhrase(pickRandom(PHRASES.gang_others_me), { who: l });
    }
    if (h.loser_id === state.myPlayerId) {
      return fillPhrase(pickRandom(PHRASES.gang_others_iam_loser), { who: w });
    }
    return fillPhrase(pickRandom(PHRASES.gang_others_other), { who: w, loser: l });
  }
  return "";
}

/* ============================================================
   HOME
============================================================ */
async function showHome() {
  state.view = "home";
  state.sessionId = null;
  state.data = null;
  state.lastSeenHandIds = new Set();
  state.prevBalances = {};
  stopPolling();
  mount("tpl-home");
  applyTheme(getTheme());

  $("#btn-create").onclick = async () => {
    const { id } = await api("/api/sessions", {
      method: "POST", body: JSON.stringify({}),
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
        <div class="title">${escape(s.name)} ${status}</div>
        <div class="meta">${escape(players)} · ${s.hand_count} 盘 · ${fmtTime(s.created_at)}</div>
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

function escape(s) {
  return String(s).replace(/[&<>"]/g, c =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])
  );
}

/* ============================================================
   PICK ME
============================================================ */
function showPickMe(sessionData) {
  mount("tpl-pick-me");
  applyTheme(getTheme());
  const grid = $("#pick-me-grid");
  grid.innerHTML = "";
  sessionData.players.forEach((p, i) => {
    const el = document.createElement("div");
    el.className = "pick";
    el.innerHTML = `${escape(p.name)}<span class="seat">${SEAT_NAMES[i]}家</span>`;
    el.onclick = () => {
      setMe(sessionData.id, p.id);
      // remember this name as login (for "login by name" feature)
      setLogin(p.name);
      state.myPlayerId = p.id;
      proceedSession(sessionData);
    };
    grid.appendChild(el);
  });

  $("#pick-me-login").onclick = () => openLoginModal(sessionData);
  $("#pick-me-skip").onclick = () => {
    state.myPlayerId = null;
    proceedSession(sessionData);
  };
}

function proceedSession(data) {
  mount("tpl-session");
  applyTheme(getTheme());
  renderSession(data);
  startPolling();
}

/* ============================================================
   SESSION
============================================================ */
async function showSession(sid) {
  state.view = "session";
  state.sessionId = sid;
  state.lastSeenHandIds = new Set();
  state.prevBalances = {};
  state.selectedAmount = state.config.amounts[0];
  stopPolling();

  const data = await api(`/api/sessions/${sid}`);
  state.data = data;
  state.myPlayerId = getMe(sid);

  // Try login by saved name → match a player
  if (state.myPlayerId == null && state.loginName) {
    const match = data.players.find(p =>
      p.name.toLowerCase() === state.loginName.toLowerCase()
    );
    if (match) {
      state.myPlayerId = match.id;
      setMe(sid, match.id);
    }
  }

  if (state.myPlayerId == null) {
    showPickMe(data);
    return;
  }
  if (!data.players.find(p => p.id === state.myPlayerId)) {
    setMe(sid, null);
    showPickMe(data);
    return;
  }

  proceedSession(data);
}

function startPolling() {
  stopPolling();
  state.pollTimer = setInterval(async () => {
    if (state.view !== "session" || state.sessionId == null) return;
    try {
      const data = await api(`/api/sessions/${state.sessionId}`);
      const prevIds = state.lastSeenHandIds;
      const currIds = new Set(data.hands.map(h => h.id));
      const newOnes = data.hands.filter(h => !prevIds.has(h.id));
      state.data = data;
      renderSession(data);
      if (prevIds.size > 0) {
        for (const h of newOnes.reverse()) {
          const isMe = h.winner_id === state.myPlayerId;
          toast(toastForHand(h, data, isMe));
        }
      }
      state.lastSeenHandIds = currIds;
    } catch {}
  }, 2000);
}

function renderSession(s) {
  $("#topbar-title").textContent = (THEMES.find(t => t.key === getTheme()) || THEMES[0]).title;

  $("#s-name").textContent = s.name + (s.ended_at ? "（已结束）" : "");
  $("#s-meta").textContent = `开局 ${fmtTime(s.created_at)} · 共 ${s.hands.length} 盘`;

  const me = s.players.find(p => p.id === state.myPlayerId);
  $("#me-tag").innerHTML = me
    ? `我是 <b style="color:var(--accent-b)">${escape(me.name)}</b> · <span class="edit-me" style="cursor:pointer; text-decoration:underline">换位</span>`
    : `<span class="edit-me" style="cursor:pointer; text-decoration:underline">点这里选我是哪一家</span>`;
  $(".edit-me").onclick = () => {
    setMe(s.id, null);
    state.myPlayerId = null;
    showPickMe(s);
  };

  const btnEnd = $("#btn-end");
  btnEnd.textContent = s.ended_at ? "重开" : "结束";
  btnEnd.onclick = async () => {
    if (s.ended_at) {
      await api(`/api/sessions/${s.id}/reopen`, { method: "POST" });
    } else {
      if (!confirm("结束本牌局？随时可重开。")) return;
      await api(`/api/sessions/${s.id}/end`, { method: "POST" });
      // auto-show settlement after end
      const fresh = await api(`/api/sessions/${s.id}`);
      state.data = fresh;
      renderSession(fresh);
      openSettlement(fresh);
      return;
    }
    refreshOnce();
  };
  $("#btn-settle").onclick = () => openSettlement(s);

  // Balances — diamond layout if my seat known
  const bals = $("#balances");
  bals.innerHTML = "";

  const myBal = s.balances.find(b => b.player_id === state.myPlayerId);
  const mySeat = myBal ? myBal.seat : null;
  const useDiamond = mySeat != null;
  bals.classList.toggle("diamond", useDiamond);

  function relPos(theirSeat) {
    if (!useDiamond) return null;
    if (theirSeat === mySeat) return "bottom";
    const diff = (theirSeat - mySeat + 4) % 4;
    return diff === 1 ? "right" : diff === 2 ? "top" : "left";
  }
  // expose for downstream picker
  state._relPos = relPos;
  state._useDiamond = useDiamond;

  s.balances.forEach((b, i) => {
    const cls = b.balance > 0 ? "win" : b.balance < 0 ? "lose" : "flat";
    const meCls = b.player_id === state.myPlayerId ? " me" : "";
    const sign = b.balance > 0 ? "+" : "";
    const div = document.createElement("div");
    div.className = `bal ${cls}${meCls}`;
    let streakHtml = `<div class="streak none">—</div>`;
    if (b.streak.kind === "win" && b.streak.count > 1) {
      streakHtml = `<div class="streak win"><span class="icon">🔥</span> 连胜 ${b.streak.count}</div>`;
    } else if (b.streak.kind === "lose" && b.streak.count > 1) {
      streakHtml = `<div class="streak lose"><span class="icon">💧</span> 连败 ${b.streak.count}</div>`;
    } else if (b.streak.kind === "win") {
      streakHtml = `<div class="streak win">刚赢</div>`;
    } else if (b.streak.kind === "lose") {
      streakHtml = `<div class="streak lose">刚输</div>`;
    }
    div.innerHTML = `
      <div class="name">
        <span class="seat">${SEAT_NAMES[i]}</span>
        <span class="pname">${escape(b.name)}</span>
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
        method: "PUT", body: JSON.stringify({ name: trimmed }),
      }).then(() => {
        // if I renamed myself, update login
        if (b.player_id === state.myPlayerId) setLogin(trimmed);
        refreshOnce();
      });
    };
    // pulse if changed
    const prev = state.prevBalances[b.player_id];
    if (prev != null && prev !== b.balance) {
      div.classList.add("bumping");
      setTimeout(() => div.classList.remove("bumping"), 600);
    }
    if (useDiamond) div.dataset.pos = relPos(b.seat);
    else div.removeAttribute("data-pos");
    bals.appendChild(div);
    state.prevBalances[b.player_id] = b.balance;
  });

  // table-center decoration for diamond mode (cream 中 tile)
  if (useDiamond) {
    const center = document.createElement("div");
    center.className = "table-center";
    center.innerHTML = `<div class="zhong">中</div>`;
    bals.appendChild(center);
  }

  // Amount strip
  const strip = $("#amount-strip");
  strip.innerHTML = "";
  state.config.amounts.forEach((v, i) => {
    const el = document.createElement("div");
    el.className = "a" + (state.selectedAmount === v ? " selected" : "");
    el.innerHTML = `<span class="v">${state.config.amount_labels[i]}</span><span class="m">${v}块</span>`;
    el.onclick = () => {
      state.selectedAmount = v;
      $$("#amount-strip .a").forEach(n => n.classList.remove("selected"));
      el.classList.add("selected", "poking");
      setTimeout(() => el.classList.remove("poking"), 420);
      SoundFx.pick();
      buzz(15);
    };
    strip.appendChild(el);
  });

  const btnZimo = $("#btn-zimo");
  const btnUndo = $("#btn-undo");
  const btnOtherWin = $("#btn-other-win");
  const btnGenzhuang = $("#btn-genzhuang");
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
    if (state.myPlayerId == null) { toast("先点上方「选我是哪一家」"); return; }
    buzz(40);
    SoundFx.win();
    addHand({ kind: "zimo", winner_id: state.myPlayerId, amount: state.selectedAmount });
  };

  // helper: positions object {pid: "top"|"left"|"right"} for the 3 non-me players
  function picksWithPositions(excludeMe = true) {
    if (!useDiamond) return { choices: s.players.filter(p => !excludeMe || p.id !== state.myPlayerId), positions: null };
    const choices = excludeMe
      ? s.players.filter(p => p.id !== state.myPlayerId)
      : s.players.slice();
    const positions = {};
    for (const p of choices) positions[p.id] = relPos(p.seat);
    return { choices, positions };
  }

  for (const g of gangBtns) {
    g.onclick = () => {
      const act = g.dataset.act;
      if (state.myPlayerId == null) { toast("先点上方「选我是哪一家」"); return; }
      if (act === "gang_others_pick") {
        const { choices, positions } = picksWithPositions(true);
        openPickModal({
          title: "我杠了谁？",
          choices, positions,
          meLabel: myBal ? myBal.name : "我",
          onOk: (pid) => {
            buzz(30); SoundFx.gang();
            addHand({ kind: "gang_others", winner_id: state.myPlayerId, loser_id: pid });
          },
        });
      } else if (act === "zinged_pick") {
        const { choices, positions } = picksWithPositions(true);
        openPickModal({
          title: "谁杠了我？",
          choices, positions,
          meLabel: myBal ? myBal.name : "我",
          onOk: (pid) => {
            buzz(30); SoundFx.zinged();
            // gang_others record: pid is the winner, I'm the loser
            addHand({ kind: "gang_others", winner_id: pid, loser_id: state.myPlayerId });
          },
        });
      } else {
        buzz(30); SoundFx.gang();
        addHand({ kind: act, winner_id: state.myPlayerId });
      }
    };
  }

  btnOtherWin.onclick = () => {
    const { choices, positions } = picksWithPositions(true);
    openPickModal({
      title: "谁赢了？",
      choices, positions,
      meLabel: myBal ? myBal.name : "我",
      withAmount: true,
      onOk: (pid, amt) => {
        buzz(30); SoundFx.win();
        addHand({ kind: "zimo", winner_id: pid, amount: amt });
      },
    });
  };

  btnGenzhuang.onclick = () => {
    if (state.myPlayerId == null) { toast("先点上方「选我是哪一家」"); return; }
    const { choices, positions } = picksWithPositions(false);
    openPickModal({
      title: "跟庄是谁？",
      choices, positions,
      onOk: (pid) => {
        buzz(25); SoundFx.zinged();
        addHand({ kind: "genzhuang", loser_id: pid });
      },
    });
  };

  btnUndo.onclick = async () => {
    if (!lastHand) { toast("还没有可撤销的记录"); return; }
    if (!confirm("撤销最近一盘？")) return;
    buzz(15); SoundFx.undo();
    await api(`/api/sessions/${s.id}/hands/${lastHand.id}`, { method: "DELETE" });
    refreshOnce();
  };

  // Hands list
  const handCountEl = $("#hand-count");
  if (handCountEl) handCountEl.textContent = s.hands.length;
  // wire up collapse toggle once
  const histCard = $("#hist-card");
  const histHead = $("#hist-head");
  if (histCard && histHead && !histHead.dataset.bound) {
    histHead.dataset.bound = "1";
    histHead.onclick = () => histCard.classList.toggle("open");
  }

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
      div.className = "hand huang"; title = "黄庄"; detail = "流局"; amt = "—";
    } else if (h.kind === "zimo") {
      div.className = "hand";
      title = `<span class="winner">${escape(w?.name || "?")}</span> 自摸`;
      detail = `${maLabel(h.amount)} · 三家各 ${h.amount}`;
      amt = `+${h.amount * 3}`;
    } else if (h.kind === "gang_chagang") {
      div.className = "hand gang";
      title = `<span class="winner">${escape(w?.name || "?")}</span> 插杠`;
      detail = `三家各 1`; amt = `+3`;
    } else if (h.kind === "gang_angang") {
      div.className = "hand gang";
      title = `<span class="winner">${escape(w?.name || "?")}</span> 暗杠`;
      detail = `三家各 2`; amt = `+6`;
    } else if (h.kind === "gang_others") {
      div.className = "hand gang";
      title = `<span class="winner">${escape(w?.name || "?")}</span> 杠 ${escape(l?.name || "?")}`;
      detail = `${escape(l?.name || "?")} 给 3`; amt = `+3`;
    } else if (h.kind === "genzhuang") {
      div.className = "hand gang";
      title = `<span class="winner">${escape(l?.name || "?")}</span> 跟庄`;
      detail = `三家各 +1`; amt = `-3`;
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
    method: "POST", body: JSON.stringify(body),
  });
  // Confetti for wins
  if (body.kind === "zimo" || body.kind && body.kind.startsWith("gang_")) {
    confetti(body.kind === "zimo" ? 50 : 24);
  }
  await refreshOnce();
}

/* ============================================================
   MODAL: pick winner / payer (+ optional amount)
============================================================ */
function openPickModal({ title, choices, withAmount = false, onOk, positions = null, meLabel = null }) {
  const tpl = document.getElementById("tpl-modal-pick");
  const node = tpl.content.cloneNode(true);
  document.body.appendChild(node);
  const back = document.body.lastElementChild;

  $("#modal-title", back).textContent = title;
  let selected = null;
  let amt = state.selectedAmount;

  const grid = $("#modal-grid", back);
  grid.innerHTML = "";
  // diamond layout when caller provides positions for all choices
  const useDiamond = positions && choices.every(p => positions[p.id]);
  const isDiamond4 = useDiamond && choices.length === 4;
  if (isDiamond4) grid.classList.add("diamond4");
  else if (useDiamond) grid.classList.add("diamond3");
  for (const p of choices) {
    const el = document.createElement("div");
    el.className = "pick";
    el.textContent = p.name;
    if (useDiamond) el.dataset.pos = positions[p.id];
    el.onclick = () => {
      selected = p.id;
      buzz(10); SoundFx.click();
      $$(".pick", grid).forEach(n => n.classList.remove("selected"));
      el.classList.add("selected");
    };
    grid.appendChild(el);
  }
  // center "我" marker only in diamond3 (3 choices, anchor the layout)
  if (useDiamond && !isDiamond4) {
    const me = document.createElement("div");
    me.className = "me-marker";
    me.textContent = meLabel || "我";
    grid.appendChild(me);
  }

  if (withAmount) {
    $("#modal-amount", back).classList.remove("hidden");
    const strip = $("#modal-amount-strip", back);
    strip.innerHTML = "";
    state.config.amounts.forEach((v, i) => {
      const el = document.createElement("div");
      el.className = "a" + (amt === v ? " selected" : "");
      el.innerHTML = `<span class="v">${state.config.amount_labels[i]}</span><span class="m">${v}块</span>`;
      el.onclick = () => {
        amt = v;
        $$(".a", strip).forEach(n => n.classList.remove("selected"));
        el.classList.add("selected");
      };
      strip.appendChild(el);
    });
  }

  const close = () => back.remove();
  $("#modal-cancel", back).onclick = close;
  $("#modal-ok", back).onclick = () => {
    if (selected == null) { toast("请选一个"); return; }
    close();
    onOk(selected, amt);
  };
}

/* ============================================================
   MODAL: settlement
============================================================ */
function openSettlement(s) {
  const tpl = document.getElementById("tpl-modal-settle");
  document.body.appendChild(tpl.content.cloneNode(true));
  const back = document.body.lastElementChild;

  $("#settle-summary", back).textContent =
    `共 ${s.hands.length} 盘 · 谁转给谁，转完两清`;

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
          <span class="from">${escape(t.from)}</span>
          <span class="arrow">→</span>
          <span class="to">${escape(t.to)}</span>
        </div>
        <div class="amt">${t.amount} 块</div>
      `;
      list.appendChild(row);
    }
  }
  $("#settle-close", back).onclick = () => back.remove();
}

/* ============================================================
   MODAL: theme
============================================================ */
function openThemeModal() {
  const tpl = document.getElementById("tpl-modal-theme");
  document.body.appendChild(tpl.content.cloneNode(true));
  const back = document.body.lastElementChild;
  const grid = $("#theme-grid", back);
  const cur = getTheme();
  grid.innerHTML = "";
  for (const t of THEMES) {
    const el = document.createElement("div");
    el.className = "theme-card" + (cur === t.key ? " active" : "");
    // Render preview tile with its primary gradient
    el.style.background = previewBg(t.key);
    el.innerHTML = `<div class="emoji">${t.emoji}</div><div class="name">${t.name}</div>`;
    el.onclick = () => {
      setTheme(t.key);
      $$(".theme-card", grid).forEach(n => n.classList.remove("active"));
      el.classList.add("active");
      confetti(20);
    };
    grid.appendChild(el);
  }
  $("#theme-close", back).onclick = () => back.remove();
}
function previewBg(k) {
  switch (k) {
    case "neon":   return "linear-gradient(135deg, #ec4899, #a855f7 50%, #22d3ee)";
    case "luxe":   return "linear-gradient(135deg, #faf7f2 0%, #ffffff 50%, #b8956f 100%)";
    case "green":  return "linear-gradient(180deg, #2a8a4a 0%, #1d4f3a 100%)";
    case "bamboo": return "linear-gradient(180deg, #c8dcb8 0%, #8fbb70 100%)";
    case "purple": return "linear-gradient(180deg, #4c3a78 0%, #2d1f47 100%)";
    case "orange": return "linear-gradient(180deg, #ffb56b 0%, #ff7a3d 100%)";
    case "bp":     return "linear-gradient(135deg, #ff59c7, #000 50%, #ff59c7)";
    default: return "";
  }
}

/* ============================================================
   MODAL: login by name
============================================================ */
async function openLoginModal(returnSessionData) {
  const tpl = document.getElementById("tpl-modal-login");
  document.body.appendChild(tpl.content.cloneNode(true));
  const back = document.body.lastElementChild;

  const input = $("#login-input", back);
  input.value = state.loginName || "";

  // load known names
  let globals = [];
  try { globals = await api("/api/players_global"); } catch {}
  const list = $("#login-list", back);
  list.innerHTML = "";
  if (!globals.length) {
    list.innerHTML = `<div class="muted small">还没有记录的玩家</div>`;
  } else {
    for (const g of globals) {
      const chip = document.createElement("div");
      chip.className = "chip";
      chip.textContent = g.name;
      chip.onclick = () => { input.value = g.name; submit(); };
      list.appendChild(chip);
    }
  }

  const submit = () => {
    const name = input.value.trim();
    if (!name) { toast("请输入名字"); return; }
    setLogin(name);
    back.remove();
    if (returnSessionData) {
      // try to match a player on this session
      const match = returnSessionData.players.find(p =>
        p.name.toLowerCase() === name.toLowerCase()
      );
      if (match) {
        setMe(returnSessionData.id, match.id);
        state.myPlayerId = match.id;
        proceedSession(returnSessionData);
      } else {
        toast(`「${name}」不在本局玩家里，下次自动认你`);
      }
    } else {
      toast(`记住你了：${name}`);
    }
  };

  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") submit();
  });
  $("#login-cancel", back).onclick = () => back.remove();
}

/* ============================================================
   LEADERBOARD
============================================================ */
async function showLeaderboard() {
  state.view = "leaderboard";
  state.sessionId = null;
  stopPolling();
  mount("tpl-leaderboard");
  applyTheme(getTheme());

  const rows = await api("/api/leaderboard");
  const list = $("#leaderboard");
  list.innerHTML = "";
  if (!rows.length) {
    list.innerHTML = `<div class="muted small">还没有任何战绩。开一局吧。</div>`;
    return;
  }
  rows.forEach((r, i) => {
    const sign = r.total_balance > 0 ? "+" : "";
    const cls = r.total_balance > 0 ? "pos" : r.total_balance < 0 ? "neg" : "flat";
    const div = document.createElement("div");
    const topCls = i < 3 ? ` top${i + 1}` : "";
    div.className = `lb-row${topCls}`;
    div.innerHTML = `
      <div class="rank">${i < 3 ? ["🥇","🥈","🥉"][i] : i + 1}</div>
      <div>
        <div class="name">${escape(r.name)}</div>
        <div class="meta">${r.sessions} 局 · 自摸 ${r.zimo} · 杠 ${r.gang} · 胜率 ${(r.win_rate * 100).toFixed(0)}%</div>
      </div>
      <div class="bal ${cls}">${sign}${r.total_balance}</div>
    `;
    div.onclick = () => showPlayer(r.global_id);
    list.appendChild(div);
  });
}

async function showPlayer(gid) {
  state.view = "player";
  stopPolling();
  mount("tpl-player");
  applyTheme(getTheme());

  const data = await api(`/api/players_global/${gid}`);
  $("#pd-name").textContent = `🎴 ${data.name}`;
  const s = data.stats || { total_balance: 0, sessions: 0, hands_played: 0, wins: 0, zimo: 0, gang: 0, max_win: 0, win_rate: 0 };
  const sign = s.total_balance > 0 ? "+" : "";
  const cls = s.total_balance > 0 ? "pos" : s.total_balance < 0 ? "neg" : "";
  $("#pd-stats").innerHTML = `
    <div class="pd-stat"><div class="lab">累计</div><div class="val ${cls}">${sign}${s.total_balance}</div></div>
    <div class="pd-stat"><div class="lab">局数</div><div class="val">${s.sessions}</div></div>
    <div class="pd-stat"><div class="lab">自摸</div><div class="val">${s.zimo}</div></div>
    <div class="pd-stat"><div class="lab">杠</div><div class="val">${s.gang}</div></div>
    <div class="pd-stat"><div class="lab">胜率</div><div class="val">${(s.win_rate * 100).toFixed(0)}%</div></div>
    <div class="pd-stat"><div class="lab">最高单盘</div><div class="val">${s.max_win || 0}</div></div>
  `;

  const list = $("#pd-history");
  list.innerHTML = "";
  if (!data.history.length) {
    list.innerHTML = `<div class="muted small">还没有参加过牌局。</div>`;
    return;
  }
  for (const h of data.history) {
    const sign = h.balance > 0 ? "+" : "";
    const cls = h.balance > 0 ? "pos" : h.balance < 0 ? "neg" : "";
    const row = document.createElement("div");
    row.className = "pd-history-row";
    row.innerHTML = `
      <div class="left">
        <div><b>${escape(h.session_name)}</b> ${h.session_ended ? '<span class="muted small">已结束</span>' : ''}</div>
        <div class="when">${fmtTime(h.session_created)} · ${h.hand_count} 盘 · 当时叫「${escape(h.name_in_session)}」</div>
      </div>
      <div class="bal ${cls}">${sign}${h.balance}</div>
    `;
    row.onclick = () => showSession(h.session_id);
    list.appendChild(row);
  }
}

/* ============================================================
   Boot
============================================================ */
$("#btn-home").onclick = () => showHome();
$("#btn-theme").onclick = () => openThemeModal();
$("#btn-leaderboard").onclick = () => showLeaderboard();
$("#btn-sound").onclick = () => {
  // toggle and play a confirm beep
  const next = !SoundFx.enabled;
  setSoundOn(next);
  if (next) { SoundFx.init(); SoundFx.resume(); SoundFx.click(); }
  buzz(15);
};

// Unlock audio on first user gesture (browsers require this)
function unlockAudioOnce() {
  SoundFx.init();
  SoundFx.resume();
  document.removeEventListener("click", unlockAudioOnce);
  document.removeEventListener("touchstart", unlockAudioOnce);
}
document.addEventListener("click", unlockAudioOnce, { once: true });
document.addEventListener("touchstart", unlockAudioOnce, { once: true });

(async function init() {
  try {
    const cfg = await api("/api/config");
    state.config = { ...state.config, ...cfg };
    state.selectedAmount = state.config.amounts[0];
  } catch {}
  state.loginName = getLogin();
  SoundFx.enabled = getSoundOn();
  $("#btn-sound").textContent = SoundFx.enabled ? "🔊" : "🔇";
  applyTheme(getTheme());
  showHome();
})();

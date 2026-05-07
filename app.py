import os
import sqlite3
import socket
from contextlib import closing
from datetime import datetime

from flask import Flask, g, jsonify, render_template, request

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.join(BASE_DIR, "data")
DB_PATH = os.path.join(DATA_DIR, "mahjong.db")

ALLOWED_AMOUNTS = [2, 4, 6, 8, 10, 12, 14]
# 抓几个马 → 实际金额，2 + 2*马
AMOUNT_LABELS = ["无马", "1个马", "2个马", "3个马", "4个马", "5个马", "6个马"]
DEFAULT_PLAYERS = ["东家", "南家", "西家", "北家"]

GANG_FIXED = {
    "gang_chagang": 1,
    "gang_angang": 2,
    "gang_others": 3,
}
ALL_KINDS = {"zimo", "huangzhuang", "genzhuang", *GANG_FIXED.keys()}

app = Flask(__name__)


def get_db():
    if "db" not in g:
        os.makedirs(DATA_DIR, exist_ok=True)
        conn = sqlite3.connect(DB_PATH)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA foreign_keys = ON")
        g.db = conn
    return g.db


@app.teardown_appcontext
def close_db(_exc):
    db = g.pop("db", None)
    if db is not None:
        db.close()


def init_db():
    os.makedirs(DATA_DIR, exist_ok=True)
    with closing(sqlite3.connect(DB_PATH)) as conn:
        conn.executescript(
            """
            CREATE TABLE IF NOT EXISTS sessions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                created_at TEXT NOT NULL,
                ended_at TEXT
            );
            CREATE TABLE IF NOT EXISTS players_global (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT UNIQUE NOT NULL COLLATE NOCASE,
                created_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS players (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                session_id INTEGER NOT NULL,
                seat INTEGER NOT NULL,
                name TEXT NOT NULL,
                global_id INTEGER,
                FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE,
                FOREIGN KEY (global_id)  REFERENCES players_global(id)
            );
            CREATE TABLE IF NOT EXISTS hands (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                session_id INTEGER NOT NULL,
                created_at TEXT NOT NULL,
                kind TEXT NOT NULL,
                amount INTEGER NOT NULL,
                winner_id INTEGER,
                loser_id INTEGER,
                note TEXT,
                FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE,
                FOREIGN KEY (winner_id) REFERENCES players(id),
                FOREIGN KEY (loser_id)  REFERENCES players(id)
            );
            CREATE INDEX IF NOT EXISTS idx_hands_session ON hands(session_id, id);
            """
        )
        # idempotent migrations for older DBs
        cols = {r[1] for r in conn.execute("PRAGMA table_info(hands)").fetchall()}
        if "loser_id" not in cols:
            conn.execute("ALTER TABLE hands ADD COLUMN loser_id INTEGER")
        cols = {r[1] for r in conn.execute("PRAGMA table_info(players)").fetchall()}
        if "global_id" not in cols:
            conn.execute("ALTER TABLE players ADD COLUMN global_id INTEGER")
        # backfill global_id for existing players
        rows = conn.execute("SELECT id, name FROM players WHERE global_id IS NULL").fetchall()
        for r in rows:
            gid = _link_or_create_global(conn, r[1])
            conn.execute("UPDATE players SET global_id = ? WHERE id = ?", (gid, r[0]))
        conn.commit()


def _link_or_create_global(conn, name):
    name = name.strip()
    row = conn.execute(
        "SELECT id FROM players_global WHERE name = ? COLLATE NOCASE", (name,)
    ).fetchone()
    if row:
        return row[0] if isinstance(row, tuple) else row["id"]
    cur = conn.execute(
        "INSERT INTO players_global(name, created_at) VALUES(?, ?)",
        (name, datetime.now().isoformat(timespec="seconds")),
    )
    return cur.lastrowid


def session_to_dict(row):
    return {
        "id": row["id"],
        "name": row["name"],
        "created_at": row["created_at"],
        "ended_at": row["ended_at"],
    }


def players_for_session(db, session_id):
    rows = db.execute(
        "SELECT id, seat, name, global_id FROM players "
        "WHERE session_id = ? ORDER BY seat",
        (session_id,),
    ).fetchall()
    return [
        {"id": r["id"], "seat": r["seat"], "name": r["name"], "global_id": r["global_id"]}
        for r in rows
    ]


def hand_outcome_for(player_id, hand):
    kind = hand["kind"]
    if kind == "huangzhuang":
        return "neutral"
    if kind == "genzhuang":
        return "lose" if hand["loser_id"] == player_id else "win"
    if hand["winner_id"] == player_id:
        return "win"
    if kind == "gang_others":
        return "lose" if hand["loser_id"] == player_id else "neutral"
    return "lose"


def compute_balances_and_streaks(db, session_id):
    players = players_for_session(db, session_id)
    balances = {p["id"]: 0 for p in players}

    hands_asc = db.execute(
        "SELECT kind, amount, winner_id, loser_id FROM hands "
        "WHERE session_id = ? ORDER BY id ASC",
        (session_id,),
    ).fetchall()

    for h in hands_asc:
        kind = h["kind"]
        winner = h["winner_id"]
        amt = h["amount"]
        if kind == "huangzhuang":
            continue
        if kind == "gang_others":
            loser = h["loser_id"]
            if winner is None or loser is None:
                continue
            balances[winner] += amt
            balances[loser] -= amt
        elif kind in ("zimo", "gang_chagang", "gang_angang"):
            if winner is None:
                continue
            for p in players:
                if p["id"] == winner:
                    continue
                balances[p["id"]] -= amt
                balances[winner] += amt
        elif kind == "genzhuang":
            # 跟庄: loser pays 1 to each of 3 others
            loser = h["loser_id"]
            if loser is None:
                continue
            for p in players:
                if p["id"] == loser:
                    balances[p["id"]] -= amt * 3
                else:
                    balances[p["id"]] += amt

    hands_desc = list(reversed(hands_asc))
    streaks = {}
    for p in players:
        kind, count = None, 0
        for h in hands_desc:
            outcome = hand_outcome_for(p["id"], h)
            if outcome == "neutral":
                continue
            if kind is None:
                kind, count = outcome, 1
            elif outcome == kind:
                count += 1
            else:
                break
        streaks[p["id"]] = {"kind": kind or "none", "count": count}

    return [
        {
            "player_id": p["id"],
            "seat": p["seat"],
            "name": p["name"],
            "global_id": p["global_id"],
            "balance": balances.get(p["id"], 0),
            "streak": streaks[p["id"]],
        }
        for p in players
    ]


def compute_settlement(balances):
    creditors = sorted(
        [{"id": b["player_id"], "name": b["name"], "amount": b["balance"]}
         for b in balances if b["balance"] > 0],
        key=lambda x: -x["amount"],
    )
    debtors = sorted(
        [{"id": b["player_id"], "name": b["name"], "amount": -b["balance"]}
         for b in balances if b["balance"] < 0],
        key=lambda x: -x["amount"],
    )
    transfers = []
    i = j = 0
    while i < len(debtors) and j < len(creditors):
        d, c = debtors[i], creditors[j]
        amt = min(d["amount"], c["amount"])
        if amt > 0:
            transfers.append({
                "from_id": d["id"], "from": d["name"],
                "to_id": c["id"], "to": c["name"],
                "amount": amt,
            })
        d["amount"] -= amt
        c["amount"] -= amt
        if d["amount"] == 0: i += 1
        if c["amount"] == 0: j += 1
    return transfers


def compute_leaderboard(db):
    """Aggregate stats per global player across all sessions."""
    rows = db.execute(
        "SELECT id, name FROM players_global ORDER BY name COLLATE NOCASE"
    ).fetchall()
    out = []
    for g in rows:
        sps = db.execute(
            "SELECT id, session_id FROM players WHERE global_id = ?", (g["id"],)
        ).fetchall()
        if not sps:
            continue
        sessions = set(sp["session_id"] for sp in sps)
        sp_by_session = {sp["session_id"]: sp["id"] for sp in sps}
        total = 0
        wins = 0
        losses = 0
        zimo = 0
        gang = 0
        max_win = 0
        hands_played = 0
        for sid in sessions:
            sp_id = sp_by_session[sid]
            balances = compute_balances_and_streaks(db, sid)
            for b in balances:
                if b["player_id"] == sp_id:
                    total += b["balance"]
            hands = db.execute(
                "SELECT kind, amount, winner_id, loser_id FROM hands WHERE session_id = ?",
                (sid,),
            ).fetchall()
            for h in hands:
                outcome = hand_outcome_for(sp_id, h)
                if outcome == "win":
                    wins += 1
                    if h["kind"] == "zimo":
                        zimo += 1
                        max_win = max(max_win, h["amount"] * 3)
                    elif h["kind"] in ("gang_chagang", "gang_angang"):
                        gang += 1
                        max_win = max(max_win, h["amount"] * 3)
                    elif h["kind"] == "gang_others":
                        gang += 1
                        max_win = max(max_win, h["amount"])
                elif outcome == "lose":
                    losses += 1
                if outcome != "neutral":
                    hands_played += 1
        out.append({
            "global_id": g["id"],
            "name": g["name"],
            "sessions": len(sessions),
            "hands_played": hands_played,
            "wins": wins,
            "losses": losses,
            "win_rate": round(wins / hands_played, 3) if hands_played else 0,
            "total_balance": total,
            "zimo": zimo,
            "gang": gang,
            "max_win": max_win,
        })
    return sorted(out, key=lambda r: -r["total_balance"])


def compute_player_history(db, gid):
    """Per-session breakdown for a global player."""
    sps = db.execute(
        "SELECT p.id, p.session_id, p.name, p.seat, s.name AS session_name, "
        "       s.created_at, s.ended_at "
        "FROM players p JOIN sessions s ON s.id = p.session_id "
        "WHERE p.global_id = ? ORDER BY s.id DESC",
        (gid,),
    ).fetchall()
    out = []
    for sp in sps:
        balances = compute_balances_and_streaks(db, sp["session_id"])
        bal = next((b["balance"] for b in balances if b["player_id"] == sp["id"]), 0)
        hand_count = db.execute(
            "SELECT COUNT(*) AS c FROM hands WHERE session_id = ?", (sp["session_id"],)
        ).fetchone()["c"]
        out.append({
            "session_id": sp["session_id"],
            "session_name": sp["session_name"],
            "session_created": sp["created_at"],
            "session_ended": sp["ended_at"],
            "name_in_session": sp["name"],
            "seat": sp["seat"],
            "balance": bal,
            "hand_count": hand_count,
        })
    return out


# ====================== ROUTES ======================

@app.route("/")
def index():
    return render_template("index.html")


@app.get("/api/config")
def api_config():
    return jsonify({
        "amounts": ALLOWED_AMOUNTS,
        "amount_labels": AMOUNT_LABELS,
        "default_players": DEFAULT_PLAYERS,
        "gang_fixed": GANG_FIXED,
    })


@app.get("/api/sessions")
def api_list_sessions():
    db = get_db()
    rows = db.execute(
        "SELECT id, name, created_at, ended_at FROM sessions ORDER BY id DESC"
    ).fetchall()
    out = []
    for r in rows:
        s = session_to_dict(r)
        s["players"] = players_for_session(db, r["id"])
        s["hand_count"] = db.execute(
            "SELECT COUNT(*) AS c FROM hands WHERE session_id = ?", (r["id"],)
        ).fetchone()["c"]
        out.append(s)
    return jsonify(out)


@app.post("/api/sessions")
def api_create_session():
    data = request.get_json(silent=True) or {}
    raw_names = data.get("players") or DEFAULT_PLAYERS
    names = [str(n).strip() or DEFAULT_PLAYERS[i] for i, n in enumerate(raw_names)]
    if len(names) != 4:
        return jsonify({"error": "需要 4 个玩家"}), 400

    name = (data.get("name") or "").strip()
    if not name:
        name = datetime.now().strftime("%m-%d %H:%M")

    db = get_db()
    cur = db.execute(
        "INSERT INTO sessions(name, created_at) VALUES(?, ?)",
        (name, datetime.now().isoformat(timespec="seconds")),
    )
    sid = cur.lastrowid
    for seat, pname in enumerate(names):
        gid = _link_or_create_global(db, pname)
        db.execute(
            "INSERT INTO players(session_id, seat, name, global_id) VALUES(?, ?, ?, ?)",
            (sid, seat, pname, gid),
        )
    db.commit()
    return jsonify({"id": sid})


@app.get("/api/sessions/<int:sid>")
def api_get_session(sid):
    db = get_db()
    row = db.execute(
        "SELECT id, name, created_at, ended_at FROM sessions WHERE id = ?", (sid,)
    ).fetchone()
    if not row:
        return jsonify({"error": "未找到牌局"}), 404
    s = session_to_dict(row)
    s["players"] = players_for_session(db, sid)
    s["balances"] = compute_balances_and_streaks(db, sid)
    s["settlement"] = compute_settlement(s["balances"])
    s["hands"] = [
        {
            "id": h["id"],
            "created_at": h["created_at"],
            "kind": h["kind"],
            "amount": h["amount"],
            "winner_id": h["winner_id"],
            "loser_id": h["loser_id"],
            "note": h["note"],
        }
        for h in db.execute(
            "SELECT id, created_at, kind, amount, winner_id, loser_id, note "
            "FROM hands WHERE session_id = ? ORDER BY id DESC",
            (sid,),
        ).fetchall()
    ]
    return jsonify(s)


@app.put("/api/sessions/<int:sid>/players/<int:pid>")
def api_rename_player(sid, pid):
    data = request.get_json(silent=True) or {}
    name = (data.get("name") or "").strip()
    if not name:
        return jsonify({"error": "名字不能为空"}), 400
    if len(name) > 12:
        return jsonify({"error": "名字最多 12 个字"}), 400
    db = get_db()
    gid = _link_or_create_global(db, name)
    cur = db.execute(
        "UPDATE players SET name = ?, global_id = ? WHERE id = ? AND session_id = ?",
        (name, gid, pid, sid),
    )
    db.commit()
    if cur.rowcount == 0:
        return jsonify({"error": "未找到玩家"}), 404
    return jsonify({"ok": True})


@app.put("/api/sessions/<int:sid>")
def api_rename_session(sid):
    data = request.get_json(silent=True) or {}
    name = (data.get("name") or "").strip()
    if not name:
        return jsonify({"error": "名字不能为空"}), 400
    db = get_db()
    cur = db.execute("UPDATE sessions SET name = ? WHERE id = ?", (name, sid))
    db.commit()
    if cur.rowcount == 0:
        return jsonify({"error": "未找到牌局"}), 404
    return jsonify({"ok": True})


@app.post("/api/sessions/<int:sid>/hands")
def api_add_hand(sid):
    data = request.get_json(silent=True) or {}
    kind = data.get("kind", "zimo")
    if kind not in ALL_KINDS:
        return jsonify({"error": "未知的类型"}), 400

    winner_id = data.get("winner_id")
    loser_id = data.get("loser_id")
    note = (data.get("note") or "").strip() or None

    db = get_db()
    if not db.execute("SELECT 1 FROM sessions WHERE id = ?", (sid,)).fetchone():
        return jsonify({"error": "未找到牌局"}), 404

    player_ids = {
        r["id"] for r in db.execute(
            "SELECT id FROM players WHERE session_id = ?", (sid,)
        ).fetchall()
    }

    if kind == "huangzhuang":
        amount = 0
        winner_id = None
        loser_id = None
    elif kind == "genzhuang":
        if loser_id not in player_ids:
            return jsonify({"error": "请选择跟庄的人"}), 400
        amount = 1
        winner_id = None
    elif kind in GANG_FIXED:
        if winner_id not in player_ids:
            return jsonify({"error": "请选择是谁杠的"}), 400
        amount = GANG_FIXED[kind]
        if kind == "gang_others":
            if loser_id not in player_ids:
                return jsonify({"error": "请选择给杠的人"}), 400
            if loser_id == winner_id:
                return jsonify({"error": "给杠的人不能是自己"}), 400
        else:
            loser_id = None
    else:  # zimo
        if winner_id not in player_ids:
            return jsonify({"error": "请选择赢家"}), 400
        amount = int(data.get("amount") or 0)
        if amount not in ALLOWED_AMOUNTS:
            return jsonify({"error": f"金额必须是 {ALLOWED_AMOUNTS} 之一"}), 400
        loser_id = None

    db.execute(
        "INSERT INTO hands(session_id, created_at, kind, amount, winner_id, loser_id, note) "
        "VALUES(?, ?, ?, ?, ?, ?, ?)",
        (
            sid,
            datetime.now().isoformat(timespec="seconds"),
            kind, amount, winner_id, loser_id, note,
        ),
    )
    db.commit()
    return jsonify({"ok": True})


@app.delete("/api/sessions/<int:sid>/hands/<int:hid>")
def api_delete_hand(sid, hid):
    db = get_db()
    cur = db.execute(
        "DELETE FROM hands WHERE id = ? AND session_id = ?", (hid, sid)
    )
    db.commit()
    if cur.rowcount == 0:
        return jsonify({"error": "未找到该盘记录"}), 404
    return jsonify({"ok": True})


@app.post("/api/sessions/<int:sid>/end")
def api_end_session(sid):
    db = get_db()
    db.execute(
        "UPDATE sessions SET ended_at = ? WHERE id = ?",
        (datetime.now().isoformat(timespec="seconds"), sid),
    )
    db.commit()
    return jsonify({"ok": True})


@app.post("/api/sessions/<int:sid>/reopen")
def api_reopen_session(sid):
    db = get_db()
    db.execute("UPDATE sessions SET ended_at = NULL WHERE id = ?", (sid,))
    db.commit()
    return jsonify({"ok": True})


@app.delete("/api/sessions/<int:sid>")
def api_delete_session(sid):
    db = get_db()
    db.execute("DELETE FROM hands WHERE session_id = ?", (sid,))
    db.execute("DELETE FROM players WHERE session_id = ?", (sid,))
    db.execute("DELETE FROM sessions WHERE id = ?", (sid,))
    db.commit()
    return jsonify({"ok": True})


@app.get("/api/leaderboard")
def api_leaderboard():
    db = get_db()
    return jsonify(compute_leaderboard(db))


@app.get("/api/players_global")
def api_list_globals():
    db = get_db()
    rows = db.execute(
        "SELECT id, name FROM players_global ORDER BY name COLLATE NOCASE"
    ).fetchall()
    return jsonify([{"id": r["id"], "name": r["name"]} for r in rows])


@app.get("/api/players_global/<int:gid>")
def api_get_global(gid):
    db = get_db()
    row = db.execute(
        "SELECT id, name FROM players_global WHERE id = ?", (gid,)
    ).fetchone()
    if not row:
        return jsonify({"error": "未找到玩家"}), 404
    leaderboard = compute_leaderboard(db)
    stats = next((r for r in leaderboard if r["global_id"] == gid), None)
    return jsonify({
        "global_id": row["id"],
        "name": row["name"],
        "stats": stats,
        "history": compute_player_history(db, gid),
    })


def _lan_ip():
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        s.connect(("8.8.8.8", 80))
        return s.getsockname()[0]
    except OSError:
        return "127.0.0.1"
    finally:
        s.close()


if __name__ == "__main__":
    init_db()
    port = int(os.environ.get("PORT", "5000"))
    print(f"\n  麻将记分 → 局域网访问:  http://{_lan_ip()}:{port}\n")
    app.run(host="0.0.0.0", port=port, debug=False)

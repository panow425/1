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
DEFAULT_PLAYERS = ["东家", "南家", "西家", "北家"]

GANG_FIXED = {
    "gang_chagang": 1,   # 插杠：其他三家各 1
    "gang_angang": 2,    # 暗杠：其他三家各 2
    "gang_others": 3,    # 杠别人：放杠者一人 3
}
ALL_KINDS = {"zimo", "huangzhuang", *GANG_FIXED.keys()}

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
            CREATE TABLE IF NOT EXISTS players (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                session_id INTEGER NOT NULL,
                seat INTEGER NOT NULL,
                name TEXT NOT NULL,
                FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
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
        cols = {r[1] for r in conn.execute("PRAGMA table_info(hands)").fetchall()}
        if "loser_id" not in cols:
            conn.execute("ALTER TABLE hands ADD COLUMN loser_id INTEGER")
        conn.commit()


def session_to_dict(row):
    return {
        "id": row["id"],
        "name": row["name"],
        "created_at": row["created_at"],
        "ended_at": row["ended_at"],
    }


def players_for_session(db, session_id):
    rows = db.execute(
        "SELECT id, seat, name FROM players WHERE session_id = ? ORDER BY seat",
        (session_id,),
    ).fetchall()
    return [{"id": r["id"], "seat": r["seat"], "name": r["name"]} for r in rows]


def hand_outcome_for(player_id, hand):
    """Return 'win' / 'lose' / 'neutral' for this player on this hand."""
    kind = hand["kind"]
    if kind == "huangzhuang":
        return "neutral"
    if hand["winner_id"] == player_id:
        return "win"
    if kind == "gang_others":
        return "lose" if hand["loser_id"] == player_id else "neutral"
    # zimo / gang_chagang / gang_angang: all 3 non-winners lose
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

    # streaks: walk hands in reverse for each player
    hands_desc = list(reversed(hands_asc))
    streaks = {}
    for p in players:
        kind, count = None, 0
        for h in hands_desc:
            outcome = hand_outcome_for(p["id"], h)
            if outcome == "neutral":
                continue
            if kind is None:
                kind = outcome
                count = 1
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
            "balance": balances.get(p["id"], 0),
            "streak": streaks[p["id"]],
        }
        for p in players
    ]


def compute_settlement(balances):
    """Greedy: largest debtor pays largest creditor."""
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
        if d["amount"] == 0:
            i += 1
        if c["amount"] == 0:
            j += 1
    return transfers


@app.route("/")
def index():
    return render_template("index.html")


@app.get("/api/config")
def api_config():
    return jsonify(
        {
            "amounts": ALLOWED_AMOUNTS,
            "default_players": DEFAULT_PLAYERS,
            "gang_fixed": GANG_FIXED,
        }
    )


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
        db.execute(
            "INSERT INTO players(session_id, seat, name) VALUES(?, ?, ?)",
            (sid, seat, pname),
        )
    db.commit()
    return jsonify({"id": sid})


@app.get("/api/sessions/<int:sid>")
def api_get_session(sid):
    db = get_db()
    row = db.execute(
        "SELECT id, name, created_at, ended_at FROM sessions WHERE id = ?",
        (sid,),
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
    cur = db.execute(
        "UPDATE players SET name = ? WHERE id = ? AND session_id = ?",
        (name, pid, sid),
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
    cur = db.execute(
        "UPDATE sessions SET name = ? WHERE id = ?", (name, sid)
    )
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
            kind,
            amount,
            winner_id,
            loser_id,
            note,
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

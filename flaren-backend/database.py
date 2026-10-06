"""Flaren database — SQLite via Python stdlib, no ORM."""
import os
import sqlite3
from contextlib import contextmanager

DB_PATH = os.environ.get("DATABASE_PATH", "data/flaren.db")

os.makedirs(os.path.dirname(DB_PATH), exist_ok=True)


def init_db():
    with get_db() as db:
        db.executescript("""
            CREATE TABLE IF NOT EXISTS users (
                id          INTEGER PRIMARY KEY AUTOINCREMENT,
                email       TEXT UNIQUE NOT NULL,
                username    TEXT NOT NULL,
                password    TEXT NOT NULL,
                created_at  INTEGER NOT NULL
            );

            CREATE TABLE IF NOT EXISTS sync_data (
                user_id     INTEGER PRIMARY KEY,
                payload     TEXT NOT NULL,
                updated_at  INTEGER NOT NULL,
                FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
            );

            CREATE TABLE IF NOT EXISTS push_tokens (
                user_id     INTEGER NOT NULL,
                token       TEXT NOT NULL,
                created_at  INTEGER NOT NULL,
                PRIMARY KEY (user_id, token),
                FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
            );
        """)


@contextmanager
def get_db():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def find_user_by_email(email):
    with get_db() as db:
        row = db.execute("SELECT * FROM users WHERE email = ?", (email.lower(),)).fetchone()
        return dict(row) if row else None


def find_user_by_id(user_id):
    with get_db() as db:
        row = db.execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone()
        return dict(row) if row else None


def create_user(email, username, hashed_password):
    import time
    with get_db() as db:
        cur = db.execute(
            "INSERT INTO users (email, username, password, created_at) VALUES (?, ?, ?, ?)",
            (email.lower(), username, hashed_password, int(time.time()))
        )
        return cur.lastrowid


def save_sync(user_id, payload_json):
    import time
    with get_db() as db:
        db.execute("""
            INSERT INTO sync_data (user_id, payload, updated_at)
            VALUES (?, ?, ?)
            ON CONFLICT(user_id) DO UPDATE SET
                payload = excluded.payload,
                updated_at = excluded.updated_at
        """, (user_id, payload_json, int(time.time())))


def get_sync(user_id):
    with get_db() as db:
        row = db.execute("SELECT payload, updated_at FROM sync_data WHERE user_id = ?", (user_id,)).fetchone()
        return dict(row) if row else None


def save_push_token(user_id, token):
    import time
    with get_db() as db:
        db.execute("""
            INSERT OR REPLACE INTO push_tokens (user_id, token, created_at)
            VALUES (?, ?, ?)
        """, (user_id, token, int(time.time())))


def get_push_tokens(user_id):
    with get_db() as db:
        rows = db.execute("SELECT token FROM push_tokens WHERE user_id = ?", (user_id,)).fetchall()
        return [r["token"] for r in rows]
"""Flaren database — Postgres in production, SQLite for local dev."""
import os
import time
import sqlite3
from contextlib import contextmanager

DATABASE_URL = os.environ.get("DATABASE_URL")
USE_POSTGRES = bool(DATABASE_URL and DATABASE_URL.startswith("postgres"))

if USE_POSTGRES:
    try:
        import psycopg2
        from psycopg2.extras import RealDictCursor
    except ImportError:
        raise RuntimeError("psycopg2 not installed. Add to requirements.txt")


# ---------- schema ----------
SCHEMA_SQLITE = """
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
        updated_at  INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS push_tokens (
        user_id     INTEGER NOT NULL,
        token       TEXT NOT NULL,
        created_at  INTEGER NOT NULL,
        PRIMARY KEY (user_id, token)
    );
    CREATE TABLE IF NOT EXISTS ntfy_topics (
        user_id     INTEGER PRIMARY KEY,
        topic       TEXT NOT NULL,
        created_at  INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS reminder_log (
        reminder_key TEXT PRIMARY KEY,
        sent_at      INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS onesignal_users (
        user_id     INTEGER PRIMARY KEY,
        created_at  BIGINT NOT NULL
    );
"""

SCHEMA_POSTGRES = """
    CREATE TABLE IF NOT EXISTS users (
        id          SERIAL PRIMARY KEY,
        email       TEXT UNIQUE NOT NULL,
        username    TEXT NOT NULL,
        password    TEXT NOT NULL,
        created_at  BIGINT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS sync_data (
        user_id     INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
        payload     TEXT NOT NULL,
        updated_at  BIGINT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS push_tokens (
        user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        token       TEXT NOT NULL,
        created_at  BIGINT NOT NULL,
        PRIMARY KEY (user_id, token)
    );
    CREATE TABLE IF NOT EXISTS ntfy_topics (
        user_id     INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
        topic       TEXT NOT NULL,
        created_at  BIGINT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS reminder_log (
        reminder_key TEXT PRIMARY KEY,
        sent_at      INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS onesignal_users (
        user_id     INTEGER PRIMARY KEY,
        created_at  BIGINT NOT NULL
    );
"""


def init_db():
    if USE_POSTGRES:
        with get_db() as db:
            cur = db.cursor()
            for stmt in SCHEMA_POSTGRES.strip().split(";"):
                if stmt.strip():
                    cur.execute(stmt)
    else:
        with get_db() as db:
            db.executescript(SCHEMA_SQLITE)


# ---------- connection handling ----------
if USE_POSTGRES:
    @contextmanager
    def get_db():
        conn = psycopg2.connect(DATABASE_URL, cursor_factory=RealDictCursor)
        try:
            yield conn
            conn.commit()
        except Exception:
            conn.rollback()
            raise
        finally:
            conn.close()
else:
    DB_PATH = os.environ.get("DATABASE_PATH", "data/flaren.db")
    os.makedirs(os.path.dirname(DB_PATH), exist_ok=True)

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


# ---------- queries ----------
def _placeholder():
    return "%s" if USE_POSTGRES else "?"


def find_user_by_email(email):
    with get_db() as db:
        if USE_POSTGRES:
            cur = db.cursor()
            cur.execute("SELECT * FROM users WHERE email = %s", (email.lower(),))
            row = cur.fetchone()
        else:
            row = db.execute("SELECT * FROM users WHERE email = ?", (email.lower(),)).fetchone()
        return dict(row) if row else None


def find_user_by_id(user_id):
    with get_db() as db:
        if USE_POSTGRES:
            cur = db.cursor()
            cur.execute("SELECT * FROM users WHERE id = %s", (user_id,))
            row = cur.fetchone()
        else:
            row = db.execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone()
        return dict(row) if row else None


def create_user(email, username, hashed_password):
    with get_db() as db:
        if USE_POSTGRES:
            cur = db.cursor()
            cur.execute(
                "INSERT INTO users (email, username, password, created_at) VALUES (%s, %s, %s, %s) RETURNING id",
                (email.lower(), username, hashed_password, int(time.time()))
            )
            return cur.fetchone()["id"]
        else:
            cur = db.execute(
                "INSERT INTO users (email, username, password, created_at) VALUES (?, ?, ?, ?)",
                (email.lower(), username, hashed_password, int(time.time()))
            )
            return cur.lastrowid


def save_sync(user_id, payload_json):
    with get_db() as db:
        if USE_POSTGRES:
            cur = db.cursor()
            cur.execute("""
                INSERT INTO sync_data (user_id, payload, updated_at)
                VALUES (%s, %s, %s)
                ON CONFLICT (user_id) DO UPDATE SET
                    payload = EXCLUDED.payload,
                    updated_at = EXCLUDED.updated_at
            """, (user_id, payload_json, int(time.time())))
        else:
            db.execute("""
                INSERT INTO sync_data (user_id, payload, updated_at)
                VALUES (?, ?, ?)
                ON CONFLICT(user_id) DO UPDATE SET
                    payload = excluded.payload,
                    updated_at = excluded.updated_at
            """, (user_id, payload_json, int(time.time())))


def get_sync(user_id):
    with get_db() as db:
        if USE_POSTGRES:
            cur = db.cursor()
            cur.execute("SELECT payload, updated_at FROM sync_data WHERE user_id = %s", (user_id,))
            row = cur.fetchone()
        else:
            row = db.execute("SELECT payload, updated_at FROM sync_data WHERE user_id = ?", (user_id,)).fetchone()
        return dict(row) if row else None


def save_push_token(user_id, token):
    with get_db() as db:
        if USE_POSTGRES:
            cur = db.cursor()
            cur.execute("""
                INSERT INTO push_tokens (user_id, token, created_at) VALUES (%s, %s, %s)
                ON CONFLICT (user_id, token) DO NOTHING
            """, (user_id, token, int(time.time())))
        else:
            db.execute("""
                INSERT OR REPLACE INTO push_tokens (user_id, token, created_at)
                VALUES (?, ?, ?)
            """, (user_id, token, int(time.time())))


def get_push_tokens(user_id):
    with get_db() as db:
        if USE_POSTGRES:
            cur = db.cursor()
            cur.execute("SELECT token FROM push_tokens WHERE user_id = %s", (user_id,))
            return [r["token"] for r in cur.fetchall()]
        else:
            rows = db.execute("SELECT token FROM push_tokens WHERE user_id = ?", (user_id,)).fetchall()
            return [r["token"] for r in rows]



# ---------- ntfy push ----------
def save_ntfy_topic(user_id, topic):
    with get_db() as db:
        if USE_POSTGRES:
            cur = db.cursor()
            cur.execute("""
                INSERT INTO ntfy_topics (user_id, topic, created_at)
                VALUES (%s, %s, %s)
                ON CONFLICT (user_id) DO UPDATE SET topic = EXCLUDED.topic
            """, (user_id, topic, int(time.time())))
        else:
            db.execute("""
                INSERT OR REPLACE INTO ntfy_topics (user_id, topic, created_at)
                VALUES (?, ?, ?)
            """, (user_id, topic, int(time.time())))


def get_ntfy_topic(user_id):
    with get_db() as db:
        if USE_POSTGRES:
            cur = db.cursor()
            cur.execute("SELECT topic FROM ntfy_topics WHERE user_id = %s", (user_id,))
            row = cur.fetchone()
        else:
            row = db.execute("SELECT topic FROM ntfy_topics WHERE user_id = ?", (user_id,)).fetchone()
        return row["topic"] if row else None


def get_all_ntfy_topics():
    with get_db() as db:
        if USE_POSTGRES:
            cur = db.cursor()
            cur.execute("SELECT user_id, topic FROM ntfy_topics")
            return [dict(r) for r in cur.fetchall()]
        else:
            rows = db.execute("SELECT user_id, topic FROM ntfy_topics").fetchall()
            return [dict(r) for r in rows]


def was_reminder_sent(key):
    with get_db() as db:
        if USE_POSTGRES:
            cur = db.cursor()
            cur.execute("SELECT 1 FROM reminder_log WHERE reminder_key = %s", (key,))
            return cur.fetchone() is not None
        else:
            row = db.execute("SELECT 1 FROM reminder_log WHERE reminder_key = ?", (key,)).fetchone()
            return row is not None


def mark_reminder_sent(key):
    with get_db() as db:
        if USE_POSTGRES:
            cur = db.cursor()
            cur.execute("""
                INSERT INTO reminder_log (reminder_key, sent_at)
                VALUES (%s, %s)
                ON CONFLICT (reminder_key) DO NOTHING
            """, (key, int(time.time())))
        else:
            db.execute("""
                INSERT OR IGNORE INTO reminder_log (reminder_key, sent_at)
                VALUES (?, ?)
            """, (key, int(time.time())))
# ---------- OneSignal subscribers ----------
def save_onesignal_user(user_id):
    with get_db() as db:
        if USE_POSTGRES:
            cur = db.cursor()
            cur.execute("""
                INSERT INTO onesignal_users (user_id, created_at)
                VALUES (%s, %s)
                ON CONFLICT (user_id) DO NOTHING
            """, (user_id, int(time.time())))
        else:
            db.execute("""
                INSERT OR REPLACE INTO onesignal_users (user_id, created_at)
                VALUES (?, ?)
            """, (user_id, int(time.time())))


def get_all_onesignal_users():
    with get_db() as db:
        if USE_POSTGRES:
            cur = db.cursor()
            cur.execute("SELECT user_id FROM onesignal_users")
            return [r["user_id"] for r in cur.fetchall()]
        else:
            rows = db.execute("SELECT user_id FROM onesignal_users").fetchall()
            return [r["user_id"] for r in rows]


def has_onesignal_user(user_id):
    with get_db() as db:
        if USE_POSTGRES:
            cur = db.cursor()
            cur.execute("SELECT 1 FROM onesignal_users WHERE user_id = %s", (user_id,))
            return cur.fetchone() is not None
        else:
            row = db.execute("SELECT 1 FROM onesignal_users WHERE user_id = ?", (user_id,)).fetchone()
            return row is not None

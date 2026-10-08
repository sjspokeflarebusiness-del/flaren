F"""Flaren backend — Flask API."""
import os
import json
from functools import wraps
import requests
import time


from dotenv import load_dotenv
load_dotenv()

from flask import Flask, request, jsonify
from flask_cors import CORS

import database
import auth
ONESIGNAL_APP_ID = os.environ.get("ONESIGNAL_APP_ID", "98c56f52-d557-4b34-9f4b-5c78a08a6889")
ONESIGNAL_REST_KEY = os.environ.get("ONESIGNAL_REST_KEY", "")

def send_onesignal_push(user_id, title, body, url=None):
    """Send a real push via OneSignal to one user (by external ID)."""
    if not ONESIGNAL_REST_KEY:
        print("[onesignal] REST key not set — skipping")
        return False
    try:
        r = requests.post(
            "https://api.onesignal.com/notifications",
            headers={
                "Authorization": f"Basic {ONESIGNAL_REST_KEY}",
                "Content-Type": "application/json",
            },
            json={
                "app_id": ONESIGNAL_APP_ID,
                "include_aliases": {"external_id": [str(user_id)]},
                "target_channel": "push",
                "headings": {"en": title},
                "contents": {"en": body},
                "url": url or "https://sjspokeflarebusiness-del.github.io/flaren/app.html",
            },
            timeout=8,
        )
        print("[onesignal]", r.status_code, r.text[:200])
        return r.status_code == 200
    except Exception as e:
        print("[onesignal] failed:", e)
        return False

app = Flask(__name__)

CORS_ORIGIN = os.environ.get("CORS_ORIGIN", "*")
CORS(app, resources={r"/api/*": {"origins": CORS_ORIGIN}}, supports_credentials=False)

database.init_db()


# ---------- helpers ----------
def current_user_id():
    """Extract user id from Bearer token."""
    header = request.headers.get("Authorization", "")
    if not header.startswith("Bearer "):
        return None
    token = header[7:].strip()
    return auth.verify_token(token)


def require_auth(fn):
    @wraps(fn)
    def wrapper(*args, **kwargs):
        uid = current_user_id()
        if not uid:
            return jsonify({"error": "Unauthorized"}), 401
        return fn(uid, *args, **kwargs)
    return wrapper


def user_public(u):
    return {"id": u["id"], "email": u["email"], "username": u["username"]}


# ---------- routes ----------
@app.get("/api/health")
def health():
    return jsonify({"ok": True, "service": "flaren", "version": "1.0.0"})


@app.post("/api/register")
def register():
    data = request.get_json(silent=True) or {}
    email = (data.get("email") or "").strip().lower()
    username = (data.get("username") or "").strip()
    password = data.get("password") or ""

    if not email or "@" not in email:
        return jsonify({"error": "Valid email required"}), 400
    if len(username) < 2:
        return jsonify({"error": "Username must be at least 2 characters"}), 400
    if len(password) < 8:
        return jsonify({"error": "Password must be at least 8 characters"}), 400

    if database.find_user_by_email(email):
        return jsonify({"error": "That email is already registered"}), 409

    hashed = auth.hash_password(password)
    uid = database.create_user(email, username, hashed)
    user = database.find_user_by_id(uid)
    token = auth.make_token(uid)

    return jsonify({"token": token, "user": user_public(user)}), 201


@app.post("/api/login")
def login():
    data = request.get_json(silent=True) or {}
    email = (data.get("email") or "").strip().lower()
    password = data.get("password") or ""

    user = database.find_user_by_email(email)
    if not user or not auth.verify_password(password, user["password"]):
        return jsonify({"error": "Wrong email or password"}), 401

    token = auth.make_token(user["id"])
    return jsonify({"token": token, "user": user_public(user)})


@app.get("/api/me")
@require_auth
def me(uid):
    user = database.find_user_by_id(uid)
    if not user:
        return jsonify({"error": "User not found"}), 404
    return jsonify({"user": user_public(user)})


@app.post("/api/sync")
@require_auth
def push_sync(uid):
    data = request.get_json(silent=True) or {}
    payload = data.get("payload")
    if not isinstance(payload, dict):
        return jsonify({"error": "payload must be an object"}), 400
    database.save_sync(uid, json.dumps(payload))
    return jsonify({"ok": True})


@app.get("/api/sync")
@require_auth
def pull_sync(uid):
    row = database.get_sync(uid)
    if not row:
        return jsonify({"payload": None, "updated_at": None})
    return jsonify({
        "payload": json.loads(row["payload"]),
        "updated_at": row["updated_at"]
    })


@app.post("/api/push-token")
@require_auth
def push_token(uid):
    data = request.get_json(silent=True) or {}
    token = (data.get("token") or "").strip()
    if not token:
        return jsonify({"error": "token required"}), 400
    database.save_push_token(uid, token)
    return jsonify({"ok": True})


# =========================================================
# NTFY PUSH NOTIFICATIONS
# =========================================================

@app.post("/api/ntfy/register")
@require_auth
def ntfy_register(uid):
    data = request.get_json(silent=True) or {}
    topic = (data.get("topic") or "").strip()
    if not topic or len(topic) < 6 or len(topic) > 64:
        return jsonify({"error": "topic must be 6-64 chars"}), 400
    if not all(c.isalnum() or c in "-_" for c in topic):
        return jsonify({"error": "topic can only contain letters, numbers, - and _"}), 400
    database.save_ntfy_topic(uid, topic)
    return jsonify({"ok": True, "topic": topic})

@app.post("/api/pill-reminder")
@require_auth
def pill_reminder(uid):
    """Called by the frontend when a pill is due — sends an ntfy push."""
    data = request.get_json(silent=True) or {}
    pill_name = (data.get("pillName") or "").strip()
    dose = (data.get("dose") or "").strip()
    time_str = (data.get("time") or "").strip()
    if not pill_name:
        return jsonify({"error": "pillName required"}), 400

    topic = database.get_ntfy_topic(uid)
    if not topic:
        return jsonify({"ok": False, "reason": "no topic registered"}), 200

    try:
        requests.post(
            f"https://ntfy.sh/{topic}",
            data=(f"{dose or 'Take now'} — scheduled for {time_str}".encode("utf-8")),
            headers={
                "Title": "💊 " + pill_name,
                "Priority": "high",
                "Tags": "pill",
                "Click": "https://sjspokeflarebusiness-del.github.io/flaren/app.html"
            },
            timeout=5
        )
       except Exception as e:
        print("pill ntfy send failed:", e)

    # ALSO send via OneSignal (real browser push)
    send_onesignal_push(
        user_id=uid,
        title="💊 " + pill_name,
        body=f"{dose or 'Take now'} — scheduled for {time_str}",
    )

    return jsonify({"ok": True})

@app.route("/api/check-reminders", methods=["GET", "POST"])
def check_reminders():
    """
    Called by cron-job.org or UptimeRobot every 1-5 minutes.
    Checks all users' tasks with reminders that are now due,
    and sends push notifications via ntfy.sh.
    """
    import json
    from datetime import datetime, timezone

    now_ts = int(time.time())
    sent = 0
    checked_users = 0

    topics = database.get_all_ntfy_topics()
    checked_users = len(topics)

    for row in topics:
        user_id = row["user_id"]
        topic = row["topic"]

        sync = database.get_sync(user_id)
        if not sync:
            continue

        try:
            payload = json.loads(sync["payload"])
        except Exception:
            continue

        tasks = payload.get("tasks", [])
        for task in tasks:
            if task.get("completed"):
                continue
            if not task.get("reminder"):
                continue
            due_date = task.get("dueDate")
            due_time = task.get("dueTime") or "09:00"
            if not due_date:
                continue

            try:
                dt = datetime.strptime(f"{due_date} {due_time}", "%Y-%m-%d %H:%M")
                dt = dt.replace(tzinfo=timezone.utc)
                due_ts = int(dt.timestamp())
            except Exception:
                continue

            if due_ts <= now_ts and due_ts > now_ts - 300:
                reminder_key = f"task-{task.get('id')}-{due_date}-{due_time}"
                if database.was_reminder_sent(reminder_key):
                    continue

                try:
                    requests.post(
                        f"https://ntfy.sh/{topic}",
                        data=(task.get("description") or "Task reminder from Flaren").encode("utf-8"),
                        headers={
                            "Title": "⏰ " + task.get("title", "Task"),
                            "Priority": "high",
                            "Tags": "alarm_clock",
                            "Click": "https://sjspokeflarebusiness-del.github.io/flaren/app.html"
                        },
                        timeout=5
                    )
                    database.mark_reminder_sent(reminder_key)
                    sent += 1

                    # OneSignal push (browser subscription)
                    send_onesignal_push(
                        user_id=user_id,
                        title="⏰ " + task.get("title", "Task"),
                        body=task.get("description") or "Task reminder from Flaren",
                    )
                except Exception as e:
                    print("ntfy send error:", e)

    return jsonify({"sent": sent, "users_checked": checked_users, "at": now_ts})



@app.errorhandler(404)
def not_found(e):
    return jsonify({"error": "Not found"}), 404


@app.errorhandler(500)
def server_error(e):
    return jsonify({"error": "Server error"}), 500


if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5000))
    debug = os.environ.get("FLASK_ENV") != "production"
    app.run(host="0.0.0.0", port=port, debug=debug)

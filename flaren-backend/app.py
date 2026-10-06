"""Flaren backend — Flask API."""
import os
import json
from functools import wraps

from dotenv import load_dotenv
load_dotenv()

from flask import Flask, request, jsonify
from flask_cors import CORS

import database
import auth

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


@app.errorhandler(404)
def not_found(e):
    return jsonify({"error": "Not found"}), 404


@app.errorhandler(500)
def server_error(e):
    return jsonify({"error": "Server error"}), 500


if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5000))
    app.run(host="0.0.0.0", port=port, debug=True)
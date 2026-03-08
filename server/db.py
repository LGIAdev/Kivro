from __future__ import annotations

import sqlite3
import time
import uuid
from pathlib import Path


ROOT_DIR = Path(__file__).resolve().parent.parent
DATA_DIR = ROOT_DIR / "data"
DB_PATH = DATA_DIR / "kivro.db"
SCHEMA_PATH = Path(__file__).resolve().parent / "schema.sql"


def now_ms() -> int:
    return int(time.time() * 1000)


def generate_conversation_id() -> str:
    return f"c{uuid.uuid4().hex[:12]}"


def connect() -> sqlite3.Connection:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


def init_db() -> None:
    schema = SCHEMA_PATH.read_text(encoding="utf-8")
    with connect() as conn:
        conn.executescript(schema)


def list_conversations(include_archived: bool = False) -> list[dict]:
    where = "" if include_archived else "WHERE c.archived = 0"
    query = f"""
        SELECT
          c.id,
          c.title,
          c.created_at,
          c.updated_at,
          c.archived,
          COUNT(m.id) AS message_count
        FROM conversations c
        LEFT JOIN messages m ON m.conversation_id = c.id
        {where}
        GROUP BY c.id
        ORDER BY c.updated_at DESC, c.created_at DESC
    """
    with connect() as conn:
        rows = conn.execute(query).fetchall()
    return [dict(row) for row in rows]


def get_conversation(conversation_id: str) -> dict | None:
    with connect() as conn:
        conversation = conn.execute(
            """
            SELECT id, title, created_at, updated_at, archived
            FROM conversations
            WHERE id = ?
            """,
            (conversation_id,),
        ).fetchone()
        if conversation is None:
            return None
        messages = conn.execute(
            """
            SELECT id, conversation_id, role, content, created_at, position
            FROM messages
            WHERE conversation_id = ?
            ORDER BY position ASC, id ASC
            """,
            (conversation_id,),
        ).fetchall()
    return {
        "conversation": dict(conversation),
        "messages": [dict(row) for row in messages],
    }


def create_conversation(conversation_id: str | None, title: str | None) -> dict:
    ts = now_ms()
    conversation_id = (conversation_id or "").strip() or generate_conversation_id()
    title = (title or "").strip() or "Nouvelle conversation"
    with connect() as conn:
        conn.execute(
            """
            INSERT INTO conversations (id, title, created_at, updated_at, archived)
            VALUES (?, ?, ?, ?, 0)
            """,
            (conversation_id, title, ts, ts),
        )
        row = conn.execute(
            """
            SELECT id, title, created_at, updated_at, archived
            FROM conversations
            WHERE id = ?
            """,
            (conversation_id,),
        ).fetchone()
    return dict(row)


def update_conversation(
    conversation_id: str,
    *,
    title: str | None = None,
    archived: int | None = None,
) -> dict | None:
    existing = get_conversation(conversation_id)
    if existing is None:
        return None

    updates = []
    params: list[object] = []
    if title is not None:
        updates.append("title = ?")
        params.append(title.strip() or "Nouvelle conversation")
    if archived is not None:
        updates.append("archived = ?")
        params.append(1 if archived else 0)
    updates.append("updated_at = ?")
    params.append(now_ms())
    params.append(conversation_id)

    with connect() as conn:
        conn.execute(
            f"UPDATE conversations SET {', '.join(updates)} WHERE id = ?",
            params,
        )
        row = conn.execute(
            """
            SELECT id, title, created_at, updated_at, archived
            FROM conversations
            WHERE id = ?
            """,
            (conversation_id,),
        ).fetchone()
    return dict(row) if row else None


def delete_conversation(conversation_id: str) -> bool:
    with connect() as conn:
        cur = conn.execute(
            "DELETE FROM conversations WHERE id = ?",
            (conversation_id,),
        )
    return cur.rowcount > 0


def add_message(conversation_id: str, role: str, content: str) -> dict | None:
    role = (role or "").strip().lower()
    if role not in {"user", "assistant", "system"}:
        raise ValueError("Invalid role.")

    payload = (content or "").strip()
    if not payload:
        raise ValueError("Message content cannot be empty.")

    ts = now_ms()
    with connect() as conn:
        conversation = conn.execute(
            "SELECT id FROM conversations WHERE id = ?",
            (conversation_id,),
        ).fetchone()
        if conversation is None:
            return None

        last_position = conn.execute(
            "SELECT COALESCE(MAX(position), 0) FROM messages WHERE conversation_id = ?",
            (conversation_id,),
        ).fetchone()[0]
        position = int(last_position) + 1

        cur = conn.execute(
            """
            INSERT INTO messages (conversation_id, role, content, created_at, position)
            VALUES (?, ?, ?, ?, ?)
            """,
            (conversation_id, role, payload, ts, position),
        )
        conn.execute(
            "UPDATE conversations SET updated_at = ? WHERE id = ?",
            (ts, conversation_id),
        )
        row = conn.execute(
            """
            SELECT id, conversation_id, role, content, created_at, position
            FROM messages
            WHERE id = ?
            """,
            (cur.lastrowid,),
        ).fetchone()
    return dict(row) if row else None

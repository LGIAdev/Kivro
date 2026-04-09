from __future__ import annotations

import re
import shutil
import sqlite3
import time
import uuid
from pathlib import Path


ROOT_DIR = Path(__file__).resolve().parent.parent
DATA_DIR = ROOT_DIR / 'data'
DB_PATH = DATA_DIR / 'kivrio.db'
SCHEMA_PATH = Path(__file__).resolve().parent / 'schema.sql'
UPLOADS_DIR = DATA_DIR / 'uploads'
SAFE_NAME_RE = re.compile(r'[^A-Za-z0-9._-]+')


def now_ms() -> int:
    return int(time.time() * 1000)


def generate_conversation_id() -> str:
    return f"c{uuid.uuid4().hex[:12]}"


def generate_attachment_id() -> str:
    return f"a{uuid.uuid4().hex[:12]}"


def connect() -> sqlite3.Connection:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute('PRAGMA foreign_keys = ON')
    return conn


def init_db() -> None:
    schema = SCHEMA_PATH.read_text(encoding='utf-8')
    with connect() as conn:
        conn.executescript(schema)
        ensure_messages_columns(conn)


def ensure_messages_columns(conn: sqlite3.Connection) -> None:
    columns = {
        str(row['name']).lower()
        for row in conn.execute("PRAGMA table_info(messages)").fetchall()
    }
    if 'reasoning_text' not in columns:
        conn.execute('ALTER TABLE messages ADD COLUMN reasoning_text TEXT')
    if 'model' not in columns:
        conn.execute('ALTER TABLE messages ADD COLUMN model TEXT')
    if 'reasoning_duration_ms' not in columns:
        conn.execute('ALTER TABLE messages ADD COLUMN reasoning_duration_ms INTEGER')


def serialize_system_prompt(row: sqlite3.Row | dict | None) -> dict:
    if row is None:
        return {
            'prompt': '',
            'updatedAt': 0,
        }
    item = dict(row)
    return {
        'prompt': str(item.get('prompt') or ''),
        'updatedAt': int(item.get('updated_at') or 0),
    }


def get_system_prompt() -> dict:
    with connect() as conn:
        row = conn.execute(
            '''
            SELECT prompt, updated_at
            FROM system_prompt
            WHERE id = 1
            '''
        ).fetchone()
        if row is not None:
            return serialize_system_prompt(row)

        ts = now_ms()
        conn.execute(
            '''
            INSERT INTO system_prompt (id, prompt, updated_at)
            VALUES (1, '', ?)
            ''',
            (ts,),
        )
        row = conn.execute(
            '''
            SELECT prompt, updated_at
            FROM system_prompt
            WHERE id = 1
            '''
        ).fetchone()
    return serialize_system_prompt(row)


def update_system_prompt(prompt: str | None) -> dict:
    value = '' if prompt is None else str(prompt)
    ts = now_ms()
    with connect() as conn:
        conn.execute(
            '''
            INSERT INTO system_prompt (id, prompt, updated_at)
            VALUES (1, ?, ?)
            ON CONFLICT(id) DO UPDATE SET
              prompt = excluded.prompt,
              updated_at = excluded.updated_at
            ''',
            (value, ts),
        )
        row = conn.execute(
            '''
            SELECT prompt, updated_at
            FROM system_prompt
            WHERE id = 1
            '''
        ).fetchone()
    return serialize_system_prompt(row)


def public_url(path: str | None) -> str | None:
    if not path:
        return None
    return '/' + path.replace('\\', '/').lstrip('/')


def serialize_attachment(row: sqlite3.Row | dict | None) -> dict | None:
    if row is None:
        return None
    item = dict(row)
    mime_type = item.get('mime_type') or 'application/octet-stream'
    attachment_id = item.get('id')
    attachment_url = f'/api/attachments/{attachment_id}/content' if attachment_id else None
    return {
        'id': attachment_id,
        'conversationId': item.get('conversation_id'),
        'messageId': item.get('message_id'),
        'filename': item.get('filename') or 'fichier',
        'mimeType': mime_type,
        'sizeBytes': int(item.get('size_bytes') or 0),
        'storagePath': item.get('storage_path'),
        'previewPath': item.get('preview_path'),
        'status': item.get('status') or 'stored',
        'createdAt': int(item.get('created_at') or 0),
        'sortOrder': int(item.get('sort_order') or 0),
        'url': attachment_url,
        'previewUrl': attachment_url,
        'isImage': str(mime_type).startswith('image/'),
    }


def sanitize_filename(filename: str) -> str:
    candidate = Path(filename or 'fichier').name.strip() or 'fichier'
    stem = SAFE_NAME_RE.sub('-', Path(candidate).stem).strip('-.') or 'fichier'
    suffix = SAFE_NAME_RE.sub('', Path(candidate).suffix.lower())
    return f'{stem}{suffix}' if suffix else stem


def cleanup_directories(start: Path, stop: Path) -> None:
    current = start
    while current.exists() and current != stop and stop in current.parents:
        try:
            current.rmdir()
        except OSError:
            break
        current = current.parent


def delete_file(relative_path: str | None) -> None:
    if not relative_path:
        return
    path = ROOT_DIR / relative_path
    if path.exists():
        path.unlink(missing_ok=True)
        cleanup_directories(path.parent, UPLOADS_DIR)


def list_conversations(include_archived: bool = False) -> list[dict]:
    where = '' if include_archived else 'WHERE c.archived = 0'
    query = f'''
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
    '''
    with connect() as conn:
        rows = conn.execute(query).fetchall()
    return [dict(row) for row in rows]


def get_conversation(conversation_id: str) -> dict | None:
    with connect() as conn:
        conversation = conn.execute(
            '''
            SELECT id, title, created_at, updated_at, archived
            FROM conversations
            WHERE id = ?
            ''',
            (conversation_id,),
        ).fetchone()
        if conversation is None:
            return None
        messages = conn.execute(
            '''
            SELECT id, conversation_id, role, content, reasoning_text, model, reasoning_duration_ms, created_at, position
            FROM messages
            WHERE conversation_id = ?
            ORDER BY position ASC, id ASC
            ''',
            (conversation_id,),
        ).fetchall()
        attachments = conn.execute(
            '''
            SELECT
              id,
              conversation_id,
              message_id,
              filename,
              mime_type,
              size_bytes,
              storage_path,
              preview_path,
              status,
              created_at,
              sort_order
            FROM attachments
            WHERE conversation_id = ? AND message_id IS NOT NULL
            ORDER BY message_id ASC, sort_order ASC, created_at ASC
            ''',
            (conversation_id,),
        ).fetchall()

    by_message: dict[int, list[dict]] = {}
    for attachment in attachments:
        item = serialize_attachment(attachment)
        if item is None:
            continue
        message_id = item.get('messageId')
        if message_id is None:
            continue
        by_message.setdefault(int(message_id), []).append(item)

    payload_messages = []
    for row in messages:
        item = dict(row)
        item['attachments'] = by_message.get(int(item['id']), [])
        payload_messages.append(item)

    return {
        'conversation': dict(conversation),
        'messages': payload_messages,
    }


def create_conversation(conversation_id: str | None, title: str | None) -> dict:
    ts = now_ms()
    conversation_id = (conversation_id or '').strip() or generate_conversation_id()
    title = (title or '').strip() or 'Nouvelle conversation'
    with connect() as conn:
        conn.execute(
            '''
            INSERT INTO conversations (id, title, created_at, updated_at, archived)
            VALUES (?, ?, ?, ?, 0)
            ''',
            (conversation_id, title, ts, ts),
        )
        row = conn.execute(
            '''
            SELECT id, title, created_at, updated_at, archived
            FROM conversations
            WHERE id = ?
            ''',
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
        updates.append('title = ?')
        params.append(title.strip() or 'Nouvelle conversation')
    if archived is not None:
        updates.append('archived = ?')
        params.append(1 if archived else 0)
    updates.append('updated_at = ?')
    params.append(now_ms())
    params.append(conversation_id)

    with connect() as conn:
        conn.execute(
            f"UPDATE conversations SET {', '.join(updates)} WHERE id = ?",
            params,
        )
        row = conn.execute(
            '''
            SELECT id, title, created_at, updated_at, archived
            FROM conversations
            WHERE id = ?
            ''',
            (conversation_id,),
        ).fetchone()
    return dict(row) if row else None


def delete_conversation(conversation_id: str) -> bool:
    with connect() as conn:
        paths = conn.execute(
            '''
            SELECT storage_path, preview_path
            FROM attachments
            WHERE conversation_id = ?
            ''',
            (conversation_id,),
        ).fetchall()
        cur = conn.execute(
            'DELETE FROM conversations WHERE id = ?',
            (conversation_id,),
        )
    if cur.rowcount <= 0:
        return False

    seen: set[str] = set()
    for row in paths:
        for key in ('storage_path', 'preview_path'):
            value = row[key]
            if value and value not in seen:
                delete_file(value)
                seen.add(value)

    conv_dir = UPLOADS_DIR / conversation_id
    if conv_dir.exists():
        shutil.rmtree(conv_dir, ignore_errors=True)
    return True


def create_attachment(conversation_id: str, filename: str, mime_type: str, payload: bytes) -> dict:
    ts = now_ms()
    attachment_id = generate_attachment_id()
    display_name = Path(filename or 'fichier').name.strip() or 'fichier'
    safe_name = sanitize_filename(display_name)
    conv_dir = UPLOADS_DIR / conversation_id / attachment_id
    conv_dir.mkdir(parents=True, exist_ok=True)
    target = conv_dir / safe_name
    target.write_bytes(payload)

    storage_path = target.relative_to(ROOT_DIR).as_posix()
    preview_path = storage_path if mime_type.startswith('image/') else None

    with connect() as conn:
        conversation = conn.execute(
            'SELECT id FROM conversations WHERE id = ?',
            (conversation_id,),
        ).fetchone()
        if conversation is None:
            shutil.rmtree(conv_dir, ignore_errors=True)
            raise ValueError('Conversation not found.')

        conn.execute(
            '''
            INSERT INTO attachments (
              id,
              conversation_id,
              message_id,
              filename,
              mime_type,
              size_bytes,
              storage_path,
              preview_path,
              status,
              created_at,
              sort_order
            )
            VALUES (?, ?, NULL, ?, ?, ?, ?, ?, 'stored', ?, 0)
            ''',
            (
                attachment_id,
                conversation_id,
                display_name,
                mime_type,
                len(payload),
                storage_path,
                preview_path,
                ts,
            ),
        )
        row = conn.execute(
            '''
            SELECT
              id,
              conversation_id,
              message_id,
              filename,
              mime_type,
              size_bytes,
              storage_path,
              preview_path,
              status,
              created_at,
              sort_order
            FROM attachments
            WHERE id = ?
            ''',
            (attachment_id,),
        ).fetchone()
    item = serialize_attachment(row)
    if item is None:
        raise ValueError('Attachment could not be created.')
    return item


def get_attachment(attachment_id: str) -> dict | None:
    with connect() as conn:
        row = conn.execute(
            '''
            SELECT
              id,
              conversation_id,
              message_id,
              filename,
              mime_type,
              size_bytes,
              storage_path,
              preview_path,
              status,
              created_at,
              sort_order
            FROM attachments
            WHERE id = ?
            ''',
            (attachment_id,),
        ).fetchone()
    return dict(row) if row else None


def get_message_with_attachments(
    conn: sqlite3.Connection,
    conversation_id: str,
    message_id: int,
) -> dict | None:
    row = conn.execute(
        '''
        SELECT id, conversation_id, role, content, reasoning_text, model, reasoning_duration_ms, created_at, position
        FROM messages
        WHERE id = ? AND conversation_id = ?
        ''',
        (message_id, conversation_id),
    ).fetchone()
    if row is None:
        return None

    attachments = conn.execute(
        '''
        SELECT
          id,
          conversation_id,
          message_id,
          filename,
          mime_type,
          size_bytes,
          storage_path,
          preview_path,
          status,
          created_at,
          sort_order
        FROM attachments
        WHERE message_id = ?
        ORDER BY sort_order ASC, created_at ASC
        ''',
        (message_id,),
    ).fetchall()

    item = dict(row)
    serialized = []
    for attachment in attachments:
        payload = serialize_attachment(attachment)
        if payload:
            serialized.append(payload)
    item['attachments'] = serialized
    return item


def collect_following_message_attachment_paths(
    conn: sqlite3.Connection,
    conversation_id: str,
    position: int,
) -> list[str]:
    rows = conn.execute(
        '''
        SELECT a.storage_path, a.preview_path
        FROM attachments a
        INNER JOIN messages m ON m.id = a.message_id
        WHERE m.conversation_id = ?
          AND m.position > ?
        ''',
        (conversation_id, position),
    ).fetchall()

    paths: list[str] = []
    seen: set[str] = set()
    for row in rows:
        for key in ('storage_path', 'preview_path'):
            value = row[key]
            if value and value not in seen:
                seen.add(value)
                paths.append(str(value))
    return paths


def delete_following_messages(
    conn: sqlite3.Connection,
    conversation_id: str,
    position: int,
) -> list[str]:
    paths = collect_following_message_attachment_paths(conn, conversation_id, position)
    conn.execute(
        '''
        DELETE FROM messages
        WHERE conversation_id = ?
          AND position > ?
        ''',
        (conversation_id, position),
    )
    return paths


def add_message(
    conversation_id: str,
    role: str,
    content: str,
    attachment_ids: list[str] | None = None,
    reasoning_text: str | None = None,
    model: str | None = None,
    reasoning_duration_ms: int | None = None,
) -> dict | None:
    role = (role or '').strip().lower()
    if role not in {'user', 'assistant', 'system'}:
        raise ValueError('Invalid role.')

    attachment_ids = [str(item).strip() for item in (attachment_ids or []) if str(item).strip()]
    payload = str(content or '').strip()
    reasoning_payload = str(reasoning_text or '').strip() or None
    model_name = str(model or '').strip() or None
    duration_value = None
    if reasoning_duration_ms is not None:
        try:
            parsed_duration = int(reasoning_duration_ms)
            if parsed_duration > 0:
                duration_value = parsed_duration
        except (TypeError, ValueError):
            duration_value = None
    if role != 'assistant':
        reasoning_payload = None
        model_name = None
        duration_value = None
    if not payload and not attachment_ids and not reasoning_payload:
        raise ValueError('Message content cannot be empty.')

    ts = now_ms()
    with connect() as conn:
        conversation = conn.execute(
            'SELECT id FROM conversations WHERE id = ?',
            (conversation_id,),
        ).fetchone()
        if conversation is None:
            return None

        if attachment_ids:
            placeholders = ','.join('?' for _ in attachment_ids)
            attachment_rows = conn.execute(
                f'''
                SELECT id
                FROM attachments
                WHERE conversation_id = ?
                  AND message_id IS NULL
                  AND id IN ({placeholders})
                ORDER BY created_at ASC, id ASC
                ''',
                [conversation_id, *attachment_ids],
            ).fetchall()
            found = {row['id'] for row in attachment_rows}
            if len(found) != len(set(attachment_ids)):
                raise ValueError('Invalid attachments for this conversation.')

        last_position = conn.execute(
            'SELECT COALESCE(MAX(position), 0) FROM messages WHERE conversation_id = ?',
            (conversation_id,),
        ).fetchone()[0]
        position = int(last_position) + 1

        cur = conn.execute(
            '''
            INSERT INTO messages (
              conversation_id,
              role,
              content,
              reasoning_text,
              model,
              reasoning_duration_ms,
              created_at,
              position
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            ''',
            (conversation_id, role, payload, reasoning_payload, model_name, duration_value, ts, position),
        )
        message_id = int(cur.lastrowid)

        for sort_order, attachment_id in enumerate(attachment_ids, start=1):
            conn.execute(
                '''
                UPDATE attachments
                SET message_id = ?, status = 'ready', sort_order = ?
                WHERE id = ? AND conversation_id = ? AND message_id IS NULL
                ''',
                (message_id, sort_order, attachment_id, conversation_id),
            )

        conn.execute(
            'UPDATE conversations SET updated_at = ? WHERE id = ?',
            (ts, conversation_id),
        )
        return get_message_with_attachments(conn, conversation_id, message_id)


def update_message(
    conversation_id: str,
    message_id: int,
    *,
    content: str | None = None,
    truncate_following: bool = False,
) -> dict | None:
    payload = '' if content is None else str(content).strip()
    ts = now_ms()
    deleted_paths: list[str] = []

    with connect() as conn:
        row = conn.execute(
            '''
            SELECT id, role, position
            FROM messages
            WHERE id = ? AND conversation_id = ?
            ''',
            (message_id, conversation_id),
        ).fetchone()
        if row is None:
            return None
        if str(row['role'] or '').lower() != 'user':
            raise ValueError('Seuls les messages utilisateur peuvent etre modifies.')

        attachment_count = int(conn.execute(
            'SELECT COUNT(*) FROM attachments WHERE message_id = ?',
            (message_id,),
        ).fetchone()[0] or 0)
        if not payload and attachment_count <= 0:
            raise ValueError('Le message ne peut pas etre vide.')

        conn.execute(
            '''
            UPDATE messages
            SET content = ?
            WHERE id = ? AND conversation_id = ?
            ''',
            (payload, message_id, conversation_id),
        )
        if truncate_following:
            deleted_paths = delete_following_messages(conn, conversation_id, int(row['position'] or 0))
        conn.execute(
            'UPDATE conversations SET updated_at = ? WHERE id = ?',
            (ts, conversation_id),
        )
    for path in deleted_paths:
        delete_file(path)
    return get_conversation(conversation_id)

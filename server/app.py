from __future__ import annotations

import argparse
import cgi
import json
import mimetypes
import sys
from http import HTTPStatus
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import unquote, urlparse


SERVER_DIR = Path(__file__).resolve().parent
ROOT_DIR = SERVER_DIR.parent
if str(SERVER_DIR) not in sys.path:
    sys.path.insert(0, str(SERVER_DIR))

import db  # noqa: E402
import ocr  # noqa: E402


MAX_IMAGE_BYTES = 10 * 1024 * 1024
MAX_PDF_BYTES = 20 * 1024 * 1024
MAX_TEXT_BYTES = 2 * 1024 * 1024
MAX_TOTAL_BYTES = 25 * 1024 * 1024
MAX_FILES = 5
ALLOWED_UPLOADS = {
    '.jpg': ('image/jpeg', MAX_IMAGE_BYTES, 'image'),
    '.jpeg': ('image/jpeg', MAX_IMAGE_BYTES, 'image'),
    '.png': ('image/png', MAX_IMAGE_BYTES, 'image'),
    '.webp': ('image/webp', MAX_IMAGE_BYTES, 'image'),
    '.pdf': ('application/pdf', MAX_PDF_BYTES, 'pdf'),
    '.txt': ('text/plain', MAX_TEXT_BYTES, 'text'),
    '.md': ('text/markdown', MAX_TEXT_BYTES, 'text'),
}


class KivrioHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT_DIR), **kwargs)

    def end_headers(self) -> None:
        self.send_header('Cache-Control', 'no-store, no-cache, must-revalidate')
        self.send_header('Pragma', 'no-cache')
        self.send_header('Expires', '0')
        super().end_headers()

    def do_GET(self) -> None:
        parsed = urlparse(self.path)
        if parsed.path.startswith('/api/'):
            self.handle_api('GET', parsed.path)
            return

        if parsed.path == '/':
            self.path = '/index.html'
        super().do_GET()

    def do_POST(self) -> None:
        parsed = urlparse(self.path)
        self.handle_api('POST', parsed.path)

    def do_PATCH(self) -> None:
        parsed = urlparse(self.path)
        self.handle_api('PATCH', parsed.path)

    def do_DELETE(self) -> None:
        parsed = urlparse(self.path)
        self.handle_api('DELETE', parsed.path)

    def handle_api(self, method: str, path: str) -> None:
        try:
            if method == 'GET' and path == '/api/health':
                self.send_json({'ok': True, 'db': 'ready'})
                return

            if method == 'GET' and path == '/api/system-prompt':
                self.send_json(db.get_system_prompt())
                return

            if method == 'GET' and path == '/api/conversations':
                self.send_json(db.list_conversations())
                return

            if method == 'POST' and path == '/api/system-prompt':
                body = self.read_json_body()
                self.send_json(db.update_system_prompt(body.get('prompt')))
                return

            if method == 'POST' and path == '/api/ocr/pix2text':
                uploads = self.read_upload_files()
                images = []
                for item in uploads:
                    suffix = Path(item['filename'] or '').suffix.lower()
                    kind = ALLOWED_UPLOADS.get(suffix, (None, None, None))[2]
                    if kind != 'image':
                        raise ValueError('Le moteur OCR Pix2Text accepte uniquement des images.')
                    images.append(item)
                self.send_json(ocr.run_pix2text_batch(images))
                return

            parts = [part for part in path.strip('/').split('/') if part]
            if len(parts) >= 3 and parts[0] == 'api' and parts[1] == 'conversations':
                conversation_id = unquote(parts[2])

                if method == 'GET' and len(parts) == 3:
                    payload = db.get_conversation(conversation_id)
                    if payload is None:
                        self.send_error_json(HTTPStatus.NOT_FOUND, 'Conversation not found.')
                        return
                    self.send_json(payload)
                    return

                if method == 'GET' and len(parts) == 4 and parts[3] == 'messages':
                    payload = db.get_conversation(conversation_id)
                    if payload is None:
                        self.send_error_json(HTTPStatus.NOT_FOUND, 'Conversation not found.')
                        return
                    self.send_json(payload['messages'])
                    return

                if method == 'POST' and len(parts) == 4 and parts[3] == 'messages':
                    body = self.read_json_body()
                    message = db.add_message(
                        conversation_id,
                        role=body.get('role', ''),
                        content=body.get('content', ''),
                        attachment_ids=body.get('attachment_ids') or [],
                        reasoning_text=body.get('reasoning_text'),
                        model=body.get('model'),
                        reasoning_duration_ms=body.get('reasoning_duration_ms'),
                    )
                    if message is None:
                        self.send_error_json(HTTPStatus.NOT_FOUND, 'Conversation not found.')
                        return
                    self.send_json(message, status=HTTPStatus.CREATED)
                    return

                if method == 'PATCH' and len(parts) == 5 and parts[3] == 'messages':
                    body = self.read_json_body()
                    try:
                        message_id = int(unquote(parts[4]))
                    except ValueError as exc:
                        raise ValueError('Message id invalide.') from exc
                    message = db.update_message(
                        conversation_id,
                        message_id,
                        content=body.get('content'),
                        truncate_following=bool(body.get('truncate_following')),
                    )
                    if message is None:
                        self.send_error_json(HTTPStatus.NOT_FOUND, 'Message introuvable.')
                        return
                    self.send_json(message)
                    return

                if method == 'POST' and len(parts) == 4 and parts[3] == 'attachments':
                    uploads = self.read_upload_files()
                    attachments = [
                        db.create_attachment(
                            conversation_id,
                            filename=item['filename'],
                            mime_type=item['mime_type'],
                            payload=item['content'],
                        )
                        for item in uploads
                    ]
                    self.send_json({'attachments': attachments}, status=HTTPStatus.CREATED)
                    return

                if method == 'PATCH' and len(parts) == 3:
                    body = self.read_json_body()
                    conversation = db.update_conversation(
                        conversation_id,
                        title=body.get('title'),
                        archived=body.get('archived'),
                    )
                    if conversation is None:
                        self.send_error_json(HTTPStatus.NOT_FOUND, 'Conversation not found.')
                        return
                    self.send_json(conversation)
                    return

                if method == 'DELETE' and len(parts) == 3:
                    deleted = db.delete_conversation(conversation_id)
                    if not deleted:
                        self.send_error_json(HTTPStatus.NOT_FOUND, 'Conversation not found.')
                        return
                    self.send_json({'ok': True})
                    return

            if method == 'POST' and path == '/api/conversations':
                body = self.read_json_body()
                conversation = db.create_conversation(body.get('id'), body.get('title'))
                self.send_json(conversation, status=HTTPStatus.CREATED)
                return

            self.send_error_json(HTTPStatus.NOT_FOUND, 'Endpoint not found.')
        except ValueError as exc:
            self.send_error_json(HTTPStatus.BAD_REQUEST, str(exc))
        except json.JSONDecodeError:
            self.send_error_json(HTTPStatus.BAD_REQUEST, 'Invalid JSON body.')
        except Exception as exc:
            self.send_error_json(HTTPStatus.INTERNAL_SERVER_ERROR, str(exc))

    def read_json_body(self) -> dict:
        length = int(self.headers.get('Content-Length', '0') or '0')
        raw = self.rfile.read(length) if length > 0 else b'{}'
        if not raw:
            return {}
        data = json.loads(raw.decode('utf-8'))
        if not isinstance(data, dict):
            raise ValueError('JSON body must be an object.')
        return data

    def normalize_upload(self, filename: str, mime_type: str | None, content: bytes) -> dict:
        suffix = Path(filename or '').suffix.lower()
        if suffix not in ALLOWED_UPLOADS:
            raise ValueError('Type de fichier non autorise.')
        normalized_mime, max_bytes, _kind = ALLOWED_UPLOADS[suffix]
        detected = (mime_type or '').strip().lower()
        guessed = (mimetypes.guess_type(filename or '')[0] or '').lower()
        mime = normalized_mime if detected in {'', 'application/octet-stream'} else detected
        if guessed and mime not in {normalized_mime, guessed}:
            raise ValueError('Type MIME incoherent pour ce fichier.')
        if len(content) > max_bytes:
            raise ValueError(f'Fichier trop volumineux ({filename}).')
        return {
            'filename': filename,
            'mime_type': normalized_mime,
            'content': content,
        }

    def read_upload_files(self) -> list[dict]:
        ctype = self.headers.get('Content-Type', '')
        if 'multipart/form-data' not in ctype:
            raise ValueError('Multipart form-data attendu.')

        env = {
            'REQUEST_METHOD': 'POST',
            'CONTENT_TYPE': ctype,
            'CONTENT_LENGTH': self.headers.get('Content-Length', '0'),
        }
        form = cgi.FieldStorage(
            fp=self.rfile,
            headers=self.headers,
            environ=env,
            keep_blank_values=True,
        )
        raw_files = form['files'] if 'files' in form else form['file'] if 'file' in form else None
        if raw_files is None:
            raise ValueError('Aucun fichier recu.')
        if not isinstance(raw_files, list):
            raw_files = [raw_files]
        if len(raw_files) > MAX_FILES:
            raise ValueError('Trop de fichiers pour un meme envoi.')

        uploads = []
        total = 0
        for item in raw_files:
            if not getattr(item, 'filename', None):
                continue
            content = item.file.read() if item.file else b''
            normalized = self.normalize_upload(item.filename, getattr(item, 'type', None), content)
            total += len(normalized['content'])
            if total > MAX_TOTAL_BYTES:
                raise ValueError('Le total des fichiers depasse la limite autorisee.')
            uploads.append(normalized)

        if not uploads:
            raise ValueError('Aucun fichier recu.')
        return uploads

    def send_json(self, payload: object, status: HTTPStatus = HTTPStatus.OK) -> None:
        body = json.dumps(payload, ensure_ascii=False).encode('utf-8')
        self.send_response(status)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def send_error_json(self, status: HTTPStatus, message: str) -> None:
        self.send_json({'error': message}, status=status)


def main() -> None:
    parser = argparse.ArgumentParser(description='Kivrio local server')
    parser.add_argument('--host', default='127.0.0.1')
    parser.add_argument('--port', type=int, default=8000)
    args = parser.parse_args()

    db.init_db()
    server = ThreadingHTTPServer((args.host, args.port), KivrioHandler)
    print(f'Kivrio local server running on http://{args.host}:{args.port}/index.html')
    print(f'SQLite database: {db.DB_PATH}')
    server.serve_forever()


if __name__ == '__main__':
    main()

from __future__ import annotations

import argparse
import json
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


class KivroHandler(SimpleHTTPRequestHandler):
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

            if method == 'GET' and path == '/api/conversations':
                self.send_json(db.list_conversations())
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
                    )
                    if message is None:
                        self.send_error_json(HTTPStatus.NOT_FOUND, 'Conversation not found.')
                        return
                    self.send_json(message, status=HTTPStatus.CREATED)
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
    parser = argparse.ArgumentParser(description='Kivro local server')
    parser.add_argument('--host', default='127.0.0.1')
    parser.add_argument('--port', type=int, default=8000)
    args = parser.parse_args()

    db.init_db()
    server = ThreadingHTTPServer((args.host, args.port), KivroHandler)
    print(f'Kivro local server running on http://{args.host}:{args.port}/index.html')
    print(f'SQLite database: {db.DB_PATH}')
    server.serve_forever()


if __name__ == '__main__':
    main()

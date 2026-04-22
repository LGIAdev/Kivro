from __future__ import annotations

import argparse
import base64
import cgi
import hashlib
import json
import mimetypes
import os
import posixpath
import secrets
import sys
import threading
import time
import traceback
from http import HTTPStatus
from http.cookies import SimpleCookie
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import unquote, urlparse


SERVER_DIR = Path(__file__).resolve().parent
ROOT_DIR = SERVER_DIR.parent
if str(SERVER_DIR) not in sys.path:
    sys.path.insert(0, str(SERVER_DIR))

import db  # noqa: E402
import math_derivative  # noqa: E402
import math_derivative_render  # noqa: E402
import math_equation  # noqa: E402
import math_equation_render  # noqa: E402
import math_integral  # noqa: E402
import math_integral_render  # noqa: E402
import math_limit  # noqa: E402
import math_limit_render  # noqa: E402
import math_ode  # noqa: E402
import math_ode_render  # noqa: E402
import math_variation  # noqa: E402
import math_variation_render  # noqa: E402
import ocr  # noqa: E402


def env_flag(name: str, default: bool = False) -> bool:
    raw = os.getenv(name)
    if raw is None:
        return default
    return str(raw).strip().lower() in {'1', 'true', 'yes', 'on'}


MAX_IMAGE_BYTES = 10 * 1024 * 1024
MAX_PDF_BYTES = 20 * 1024 * 1024
MAX_TEXT_BYTES = 2 * 1024 * 1024
MAX_TOTAL_BYTES = 25 * 1024 * 1024
MAX_FILES = 5
SESSION_COOKIE_NAME = 'kivro_session'
SESSION_TTL_SECONDS = max(300, int(os.getenv('KIVRO_SESSION_TTL_SECONDS', '43200') or '43200'))
SESSION_COOKIE_SECURE = env_flag('KIVRO_COOKIE_SECURE', default=False)
AUTH_DISABLED = env_flag('KIVRO_DISABLE_AUTH', default=False)
CONFIGURED_ADMIN_PASSWORD = str(os.getenv('KIVRO_ADMIN_PASSWORD', '') or '').strip()
AUTH_ENABLED = not AUTH_DISABLED
AUTH_STATE_PATH = ROOT_DIR / 'data' / 'auth.json'
PASSWORD_MIN_LENGTH = 8
PASSWORD_MAX_LENGTH = 128
PBKDF2_ITERATIONS = 310_000
PUBLIC_STATIC_FILES = {'/index.html'}
PUBLIC_STATIC_PREFIXES = ('/css/', '/js/', '/assets/')
SESSIONS: dict[str, float] = {}
SESSIONS_LOCK = threading.Lock()
LOOPBACK_HOSTS = {'127.0.0.1', 'localhost', '::1'}
ALLOWED_UPLOADS = {
    '.jpg': ('image/jpeg', MAX_IMAGE_BYTES, 'image'),
    '.jpeg': ('image/jpeg', MAX_IMAGE_BYTES, 'image'),
    '.png': ('image/png', MAX_IMAGE_BYTES, 'image'),
    '.webp': ('image/webp', MAX_IMAGE_BYTES, 'image'),
    '.pdf': ('application/pdf', MAX_PDF_BYTES, 'pdf'),
    '.txt': ('text/plain', MAX_TEXT_BYTES, 'text'),
    '.md': ('text/markdown', MAX_TEXT_BYTES, 'text'),
}
MATH_GUIDANCE_REASONS = {
    'deterministic-variation': {
        'missing_expression',
        'parse_failed',
        'invalid_expression',
        'invalid_variable',
        'ambiguous_variable',
        'constant_expression',
        'missing_study_interval',
        'invalid_study_interval',
    },
    'deterministic-equation': {
        'missing_equation',
        'invalid_equation',
        'parse_failed',
        'invalid_variable',
        'ambiguous_variable',
        'constant_equation',
        'unsupported_equation',
    },
    'deterministic-derivative': {
        'missing_expression',
        'parse_failed',
        'invalid_expression',
        'invalid_variable',
        'ambiguous_variable',
    },
    'deterministic-limit': {
        'missing_expression',
        'missing_limit',
        'missing_target',
        'parse_failed',
        'invalid_expression',
        'invalid_target',
        'invalid_variable',
        'ambiguous_variable',
    },
    'deterministic-integral': {
        'missing_expression',
        'missing_integral',
        'parse_failed',
        'invalid_expression',
        'invalid_bound',
        'invalid_variable',
        'ambiguous_variable',
    },
    'deterministic-ode': {
        'missing_equation',
        'invalid_equation',
        'missing_derivative',
        'parse_failed',
        'invalid_variable',
        'invalid_function',
        'unsupported_order',
        'unsupported_ode',
    },
}


def build_math_success_payload(*, pipeline: str, data: dict, html: str) -> dict:
    normalized = dict(data or {})
    normalized.pop('html', None)
    normalized.pop('status', None)
    normalized['html'] = str(html or '')
    return {
        'ok': True,
        'status': 'success',
        'pipeline': str(pipeline or '').strip(),
        'reason': '',
        'message': '',
        'data': normalized,
    }


def build_math_failure_payload(*, pipeline: str, exc: Exception) -> dict:
    reason = str(getattr(exc, 'code', 'analysis_failed') or 'analysis_failed').strip()
    message = str(exc or '').strip() or 'Le pipeline local n’a pas pu traiter cette demande.'
    status = 'guidance' if reason in MATH_GUIDANCE_REASONS.get(str(pipeline or '').strip(), set()) else 'fallback'
    return {
        'ok': False,
        'status': status,
        'pipeline': str(pipeline or '').strip(),
        'reason': reason,
        'message': message,
        'error': message,
        'data': None,
    }


def normalize_host_port(value: str | None) -> tuple[str | None, int | None]:
    raw = str(value or '').strip()
    if not raw:
        return None, None
    parsed = urlparse(raw if '://' in raw else f'//{raw}')
    host = str(parsed.hostname or '').strip().lower() or None
    return host, parsed.port


def is_loopback_host(host: str | None) -> bool:
    return str(host or '').strip().lower() in LOOPBACK_HOSTS


def purge_expired_sessions() -> None:
    if not AUTH_ENABLED:
        return
    now = time.time()
    with SESSIONS_LOCK:
        expired = [token for token, expiry in SESSIONS.items() if expiry <= now]
        for token in expired:
            SESSIONS.pop(token, None)


def create_session() -> str:
    purge_expired_sessions()
    token = secrets.token_urlsafe(32)
    with SESSIONS_LOCK:
        SESSIONS[token] = time.time() + SESSION_TTL_SECONDS
    return token


def revoke_session(token: str | None) -> None:
    if not token:
        return
    with SESSIONS_LOCK:
        SESSIONS.pop(token, None)


def has_valid_session(token: str | None) -> bool:
    if not AUTH_ENABLED:
        return True
    if not token:
        return False
    purge_expired_sessions()
    with SESSIONS_LOCK:
        expiry = SESSIONS.get(token)
        if expiry is None:
            return False
        SESSIONS[token] = time.time() + SESSION_TTL_SECONDS
    return True


def read_local_auth_record() -> dict | None:
    if not AUTH_STATE_PATH.is_file():
        return None
    try:
        payload = json.loads(AUTH_STATE_PATH.read_text(encoding='utf-8'))
    except (OSError, json.JSONDecodeError):
        return None
    if not isinstance(payload, dict):
        return None
    required = {'salt', 'passwordHash', 'iterations', 'createdAt'}
    if not required.issubset(payload.keys()):
        return None
    return payload


def auth_status_payload(*, authenticated: bool) -> dict:
    setup_required = AUTH_ENABLED and not CONFIGURED_ADMIN_PASSWORD and read_local_auth_record() is None
    password_source = (
        'disabled' if not AUTH_ENABLED else
        'environment' if CONFIGURED_ADMIN_PASSWORD else
        'local' if not setup_required else
        'unconfigured'
    )
    return {
        'enabled': AUTH_ENABLED,
        'authenticated': authenticated,
        'setupRequired': setup_required,
        'passwordSource': password_source,
    }


def validate_password(password: str) -> str:
    value = str(password or '')
    if len(value) < PASSWORD_MIN_LENGTH:
        raise ValueError(f'Le mot de passe doit contenir au moins {PASSWORD_MIN_LENGTH} caracteres.')
    if len(value) > PASSWORD_MAX_LENGTH:
        raise ValueError(f'Le mot de passe ne peut pas depasser {PASSWORD_MAX_LENGTH} caracteres.')
    return value


def build_password_record(password: str) -> dict:
    salt = secrets.token_bytes(16)
    digest = hashlib.pbkdf2_hmac(
        'sha256',
        password.encode('utf-8'),
        salt,
        PBKDF2_ITERATIONS,
    )
    return {
        'salt': base64.b64encode(salt).decode('ascii'),
        'passwordHash': base64.b64encode(digest).decode('ascii'),
        'iterations': PBKDF2_ITERATIONS,
        'createdAt': int(time.time()),
    }


def persist_local_password(password: str) -> None:
    record = build_password_record(validate_password(password))
    AUTH_STATE_PATH.parent.mkdir(parents=True, exist_ok=True)
    temp_path = AUTH_STATE_PATH.with_suffix('.tmp')
    temp_path.write_text(json.dumps(record, ensure_ascii=True), encoding='utf-8')
    temp_path.replace(AUTH_STATE_PATH)


def verify_local_password(password: str, record: dict) -> bool:
    try:
        salt = base64.b64decode(str(record.get('salt') or ''))
        expected = base64.b64decode(str(record.get('passwordHash') or ''))
        iterations = int(record.get('iterations') or 0)
    except (TypeError, ValueError):
        return False
    if not salt or not expected or iterations <= 0:
        return False
    computed = hashlib.pbkdf2_hmac(
        'sha256',
        str(password or '').encode('utf-8'),
        salt,
        iterations,
    )
    return secrets.compare_digest(computed, expected)


def verify_password(password: str) -> bool:
    if not AUTH_ENABLED:
        return True
    if CONFIGURED_ADMIN_PASSWORD:
        return secrets.compare_digest(str(password or ''), CONFIGURED_ADMIN_PASSWORD)
    record = read_local_auth_record()
    if record is None:
        return False
    return verify_local_password(password, record)


class KivrioHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT_DIR), **kwargs)

    def end_headers(self) -> None:
        self.send_header('Cache-Control', 'no-store, no-cache, must-revalidate')
        self.send_header('Pragma', 'no-cache')
        self.send_header('Expires', '0')
        self.send_header('X-Content-Type-Options', 'nosniff')
        self.send_header('X-Frame-Options', 'DENY')
        self.send_header('Referrer-Policy', 'no-referrer')
        super().end_headers()

    def do_GET(self) -> None:
        parsed = urlparse(self.path)
        if parsed.path.startswith('/api/'):
            self.handle_api('GET', parsed.path)
            return

        normalized = self.normalize_static_path(parsed.path)
        if not self.is_public_static_path(normalized):
            self.send_error(HTTPStatus.NOT_FOUND, 'Resource not found.')
            return

        if normalized == '/':
            self.path = '/index.html'
        else:
            self.path = normalized
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

    def list_directory(self, path: str):
        self.send_error(HTTPStatus.NOT_FOUND, 'Directory listing disabled.')
        return None

    def normalize_static_path(self, path: str) -> str:
        normalized = posixpath.normpath(unquote(path or '/'))
        if not normalized.startswith('/'):
            normalized = '/' + normalized
        return normalized

    def is_public_static_path(self, path: str) -> bool:
        if path == '/':
            return True
        if path in PUBLIC_STATIC_FILES:
            return True
        return any(path.startswith(prefix) for prefix in PUBLIC_STATIC_PREFIXES)

    def get_session_token(self) -> str | None:
        raw = self.headers.get('Cookie', '')
        if not raw:
            return None
        cookie = SimpleCookie()
        try:
            cookie.load(raw)
        except Exception:
            return None
        morsel = cookie.get(SESSION_COOKIE_NAME)
        return morsel.value if morsel else None

    def is_authenticated(self) -> bool:
        return has_valid_session(self.get_session_token())

    def require_auth(self) -> bool:
        if self.is_authenticated():
            return True
        self.send_error_json(HTTPStatus.UNAUTHORIZED, 'Authentication required.')
        return False

    def is_trusted_mutating_request(self) -> bool:
        sec_fetch_site = str(self.headers.get('Sec-Fetch-Site') or '').strip().lower()
        if sec_fetch_site and sec_fetch_site not in {'same-origin', 'same-site', 'none'}:
            return False

        request_host_raw = str(self.headers.get('Host') or '').strip()
        request_host, request_port = normalize_host_port(request_host_raw)
        if request_host is None:
            return True

        for header_name in ('Origin', 'Referer'):
            raw = str(self.headers.get(header_name) or '').strip()
            if not raw:
                continue
            parsed = urlparse(raw)
            if parsed.scheme not in {'http', 'https'}:
                return False

            origin_host, origin_port = normalize_host_port(parsed.netloc)
            if origin_host is None:
                return False
            if parsed.netloc.lower() == request_host_raw.lower():
                continue
            if (
                is_loopback_host(origin_host)
                and is_loopback_host(request_host)
                and (origin_port is None or request_port is None or origin_port == request_port)
            ):
                continue
            return False

        return True

    def build_session_cookie(self, token: str, *, clear: bool = False) -> str:
        parts = [f'{SESSION_COOKIE_NAME}={token}']
        parts.append('Path=/')
        parts.append('HttpOnly')
        parts.append('SameSite=Lax')
        parts.append('Max-Age=0' if clear else f'Max-Age={SESSION_TTL_SECONDS}')
        if clear:
            parts.append('Expires=Thu, 01 Jan 1970 00:00:00 GMT')
        if SESSION_COOKIE_SECURE:
            parts.append('Secure')
        return '; '.join(parts)

    def send_file_response(self, absolute_path: Path, *, mime_type: str | None = None) -> None:
        try:
            body = absolute_path.read_bytes()
        except FileNotFoundError:
            self.send_error_json(HTTPStatus.NOT_FOUND, 'Attachment not found.')
            return

        content_type = mime_type or mimetypes.guess_type(str(absolute_path))[0] or 'application/octet-stream'
        self.send_response(HTTPStatus.OK)
        self.send_header('Content-Type', content_type)
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def handle_math_endpoint(
        self,
        *,
        body_keys: tuple[str, ...],
        variable_key: str,
        analyzer,
        renderer,
        error_type,
        pipeline: str,
    ) -> None:
        body = self.read_json_body()
        expression = ''
        for key in body_keys:
            value = body.get(key)
            if value:
                expression = value
                break
        variable = body.get(variable_key)
        try:
            data = analyzer(expression, variable)
        except error_type as exc:
            self.send_json(
                build_math_failure_payload(pipeline=pipeline, exc=exc),
                status=HTTPStatus.UNPROCESSABLE_ENTITY,
            )
            return

        html = renderer(data)
        self.send_json(build_math_success_payload(pipeline=pipeline, data=data, html=html))

    def handle_api(self, method: str, path: str) -> None:
        try:
            if method in {'POST', 'PATCH', 'DELETE'} and path.startswith('/api/'):
                if not self.is_trusted_mutating_request():
                    self.send_error_json(HTTPStatus.FORBIDDEN, 'Cross-origin request blocked.')
                    return

            if method == 'GET' and path == '/api/health':
                self.send_json({'ok': True, 'db': 'ready'})
                return

            if method == 'GET' and path == '/api/auth/status':
                self.send_json(auth_status_payload(authenticated=self.is_authenticated()))
                return

            if method == 'POST' and path == '/api/auth/setup':
                if not AUTH_ENABLED:
                    self.send_json(auth_status_payload(authenticated=True))
                    return
                if CONFIGURED_ADMIN_PASSWORD:
                    self.send_error_json(
                        HTTPStatus.CONFLICT,
                        'La creation locale du mot de passe est desactivee quand KIVRO_ADMIN_PASSWORD est defini.',
                    )
                    return
                if read_local_auth_record() is not None:
                    self.send_error_json(HTTPStatus.CONFLICT, 'Le mot de passe est deja configure.')
                    return
                body = self.read_json_body()
                password = validate_password(body.get('password'))
                persist_local_password(password)
                token = create_session()
                self.send_json(
                    auth_status_payload(authenticated=True),
                    headers=[('Set-Cookie', self.build_session_cookie(token))],
                )
                return

            if method == 'POST' and path == '/api/auth/login':
                if not AUTH_ENABLED:
                    self.send_json(auth_status_payload(authenticated=True))
                    return
                if not CONFIGURED_ADMIN_PASSWORD and read_local_auth_record() is None:
                    self.send_error_json(HTTPStatus.CONFLICT, 'Password setup required.')
                    return
                body = self.read_json_body()
                password = str(body.get('password') or '')
                if not verify_password(password):
                    self.send_error_json(HTTPStatus.UNAUTHORIZED, 'Invalid credentials.')
                    return
                token = create_session()
                self.send_json(
                    auth_status_payload(authenticated=True),
                    headers=[('Set-Cookie', self.build_session_cookie(token))],
                )
                return

            if method == 'POST' and path == '/api/auth/logout':
                revoke_session(self.get_session_token())
                self.send_json(
                    {**auth_status_payload(authenticated=False), 'ok': True},
                    headers=[('Set-Cookie', self.build_session_cookie('', clear=True))],
                )
                return

            if not self.require_auth():
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

            if method == 'POST' and path == '/api/math/variation-table':
                self.handle_math_endpoint(
                    body_keys=('expression', 'function', 'content'),
                    variable_key='variable',
                    analyzer=math_variation.analyze_variation,
                    renderer=math_variation_render.build_variation_html,
                    error_type=math_variation.VariationAnalysisError,
                    pipeline='deterministic-variation',
                )
                return

            if method == 'POST' and path == '/api/math/equation-solve':
                self.handle_math_endpoint(
                    body_keys=('expression', 'equation', 'content'),
                    variable_key='variable',
                    analyzer=math_equation.analyze_equation,
                    renderer=math_equation_render.build_equation_html,
                    error_type=math_equation.EquationAnalysisError,
                    pipeline='deterministic-equation',
                )
                return

            if method == 'POST' and path == '/api/math/derivative':
                self.handle_math_endpoint(
                    body_keys=('expression', 'content'),
                    variable_key='variable',
                    analyzer=math_derivative.analyze_derivative,
                    renderer=math_derivative_render.build_derivative_html,
                    error_type=math_derivative.DerivativeAnalysisError,
                    pipeline='deterministic-derivative',
                )
                return

            if method == 'POST' and path == '/api/math/limit':
                self.handle_math_endpoint(
                    body_keys=('expression', 'content'),
                    variable_key='variable',
                    analyzer=math_limit.analyze_limit,
                    renderer=math_limit_render.build_limit_html,
                    error_type=math_limit.LimitAnalysisError,
                    pipeline='deterministic-limit',
                )
                return

            if method == 'POST' and path == '/api/math/integral':
                self.handle_math_endpoint(
                    body_keys=('expression', 'content'),
                    variable_key='variable',
                    analyzer=math_integral.analyze_integral,
                    renderer=math_integral_render.build_integral_html,
                    error_type=math_integral.IntegralAnalysisError,
                    pipeline='deterministic-integral',
                )
                return

            if method == 'POST' and path == '/api/math/ode':
                self.handle_math_endpoint(
                    body_keys=('expression', 'equation', 'content'),
                    variable_key='variable',
                    analyzer=math_ode.analyze_ode,
                    renderer=math_ode_render.build_ode_html,
                    error_type=math_ode.OdeAnalysisError,
                    pipeline='deterministic-ode',
                )
                return

            parts = [part for part in path.strip('/').split('/') if part]
            if len(parts) == 4 and parts[0] == 'api' and parts[1] == 'attachments' and parts[3] == 'content':
                attachment_id = unquote(parts[2])
                attachment = db.get_attachment(attachment_id)
                if attachment is None:
                    self.send_error_json(HTTPStatus.NOT_FOUND, 'Attachment not found.')
                    return
                storage_path = Path(str(attachment.get('storage_path') or '')).as_posix().lstrip('/')
                if not storage_path:
                    self.send_error_json(HTTPStatus.NOT_FOUND, 'Attachment not found.')
                    return
                absolute = (ROOT_DIR / storage_path).resolve()
                uploads_root = db.UPLOADS_DIR.resolve()
                if absolute != uploads_root and uploads_root not in absolute.parents:
                    self.send_error_json(HTTPStatus.NOT_FOUND, 'Attachment not found.')
                    return
                self.send_file_response(
                    absolute,
                    mime_type=str(attachment.get('mime_type') or 'application/octet-stream'),
                )
                return

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
        except Exception:
            traceback.print_exc()
            self.send_error_json(HTTPStatus.INTERNAL_SERVER_ERROR, 'Internal server error.')

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

    def send_json(
        self,
        payload: object,
        status: HTTPStatus = HTTPStatus.OK,
        headers: list[tuple[str, str]] | None = None,
    ) -> None:
        body = json.dumps(payload, ensure_ascii=False).encode('utf-8')
        self.send_response(status)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(body)))
        for key, value in (headers or []):
            self.send_header(key, value)
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
    if AUTH_ENABLED:
        print('Authentication: enabled')
        if CONFIGURED_ADMIN_PASSWORD:
            print('Admin password source: KIVRO_ADMIN_PASSWORD')
        elif read_local_auth_record() is not None:
            print(f'Admin password source: {AUTH_STATE_PATH}')
        else:
            print('Admin password setup required on first launch')
    else:
        print('Authentication: disabled via KIVRO_DISABLE_AUTH')
    server.serve_forever()


if __name__ == '__main__':
    main()

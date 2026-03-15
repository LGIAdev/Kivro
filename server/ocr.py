from __future__ import annotations

import json
import os
import subprocess
import tempfile
import time
from pathlib import Path


ROOT_DIR = Path(__file__).resolve().parent.parent
OCR_ROOT = ROOT_DIR / 'ocr' / 'pix2text'
RUNTIME_DIR = OCR_ROOT / 'runtime'
MODELS_DIR = OCR_ROOT / 'models'
TEMP_IMAGES_DIR = OCR_ROOT / 'temp' / 'images'
OUTPUT_MARKDOWN_DIR = OCR_ROOT / 'output' / 'markdown'
LOCAL_CONFIG_DIR = OCR_ROOT / 'config'
LOCAL_CACHE_DIR = MODELS_DIR / 'cache'
RUNNER_PATH = OCR_ROOT / 'run_pix2text.py'
CONFIG_PATH = OCR_ROOT / 'config' / 'pix2text_config.json'
OCR_TIMEOUT_SECONDS = 120


def ensure_ocr_directories() -> None:
    for path in (
        RUNTIME_DIR,
        MODELS_DIR,
        TEMP_IMAGES_DIR,
        OUTPUT_MARKDOWN_DIR,
        CONFIG_PATH.parent,
        LOCAL_CACHE_DIR,
    ):
        path.mkdir(parents=True, exist_ok=True)


def build_runtime_env() -> dict[str, str]:
    env = os.environ.copy()
    env.update({
        'YOLO_CONFIG_DIR': str(LOCAL_CONFIG_DIR),
        'PIX2TEXT_HOME': str(MODELS_DIR / 'pix2text'),
        'CNOCR_HOME': str(MODELS_DIR / 'cnocr'),
        'CNSTD_HOME': str(MODELS_DIR / 'cnstd'),
        'HF_HOME': str(LOCAL_CACHE_DIR / 'huggingface'),
        'HUGGINGFACE_HUB_CACHE': str(LOCAL_CACHE_DIR / 'huggingface' / 'hub'),
        'TRANSFORMERS_CACHE': str(LOCAL_CACHE_DIR / 'transformers'),
        'TORCH_HOME': str(LOCAL_CACHE_DIR / 'torch'),
        'XDG_CACHE_HOME': str(LOCAL_CACHE_DIR / 'xdg'),
    })
    return env


def resolve_runtime_python() -> Path:
    candidates = [
        RUNTIME_DIR / 'python.exe',
        RUNTIME_DIR / 'python',
    ]
    for candidate in candidates:
        if candidate.is_file():
            return candidate
    raise RuntimeError(
        'Runtime Pix2Text introuvable. Ajoutez Python dans ocr/pix2text/runtime avant d utiliser l OCR.',
    )


def parse_runner_stdout(stdout: str) -> dict:
    lines = [line.strip() for line in str(stdout).splitlines() if line.strip()]
    if not lines:
        raise RuntimeError('La sortie OCR est vide.')
    try:
        return json.loads(lines[-1])
    except json.JSONDecodeError as exc:
        raise RuntimeError('Sortie OCR invalide.') from exc


def run_pix2text(image_name: str, payload: bytes) -> dict:
    ensure_ocr_directories()
    if not RUNNER_PATH.is_file():
        raise RuntimeError('Script Pix2Text introuvable dans ocr/pix2text.')

    python_bin = resolve_runtime_python()
    suffix = Path(image_name or 'image.png').suffix.lower() or '.png'
    raw_stem = Path(image_name or 'image').stem or 'image'
    safe_stem = ''.join(ch if ch.isalnum() or ch in {'-', '_', '.'} else '-' for ch in raw_stem).strip('-.')
    if not safe_stem:
        safe_stem = 'image'
    stamp = f'{int(time.time() * 1000)}-{safe_stem}'
    output_path = OUTPUT_MARKDOWN_DIR / f'{stamp}.md'

    with tempfile.NamedTemporaryFile(
        prefix='pix2text-',
        suffix=suffix,
        dir=str(TEMP_IMAGES_DIR),
        delete=False,
    ) as tmp:
        tmp.write(payload)
        image_path = Path(tmp.name)

    try:
        cmd = [
            str(python_bin),
            str(RUNNER_PATH),
            str(image_path),
            '--output',
            str(output_path),
        ]
        if CONFIG_PATH.is_file():
            cmd.extend(['--config', str(CONFIG_PATH)])

        proc = subprocess.run(
            cmd,
            cwd=str(OCR_ROOT),
            capture_output=True,
            text=True,
            encoding='utf-8',
            errors='replace',
            env=build_runtime_env(),
            timeout=OCR_TIMEOUT_SECONDS,
            check=False,
        )
    except subprocess.TimeoutExpired as exc:
        raise RuntimeError('Le traitement OCR a expire.') from exc
    finally:
        image_path.unlink(missing_ok=True)

    if proc.returncode != 0:
        details = (proc.stderr or '').strip()
        if not details:
            try:
                details = str(parse_runner_stdout(proc.stdout).get('error') or '').strip()
            except RuntimeError:
                details = (proc.stdout or '').strip()
        raise RuntimeError(details or 'Execution Pix2Text impossible.')

    result = parse_runner_stdout(proc.stdout)
    markdown = str(result.get('markdown') or '').strip()
    if not markdown:
        raise RuntimeError(
            'Impossible de lire correctement l image. Essayez une image plus nette ou utilisez un modele multimodal.',
        )

    return {
        'filename': image_name,
        'markdown': markdown,
        'outputPath': str(output_path.relative_to(ROOT_DIR).as_posix()) if output_path.exists() else None,
    }


def run_pix2text_batch(files: list[dict]) -> dict:
    results = []
    for item in files:
        results.append(run_pix2text(item['filename'], item['content']))
    return {
        'engine': 'pix2text',
        'results': results,
    }

from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description='Kivrio Pix2Text runner')
    parser.add_argument('image_path', help='Path to the image to analyze')
    parser.add_argument('--output', help='Optional markdown output path')
    parser.add_argument('--config', help='Optional Pix2Text configuration path')
    return parser


def load_pix2text():
    try:
        from pix2text import Pix2Text
    except Exception as exc:  # pragma: no cover - depends on local runtime
        raise RuntimeError(
            'Pix2Text est indisponible dans le runtime OCR. Installez les dependances requises.',
        ) from exc
    return Pix2Text


def configure_local_runtime() -> None:
    root = Path(__file__).resolve().parent
    config_dir = root / 'config'
    models_dir = root / 'models'
    cache_dir = models_dir / 'cache'
    for path in (config_dir, models_dir, cache_dir):
        path.mkdir(parents=True, exist_ok=True)

    os.environ.setdefault('YOLO_CONFIG_DIR', str(config_dir))
    os.environ.setdefault('PIX2TEXT_HOME', str(models_dir / 'pix2text'))
    os.environ.setdefault('CNOCR_HOME', str(models_dir / 'cnocr'))
    os.environ.setdefault('CNSTD_HOME', str(models_dir / 'cnstd'))
    os.environ.setdefault('HF_HOME', str(cache_dir / 'huggingface'))
    os.environ.setdefault('HUGGINGFACE_HUB_CACHE', str(cache_dir / 'huggingface' / 'hub'))
    os.environ.setdefault('TRANSFORMERS_CACHE', str(cache_dir / 'transformers'))
    os.environ.setdefault('TORCH_HOME', str(cache_dir / 'torch'))
    os.environ.setdefault('XDG_CACHE_HOME', str(cache_dir / 'xdg'))


def recognize_markdown(image_path: Path, out_dir: Path) -> str:
    Pix2Text = load_pix2text()
    engine = Pix2Text.from_config()
    page = engine.recognize_page(str(image_path))

    if hasattr(page, 'to_markdown'):
        return str(page.to_markdown(out_dir) or '').strip()
    if isinstance(page, str):
        return page.strip()
    return str(page or '').strip()


def main() -> int:
    args = build_parser().parse_args()
    configure_local_runtime()
    image_path = Path(args.image_path).resolve()
    if not image_path.is_file():
        print(json.dumps({'ok': False, 'error': 'Image introuvable.'}))
        return 1

    try:
        out_dir = Path(args.output).resolve().parent if args.output else (Path(__file__).resolve().parent / 'output' / 'markdown')
        markdown = recognize_markdown(image_path, out_dir)
        if not markdown:
            print(json.dumps({'ok': False, 'error': 'Aucun contenu OCR exploitable.'}))
            return 2

        output_path = None
        if args.output:
            output_path = Path(args.output).resolve()
            output_path.parent.mkdir(parents=True, exist_ok=True)
            output_path.write_text(markdown, encoding='utf-8')

        print(json.dumps({
            'ok': True,
            'markdown': markdown,
            'output_path': str(output_path) if output_path else None,
        }, ensure_ascii=False))
        return 0
    except Exception as exc:  # pragma: no cover - depends on local runtime
        print(json.dumps({'ok': False, 'error': str(exc)}, ensure_ascii=False))
        return 3


if __name__ == '__main__':
    sys.exit(main())

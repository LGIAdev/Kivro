from __future__ import annotations

from html import escape


def _render_math(value: str) -> str:
    text = str(value or "").strip()
    if not text:
        return '<span class="limit-empty"></span>'
    return f'<span class="limit-math">\\({escape(text)}\\)</span>'


def _render_row(label: str, value: str) -> str:
    return (
        '<div class="limit-row">'
        f'<div class="limit-label">{escape(label)}</div>'
        f'<div class="limit-value">{_render_math(value)}</div>'
        '</div>'
    )


def build_limit_html(payload: dict) -> str:
    expression_latex = str(payload.get("expressionLatex") or "").strip()
    target_latex = str(payload.get("targetLatex") or "").strip()
    limit_statement_latex = str(payload.get("limitStatementLatex") or "").strip()
    if not expression_latex or not target_latex or not limit_statement_latex:
        return ""

    return "".join(
        [
            '<div class="limit-card">',
            '<div class="limit-title">Calcul de la limite</div>',
            _render_row("Expression", expression_latex),
            _render_row("Point", target_latex),
            _render_row("Limite", limit_statement_latex),
            '</div>',
        ]
    )

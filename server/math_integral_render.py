from __future__ import annotations

from html import escape


def _render_math(value: str) -> str:
    text = str(value or "").strip()
    if not text:
        return '<span class="integral-empty"></span>'
    return f'<span class="integral-math">\\({escape(text)}\\)</span>'


def _render_row(label: str, value: str) -> str:
    return (
        '<div class="integral-row">'
        f'<div class="integral-label">{escape(label)}</div>'
        f'<div class="integral-value">{_render_math(value)}</div>'
        '</div>'
    )


def build_integral_html(payload: dict) -> str:
    expression_latex = str(payload.get("expressionLatex") or "").strip()
    statement_latex = str(payload.get("integralStatementLatex") or "").strip()
    variable = str(payload.get("variable") or "x").strip() or "x"
    lower_latex = str(payload.get("lowerBoundLatex") or "").strip()
    upper_latex = str(payload.get("upperBoundLatex") or "").strip()
    is_definite = bool(payload.get("isDefinite"))
    if not expression_latex or not statement_latex:
        return ""

    parts = [
        '<div class="integral-card">',
        '<div class="integral-title">Calcul de l\'integrale</div>',
        _render_row("Expression", expression_latex),
        _render_row("Variable", variable),
    ]
    if is_definite and lower_latex and upper_latex:
        parts.append(_render_row("Bornes", rf"[{lower_latex}, {upper_latex}]"))
    parts.append(_render_row("Resultat", statement_latex))
    parts.append('</div>')
    return "".join(parts)

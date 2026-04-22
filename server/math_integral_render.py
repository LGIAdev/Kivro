from __future__ import annotations

from html import escape


def _render_math(value: str) -> str:
    text = str(value or "").strip()
    if not text:
        return '<span class="integral-empty"></span>'
    return f'<span class="integral-math">\\({escape(text)}\\)</span>'


def _render_row(label: str, value: str) -> str:
    return (
        '<div class="integral-row pipeline-card-row">'
        f'<div class="integral-label pipeline-card-label">{escape(label)}</div>'
        f'<div class="integral-value pipeline-card-value">{_render_math(value)}</div>'
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
        '<div class="integral-card pipeline-card">',
        '<div class="integral-title pipeline-card-title">Calcul de l&#39;int\u00e9grale</div>',
        _render_row("Expression", expression_latex),
        _render_row("Variable", variable),
    ]
    if is_definite and lower_latex and upper_latex:
        parts.append(_render_row("Bornes", rf"[{lower_latex}, {upper_latex}]"))
    parts.append(_render_row("R\u00e9sultat", statement_latex))
    parts.append('</div>')
    return "".join(parts)

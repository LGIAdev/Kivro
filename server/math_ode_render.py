from __future__ import annotations

from html import escape


def _render_math(value: str) -> str:
    text = str(value or "").strip()
    if not text:
        return '<span class="ode-empty"></span>'
    return f'<span class="ode-math">\\({escape(text)}\\)</span>'


def _render_row(label: str, value: str) -> str:
    return (
        '<div class="ode-row">'
        f'<div class="ode-label">{escape(label)}</div>'
        f'<div class="ode-value">{_render_math(value)}</div>'
        '</div>'
    )


def build_ode_html(payload: dict) -> str:
    equation_latex = str(payload.get("equationLatex") or "").strip()
    solution_latex = str(payload.get("solutionLatex") or "").strip()
    function_latex = str(payload.get("functionLatex") or "").strip()
    variable = str(payload.get("variable") or "x").strip() or "x"
    if not equation_latex or not solution_latex:
        return ""

    parts = [
        '<div class="ode-card">',
        '<div class="ode-title">Resolution de l\'equation differentielle</div>',
        _render_row("Equation", equation_latex),
    ]
    if function_latex:
        parts.append(_render_row("Inconnue", function_latex))
    parts.append(_render_row("Variable", variable))
    parts.append(_render_row("Solution", solution_latex))
    parts.append('</div>')
    return "".join(parts)

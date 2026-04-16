from __future__ import annotations

from html import escape


def _render_math(value: str) -> str:
    text = str(value or "").strip()
    if not text:
        return '<span class="derivative-empty"></span>'
    return f'<span class="derivative-math">\\({escape(text)}\\)</span>'


def _render_row(label: str, value: str) -> str:
    return (
        '<div class="derivative-row">'
        f'<div class="derivative-label">{escape(label)}</div>'
        f'<div class="derivative-value">{_render_math(value)}</div>'
        '</div>'
    )


def build_derivative_html(payload: dict) -> str:
    expression_latex = str(payload.get("expressionLatex") or "").strip()
    derivative_latex = str(payload.get("derivativeLatex") or "").strip()
    variable = str(payload.get("variable") or "x").strip() or "x"
    if not expression_latex or not derivative_latex:
        return ""

    derivative_result_latex = f"f'({variable}) = {derivative_latex}"
    return "".join(
        [
            '<div class="derivative-card">',
            '<div class="derivative-title">Calcul de la derivee</div>',
            _render_row("Expression", expression_latex),
            _render_row("Variable", variable),
            _render_row("Derivee", derivative_result_latex),
            '</div>',
        ]
    )

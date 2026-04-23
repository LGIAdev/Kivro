from __future__ import annotations

from html import escape


def _render_math(value: str) -> str:
    text = str(value or "").strip()
    if not text:
        return '<span class="system-solve-empty"></span>'
    return f'<span class="system-solve-math">\\({escape(text)}\\)</span>'


def _render_row(label: str, value: str) -> str:
    return (
        '<div class="system-solve-row pipeline-card-row">'
        f'<div class="system-solve-label pipeline-card-label">{escape(label)}</div>'
        f'<div class="system-solve-value pipeline-card-value">{_render_math(value)}</div>'
        '</div>'
    )


def build_system_html(payload: dict) -> str:
    system_latex = str(payload.get("systemLatex") or "").strip()
    solution_rows = list(payload.get("solutionRows") or [])
    has_exact_solution = bool(payload.get("hasExactSolution", True))
    solution_type = str(payload.get("solutionType") or "").strip()
    if not system_latex:
        return ""

    parts = [
        '<div class="system-solve-card pipeline-card">',
        '<div class="system-solve-title pipeline-card-title">Résolution du système</div>',
        _render_row("Système", system_latex),
    ]

    if solution_type == "none":
        parts.append(_render_row("Solution", r"\varnothing"))
    else:
        for row in solution_rows:
            variable = str(row.get("variable") or "").strip()
            variable_latex = str(row.get("variableLatex") or "").strip()
            value_latex = str(row.get("valueLatex") or "").strip()
            label = variable or variable_latex or "Inconnue"
            parts.append(_render_row(label, value_latex))

    if not has_exact_solution:
        parts.append(
            '<div class="system-solve-note pipeline-card-note">'
            'Solution approchée ou obtenue via le fallback SymPy'
            '</div>'
        )
    parts.append('</div>')
    return "".join(parts)

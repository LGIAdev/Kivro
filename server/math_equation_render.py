from __future__ import annotations

from html import escape


def _render_math(value: str) -> str:
    text = str(value or "").strip()
    if not text:
        return '<span class="equation-solve-empty"></span>'
    return f'<span class="equation-solve-math">\\({escape(text)}\\)</span>'


def _render_row(label: str, value: str) -> str:
    return (
        '<div class="equation-solve-row">'
        f'<div class="equation-solve-label">{escape(label)}</div>'
        f'<div class="equation-solve-value">{_render_math(value)}</div>'
        '</div>'
    )


def build_equation_html(payload: dict) -> str:
    equation_latex = str(payload.get("equationLatex") or "").strip()
    domain_latex = str(payload.get("domainLatex") or "").strip()
    solution_set_latex = str(payload.get("solutionSetLatex") or "").strip()
    has_exact_solution = bool(payload.get("hasExactSolution", True))
    if not equation_latex or not solution_set_latex:
        return ""

    parts = [
        '<div class="equation-solve-card">',
        '<div class="equation-solve-title">Resolution de l\'equation</div>',
        _render_row("Equation", equation_latex),
        _render_row("Domaine", domain_latex),
        _render_row("Ensemble solution", f"S = {solution_set_latex}"),
    ]
    if not has_exact_solution:
        parts.append('<div class="equation-solve-note">Solution approchee par calcul numerique</div>')
    parts.append('</div>')
    return "".join(parts)

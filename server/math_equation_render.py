from __future__ import annotations

from html import escape


def _render_math(value: str) -> str:
    text = str(value or "").strip()
    if not text:
        return '<span class="equation-solve-empty"></span>'
    return f'<span class="equation-solve-math">\\({escape(text)}\\)</span>'


def _render_row(label: str, value: str) -> str:
    return (
        '<div class="equation-solve-row pipeline-card-row">'
        f'<div class="equation-solve-label pipeline-card-label">{escape(label)}</div>'
        f'<div class="equation-solve-value pipeline-card-value">{_render_math(value)}</div>'
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
        '<div class="equation-solve-card pipeline-card">',
        '<div class="equation-solve-title pipeline-card-title">R\u00e9solution de l&#39;\u00e9quation</div>',
        _render_row("\u00c9quation", equation_latex),
        _render_row("Domaine", domain_latex),
        _render_row("Ensemble solution", f"S = {solution_set_latex}"),
    ]
    if not has_exact_solution:
        parts.append(
            '<div class="equation-solve-note pipeline-card-note">'
            'Solution approch\u00e9e par calcul num\u00e9rique'
            '</div>'
        )
    parts.append('</div>')
    return "".join(parts)

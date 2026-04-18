from __future__ import annotations

from html import escape


def _render_math(value: str) -> str:
    text = str(value or "").strip()
    if not text:
        return '<span class="variation-empty"></span>'
    return f'<span class="variation-math">\\({escape(text)}\\)</span>'


def _render_cell(tag: str, class_name: str, value: str) -> str:
    return f'<{tag} class="{class_name}">{_render_math(value)}</{tag}>'


def _render_segment(segment: dict, variable: str, derivative_latex: str, expression_latex: str) -> str:
    points = list(segment.get("points") or [])
    intervals = list(segment.get("intervals") or [])
    html = ['<table class="variation-table variation-table-deterministic"><tbody>']

    html.append('<tr class="variation-row variation-row-axis">')
    html.append(_render_cell("th", "variation-label variation-label-axis", variable))
    for index, point in enumerate(points):
        html.append(_render_cell("th", "variation-axis-point", point.get("xLabel", "")))
        if index < len(intervals):
            html.append('<th class="variation-axis-gap"><span class="variation-empty"></span></th>')
    html.append("</tr>")

    html.append('<tr class="variation-row variation-row-sign">')
    html.append(_render_cell("th", "variation-label variation-label-sign", derivative_latex))
    for index, point in enumerate(points):
        html.append(_render_cell("td", "variation-point-marker", point.get("marker", "")))
        if index < len(intervals):
            html.append(_render_cell("td", "variation-interval variation-sign-cell", intervals[index].get("sign", "")))
    html.append("</tr>")

    html.append('<tr class="variation-row variation-row-function">')
    html.append(_render_cell("th", "variation-label variation-label-function", expression_latex))
    for index, point in enumerate(points):
        html.append(_render_cell("td", "variation-value-point", point.get("valueLabel", "")))
        if index < len(intervals):
            html.append(_render_cell("td", "variation-interval variation-arrow-cell", intervals[index].get("arrow", "")))
    html.append("</tr>")
    html.append("</tbody></table>")
    return "".join(html)


def build_variation_html(payload: dict) -> str:
    segments = list(payload.get("segments") or [])
    if not segments:
        return ""

    variable = str(payload.get("variable") or "x")
    derivative_latex = "f'(x)"
    expression_latex = "f(x)"

    parts = [
        '<div class="variation-table-stack pipeline-card">',
        '<div class="variation-table-title pipeline-card-title">Tableau de variations</div>',
    ]
    for segment in segments:
        parts.append('<div class="variation-table-panel">')
        parts.append(_render_segment(segment, variable, derivative_latex, expression_latex))
        parts.append('</div>')
    parts.append("</div>")
    return "".join(parts)

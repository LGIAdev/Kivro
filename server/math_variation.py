from __future__ import annotations

import re
from typing import Iterable

import sympy as sp
from sympy import Eq, Interval, S, Union
from sympy.calculus.singularities import singularities
from sympy.calculus.util import continuous_domain
from sympy.parsing.sympy_parser import (
    convert_xor,
    implicit_multiplication_application,
    parse_expr,
    standard_transformations,
)


TRANSFORMATIONS = standard_transformations + (
    implicit_multiplication_application,
    convert_xor,
)
FUNCTION_RE = re.compile(r"^\s*(?:[a-zA-Z]\w*|y)\s*\(\s*([a-zA-Z])\s*\)\s*=\s*(.+?)\s*$")
Y_EQUALS_RE = re.compile(r"^\s*y\s*=\s*(.+?)\s*$")
FUNCTION_IN_TEXT_RE = re.compile(r"([a-zA-Z]\w*)\s*\(\s*([a-zA-Z])\s*\)\s*=\s*(.+)")
Y_IN_TEXT_RE = re.compile(r"\by\s*=\s*(.+)")
INTERVAL_WITH_KEYWORD_RE = re.compile(r"\b(?:sur|dans|pour)\b\s*([\[\]])\s*([^\[\]]+?)\s*([\[\]])", re.IGNORECASE)
INTERVAL_FALLBACK_RE = re.compile(r"([\[\]])\s*([^\[\]]+?)\s*([\[\]])")
ALLOWED_NAMES = {
    "sin": sp.sin,
    "cos": sp.cos,
    "tan": sp.tan,
    "asin": sp.asin,
    "acos": sp.acos,
    "atan": sp.atan,
    "exp": sp.exp,
    "log": sp.log,
    "ln": sp.log,
    "sqrt": sp.sqrt,
    "abs": sp.Abs,
    "pi": sp.pi,
    "e": sp.E,
    "oo": sp.oo,
}
TRAILING_CONTEXT_RE = re.compile(
    r"\s+(?:sur|pour|avec|dans|lorsque|quand|ou|où|si|afin|afin\s+de|puis|ensuite|etudier|etudier|dresser|dressez|donner|calculez|calculer)\b.*$",
    re.IGNORECASE,
)


class VariationAnalysisError(ValueError):
    def __init__(self, message: str, *, code: str = "analysis_failed"):
        super().__init__(message)
        self.code = str(code or "analysis_failed")


def _is_sympy_true(value: object) -> bool:
    return value is True or value == True


def _normalize_math_text(text: str) -> str:
    return (
        str(text or "")
        .replace("\u2212", "-")
        .replace("\u2013", "-")
        .replace("\u2014", "-")
        .replace("\u03c0", "pi")
        .replace("\u221e", "oo")
    )


def _symbol_pool() -> dict[str, sp.Symbol]:
    symbols: dict[str, sp.Symbol] = {}
    for code in range(ord("a"), ord("z") + 1):
        name = chr(code)
        symbols[name] = sp.Symbol(name, real=True)
    symbols["e"] = sp.E
    return symbols


def _clean_expression_input(text: str) -> tuple[str, str | None]:
    raw = _normalize_math_text(text).strip()
    if not raw:
        raise VariationAnalysisError("Expression de fonction manquante.", code="missing_expression")

    function_match = FUNCTION_RE.match(raw)
    if function_match:
        return function_match.group(2).strip(), function_match.group(1).strip()

    y_match = Y_EQUALS_RE.match(raw)
    if y_match:
        return y_match.group(1).strip(), None

    for line in raw.splitlines():
        candidate_line = line.strip()
        if not candidate_line:
            continue

        function_in_text = FUNCTION_IN_TEXT_RE.search(candidate_line)
        if function_in_text:
            variable = function_in_text.group(2).strip()
            expr = _normalize_expression_candidate(function_in_text.group(3))
            if expr:
                return expr, variable

        y_in_text = Y_IN_TEXT_RE.search(candidate_line)
        if y_in_text:
            expr = _normalize_expression_candidate(y_in_text.group(1))
            if expr:
                return expr, None

    return raw, None


def _normalize_expression_candidate(text: str) -> str:
    candidate = _normalize_math_text(text).strip()
    if not candidate:
        return ""
    candidate = re.split(r"[\n\r?!]", candidate, maxsplit=1)[0].strip()
    candidate = TRAILING_CONTEXT_RE.sub("", candidate).strip()
    candidate = candidate.rstrip(".,;:")
    return candidate.strip()


def _build_local_dict(variable_name: str) -> tuple[dict[str, object], sp.Symbol]:
    local_dict = {**ALLOWED_NAMES, **_symbol_pool()}
    symbol = sp.Symbol(variable_name, real=True)
    local_dict[variable_name] = symbol
    return local_dict, symbol


def parse_function(expression: str, variable: str | None = None) -> tuple[sp.Expr, sp.Symbol]:
    expr_text, hinted_variable = _clean_expression_input(expression)
    variable_name = str(variable or hinted_variable or "x").strip() or "x"
    if not re.fullmatch(r"[A-Za-z]", variable_name):
        raise VariationAnalysisError("Variable invalide pour l'analyse.", code="invalid_variable")

    local_dict, symbol = _build_local_dict(variable_name)

    try:
        expr = parse_expr(expr_text, local_dict=local_dict, transformations=TRANSFORMATIONS, evaluate=True)
    except Exception as exc:  # pragma: no cover - depends on parser errors
        raise VariationAnalysisError("Impossible d'analyser l'expression fournie.", code="parse_failed") from exc

    if not isinstance(expr, sp.Expr):
        raise VariationAnalysisError("Expression mathematique invalide.", code="invalid_expression")

    free_symbols = list(expr.free_symbols)
    if not free_symbols:
        raise VariationAnalysisError("La fonction doit dependre d'une variable reelle.", code="constant_expression")
    if symbol not in free_symbols and len(free_symbols) == 1:
        symbol = next(iter(free_symbols))
    elif symbol not in free_symbols:
        raise VariationAnalysisError(
            "Impossible de determiner de facon sure la variable de la fonction.",
            code="ambiguous_variable",
        )

    return sp.simplify(expr), sp.Symbol(str(symbol), real=True)


def _split_interval_body(body: str) -> tuple[str, str] | None:
    text = str(body or "").strip()
    if not text:
        return None
    if ";" in text:
        left, right = text.split(";", 1)
        return left.strip(), right.strip()
    if text.count(",") == 1:
        left, right = text.split(",", 1)
        return left.strip(), right.strip()
    return None


def _parse_interval_bound(text: str, local_dict: dict[str, object]) -> sp.Expr:
    candidate = _normalize_math_text(text).strip()
    if not candidate:
        raise VariationAnalysisError("Borne d'intervalle manquante.", code="invalid_study_interval")
    try:
        value = parse_expr(candidate, local_dict=local_dict, transformations=TRANSFORMATIONS, evaluate=True)
    except Exception as exc:  # pragma: no cover - depends on parser errors
        raise VariationAnalysisError(
            "Impossible d'analyser une borne de l'intervalle d'etude.",
            code="invalid_study_interval",
        ) from exc

    value = sp.simplify(value)
    if value.free_symbols:
        raise VariationAnalysisError(
            "Les bornes de l'intervalle d'etude doivent etre numeriques.",
            code="invalid_study_interval",
        )
    if value not in {-sp.oo, sp.oo} and value.is_real is False:
        raise VariationAnalysisError(
            "Les bornes de l'intervalle d'etude doivent etre reelles.",
            code="invalid_study_interval",
        )
    return value


def _extract_requested_interval(text: str, variable_name: str) -> Interval | None:
    raw = _normalize_math_text(text).strip()
    if not raw:
        return None

    match = INTERVAL_WITH_KEYWORD_RE.search(raw) or INTERVAL_FALLBACK_RE.search(raw)
    if not match:
        return None

    bounds = _split_interval_body(match.group(2))
    if not bounds:
        return None

    left_bound, right_bound = bounds
    local_dict, _ = _build_local_dict(variable_name)
    start = _parse_interval_bound(left_bound, local_dict)
    end = _parse_interval_bound(right_bound, local_dict)

    delta = sp.simplify(end - start)
    if delta.is_real and delta.is_negative:
        raise VariationAnalysisError(
            "Les bornes de l'intervalle d'etude sont incoherentes.",
            code="invalid_study_interval",
        )
    numeric_delta = sp.N(delta)
    if numeric_delta.is_real and numeric_delta < 0:
        raise VariationAnalysisError(
            "Les bornes de l'intervalle d'etude sont incoherentes.",
            code="invalid_study_interval",
        )

    left_open = match.group(1) == "]"
    right_open = match.group(3) == "["
    if sp.simplify(start - end) == 0 and (left_open or right_open):
        raise VariationAnalysisError(
            "L'intervalle d'etude est vide.",
            code="invalid_study_interval",
        )

    interval = Interval(start, end, left_open=left_open, right_open=right_open)
    if interval is S.EmptySet:
        raise VariationAnalysisError(
            "L'intervalle d'etude est vide.",
            code="invalid_study_interval",
        )
    return interval


def _requires_bounded_trig_interval(expr: sp.Expr) -> bool:
    return expr.has(sp.sin, sp.cos, sp.tan)


def _flatten_real_intervals(domain: sp.Set) -> list[Interval]:
    if domain is S.EmptySet:
        return []
    if domain == S.Reals:
        return [Interval(-sp.oo, sp.oo)]
    if isinstance(domain, Interval):
        return [domain]
    if isinstance(domain, Union):
        intervals: list[Interval] = []
        for arg in domain.args:
            intervals.extend(_flatten_real_intervals(arg))
        return sorted(
            intervals,
            key=lambda item: float(sp.N(item.start)) if item.start.is_finite else float("-inf"),
        )
    raise VariationAnalysisError(
        "Le domaine reel de la fonction n'est pas representable en intervalles simples.",
        code="unsupported_domain",
    )


def _collect_finite_real_points(set_expr: sp.Set, domain: sp.Set) -> list[sp.Expr]:
    if set_expr in {S.EmptySet, None}:
        return []
    if isinstance(set_expr, sp.FiniteSet):
        points = [
            point
            for point in set_expr
            if point.is_real and point.is_finite and _is_sympy_true(domain.contains(point))
        ]
        return _sort_points(points)
    if isinstance(set_expr, Union):
        items: list[sp.Expr] = []
        for arg in set_expr.args:
            items.extend(_collect_finite_real_points(arg, domain))
        return _sort_points(items)
    raise VariationAnalysisError(
        "Les points critiques ne peuvent pas etre determines de facon finie et sure.",
        code="unsupported_critical_points",
    )


def _sort_points(points: Iterable[sp.Expr]) -> list[sp.Expr]:
    unique = []
    seen = set()
    for point in points:
        key = sp.simplify(point)
        if key in seen:
            continue
        seen.add(key)
        unique.append(key)
    return sorted(unique, key=lambda value: float(sp.N(value)))


def _point_in_interval(point: sp.Expr, interval: Interval) -> bool:
    contains = interval.contains(point)
    return _is_sympy_true(contains)


def _point_in_open_interval(point: sp.Expr, interval: Interval) -> bool:
    if not _point_in_interval(point, interval):
        return False
    if interval.start.is_finite and sp.simplify(point - interval.start) == 0:
        return False
    if interval.end.is_finite and sp.simplify(point - interval.end) == 0:
        return False
    return True


def _point_label(point: sp.Expr) -> str:
    return sp.latex(sp.simplify(point))


def _expr_label(expr: sp.Expr) -> str:
    return sp.latex(sp.simplify(expr))


def _pick_sample(left: sp.Expr, right: sp.Expr) -> sp.Expr:
    if left == -sp.oo and right == sp.oo:
        return sp.Integer(0)
    if left == -sp.oo:
        return sp.simplify(right - 1)
    if right == sp.oo:
        return sp.simplify(left + 1)
    return sp.simplify((left + right) / 2)


def _sign_of_expression(expr: sp.Expr, variable: sp.Symbol, sample: sp.Expr) -> str:
    try:
        value = sp.simplify(expr.subs(variable, sample))
    except Exception as exc:  # pragma: no cover - symbolic substitution edge case
        raise VariationAnalysisError(
            "Impossible d'evaluer le signe de la derivee sur un intervalle.",
            code="sign_eval_failed",
        ) from exc

    if value.is_positive is True:
        return "+"
    if value.is_negative is True:
        return "-"
    numeric = sp.N(value)
    if numeric.is_real:
        if numeric > 0:
            return "+"
        if numeric < 0:
            return "-"
    raise VariationAnalysisError(
        "Le signe de la derivee reste indetermine sur un intervalle.",
        code="indeterminate_sign",
    )


def _arrow_from_sign(sign: str) -> str:
    if sign == "+":
        return r"\nearrow"
    if sign == "-":
        return r"\searrow"
    return ""


def _limit_label(expr: sp.Expr, variable: sp.Symbol, target: sp.Expr, direction: str | None = None) -> str:
    limit_value = sp.limit(expr, variable, target, dir=direction) if direction else sp.limit(expr, variable, target)
    return _expr_label(limit_value)


def _point_value_label(expr: sp.Expr, variable: sp.Symbol, point: sp.Expr, *, is_boundary: bool, side: str | None) -> str:
    if point in {-sp.oo, sp.oo}:
        return _limit_label(expr, variable, point)
    if is_boundary and side:
        return _limit_label(expr, variable, point, direction=side)
    value = sp.simplify(expr.subs(variable, point))
    return _expr_label(value)


def _classify_extremum(prev_sign: str, next_sign: str) -> str:
    if prev_sign == "+" and next_sign == "-":
        return "max"
    if prev_sign == "-" and next_sign == "+":
        return "min"
    return ""


def _build_segment(expr: sp.Expr, derivative: sp.Expr, variable: sp.Symbol, interval: Interval, critical_points: list[sp.Expr]) -> dict:
    interior_points = [point for point in critical_points if _point_in_open_interval(point, interval)]
    ordered_points = [interval.start, *interior_points, interval.end]

    points: list[dict] = []
    intervals: list[dict] = []

    for index, point in enumerate(ordered_points):
        is_first = index == 0
        is_last = index == len(ordered_points) - 1
        is_boundary = is_first or is_last
        side = None
        if is_first and point.is_finite and interval.left_open:
            side = "+"
        elif is_last and point.is_finite and interval.right_open:
            side = "-"

        points.append(
            {
                "xLabel": _point_label(point),
                "xRaw": str(point),
                "marker": "0" if (not is_boundary and sp.simplify(derivative.subs(variable, point)) == 0) else "",
                "valueLabel": _point_value_label(expr, variable, point, is_boundary=is_boundary, side=side),
                "descriptor": "",
                "kind": "boundary" if is_boundary else "critical",
            }
        )

        if is_last:
            continue

        left = point
        right = ordered_points[index + 1]
        sample = _pick_sample(left, right)
        sign = _sign_of_expression(derivative, variable, sample)
        intervals.append(
            {
                "leftLabel": _point_label(left),
                "rightLabel": _point_label(right),
                "sign": sign,
                "arrow": _arrow_from_sign(sign),
                "sampleLabel": _point_label(sample),
            }
        )

    for index in range(1, len(points) - 1):
        descriptor = _classify_extremum(intervals[index - 1]["sign"], intervals[index]["sign"])
        if descriptor:
            points[index]["descriptor"] = descriptor
            points[index]["marker"] = "0"

    return {
        "domainStart": _point_label(interval.start),
        "domainEnd": _point_label(interval.end),
        "points": points,
        "intervals": intervals,
    }


def analyze_variation(expression: str, variable: str | None = None) -> dict:
    expr, symbol = parse_function(expression, variable)
    requested_interval = _extract_requested_interval(expression, str(symbol))
    if _requires_bounded_trig_interval(expr) and requested_interval is None:
        raise VariationAnalysisError(
            "Les fonctions trigonometriques necessitent un intervalle d'etude borne explicite.",
            code="missing_study_interval",
        )

    try:
        natural_domain = continuous_domain(expr, symbol, S.Reals)
        derivative = sp.simplify(sp.diff(expr, symbol))
    except Exception as exc:  # pragma: no cover - SymPy calculus edge case
        raise VariationAnalysisError(
            "Impossible de calculer le domaine ou la derivee de cette fonction.",
            code="calculus_failed",
        ) from exc

    domain = natural_domain.intersect(requested_interval) if requested_interval is not None else natural_domain

    real_intervals = _flatten_real_intervals(domain)
    if not real_intervals:
        raise VariationAnalysisError("Le domaine reel de la fonction est vide.", code="empty_domain")

    derivative_zeros = _collect_finite_real_points(sp.solveset(Eq(derivative, 0), symbol, domain), domain)
    try:
        derivative_breaks = _collect_finite_real_points(singularities(derivative, symbol), domain)
    except Exception:
        derivative_breaks = []

    critical_points = _sort_points([*derivative_zeros, *derivative_breaks])
    segments = [_build_segment(expr, derivative, symbol, interval, critical_points) for interval in real_intervals]

    return {
        "ok": True,
        "pipeline": "deterministic-variation",
        "functionInput": str(expression or "").strip(),
        "variable": str(symbol),
        "expressionLatex": _expr_label(expr),
        "derivativeLatex": _expr_label(derivative),
        "domainLatex": _expr_label(domain),
        "segments": segments,
    }

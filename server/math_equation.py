from __future__ import annotations

import re
import unicodedata
from typing import Iterable

import sympy as sp
from sympy import Eq, Interval, S, Union
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
EQUATION_PREFIX_RE = re.compile(
    r"^\s*(?:resoudre|trouver|donner|solutionner)?(?:\s+toutes?\s+les?\s+solutions?)?"
    r"(?:\s+(?:de|pour))?(?:\s+l['’]?(?:equation|equation suivante)|\s+(?:equation|equation suivante))?\s*:?\s*",
    re.IGNORECASE,
)
DOMAIN_REAL_RE = re.compile(r"\b(?:dans|sur)\s*(?:r|reels?|ensemble\s+des\s+reels?)\b", re.IGNORECASE)
DOMAIN_COMPLEX_RE = re.compile(r"\b(?:dans|sur)\s*(?:c|complexes?|ensemble\s+des\s+complexes?)\b", re.IGNORECASE)
TRAILING_CONTEXT_RE = re.compile(
    r"\s+(?:dans|sur|pour|avec|alors|si|puis|ensuite)\b.*$",
    re.IGNORECASE,
)
LEADING_REQUEST_PATTERNS = (
    re.compile(
        r"^\s*(?:peux(?:\s*-\s*|\s+)tu|pourrais(?:\s*-\s*|\s+)tu|veux(?:\s*-\s*|\s+)tu)\s+",
        re.IGNORECASE,
    ),
    re.compile(
        r"^\s*(?:merci\s+de(?:\s+bien\s+vouloir)?|veuillez(?:\s+bien)?|s'?il\s+te\s+plait|s'?il\s+vous\s+plait)\s+",
        re.IGNORECASE,
    ),
    re.compile(
        r"^\s*(?:(?:me|moi)\s+)?(?:calculer|calculez|donner|donnez|donne(?:\s*-\s*moi|\s+moi)?|determiner|determinez|determine|trouver|trouvez|trouve|resoudre|resolvez|resous|solutionner)\s+",
        re.IGNORECASE,
    ),
)


class EquationAnalysisError(ValueError):
    def __init__(self, message: str, *, code: str = "analysis_failed"):
        super().__init__(message)
        self.code = str(code or "analysis_failed")


def _is_sympy_true(value: object) -> bool:
    return value is True or value == True


def _normalize_math_text(text: str) -> str:
    normalized = (
        str(text or "")
        .replace("\u2212", "-")
        .replace("\u2013", "-")
        .replace("\u2014", "-")
        .replace("\u00d7", "*")
        .replace("\u00f7", "/")
        .replace("\u00b7", "*")
        .replace("\u03c0", "pi")
        .replace("\u221e", "oo")
        .replace("\u211d", "R")
        .replace("\u2102", "C")
        .replace("\u2019", "'")
    )
    return "".join(
        ch for ch in unicodedata.normalize("NFD", normalized)
        if unicodedata.category(ch) != "Mn"
    )


def _symbol_pool(*, real: bool) -> dict[str, sp.Symbol]:
    symbols: dict[str, sp.Symbol] = {}
    for code in range(ord("a"), ord("z") + 1):
        name = chr(code)
        symbols[name] = sp.Symbol(name, real=real)
    symbols["e"] = sp.E
    return symbols


def _build_local_dict(variable_name: str, *, real: bool) -> tuple[dict[str, object], sp.Symbol]:
    local_dict = {**ALLOWED_NAMES, **_symbol_pool(real=real)}
    symbol = sp.Symbol(variable_name, real=real)
    local_dict[variable_name] = symbol
    return local_dict, symbol


def _extract_requested_domain(text: str) -> sp.Set:
    raw = _normalize_math_text(text)
    if DOMAIN_COMPLEX_RE.search(raw):
        return S.Complexes
    return S.Reals


def _normalize_equation_candidate(text: str) -> str:
    candidate = _normalize_math_text(text).strip()
    if not candidate:
        return ""
    candidate = EQUATION_PREFIX_RE.sub("", candidate).strip()
    candidate = re.split(r"[\n\r?!]", candidate, maxsplit=1)[0].strip()
    candidate = TRAILING_CONTEXT_RE.sub("", candidate).strip()
    candidate = candidate.rstrip(".,;:")
    candidate = re.sub(r"\s*=\s*", " = ", candidate)
    candidate = re.sub(r"(?<=\d)(?=[A-Za-z(])", "*", candidate)
    candidate = re.sub(r"(?<=[)\]])(?=[A-Za-z0-9(])", "*", candidate)
    candidate = re.sub(r"(?<=[A-Za-z])(?=\d)", "*", candidate)
    candidate = re.sub(r"\s+", " ", candidate).strip()
    return candidate.strip()


def _strip_leading_request_phrases(text: str) -> str:
    candidate = _normalize_math_text(text).strip()
    if not candidate:
        return ""

    changed = True
    while changed and candidate:
        changed = False
        for pattern in LEADING_REQUEST_PATTERNS:
            next_candidate = pattern.sub("", candidate, count=1).strip()
            if next_candidate != candidate:
                candidate = next_candidate
                changed = True
    return candidate


def _can_parse_equation_member(text: str) -> bool:
    candidate = str(text or "").strip()
    if not candidate or "=" in candidate:
        return False

    probe_dict = {**ALLOWED_NAMES, **_symbol_pool(real=True)}
    try:
        expr = parse_expr(candidate, local_dict=probe_dict, transformations=TRANSFORMATIONS, evaluate=True)
    except Exception:
        return False
    return isinstance(expr, sp.Expr)


def _trim_equation_member(candidate: str, *, from_left: bool) -> str:
    text = str(candidate or "").strip()
    if not text:
        return ""

    tokens = text.split()
    if len(tokens) <= 1:
        return text if _can_parse_equation_member(text) else ""

    indexes = range(len(tokens)) if from_left else range(len(tokens), 0, -1)
    for index in indexes:
        probe = " ".join(tokens[index:]).strip() if from_left else " ".join(tokens[:index]).strip()
        if _can_parse_equation_member(probe):
            return probe
    return text if _can_parse_equation_member(text) else ""


def _has_unknown_leading_word_prefix(candidate: str) -> bool:
    text = str(candidate or "").strip()
    if not text:
        return False

    tokens = text.split()
    if len(tokens) <= 1:
        return False

    first = str(tokens[0] or "").strip().lower()
    if not re.fullmatch(r"[A-Za-z]{2,}", first):
        return False
    if first in ALLOWED_NAMES:
        return False

    remainder = " ".join(tokens[1:]).strip()
    if not remainder:
        return False
    return _can_parse_equation_member(remainder)


def _compact_equation_candidate(candidate: str) -> str:
    parts = str(candidate or "").split("=", 1)
    if len(parts) != 2:
        return ""

    left_source = parts[0].strip()
    if _has_unknown_leading_word_prefix(left_source):
        return ""
    if not _can_parse_equation_member(left_source):
        return ""

    left = left_source
    right = _trim_equation_member(parts[1], from_left=False)
    if not left or not right:
        return ""
    return f"{left} = {right}".strip()


def _extract_equation_candidate(text: str) -> tuple[str, str | None]:
    raw = _normalize_math_text(text).strip()
    if not raw:
        raise EquationAnalysisError("Equation manquante.", code="missing_equation")

    for line in raw.splitlines():
        candidate = _normalize_equation_candidate(_strip_leading_request_phrases(line))
        if "=" in candidate:
            compact = _compact_equation_candidate(candidate)
            if compact:
                return compact, None

    candidate = _normalize_equation_candidate(_strip_leading_request_phrases(raw))
    if "=" in candidate:
        compact = _compact_equation_candidate(candidate)
        if compact:
            return compact, None

    raise EquationAnalysisError("Aucune equation exploitable n'a ete detectee.", code="missing_equation")


def _split_equation_members(equation_text: str) -> tuple[str, str]:
    parts = str(equation_text or "").split("=", 1)
    if len(parts) != 2:
        raise EquationAnalysisError("Equation invalide.", code="invalid_equation")
    left = parts[0].strip()
    right = parts[1].strip()
    if not left or not right:
        raise EquationAnalysisError("Equation incomplete.", code="invalid_equation")
    return left, right


def _sort_solutions(values: Iterable[sp.Expr]) -> list[sp.Expr]:
    items = [sp.simplify(value) for value in values]
    try:
        return sorted(items, key=lambda value: float(sp.N(value)))
    except Exception:
        return items


def _expr_label(expr: sp.Expr) -> str:
    return sp.latex(sp.simplify(expr))


def _set_label(expr: sp.Set | sp.Expr) -> str:
    return sp.latex(sp.simplify(expr))


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
    return []


def _coerce_real_float(value: sp.Expr) -> float | None:
    try:
        numeric = sp.N(value, 30)
    except Exception:
        return None

    try:
        imag = float(sp.im(numeric))
    except Exception:
        return None
    if abs(imag) > 1e-8:
        return None

    try:
        real_value = float(sp.re(numeric))
    except Exception:
        return None
    if not sp.Float(real_value).is_finite:
        return None
    return real_value


def _value_in_interval(value: float, interval: Interval, *, tolerance: float = 1e-7) -> bool:
    left = None if interval.start == -sp.oo else float(sp.N(interval.start))
    right = None if interval.end == sp.oo else float(sp.N(interval.end))

    if left is not None:
        if interval.left_open and value <= left + tolerance:
            return False
        if not interval.left_open and value < left - tolerance:
            return False
    if right is not None:
        if interval.right_open and value >= right - tolerance:
            return False
        if not interval.right_open and value > right + tolerance:
            return False
    return True


def _add_unique_root(roots: list[sp.Expr], candidate: sp.Expr, *, tolerance: float = 1e-7) -> None:
    candidate_value = _coerce_real_float(candidate)
    if candidate_value is None:
        return
    for root in roots:
        existing_value = _coerce_real_float(root)
        if existing_value is None:
            continue
        if abs(existing_value - candidate_value) <= tolerance:
            return
    roots.append(sp.Float(candidate_value, 15))


def _filter_explicit_solutions(
    candidates: Iterable[sp.Expr],
    relation: sp.Expr,
    symbol: sp.Symbol,
    domain: sp.Set,
) -> list[sp.Expr]:
    filtered: list[sp.Expr] = []
    for candidate in candidates:
        value = sp.simplify(candidate)
        if value.free_symbols:
            continue
        if domain == S.Reals and value.is_real is False:
            continue
        contains = domain.contains(value)
        if contains == False:
            continue
        if not _is_sympy_true(contains) and domain == S.Reals:
            numeric = _coerce_real_float(value)
            if numeric is None:
                continue
        try:
            residual = sp.simplify(relation.subs(symbol, value))
        except Exception:
            continue
        if residual == 0:
            filtered.append(value)
            continue
        numeric_residual = _coerce_real_float(residual)
        if numeric_residual is not None and abs(numeric_residual) <= 1e-8:
            filtered.append(value)
    return _sort_solutions(filtered)


def _build_finite_solution_payload(values: Iterable[sp.Expr], *, exact: bool) -> dict:
    ordered = _sort_solutions(values)
    return {
        "solutionType": "finite" if exact else "numeric",
        "solutionsLatex": [_expr_label(value) for value in ordered],
        "solutionSetLatex": _set_label(sp.FiniteSet(*ordered)),
        "hasExactSolution": exact,
    }


def _is_log_exp_equation(expr: sp.Expr) -> bool:
    return bool(expr.has(sp.log) or expr.has(sp.exp))


def _try_exact_transcendental_solutions(
    left_expr: sp.Expr,
    right_expr: sp.Expr,
    relation: sp.Expr,
    symbol: sp.Symbol,
    domain: sp.Set,
) -> dict | None:
    try:
        raw_solutions = sp.solve(Eq(left_expr, right_expr), symbol, dict=False)
    except Exception:
        return None
    if not raw_solutions:
        return None

    filtered = _filter_explicit_solutions(raw_solutions, relation, symbol, domain)
    if not filtered:
        return None
    return _build_finite_solution_payload(filtered, exact=True)


def _interval_seed_values(interval: Interval) -> list[float]:
    if interval.start.is_finite and interval.end.is_finite:
        start = float(sp.N(interval.start))
        end = float(sp.N(interval.end))
        if end <= start:
            return []
        width = end - start
        edge_offset = min(width / 50.0, 0.25)
        left = start + (edge_offset if interval.left_open else 0.0)
        right = end - (edge_offset if interval.right_open else 0.0)
        if right <= left:
            midpoint = (start + end) / 2.0
            return [midpoint]
        return [left + (right - left) * index / 12.0 for index in range(13)]

    if not interval.start.is_finite and not interval.end.is_finite:
        return [-50.0, -20.0, -10.0, -5.0, -2.0, -1.0, -0.5, 0.5, 1.0, 2.0, 5.0, 10.0, 20.0, 50.0]

    if interval.start.is_finite:
        start = float(sp.N(interval.start))
        offset = 1e-3 if interval.left_open else 0.0
        return [start + offset + step for step in (0.1, 0.25, 0.5, 1.0, 2.0, 5.0, 10.0, 20.0, 50.0)]

    end = float(sp.N(interval.end))
    offset = 1e-3 if interval.right_open else 0.0
    return [end - offset - step for step in (50.0, 20.0, 10.0, 5.0, 2.0, 1.0, 0.5, 0.25, 0.1)]


def _find_numeric_roots(
    relation: sp.Expr,
    symbol: sp.Symbol,
    domain: sp.Set,
) -> list[sp.Expr]:
    effective_domain = continuous_domain(relation, symbol, S.Reals)
    if domain != S.Reals:
        try:
            effective_domain = sp.Intersection(effective_domain, domain)
        except Exception:
            pass

    intervals = _flatten_real_intervals(effective_domain)
    if not intervals:
        return []

    roots: list[sp.Expr] = []
    for interval in intervals:
        for seed in _interval_seed_values(interval):
            if not _value_in_interval(seed, interval):
                continue
            try:
                root = sp.nsolve(relation, symbol, seed, tol=1e-14, maxsteps=100, prec=50)
            except Exception:
                continue

            numeric_root = _coerce_real_float(root)
            if numeric_root is None or not _value_in_interval(numeric_root, interval):
                continue
            try:
                residual = relation.subs(symbol, numeric_root)
            except Exception:
                continue
            numeric_residual = _coerce_real_float(residual)
            if numeric_residual is None or abs(numeric_residual) > 1e-7:
                continue
            _add_unique_root(roots, sp.Float(numeric_root, 15))
    return _sort_solutions(roots)


def _try_special_transcendental_resolution(
    left_expr: sp.Expr,
    right_expr: sp.Expr,
    relation: sp.Expr,
    symbol: sp.Symbol,
    domain: sp.Set,
) -> dict | None:
    if not _is_log_exp_equation(relation):
        return None

    exact_payload = _try_exact_transcendental_solutions(left_expr, right_expr, relation, symbol, domain)
    if exact_payload:
        return exact_payload

    if domain != S.Reals:
        return None

    numeric_roots = _find_numeric_roots(relation, symbol, domain)
    if not numeric_roots:
        return None
    return _build_finite_solution_payload(numeric_roots, exact=False)


def parse_equation(expression: str, variable: str | None = None) -> tuple[sp.Expr, sp.Expr, sp.Symbol, sp.Set]:
    domain = _extract_requested_domain(expression)
    eq_text, hinted_variable = _extract_equation_candidate(expression)
    left_text, right_text = _split_equation_members(eq_text)
    variable_name = str(variable or hinted_variable or "x").strip() or "x"
    if not re.fullmatch(r"[A-Za-z]", variable_name):
        raise EquationAnalysisError("Variable invalide pour l'analyse.", code="invalid_variable")

    local_dict, symbol = _build_local_dict(variable_name, real=(domain == S.Reals))

    try:
        left_expr = parse_expr(left_text, local_dict=local_dict, transformations=TRANSFORMATIONS, evaluate=True)
        right_expr = parse_expr(right_text, local_dict=local_dict, transformations=TRANSFORMATIONS, evaluate=True)
    except Exception as exc:  # pragma: no cover - parser specifics
        raise EquationAnalysisError("Impossible d'analyser l'equation fournie.", code="parse_failed") from exc

    if not isinstance(left_expr, sp.Expr) or not isinstance(right_expr, sp.Expr):
        raise EquationAnalysisError("Equation mathematique invalide.", code="invalid_equation")

    free_symbols = list((left_expr - right_expr).free_symbols)
    if not free_symbols:
        raise EquationAnalysisError("L'equation doit dependre d'une variable.", code="constant_equation")
    if symbol not in free_symbols and len(free_symbols) == 1:
        symbol = next(iter(free_symbols))
    elif symbol not in free_symbols:
        raise EquationAnalysisError(
            "Impossible de determiner de facon sure la variable de l'equation.",
            code="ambiguous_variable",
        )

    return sp.simplify(left_expr), sp.simplify(right_expr), symbol, domain


def _normalize_solution_payload(solution_set: sp.Set, domain: sp.Set) -> dict:
    if solution_set is S.EmptySet:
        return {
            "solutionType": "none",
            "solutionsLatex": [],
            "solutionSetLatex": r"\varnothing",
            "hasExactSolution": True,
        }

    if isinstance(solution_set, sp.FiniteSet):
        ordered = _sort_solutions(solution_set)
        return {
            "solutionType": "finite",
            "solutionsLatex": [_expr_label(value) for value in ordered],
            "solutionSetLatex": _set_label(sp.FiniteSet(*ordered)),
            "hasExactSolution": True,
        }

    if solution_set == domain:
        return {
            "solutionType": "all-domain",
            "solutionsLatex": [],
            "solutionSetLatex": _set_label(solution_set),
            "hasExactSolution": True,
        }

    if isinstance(solution_set, sp.ConditionSet):
        raise EquationAnalysisError(
            "La resolution symbolique de cette equation reste indeterminee.",
            code="unsupported_equation",
        )

    return {
        "solutionType": "set",
        "solutionsLatex": [],
        "solutionSetLatex": _set_label(solution_set),
        "hasExactSolution": True,
    }


def analyze_equation(expression: str, variable: str | None = None) -> dict:
    left_expr, right_expr, symbol, domain = parse_equation(expression, variable)
    relation = sp.simplify(left_expr - right_expr)

    try:
        solution_set = sp.solveset(relation, symbol, domain)
    except Exception as exc:  # pragma: no cover - depends on SymPy internals
        raise EquationAnalysisError(
            "Impossible de resoudre cette equation de facon fiable.",
            code="solve_failed",
        ) from exc

    if isinstance(solution_set, sp.ConditionSet):
        normalized = _try_special_transcendental_resolution(left_expr, right_expr, relation, symbol, domain)
        if not normalized:
            raise EquationAnalysisError(
                "La resolution symbolique de cette equation reste indeterminee.",
                code="unsupported_equation",
            )
    else:
        normalized = _normalize_solution_payload(solution_set, domain)

    return {
        "ok": True,
        "pipeline": "deterministic-equation",
        "equationInput": str(expression or "").strip(),
        "variable": str(symbol),
        "domainLatex": _set_label(domain),
        "equationLatex": _set_label(Eq(left_expr, right_expr)),
        "reducedLatex": _expr_label(relation),
        **normalized,
    }

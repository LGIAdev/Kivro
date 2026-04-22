from __future__ import annotations

import re
import unicodedata

import sympy as sp
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
FUNCTION_IN_TEXT_RE = re.compile(r"([a-zA-Z]\w*|y)\s*\(\s*([a-zA-Z])\s*\)\s*=\s*(.+)")
WITH_RESPECT_TO_RE = re.compile(r"\bpar\s+rapport\s+a\s+([a-zA-Z])\b", re.IGNORECASE)
INTEGRAL_BETWEEN_RE = re.compile(
    r"^\s*(?:calculer|donner|determiner|trouver)?\s*"
    r"(?:(?:l['']?)?integrale|primitive)(?:\s+de)?\s+(.+?)\s+entre\s+(.+?)\s+et\s+(.+?)\s*$",
    re.IGNORECASE,
)
INTEGRAL_SIMPLE_RE = re.compile(
    r"^\s*(?:calculer|donner|determiner|trouver)?\s*"
    r"(?:(?:l['']?)?integrale|primitive)(?:\s+de)?\s+(.+?)\s*$",
    re.IGNORECASE,
)
SYMBOLIC_DEFINITE_RE = re.compile(
    r"^\s*(?:\\int|∫|int)\s*_\{?\s*(.+?)\s*\}?\s*\^\{?\s*(.+?)\s*\}?\s*(.+?)\s*d([a-zA-Z])\s*$",
    re.IGNORECASE,
)
SYMBOLIC_INDEFINITE_RE = re.compile(
    r"^\s*(?:\\int|∫|int)\s*(.+?)\s*d([a-zA-Z])\s*$",
    re.IGNORECASE,
)
TRAILING_CONTEXT_RE = re.compile(
    r"\s+(?:dans|sur|avec|alors|puis|ensuite)\b.*$",
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
        r"^\s*(?:(?:me|moi)\s+)?(?:calculer|calculez|donner|donnez|donne(?:\s*-\s*moi|\s+moi)?|determiner|determinez|determine|trouver|trouvez|trouve|integrer|integrez)\s+",
        re.IGNORECASE,
    ),
)


class IntegralAnalysisError(ValueError):
    def __init__(self, message: str, *, code: str = "analysis_failed"):
        super().__init__(message)
        self.code = str(code or "analysis_failed")


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
        .replace("\u2019", "'")
        .replace("\u222b", "∫")
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


def _normalize_expression_candidate(text: str) -> str:
    candidate = _normalize_math_text(text).strip()
    if not candidate:
        return ""
    candidate = re.split(r"[\n\r?!]", candidate, maxsplit=1)[0].strip()
    candidate = TRAILING_CONTEXT_RE.sub("", candidate).strip()
    candidate = candidate.rstrip(".,;:")
    candidate = re.sub(r"(?<=\d)(?=[A-Za-z(])", "*", candidate)
    candidate = re.sub(r"(?<=[)\]])(?=[A-Za-z0-9(])", "*", candidate)
    candidate = re.sub(r"(?<=[A-Za-z])(?=\d)", "*", candidate)
    candidate = re.sub(r"\s+", " ", candidate).strip()
    return candidate


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


def _expr_label(expr: sp.Expr) -> str:
    return sp.latex(sp.simplify(expr))


def _parse_bound(text: str, local_dict: dict[str, object]) -> sp.Expr:
    candidate = _normalize_expression_candidate(text)
    try:
        value = parse_expr(candidate, local_dict=local_dict, transformations=TRANSFORMATIONS, evaluate=True)
    except Exception as exc:
        raise IntegralAnalysisError("Impossible d'analyser une borne d'integrale.", code="invalid_bound") from exc
    if not isinstance(value, sp.Expr):
        raise IntegralAnalysisError("Borne d'integrale invalide.", code="invalid_bound")
    return sp.simplify(value)


def _extract_integral_candidate(text: str) -> tuple[str, str | None, sp.Expr | None, sp.Expr | None]:
    raw = _normalize_math_text(text).strip()
    if not raw:
        raise IntegralAnalysisError("Expression manquante.", code="missing_expression")

    variable_match = WITH_RESPECT_TO_RE.search(raw)
    hinted_variable = variable_match.group(1).strip() if variable_match else None

    for line in raw.splitlines():
        candidate_line = _strip_leading_request_phrases(line)
        if not candidate_line:
            continue

        symbolic_definite = SYMBOLIC_DEFINITE_RE.match(candidate_line)
        if symbolic_definite:
            lower_text = symbolic_definite.group(1).strip()
            upper_text = symbolic_definite.group(2).strip()
            expr = _normalize_expression_candidate(symbolic_definite.group(3))
            variable = symbolic_definite.group(4).strip()
            if expr:
                local_dict, _ = _build_local_dict(variable, real=True)
                return expr, variable, _parse_bound(lower_text, local_dict), _parse_bound(upper_text, local_dict)

        symbolic_indefinite = SYMBOLIC_INDEFINITE_RE.match(candidate_line)
        if symbolic_indefinite:
            expr = _normalize_expression_candidate(symbolic_indefinite.group(1))
            variable = symbolic_indefinite.group(2).strip()
            if expr:
                return expr, variable, None, None

        function_match = FUNCTION_IN_TEXT_RE.search(candidate_line)
        candidate_from_definition = _normalize_expression_candidate(function_match.group(3)) if function_match else ""
        variable_from_definition = function_match.group(2).strip() if function_match else None

        between_match = INTEGRAL_BETWEEN_RE.match(candidate_line)
        if between_match:
            expr = candidate_from_definition or _normalize_expression_candidate(between_match.group(1))
            variable = variable_from_definition or hinted_variable
            variable_name = str(variable or "x").strip() or "x"
            local_dict, _ = _build_local_dict(variable_name, real=True)
            lower = _parse_bound(between_match.group(2), local_dict)
            upper = _parse_bound(between_match.group(3), local_dict)
            if expr:
                return expr, variable, lower, upper

        simple_match = INTEGRAL_SIMPLE_RE.match(candidate_line)
        if simple_match:
            expr = candidate_from_definition or _normalize_expression_candidate(simple_match.group(1))
            if expr:
                return expr, variable_from_definition or hinted_variable, None, None

    raise IntegralAnalysisError("Aucune integrale exploitable n'a ete detectee.", code="missing_integral")


def parse_integral_expression(
    expression: str,
    variable: str | None = None,
) -> tuple[sp.Expr, sp.Symbol, sp.Expr | None, sp.Expr | None]:
    expr_text, hinted_variable, lower, upper = _extract_integral_candidate(expression)
    variable_name = str(variable or hinted_variable or "x").strip() or "x"
    if not re.fullmatch(r"[A-Za-z]", variable_name):
        raise IntegralAnalysisError("Variable invalide pour l'analyse.", code="invalid_variable")

    local_dict, symbol = _build_local_dict(variable_name, real=True)
    try:
        expr = parse_expr(expr_text, local_dict=local_dict, transformations=TRANSFORMATIONS, evaluate=True)
    except Exception as exc:
        raise IntegralAnalysisError("Impossible d'analyser l'expression fournie.", code="parse_failed") from exc

    if not isinstance(expr, sp.Expr):
        raise IntegralAnalysisError("Expression mathematique invalide.", code="invalid_expression")

    free_symbols = list(expr.free_symbols)
    if symbol not in free_symbols and len(free_symbols) == 1:
        symbol = next(iter(free_symbols))
    elif symbol not in free_symbols and len(free_symbols) > 1:
        raise IntegralAnalysisError(
            "Impossible de determiner de facon sure la variable d'integration.",
            code="ambiguous_variable",
        )

    return sp.simplify(expr), sp.Symbol(str(symbol), real=True), lower, upper


def analyze_integral(expression: str, variable: str | None = None) -> dict:
    expr, symbol, lower, upper = parse_integral_expression(expression, variable)
    try:
        if lower is None or upper is None:
            result = sp.simplify(sp.integrate(expr, symbol))
            statement = rf"\int {sp.latex(expr)} \, d{sp.latex(symbol)} = {sp.latex(result)} + C"
            is_definite = False
        else:
            result = sp.simplify(sp.integrate(expr, (symbol, lower, upper)))
            statement = rf"\int_{{{sp.latex(lower)}}}^{{{sp.latex(upper)}}} {sp.latex(expr)} \, d{sp.latex(symbol)} = {sp.latex(result)}"
            is_definite = True
    except Exception as exc:
        raise IntegralAnalysisError(
            "Impossible de calculer cette integrale de facon fiable.",
            code="integral_failed",
        ) from exc

    return {
        "ok": True,
        "pipeline": "deterministic-integral",
        "expressionInput": str(expression or "").strip(),
        "variable": str(symbol),
        "expressionLatex": _expr_label(expr),
        "integralLatex": sp.latex(result),
        "integralStatementLatex": statement,
        "lowerBoundLatex": sp.latex(lower) if lower is not None else "",
        "upperBoundLatex": sp.latex(upper) if upper is not None else "",
        "isDefinite": is_definite,
        "hasExactSolution": True,
    }

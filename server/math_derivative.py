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

from math_sympy_fallback import ControlledSympyFallbackError, execute_controlled_sympy


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
FALLBACK_ALLOWED_NAMES = {
    **ALLOWED_NAMES,
    "sinh": sp.sinh,
    "cosh": sp.cosh,
    "tanh": sp.tanh,
    "asinh": sp.asinh,
    "acosh": sp.acosh,
    "atanh": sp.atanh,
    "arcsin": sp.asin,
    "arccos": sp.acos,
    "arctan": sp.atan,
    "sec": sp.sec,
    "csc": sp.csc,
    "cot": sp.cot,
    "sech": sp.sech,
    "csch": sp.csch,
    "coth": sp.coth,
    "erf": sp.erf,
    "gamma": sp.gamma,
}
FUNCTION_IN_TEXT_RE = re.compile(r"([a-zA-Z]\w*|y)\s*\(\s*([a-zA-Z])\s*\)\s*=\s*(.+)")
WITH_RESPECT_TO_RE = re.compile(r"\bpar\s+rapport\s+a\s+([a-zA-Z])\b", re.IGNORECASE)
DERIVATIVE_PREFIX_RE = re.compile(
    r"^\s*(?:calculer|donner|determiner|trouver)?\s*"
    r"(?:(?:la|sa)\s+)?derivee(?:\s+premiere)?(?:\s+de)?(?:\s+la\s+fonction)?\s*",
    re.IGNORECASE,
)
DERIVATIVE_SYMBOL_PREFIX_RE = re.compile(
    r"^\s*(?:calculer|donner|determiner|trouver)?\s*"
    r"(?:[a-zA-Z]\s*'\s*\(\s*[a-zA-Z]\s*\)|[a-zA-Z]\s+prime\s*\(\s*[a-zA-Z]\s*\))\s*"
    r"(?:si|pour|avec)?\s*",
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
        r"^\s*(?:(?:me|moi)\s+)?(?:calculer|calculez|donner|donnez|donne(?:\s*-\s*moi|\s+moi)?|determiner|determinez|determine|trouver|trouvez|trouve|resoudre|resolvez|resous|solutionner|deriver|derivez)\s+",
        re.IGNORECASE,
    ),
)
FUNCTION_CALL_RE = re.compile(r"\b([A-Za-z]\w*)\s*\(")


class DerivativeAnalysisError(ValueError):
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


def _build_fallback_local_dict(variable_name: str, *, real: bool) -> tuple[dict[str, object], sp.Symbol]:
    local_dict = {**FALLBACK_ALLOWED_NAMES, **_symbol_pool(real=real)}
    symbol = sp.Symbol(variable_name, real=real)
    local_dict[variable_name] = symbol
    return local_dict, symbol


def _normalize_expression_candidate(text: str) -> str:
    candidate = _normalize_math_text(text).strip()
    if not candidate:
        return ""
    candidate = DERIVATIVE_PREFIX_RE.sub("", candidate).strip()
    candidate = DERIVATIVE_SYMBOL_PREFIX_RE.sub("", candidate).strip()
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


def _looks_like_derivative_request(candidate: str) -> bool:
    text = _normalize_math_text(candidate).strip()
    if not text:
        return False
    if FUNCTION_IN_TEXT_RE.search(text):
        return True
    if DERIVATIVE_PREFIX_RE.match(text):
        return True
    if DERIVATIVE_SYMBOL_PREFIX_RE.match(text):
        return True
    return False


def _extract_derivative_candidate(text: str) -> tuple[str, str | None]:
    raw = _normalize_math_text(text).strip()
    if not raw:
        raise DerivativeAnalysisError("Expression manquante.", code="missing_expression")

    variable_match = WITH_RESPECT_TO_RE.search(raw)
    hinted_variable = variable_match.group(1).strip() if variable_match else None

    for line in raw.splitlines():
        candidate_line = _strip_leading_request_phrases(line)
        if not candidate_line:
            continue
        if not _looks_like_derivative_request(candidate_line):
            continue

        function_match = FUNCTION_IN_TEXT_RE.search(candidate_line)
        if function_match:
            variable = function_match.group(2).strip()
            expr = _normalize_expression_candidate(function_match.group(3))
            if expr:
                return expr, variable

        expr = _normalize_expression_candidate(candidate_line)
        if expr:
            return expr, hinted_variable

    stripped_raw = _strip_leading_request_phrases(raw)
    if not _looks_like_derivative_request(stripped_raw):
        raise DerivativeAnalysisError("Aucune expression exploitable n'a ete detectee.", code="missing_expression")

    expr = _normalize_expression_candidate(stripped_raw)
    if expr:
        return expr, hinted_variable

    raise DerivativeAnalysisError("Aucune expression exploitable n'a ete detectee.", code="missing_expression")


def _expr_label(expr: sp.Expr) -> str:
    return sp.latex(sp.simplify(expr))


def _build_derivative_payload(
    expression: str,
    expr: sp.Expr,
    symbol: sp.Symbol,
    derivative: sp.Expr,
    *,
    used_sympy_fallback: bool = False,
) -> dict:
    payload = {
        "ok": True,
        "pipeline": "deterministic-derivative",
        "expressionInput": str(expression or "").strip(),
        "variable": str(symbol),
        "expressionLatex": _expr_label(expr),
        "derivativeLatex": _expr_label(derivative),
        "derivativeOrder": 1,
        "hasExactSolution": True,
    }
    if used_sympy_fallback:
        payload["usedSympyFallback"] = True
        payload["sympyFallbackStrategy"] = "controlled-derivative-fallback"
    return payload


def _should_force_derivative_fallback(expression: str) -> bool:
    try:
        expr_text, _ = _extract_derivative_candidate(expression)
    except DerivativeAnalysisError:
        return False

    for match in FUNCTION_CALL_RE.finditer(expr_text):
        name = str(match.group(1) or "").strip().lower()
        if not name:
            continue
        if name in FALLBACK_ALLOWED_NAMES and name not in ALLOWED_NAMES:
            return True
    return False


def _build_derivative_sympy_fallback_code() -> str:
    return (
        "local_dict = fallback_local_dict_input.copy()\n"
        "symbol = sp.Symbol(variable_name_input, real=True)\n"
        "local_dict[variable_name_input] = symbol\n"
        "expr = parse_expr(expression_text_input, local_dict=local_dict, transformations=transformations_input, evaluate=True)\n"
        "derivative = sp.simplify(sp.diff(expr, symbol))\n"
        "if derivative.has(sp.Derivative):\n"
        "    derivative = sp.simplify(sp.Derivative(expr, symbol, evaluate=True).doit())\n"
    )


def _try_controlled_sympy_derivative_fallback(expression: str, variable: str | None = None) -> dict | None:
    try:
        expr_text, hinted_variable = _extract_derivative_candidate(expression)
    except DerivativeAnalysisError:
        return None

    variable_name = str(variable or hinted_variable or "x").strip() or "x"
    if not re.fullmatch(r"[A-Za-z]", variable_name):
        return None

    fallback_local_dict, _ = _build_fallback_local_dict(variable_name, real=True)
    namespace = {
        "sp": sp,
        "parse_expr": parse_expr,
        "expression_text_input": expr_text,
        "variable_name_input": variable_name,
        "fallback_local_dict_input": fallback_local_dict,
        "transformations_input": TRANSFORMATIONS,
    }

    try:
        result = execute_controlled_sympy(_build_derivative_sympy_fallback_code(), namespace)
    except ControlledSympyFallbackError:
        return None

    expr = result.get("expr")
    symbol = result.get("symbol")
    derivative = result.get("derivative")
    if not isinstance(expr, sp.Expr) or not isinstance(symbol, sp.Symbol) or not isinstance(derivative, sp.Expr):
        return None
    if derivative.has(sp.Derivative):
        return None

    return _build_derivative_payload(
        expression,
        sp.simplify(expr),
        sp.Symbol(str(symbol), real=True),
        sp.simplify(derivative),
        used_sympy_fallback=True,
    )


def parse_derivative_expression(expression: str, variable: str | None = None) -> tuple[sp.Expr, sp.Symbol]:
    expr_text, hinted_variable = _extract_derivative_candidate(expression)
    variable_name = str(variable or hinted_variable or "x").strip() or "x"
    if not re.fullmatch(r"[A-Za-z]", variable_name):
        raise DerivativeAnalysisError("Variable invalide pour l'analyse.", code="invalid_variable")

    local_dict, symbol = _build_local_dict(variable_name, real=True)

    try:
        expr = parse_expr(expr_text, local_dict=local_dict, transformations=TRANSFORMATIONS, evaluate=True)
    except Exception as exc:  # pragma: no cover - parser specifics
        raise DerivativeAnalysisError("Impossible d'analyser l'expression fournie.", code="parse_failed") from exc

    if not isinstance(expr, sp.Expr):
        raise DerivativeAnalysisError("Expression mathematique invalide.", code="invalid_expression")

    free_symbols = list(expr.free_symbols)
    if symbol not in free_symbols and len(free_symbols) == 1:
        symbol = next(iter(free_symbols))
    elif symbol not in free_symbols and len(free_symbols) > 1:
        raise DerivativeAnalysisError(
            "Impossible de determiner de facon sure la variable de derivation.",
            code="ambiguous_variable",
        )

    return sp.simplify(expr), sp.Symbol(str(symbol), real=True)


def analyze_derivative(expression: str, variable: str | None = None) -> dict:
    if _should_force_derivative_fallback(expression):
        fallback_payload = _try_controlled_sympy_derivative_fallback(expression, variable)
        if fallback_payload:
            return fallback_payload

    try:
        expr, symbol = parse_derivative_expression(expression, variable)
    except DerivativeAnalysisError as exc:
        if exc.code in {"parse_failed", "invalid_expression"}:
            fallback_payload = _try_controlled_sympy_derivative_fallback(expression, variable)
            if fallback_payload:
                return fallback_payload
        raise

    try:
        derivative = sp.simplify(sp.diff(expr, symbol))
    except Exception as exc:  # pragma: no cover - depends on SymPy internals
        fallback_payload = _try_controlled_sympy_derivative_fallback(expression, variable)
        if fallback_payload:
            return fallback_payload
        raise DerivativeAnalysisError(
            "Impossible de calculer cette derivee de facon fiable.",
            code="derivative_failed",
        ) from exc

    if derivative.has(sp.Derivative):
        fallback_payload = _try_controlled_sympy_derivative_fallback(expression, variable)
        if fallback_payload:
            return fallback_payload

    return _build_derivative_payload(expression, expr, symbol, derivative)

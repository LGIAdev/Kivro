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
LIMIT_WHEN_RE = re.compile(
    r"^\s*(?:calculer|donner|determiner|trouver)?\s*(?:la\s+)?limite(?:\s+de)?\s+(.+?)\s+"
    r"(?:quand|lorsque)\s+([a-zA-Z])\s+tend\s+vers\s+(.+?)\s*$",
    re.IGNORECASE,
)
LIMIT_AT_RE = re.compile(
    r"^\s*(?:calculer|donner|determiner|trouver)?\s*(?:la\s+)?limite(?:\s+de)?\s+(.+?)\s+"
    r"(?:en|au\s+voisinage\s+de)\s+(.+?)\s*$",
    re.IGNORECASE,
)
LIMIT_SYMBOLIC_RE = re.compile(
    r"^\s*lim(?:ite)?\s*(?:_\{?\s*([a-zA-Z])\s*(?:->|\\to|→)\s*([^}]+?)\s*\}?)\s*(.+)$",
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
        r"^\s*(?:(?:me|moi)\s+)?(?:calculer|calculez|donner|donnez|donne(?:\s*-\s*moi|\s+moi)?|determiner|determinez|determine|trouver|trouvez|trouve|resoudre|resolvez|resous|solutionner|etudier|etudiez|analyser|analysez)\s+",
        re.IGNORECASE,
    ),
)


class LimitAnalysisError(ValueError):
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
        .replace("\u211d", "R")
        .replace("\u2102", "C")
        .replace("\u2019", "'")
        .replace("→", "->")
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


def _extract_limit_candidate(text: str) -> tuple[str, str | None, str, str | None]:
    raw = _normalize_math_text(text).strip()
    if not raw:
        raise LimitAnalysisError("Expression manquante.", code="missing_expression")

    for line in raw.splitlines():
        candidate_line = _strip_leading_request_phrases(line)
        if not candidate_line:
            continue

        symbolic_match = LIMIT_SYMBOLIC_RE.match(candidate_line)
        if symbolic_match:
            variable = symbolic_match.group(1).strip()
            target = symbolic_match.group(2).strip()
            expr = _normalize_expression_candidate(symbolic_match.group(3))
            if expr and target:
                return expr, variable, target, None

        function_match = FUNCTION_IN_TEXT_RE.search(candidate_line)
        candidate_from_definition = _normalize_expression_candidate(function_match.group(3)) if function_match else ""
        variable_from_definition = function_match.group(2).strip() if function_match else None

        when_match = LIMIT_WHEN_RE.match(candidate_line)
        if when_match:
            expr = candidate_from_definition or _normalize_expression_candidate(when_match.group(1))
            variable = when_match.group(2).strip() or variable_from_definition
            target = when_match.group(3).strip()
            if expr and target:
                return expr, variable, target, None

        at_match = LIMIT_AT_RE.match(candidate_line)
        if at_match:
            expr = candidate_from_definition or _normalize_expression_candidate(at_match.group(1))
            target = at_match.group(2).strip()
            if expr and target:
                return expr, variable_from_definition, target, None

    raise LimitAnalysisError("Aucune limite exploitable n'a ete detectee.", code="missing_limit")


def _parse_limit_direction(text: str | None) -> str | None:
    raw = _normalize_math_text(text or "").strip().lower()
    if not raw:
        return None
    if raw in {"+", "plus", "droite"}:
        return "+"
    if raw in {"-", "moins", "gauche"}:
        return "-"
    return None


def _split_target_and_direction(target_text: str) -> tuple[str, str | None]:
    raw = _normalize_math_text(target_text).strip()
    if not raw:
        raise LimitAnalysisError("Point de limite manquant.", code="missing_target")

    for suffix, direction in (("^+", "+"), ("^-", "-")):
        if raw.endswith(suffix):
            return raw[:-2].strip(), direction

    if raw.endswith("+") and raw not in {"+oo", "oo"}:
        return raw[:-1].strip(), "+"
    if raw.endswith("-") and raw != "-oo":
        return raw[:-1].strip(), "-"
    return raw, None


def _parse_limit_target(target_text: str, local_dict: dict[str, object]) -> tuple[sp.Expr, str | None]:
    target_candidate, inline_direction = _split_target_and_direction(target_text)
    lowered = target_candidate.lower().replace(" ", "")
    if lowered in {"oo", "+oo", "+inf", "+infty", "+infinity"}:
        return sp.oo, inline_direction
    if lowered in {"-oo", "-inf", "-infty", "-infinity"}:
        return -sp.oo, inline_direction
    try:
        target = parse_expr(target_candidate, local_dict=local_dict, transformations=TRANSFORMATIONS, evaluate=True)
    except Exception as exc:
        raise LimitAnalysisError("Impossible d'analyser le point de limite.", code="invalid_target") from exc
    if not isinstance(target, sp.Expr):
        raise LimitAnalysisError("Point de limite invalide.", code="invalid_target")
    return sp.simplify(target), inline_direction


def parse_limit_expression(expression: str, variable: str | None = None) -> tuple[sp.Expr, sp.Symbol, sp.Expr, str | None]:
    expr_text, hinted_variable, target_text, hinted_direction = _extract_limit_candidate(expression)
    variable_name = str(variable or hinted_variable or "x").strip() or "x"
    if not re.fullmatch(r"[A-Za-z]", variable_name):
        raise LimitAnalysisError("Variable invalide pour l'analyse.", code="invalid_variable")

    local_dict, symbol = _build_local_dict(variable_name, real=True)

    try:
        expr = parse_expr(expr_text, local_dict=local_dict, transformations=TRANSFORMATIONS, evaluate=True)
    except Exception as exc:  # pragma: no cover - parser specifics
        raise LimitAnalysisError("Impossible d'analyser l'expression fournie.", code="parse_failed") from exc

    if not isinstance(expr, sp.Expr):
        raise LimitAnalysisError("Expression mathematique invalide.", code="invalid_expression")

    free_symbols = list(expr.free_symbols)
    if symbol not in free_symbols and len(free_symbols) == 1:
        symbol = next(iter(free_symbols))
    elif symbol not in free_symbols and len(free_symbols) > 1:
        raise LimitAnalysisError(
            "Impossible de determiner de facon sure la variable de la limite.",
            code="ambiguous_variable",
        )

    local_dict[str(symbol)] = symbol
    target, inline_direction = _parse_limit_target(target_text, local_dict)
    direction = _parse_limit_direction(inline_direction or hinted_direction)
    return sp.simplify(expr), sp.Symbol(str(symbol), real=True), sp.simplify(target), direction


def analyze_limit(expression: str, variable: str | None = None) -> dict:
    expr, symbol, target, direction = parse_limit_expression(expression, variable)
    try:
        limit_value = sp.simplify(sp.limit(expr, symbol, target, dir=direction) if direction else sp.limit(expr, symbol, target))
    except Exception as exc:  # pragma: no cover - depends on SymPy internals
        raise LimitAnalysisError(
            "Impossible de calculer cette limite de facon fiable.",
            code="limit_failed",
        ) from exc

    direction_suffix = f"^{direction}" if direction in {"+", "-"} else ""
    statement = rf"\lim_{{{sp.latex(symbol)} \to {sp.latex(target)}{direction_suffix}}} {sp.latex(expr)} = {sp.latex(limit_value)}"
    return {
        "ok": True,
        "pipeline": "deterministic-limit",
        "expressionInput": str(expression or "").strip(),
        "variable": str(symbol),
        "expressionLatex": _expr_label(expr),
        "targetLatex": sp.latex(target),
        "direction": direction or "",
        "limitLatex": sp.latex(limit_value),
        "limitStatementLatex": statement,
        "hasExactSolution": True,
    }

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
WITH_RESPECT_TO_RE = re.compile(r"\b(?:par\s+rapport\s+a|en\s+fonction\s+de)\s+([a-zA-Z])\b", re.IGNORECASE)
ODE_PREFIX_RE = re.compile(
    r"^\s*(?:resoudre|donner|determiner|trouver|calculer)?\s*"
    r"(?:(?:la|l')\s*)?(?:solution\s+de\s+)?(?:(?:l')?\s*)?"
    r"(?:equation\s+differentielle|ed)\s*:?\s*",
    re.IGNORECASE,
)
FUNCTION_CALL_RE = re.compile(r"([a-zA-Z]\w*)\s*\(\s*([a-zA-Z])\s*\)")
PRIME_CALL_RE = re.compile(r"([a-zA-Z]\w*)\s*'\s*\(\s*([a-zA-Z])\s*\)")
PRIME_RE = re.compile(r"([a-zA-Z]\w*)\s*'")
FRACTION_DERIVATIVE_RE = re.compile(r"\bd([a-zA-Z]\w*)\s*/\s*d([a-zA-Z])\b")
HIGHER_ORDER_RE = re.compile(r"(?:''|\^\s*2|d\s*\^\s*2)")
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
        r"^\s*(?:merci\s+de|s'?il\s+te\s+plait)\s+",
        re.IGNORECASE,
    ),
    re.compile(
        r"^\s*(?:(?:me|moi)\s+)?(?:calculer|calculez|donner|donnez|donne(?:\s*-\s*moi|\s+moi)?|determiner|determinez|determine|trouver|trouvez|trouve|resoudre|resolvez|resous|solutionner)\s+",
        re.IGNORECASE,
    ),
)


class OdeAnalysisError(ValueError):
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


def _build_local_dict(
    variable_name: str,
    function_name: str,
    *,
    real: bool,
) -> tuple[dict[str, object], sp.Symbol, object]:
    local_dict = {**ALLOWED_NAMES, **_symbol_pool(real=real)}
    local_dict.pop(function_name, None)
    symbol = sp.Symbol(variable_name, real=real)
    function = sp.Function(function_name)
    local_dict[variable_name] = symbol
    local_dict[function_name] = function
    return local_dict, symbol, function


def _normalize_equation_candidate(text: str) -> str:
    candidate = _normalize_math_text(text).strip()
    if not candidate:
        return ""
    candidate = ODE_PREFIX_RE.sub("", candidate).strip()
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


def _infer_function_and_variable(candidate: str, hinted_variable: str | None) -> tuple[str, str]:
    fraction_match = FRACTION_DERIVATIVE_RE.search(candidate)
    if fraction_match:
        return fraction_match.group(1).strip(), fraction_match.group(2).strip()

    prime_call_match = PRIME_CALL_RE.search(candidate)
    if prime_call_match:
        return prime_call_match.group(1).strip(), prime_call_match.group(2).strip()

    function_call_match = FUNCTION_CALL_RE.search(candidate)
    if function_call_match:
        return function_call_match.group(1).strip(), function_call_match.group(2).strip()

    prime_match = PRIME_RE.search(candidate)
    if prime_match:
        return prime_match.group(1).strip(), str(hinted_variable or "x").strip() or "x"

    return "y", str(hinted_variable or "x").strip() or "x"


def _extract_ode_candidate(text: str) -> tuple[str, str, str]:
    raw = _normalize_math_text(text).strip()
    if not raw:
        raise OdeAnalysisError("Equation differentielle manquante.", code="missing_equation")

    variable_match = WITH_RESPECT_TO_RE.search(raw)
    hinted_variable = variable_match.group(1).strip() if variable_match else None

    for line in raw.splitlines():
        candidate_line = _normalize_equation_candidate(_strip_leading_request_phrases(line))
        if not candidate_line:
            continue
        if "=" in candidate_line:
            function_name, variable_name = _infer_function_and_variable(candidate_line, hinted_variable)
            return candidate_line, function_name, variable_name

    candidate = _normalize_equation_candidate(_strip_leading_request_phrases(raw))
    if candidate and "=" in candidate:
        function_name, variable_name = _infer_function_and_variable(candidate, hinted_variable)
        return candidate, function_name, variable_name

    raise OdeAnalysisError("Aucune equation differentielle exploitable n'a ete detectee.", code="missing_equation")


def _split_equation_members(candidate: str) -> tuple[str, str]:
    if candidate.count("=") != 1:
        raise OdeAnalysisError("L'equation differentielle doit contenir une seule egalite.", code="invalid_equation")
    left, right = [part.strip() for part in candidate.split("=", 1)]
    if not left or not right:
        raise OdeAnalysisError("L'equation differentielle est incomplete.", code="invalid_equation")
    return left, right


def _prepare_member(text: str, function_name: str, variable_name: str) -> str:
    member = _normalize_math_text(text).strip()
    escaped_function = re.escape(function_name)
    escaped_variable = re.escape(variable_name)

    member = re.sub(
        rf"\b{escaped_function}\s*'\s*\(\s*{escaped_variable}\s*\)",
        f"Derivative({function_name}({variable_name}), {variable_name})",
        member,
    )
    member = re.sub(
        rf"\bd{escaped_function}\s*/\s*d{escaped_variable}\b",
        f"Derivative({function_name}({variable_name}), {variable_name})",
        member,
    )
    member = re.sub(
        rf"\b{escaped_function}\s*'",
        f"Derivative({function_name}({variable_name}), {variable_name})",
        member,
    )
    member = re.sub(
        rf"\b{escaped_function}\s*\(\s*{escaped_variable}\s*\)",
        f"{function_name}({variable_name})",
        member,
    )
    member = re.sub(
        rf"\b{escaped_function}\b(?!\s*\()",
        f"{function_name}({variable_name})",
        member,
    )
    member = re.sub(r"(?<=\d)(?=[A-Za-z(])", "*", member)
    member = re.sub(r"(?<=[)\]])(?=[A-Za-z0-9(])", "*", member)
    member = re.sub(r"(?<=[A-Za-z])(?=\d)", "*", member)
    member = re.sub(r"\s+", " ", member).strip()
    return member


def _expr_label(expr: sp.Expr) -> str:
    return sp.latex(sp.simplify(expr))


def parse_ode_expression(
    expression: str,
    variable: str | None = None,
) -> tuple[sp.Equality, sp.Symbol, object, sp.Expr]:
    candidate, function_hint, variable_hint = _extract_ode_candidate(expression)
    if HIGHER_ORDER_RE.search(candidate):
        raise OdeAnalysisError(
            "La V1 du pipeline ne traite que les equations differentielles du premier ordre.",
            code="unsupported_order",
        )

    variable_name = str(variable or variable_hint or "x").strip() or "x"
    function_name = str(function_hint or "y").strip() or "y"
    if not re.fullmatch(r"[A-Za-z]", variable_name):
        raise OdeAnalysisError("Variable invalide pour l'analyse.", code="invalid_variable")
    if not re.fullmatch(r"[A-Za-z]\w*", function_name):
        raise OdeAnalysisError("Fonction inconnue invalide pour l'analyse.", code="invalid_function")

    local_dict, symbol, function = _build_local_dict(variable_name, function_name, real=True)
    left_text, right_text = _split_equation_members(candidate)
    prepared_left = _prepare_member(left_text, function_name, variable_name)
    prepared_right = _prepare_member(right_text, function_name, variable_name)

    try:
        left_expr = parse_expr(prepared_left, local_dict=local_dict, transformations=TRANSFORMATIONS, evaluate=True)
        right_expr = parse_expr(prepared_right, local_dict=local_dict, transformations=TRANSFORMATIONS, evaluate=True)
    except Exception as exc:
        raise OdeAnalysisError(
            "Impossible d'analyser l'equation differentielle fournie.",
            code="parse_failed",
        ) from exc

    if not isinstance(left_expr, sp.Expr) or not isinstance(right_expr, sp.Expr):
        raise OdeAnalysisError("Equation differentielle mathematique invalide.", code="invalid_equation")

    unknown = function(symbol)
    derivative = sp.Derivative(unknown, symbol)
    if not (left_expr.has(derivative) or right_expr.has(derivative)):
        raise OdeAnalysisError(
            "Aucune derivee du premier ordre n'a ete detectee dans l'equation.",
            code="missing_derivative",
        )

    equation = sp.Eq(sp.simplify(left_expr), sp.simplify(right_expr))
    return equation, symbol, function, unknown


def analyze_ode(expression: str, variable: str | None = None) -> dict:
    equation, symbol, function, unknown = parse_ode_expression(expression, variable)
    try:
        solution = sp.dsolve(equation, unknown)
    except NotImplementedError as exc:
        raise OdeAnalysisError(
            "Cette equation differentielle n'est pas encore prise en charge par le pipeline deterministe.",
            code="unsupported_ode",
        ) from exc
    except Exception as exc:
        raise OdeAnalysisError(
            "Impossible de resoudre cette equation differentielle de facon fiable.",
            code="solve_failed",
        ) from exc

    return {
        "ok": True,
        "pipeline": "deterministic-ode",
        "equationInput": str(expression or "").strip(),
        "variable": str(symbol),
        "functionLatex": sp.latex(unknown),
        "equationLatex": sp.latex(equation),
        "solutionLatex": sp.latex(solution),
        "equationOrder": 1,
        "hasExactSolution": True,
        "method": "sympy-dsolve",
    }

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
    "arcsin": sp.asin,
    "arccos": sp.acos,
    "arctan": sp.atan,
    "exp": sp.exp,
    "log": sp.log,
    "ln": sp.log,
    "sqrt": sp.sqrt,
    "abs": sp.Abs,
    "pi": sp.pi,
    "e": sp.E,
    "i": sp.I,
    "I": sp.I,
    "oo": sp.oo,
}
VARIABLE_TOKEN_RE = re.compile(r"\b([A-Za-z]+(?:\d+)?)\b")
FUNCTION_CALL_RE = re.compile(r"\b([A-Za-z]+(?:\d+)?)\s*\(")
REQUEST_RE = re.compile(r"\bresoud(?:re|ez|s)?\b|\bsysteme\b", re.IGNORECASE)
REQUEST_PREFIX_RE = re.compile(
    r"^\s*(?:resoud(?:re|ez|s)?\s+)?(?:(?:le|la|un|une)\s+)?(?:systeme)\s*(?::)?\s*",
    re.IGNORECASE,
)
LATEX_ENV_RE = re.compile(r"\\+begin\{(?:aligned|cases|array)\}|\\+end\{(?:aligned|cases|array)\}", re.IGNORECASE)
LATEX_WRAPPER_PATTERNS = (
    (re.compile(r"\\+mathrm\{([^{}]*)\}", re.IGNORECASE), lambda m: "".join(str(m.group(1) or "").split())),
    (re.compile(r"\\+text\{([^{}]*)\}", re.IGNORECASE), lambda m: " ".join(str(m.group(1) or "").split())),
    (re.compile(r"\\+operatorname\{([^{}]*)\}", re.IGNORECASE), lambda m: "".join(str(m.group(1) or "").split())),
    (re.compile(r"\\+mathbf\{([^{}]*)\}", re.IGNORECASE), lambda m: str(m.group(1) or "")),
)


class SystemAnalysisError(ValueError):
    def __init__(self, message: str, *, code: str = "analysis_failed"):
        super().__init__(message)
        self.code = str(code or "analysis_failed")


def _prepare_system_source(text: str) -> str:
    source = str(text or "")
    for pattern, replacer in LATEX_WRAPPER_PATTERNS:
        previous = None
        while previous != source:
            previous = source
            source = pattern.sub(replacer, source)

    source = re.sub(
        r"\\+frac\s*\{([^{}]+)\}\s*\{([^{}]+)\}",
        lambda m: f"({str(m.group(1) or '').strip()})/({str(m.group(2) or '').strip()})",
        source,
        flags=re.IGNORECASE,
    )
    source = re.sub(r"_\{\s*([A-Za-z0-9]+)\s*\}", r"\1", source)
    source = re.sub(r"_([A-Za-z0-9]+)", r"\1", source)
    source = re.sub(r"\\+left\b", "", source, flags=re.IGNORECASE)
    source = re.sub(r"\\+right\b", "", source, flags=re.IGNORECASE)
    source = LATEX_ENV_RE.sub("\n", source)
    source = (
        source
        .replace("\u2212", "-")
        .replace("\u2013", "-")
        .replace("\u2014", "-")
        .replace("\u00d7", "*")
        .replace("\u00f7", "/")
        .replace("\u00b7", "*")
        .replace("\u03c0", "pi")
        .replace("\u221e", "oo")
        .replace("\u2019", "'")
        .replace("âˆ«", "\\int")
        .replace("âˆ’", "-")
        .replace("$$", "\n")
        .replace("&", " ")
    )
    source = re.sub(r"\\{2,}", "\n", source)
    source = re.sub(r"(?:(?<=^)|(?<=\s)|(?<=[=+\-*/(]))\\+([A-Za-z](?:\d+)?)", r"\1", source)
    source = source.replace("{", " ").replace("}", " ")
    return source


def _normalize_math_text(text: str) -> str:
    source = _prepare_system_source(text)
    normalized = "".join(
        ch for ch in unicodedata.normalize("NFD", source)
        if unicodedata.category(ch) != "Mn"
    )
    normalized = re.sub(r"[{}]", " ", normalized)
    normalized = re.sub(r"\s+", " ", normalized)
    return normalized.strip()


def _split_candidate_lines(text: str) -> list[str]:
    source = _prepare_system_source(text)
    interim = source.replace(";", "\n")
    return [part.strip() for part in re.split(r"[\r\n]+", interim) if part.strip()]


def _normalize_equation_line(text: str) -> str:
    candidate = _normalize_math_text(text)
    candidate = re.sub(r"^(?:image|transcription ocr des images jointes)\s*:\s*", "", candidate, flags=re.IGNORECASE)
    candidate = re.sub(r"^(?:problem|probleme|piece jointe)\s*:\s*", "", candidate, flags=re.IGNORECASE)
    candidate = REQUEST_PREFIX_RE.sub("", candidate)
    candidate = re.sub(r"^\s*(?:resoudre|resolvez|resous|systeme)\s*", "", candidate, flags=re.IGNORECASE)
    candidate = re.sub(r"\b(?:left|right|begin|end|aligned|cases|array|mathbf|mathrm|text|operatorname)\b", " ", candidate, flags=re.IGNORECASE)
    candidate = candidate.strip(" .,:;")
    candidate = re.sub(r"\s*=\s*", " = ", candidate)
    candidate = re.sub(r"(?<=\d)(?=[A-Za-z(])", "*", candidate)
    candidate = re.sub(r"(?<=[)\]])(?=[A-Za-z0-9(])", "*", candidate)
    candidate = re.sub(r"\s+", " ", candidate).strip()
    return candidate


def _extract_system_equations(text: str) -> list[str]:
    raw = str(text or "").strip()
    if not raw:
        raise SystemAnalysisError("Systeme manquant.", code="missing_system")

    equations: list[str] = []
    for line in _split_candidate_lines(raw):
        candidate = _normalize_equation_line(line)
        if candidate.count("=") != 1:
            continue
        left, right = [part.strip() for part in candidate.split("=", 1)]
        if not left or not right:
            continue
        equations.append(f"{left} = {right}")

    if len(equations) < 2:
        compact = _normalize_equation_line(raw)
        chunks = [part.strip() for part in re.split(r"\s+(?=[^=]+=[^=]+)", compact) if part.strip()]
        for chunk in chunks:
            if chunk.count("=") == 1:
                equations.append(chunk)

    deduped: list[str] = []
    for equation in equations:
        if equation not in deduped:
            deduped.append(equation)

    if len(deduped) < 2:
        raise SystemAnalysisError("Aucun systeme exploitable n'a ete detecte.", code="missing_system")
    if len(deduped) != 2:
        raise SystemAnalysisError("Ce pipeline traite uniquement les systemes 2x2.", code="unsupported_system")
    return deduped


def _extract_variable_names(equations: list[str]) -> list[str]:
    reserved = {name.lower() for name in ALLOWED_NAMES}
    reserved.update({
        "resoudre", "systeme", "probleme", "image", "transcription", "ocr",
        "le", "la", "les", "un", "une", "de", "du", "des", "et", "ou",
        "left", "right", "begin", "end", "aligned", "cases", "array",
        "mathbf", "mathrm", "text", "operatorname",
    })
    names: list[str] = []
    for equation in equations:
        function_names = {str(match.group(1) or "").lower() for match in FUNCTION_CALL_RE.finditer(equation)}
        for match in VARIABLE_TOKEN_RE.finditer(equation):
            name = str(match.group(1) or "").strip()
            lowered = name.lower()
            if not name or lowered in reserved or lowered in function_names:
                continue
            if name not in names:
                names.append(name)
    if len(names) != 2:
        raise SystemAnalysisError(
            "Impossible de determiner de facon sure les deux inconnues du systeme.",
            code="ambiguous_variable",
        )
    return names


def _build_local_dict(variable_names: list[str]) -> tuple[dict[str, object], list[sp.Symbol]]:
    local_dict = dict(ALLOWED_NAMES)
    symbols: list[sp.Symbol] = []
    for name in variable_names:
        symbol = sp.Symbol(name)
        local_dict[name] = symbol
        symbols.append(symbol)
    return local_dict, symbols


def _parse_equations(equations: list[str], variable_names: list[str]) -> tuple[list[sp.Eq], list[sp.Symbol]]:
    local_dict, symbols = _build_local_dict(variable_names)
    parsed: list[sp.Eq] = []
    for equation in equations:
        left_text, right_text = [part.strip() for part in equation.split("=", 1)]
        try:
            left = parse_expr(left_text, local_dict=local_dict, transformations=TRANSFORMATIONS, evaluate=True)
            right = parse_expr(right_text, local_dict=local_dict, transformations=TRANSFORMATIONS, evaluate=True)
        except Exception as exc:
            raise SystemAnalysisError("Impossible d'analyser l'une des equations du systeme.", code="parse_failed") from exc
        if not isinstance(left, sp.Expr) or not isinstance(right, sp.Expr):
            raise SystemAnalysisError("Systeme mathematique invalide.", code="invalid_system")
        parsed.append(sp.Eq(sp.simplify(left), sp.simplify(right)))
    return parsed, symbols


def _build_system_latex(equations: list[sp.Eq]) -> str:
    body = r" \\ ".join(sp.latex(eq) for eq in equations)
    return rf"\left\{{\begin{{aligned}} {body} \end{{aligned}}\right."


def _normalize_solution_dict(solution: dict[sp.Symbol, sp.Expr], symbols: list[sp.Symbol]) -> dict[sp.Symbol, sp.Expr]:
    normalized: dict[sp.Symbol, sp.Expr] = {}
    for symbol in symbols:
        if symbol not in solution:
            raise SystemAnalysisError("La solution du systeme est incomplete.", code="unsupported_system")
        normalized[symbol] = sp.simplify(solution[symbol])
    return normalized


def _build_solution_payload(
    expression: str,
    equations: list[sp.Eq],
    symbols: list[sp.Symbol],
    solution: dict[sp.Symbol, sp.Expr],
    *,
    exact: bool,
    used_sympy_fallback: bool = False,
) -> dict:
    normalized_solution = _normalize_solution_dict(solution, symbols)
    solution_rows = [
        {
            "variable": str(symbol),
            "variableLatex": sp.latex(symbol),
            "valueLatex": sp.latex(normalized_solution[symbol]),
        }
        for symbol in symbols
    ]
    payload = {
        "ok": True,
        "pipeline": "deterministic-system",
        "systemInput": str(expression or "").strip(),
        "systemLatex": _build_system_latex(equations),
        "solutionRows": solution_rows,
        "hasExactSolution": bool(exact),
        "solutionType": "unique",
    }
    if used_sympy_fallback:
        payload["usedSympyFallback"] = True
        payload["sympyFallbackStrategy"] = "controlled-system-fallback"
    return payload


def _build_none_solution_payload(expression: str, equations: list[sp.Eq]) -> dict:
    return {
        "ok": True,
        "pipeline": "deterministic-system",
        "systemInput": str(expression or "").strip(),
        "systemLatex": _build_system_latex(equations),
        "solutionRows": [],
        "hasExactSolution": True,
        "solutionType": "none",
    }


def _solve_linear_system_direct(equations: list[sp.Eq], symbols: list[sp.Symbol]) -> dict | None:
    try:
        matrix, vector = sp.linear_eq_to_matrix(equations, symbols)
    except Exception:
        return None

    if matrix.shape != (2, 2):
        return None

    try:
        solutions = list(sp.linsolve((matrix, vector), symbols))
    except Exception:
        return None

    if not solutions:
        return {}
    if len(solutions) != 1:
        return None

    values = solutions[0]
    if len(values) != len(symbols):
        return None
    return {symbol: sp.simplify(value) for symbol, value in zip(symbols, values)}


def _build_system_fallback_code() -> str:
    return (
        "local_dict = fallback_local_dict_input.copy()\n"
        "symbols = [sp.Symbol(name) for name in variable_names_input]\n"
        "for symbol in symbols:\n"
        "    local_dict[str(symbol)] = symbol\n"
        "equations = []\n"
        "for equation_text in equation_texts_input:\n"
        "    left_text, right_text = [part.strip() for part in equation_text.split('=', 1)]\n"
        "    left = parse_expr(left_text, local_dict=local_dict, transformations=transformations_input, evaluate=True)\n"
        "    right = parse_expr(right_text, local_dict=local_dict, transformations=transformations_input, evaluate=True)\n"
        "    equations.append(sp.Eq(sp.simplify(left), sp.simplify(right)))\n"
        "fallback_solutions = sp.solve(equations, symbols, dict=True)\n"
    )


def _try_controlled_sympy_system_fallback(equation_texts: list[str], variable_names: list[str]) -> dict | None:
    namespace = {
        "sp": sp,
        "parse_expr": parse_expr,
        "equation_texts_input": list(equation_texts),
        "variable_names_input": list(variable_names),
        "fallback_local_dict_input": dict(ALLOWED_NAMES),
        "transformations_input": TRANSFORMATIONS,
    }
    try:
        result = execute_controlled_sympy(_build_system_fallback_code(), namespace)
    except ControlledSympyFallbackError:
        return None

    fallback_solutions = result.get("fallback_solutions")
    if isinstance(fallback_solutions, dict):
        fallback_solutions = [fallback_solutions]
    if not isinstance(fallback_solutions, list) or len(fallback_solutions) != 1:
        return None

    solution = fallback_solutions[0]
    if not isinstance(solution, dict):
        return None

    local_dict, symbols = _build_local_dict(variable_names)
    _ = local_dict
    try:
        return _normalize_solution_dict(solution, symbols)
    except SystemAnalysisError:
        return None


def analyze_system(expression: str) -> dict:
    equation_texts = _extract_system_equations(expression)
    variable_names = _extract_variable_names(equation_texts)
    equations, symbols = _parse_equations(equation_texts, variable_names)

    direct_solution = _solve_linear_system_direct(equations, symbols)
    if direct_solution == {}:
        return _build_none_solution_payload(expression, equations)
    if direct_solution:
        return _build_solution_payload(expression, equations, symbols, direct_solution, exact=True)

    fallback_solution = _try_controlled_sympy_system_fallback(equation_texts, variable_names)
    if fallback_solution:
        return _build_solution_payload(
            expression,
            equations,
            symbols,
            fallback_solution,
            exact=False,
            used_sympy_fallback=True,
        )

    raise SystemAnalysisError(
        "La resolution locale de ce systeme reste indeterminee.",
        code="unsupported_system",
    )

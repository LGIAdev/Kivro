from __future__ import annotations

from typing import Any


class ControlledSympyFallbackError(RuntimeError):
    def __init__(self, message: str, *, code: str = "fallback_failed"):
        super().__init__(message)
        self.code = str(code or "fallback_failed")


def execute_controlled_sympy(code: str, namespace: dict[str, Any] | None = None) -> dict[str, Any]:
    source = str(code or "").strip()
    if not source:
        raise ControlledSympyFallbackError("Fallback SymPy vide.", code="empty_fallback")

    globals_dict: dict[str, Any] = {"__builtins__": {}, "Exception": Exception}
    locals_dict: dict[str, Any] = dict(namespace or {})

    try:
        compiled = compile(source, "<kivrio-sympy-fallback>", "exec")
        exec(compiled, globals_dict, locals_dict)
    except Exception as exc:  # pragma: no cover - depends on runtime specifics
        raise ControlledSympyFallbackError(
            "Execution du fallback SymPy impossible.",
            code="fallback_execution_failed",
        ) from exc

    return locals_dict

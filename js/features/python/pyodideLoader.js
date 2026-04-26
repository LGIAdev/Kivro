const PYODIDE_BASE_PATH = '/assets/pyodide/';
const REQUIRED_PACKAGES = [
  'micropip',
  'numpy',
  'scipy',
  'sympy',
  'matplotlib',
];
const OPTIONAL_LOCAL_WHEELS = {
  seaborn: 'seaborn-0.13.2-py3-none-any.whl',
};
const PLOT_CONTEXT_MARKER = '__KIVRIO_PLOT_CONTEXT__=';

const PYTHON_RUNNER = `
import base64
import io
import json
import traceback
from contextlib import redirect_stderr, redirect_stdout

stdout_io = io.StringIO()
stderr_io = io.StringIO()
images = []
error = ""
status = "ok"
namespace = {"__name__": "__main__"}

try:
    try:
        import matplotlib
        matplotlib.use("AGG")
    except Exception:
        pass

    with redirect_stdout(stdout_io), redirect_stderr(stderr_io):
        exec(__kivrio_user_code, namespace, namespace)

    try:
        import matplotlib.pyplot as plt

        for figure_number in list(plt.get_fignums()):
            figure = plt.figure(figure_number)
            buffer = io.BytesIO()
            figure.savefig(buffer, format="png", bbox_inches="tight")
            buffer.seek(0)
            images.append({
                "type": "image/png",
                "dataUrl": "data:image/png;base64," + base64.b64encode(buffer.read()).decode("ascii"),
            })

        if plt.get_fignums():
            plt.close("all")
    except Exception as plot_error:
        stderr_io.write("\\n[matplotlib] " + str(plot_error).strip() + "\\n")
except Exception:
    status = "error"
    error = traceback.format_exc()

json.dumps({
    "status": status,
    "stdout": stdout_io.getvalue().strip(),
    "stderr": stderr_io.getvalue().strip(),
    "error": error.strip(),
    "images": images,
})
`;

let pyodideReadyPromise = null;
const executionCache = new Map();

function assetsBaseUrl() {
  return new URL(PYODIDE_BASE_PATH, window.location.href).href;
}

async function ensurePackages(pyodide) {
  if (pyodide.__kivrioPackagesLoaded) return;
  await pyodide.loadPackage(REQUIRED_PACKAGES);
  pyodide.__kivrioPackagesLoaded = true;
}

function codeImportsPackage(code, packageName) {
  const source = String(code || '');
  const pattern = new RegExp(`\\b(?:from\\s+${packageName}\\b|import\\s+${packageName}\\b)`, 'm');
  return pattern.test(source);
}

async function ensureOptionalPackage(pyodide, packageName) {
  const loaded = pyodide.__kivrioOptionalPackagesLoaded || (pyodide.__kivrioOptionalPackagesLoaded = new Set());
  if (loaded.has(packageName)) return;
  await pyodide.loadPackage([packageName]);
  loaded.add(packageName);
}

async function installLocalWheel(pyodide, packageName, wheelName) {
  const loaded = pyodide.__kivrioLocalWheelsLoaded || (pyodide.__kivrioLocalWheelsLoaded = new Set());
  if (loaded.has(packageName)) return;
  pyodide.globals.set('__kivrio_wheel_url', new URL(wheelName, assetsBaseUrl()).href);
  try {
    await pyodide.runPythonAsync(`
import micropip
await micropip.install(__kivrio_wheel_url)
`);
    loaded.add(packageName);
  } finally {
    pyodide.globals.delete('__kivrio_wheel_url');
  }
}

async function ensurePackagesForCode(pyodide, code) {
  await ensurePackages(pyodide);

  const needsSeaborn = codeImportsPackage(code, 'seaborn');
  const needsPandas = needsSeaborn || codeImportsPackage(code, 'pandas');

  if (needsPandas) {
    await ensureOptionalPackage(pyodide, 'pandas');
  }

  if (needsSeaborn) {
    await installLocalWheel(pyodide, 'seaborn', OPTIONAL_LOCAL_WHEELS.seaborn);
  }
}

function normalizeResult(payload) {
  const result = payload && typeof payload === 'object' ? payload : {};
  const extractPlotContexts = (value) => {
    const contexts = [];
    const lines = String(value || '').split(/\r?\n/);
    const kept = [];

    for (const rawLine of lines) {
      const line = String(rawLine || '');
      const trimmed = line.trim();
      if (!trimmed) {
        kept.push(line);
        continue;
      }

      const markerIndex = trimmed.indexOf(PLOT_CONTEXT_MARKER);
      if (markerIndex < 0) {
        kept.push(line);
        continue;
      }

      const payloadText = trimmed.slice(markerIndex + PLOT_CONTEXT_MARKER.length).trim();
      if (!payloadText) continue;

      try {
        const parsed = JSON.parse(payloadText);
        if (parsed && typeof parsed === 'object') contexts.push(parsed);
      } catch (_) {}
    }

    return {
      text: kept.join('\n').trim(),
      contexts,
    };
  };

  const stdoutPayload = extractPlotContexts(result.stdout);
  const stderrPayload = extractPlotContexts(result.stderr);
  const stderr = stderrPayload.text
    .split(/\r?\n/)
    .filter((line) => !/FigureCanvasAgg is non-interactive, and thus cannot be shown/i.test(line))
    .join('\n')
    .trim();

  return {
    status: result.status === 'error' ? 'error' : 'ok',
    stdout: stdoutPayload.text,
    stderr,
    error: String(result.error || '').trim(),
    images: Array.isArray(result.images) ? result.images.filter(Boolean) : [],
    plotContexts: [...stdoutPayload.contexts, ...stderrPayload.contexts],
  };
}

async function executePython(code) {
  const pyodide = await ensurePyodide();
  await ensurePackagesForCode(pyodide, code);
  pyodide.globals.set('__kivrio_user_code', String(code || ''));
  try {
    const raw = await pyodide.runPythonAsync(PYTHON_RUNNER);
    return normalizeResult(JSON.parse(String(raw || '{}')));
  } finally {
    pyodide.globals.delete('__kivrio_user_code');
  }
}

export function ensurePyodide() {
  if (!pyodideReadyPromise) {
    pyodideReadyPromise = (async () => {
      if (!window.loadPyodide) {
        await new Promise((resolve, reject) => {
          const script = document.createElement('script');
          script.src = new URL('pyodide.js', assetsBaseUrl()).href;
          script.onload = resolve;
          script.onerror = () => reject(new Error('Echec du chargement de pyodide.js'));
          document.head.appendChild(script);
        });
      }

      const pyodide = await window.loadPyodide({ indexURL: assetsBaseUrl() });
      await ensurePackages(pyodide);
      return pyodide;
    })().catch((error) => {
      pyodideReadyPromise = null;
      throw error;
    });
  }

  return pyodideReadyPromise;
}

export function clearPythonExecutionCache() {
  executionCache.clear();
}

export async function runPython(code, options = {}) {
  const source = String(code || '').trim();
  if (!source) {
    return {
      status: 'ok',
      stdout: '',
      stderr: '',
      error: '',
      images: [],
      plotContexts: [],
    };
  }

  if (options.useCache !== false && executionCache.has(source)) {
    return executionCache.get(source);
  }

  const promise = executePython(source).catch((error) => ({
    status: 'error',
    stdout: '',
    stderr: '',
    error: error?.message || String(error || 'Execution Pyodide impossible'),
    images: [],
    plotContexts: [],
  }));

  if (options.useCache !== false) executionCache.set(source, promise);

  const result = await promise;
  if (options.useCache === false) return result;
  executionCache.set(source, Promise.resolve(result));
  return result;
}

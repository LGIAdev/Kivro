// Charge Pyodide depuis /assets/pyodide et expose runPython(code)
let pyodideReadyPromise = null;

export function ensurePyodide() {
  if (!pyodideReadyPromise) {
    pyodideReadyPromise = new Promise(async (resolve, reject) => {
      try {
        // charge le script pyodide.js si absent
        if (!window.loadPyodide) {
          await new Promise((res, rej) => {
            const s = document.createElement('script');
            s.src = '/assets/pyodide/pyodide.js';
            s.onload = () => res();
            s.onerror = (e) => rej(new Error('Échec chargement pyodide.js'));
            document.head.appendChild(s);
          });
        }

        // Initialisation du runtime Pyodide (core)
        const pyodide = await loadPyodide({ indexURL: '/assets/pyodide/' });

        // Charger micropip (inclus dans pyodide-core, local)
        await pyodide.loadPackage("micropip");
        const micropip = pyodide.pyimport("micropip");

        // Installer les bibliothèques scientifiques depuis le serveur local
        await micropip.install("http://127.0.0.1:8000/assets/pyodide/numpy-2.2.5-cp313-cp313-pyodide_2025_0_wasm32.whl");
        await micropip.install("http://127.0.0.1:8000/assets/pyodide/scipy-1.14.1-cp313-cp313-pyodide_2025_0_wasm32.whl");
        await micropip.install("http://127.0.0.1:8000/assets/pyodide/matplotlib-3.8.4-cp313-cp313-pyodide_2025_0_wasm32.whl");
        await micropip.install("http://127.0.0.1:8000/assets/pyodide/sympy-1.13.3-py3-none-any.whl");

        resolve(pyodide);
      } catch (err) {
        reject(err);
      }
    });
  }
  return pyodideReadyPromise;
}

// Exécute du Python et retourne {stdout, stderr}
export async function runPython(code) {
  const pyodide = await ensurePyodide();
  let stdout = '', stderr = '';
  const origStdout = pyodide._module.print;
  const origStderr = pyodide._module.printErr;
  try {
    pyodide._module.print = (txt) => { stdout += (txt ?? '') + '\n'; };
    pyodide._module.printErr = (txt) => { stderr += (txt ?? '') + '\n'; };
    await pyodide.runPythonAsync(code);
    return { stdout: stdout.trim(), stderr: stderr.trim() };
  } finally {
    pyodide._module.print = origStdout;
    pyodide._module.printErr = origStderr;
  }
}

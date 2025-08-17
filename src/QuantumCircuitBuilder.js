import React, { useMemo, useRef, useState, useEffect } from "react";
import { ServerConnection, SessionManager } from "@jupyterlab/services";


/**
 * @typedef {Object} Gate
 * @property {string} id - unique id
 * @property {"H"|"X"|"Y"|"Z"|"S"|"T"|"RX"|"RY"|"RZ"|"CNOT"|"CZ"|"SWAP"|"MEASURE"} type
 * @property {number} column - time step (0..numColumns-1)
 * @property {number} target - target qubit index (0..numQubits-1)
 * @property {number=} control - control qubit index (two-qubit gates)
 * @property {number=} pair - partner qubit for SWAP
 * @property {number=} angle - radians for rotation gates (RX/RY/RZ)
 */

const GATE_PALETTE = [
  { type: "H", label: "H" },
  { type: "X", label: "X" },
  { type: "Y", label: "Y" },
  { type: "Z", label: "Z" },
  { type: "S", label: "S" },
  { type: "T", label: "T" },
  { type: "RX", label: "RX(θ)" },
  { type: "RY", label: "RY(θ)" },
  { type: "RZ", label: "RZ(θ)" },
  { type: "CNOT", label: "CNOT" },
  { type: "CZ", label: "CZ" },
  { type: "SWAP", label: "SWAP" },
  { type: "MEASURE", label: "Measure" },
];

function uid(prefix = "g") {
  return `${prefix}_${Math.random().toString(36).slice(2, 9)}`;
}

// ------------------------------ Helper UI ------------------------------

function Pill({ children }) {
  return (
    <div className="rounded-2xl border border-slate-600 px-3 py-1 text-sm font-medium shadow-sm bg-slate-800/60">
      {children}
    </div>
  );
}

function Button({ children, className = "", ...props }) {
  return (
    <button
      className={
        "rounded-2xl px-4 py-2 font-medium shadow-sm border border-slate-600 bg-slate-800 hover:bg-slate-700 active:scale-[.99] " +
        className
      }
      {...props}
    >
      {children}
    </button>
  );
}

// ------------------------------ In-App Python Notebook (Pyodide) ------------------------------
// Lightweight single-cell notebook that runs Python *in the browser* using Pyodide.
// NOTE: Heavy packages like qiskit/qiskit-aer are not available in Pyodide.

function usePyodide() {
  const [state, setState] = useState({ loading: true, api: null, error: null });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        if (!window.loadPyodide) {
          await new Promise((resolve, reject) => {
            const s = document.createElement("script");
            s.src = "https://cdn.jsdelivr.net/pyodide/v0.25.1/full/pyodide.js";
            s.onload = resolve;
            s.onerror = reject;
            document.body.appendChild(s);
          });
        }
        const pyodide = await window.loadPyodide({
          stdin: () => null,
          stderr: (t) => console.error(t),
          stdout: (t) => console.log(t),
        });
        if (!cancelled) setState({ loading: false, api: pyodide, error: null });
      } catch (e) {
        if (!cancelled) setState({ loading: false, api: null, error: String(e) });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return state; // {loading, api, error}
}

function InAppNotebook({ code, onClose }) {
  const [cell, setCell] = useState(
    code ||
      `# Paste/generated Python here
print('Hello from Pyodide')
`
  );
  const [output, setOutput] = useState("");
  const [running, setRunning] = useState(false);
  const { loading, api, error } = usePyodide();

  async function run() {
    if (!api) return;
    setRunning(true);
    setOutput("");
    try {
      await api.runPythonAsync(
        `
import sys
class _Cap:
    def __init__(self):
        self.buf = []
    def write(self, s):
        self.buf.append(s)
    def flush(self):
        pass
_stdout, _stderr = sys.stdout, sys.stderr
sys.stdout = _Cap()
sys.stderr = _Cap()
`.trim()
      );
      await api.runPythonAsync(cell);
      const out = await api.runPythonAsync("''.join(sys.stdout.buf)");
      const err = await api.runPythonAsync("''.join(sys.stderr.buf)");
      setOutput((out || "") + (err ? "\n[stderr]\n" + err : ""));
      await api.runPythonAsync("sys.stdout = _stdout; sys.stderr = _stderr");
    } catch (e) {
      setOutput((prev) => prev + "\n[ERR] " + String(e));
    } finally {
      setRunning(false);
    }
  }

  const qiskitDetected = /\b(qiskit|AerSimulator)\b/.test(cell);

  return (
    <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-2 sm:p-6">
      <div className="w-full max-w-5xl rounded-3xl border border-slate-700 bg-slate-900 p-3 sm:p-4 shadow-2xl">
        <div className="flex items-center gap-2 mb-3">
          <h3 className="text-lg font-semibold">In-App Python Notebook (Pyodide)</h3>
          <div className="ml-auto flex items-center gap-2">
            <Button onClick={() => navigator.clipboard.writeText(cell)}>Copy Cell</Button>
            <Button onClick={run} disabled={loading || running || !!error}>
              {running ? "Running…" : "Run Cell"}
            </Button>
            <Button onClick={onClose}>Close</Button>
          </div>
        </div>

        {loading && (
          <div className="text-sm opacity-80 mb-2">Loading Python runtime in your browser…</div>
        )}
        {error && (
          <div className="text-sm text-red-400 mb-2">Failed to load Pyodide: {String(error)}</div>
        )}
        {qiskitDetected && (
          <div className="text-xs mb-2 p-2 rounded-xl border border-amber-600 bg-amber-900/30">
            Heads up: Qiskit/Aer won’t run in this in-browser runtime. Use the Jupyter Kernel run
            for full simulation.
          </div>
        )}

        <textarea
          className="w-full h-56 sm:h-64 rounded-xl bg-slate-950 border border-slate-700 p-3 font-mono text-xs"
          value={cell}
          onChange={(e) => setCell(e.target.value)}
        />
        <div className="mt-3">
          <div className="text-sm font-semibold mb-1">Output</div>
          <pre className="w-full min-h-[120px] rounded-xl bg-slate-950 border border-slate-700 p-3 font-mono text-xs whitespace-pre-wrap">
            {output || "(no output)"}
          </pre>
        </div>
      </div>
    </div>
  );
}

// ------------------------------ Jupyter Settings Modal ------------------------------

function JupyterSettingsModal({ baseUrl, token, onSave, onClose }) {
  const [b, setB] = useState(baseUrl);
  const [t, setT] = useState(token);
  return (
    <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-2 sm:p-6">
      <div className="w-full max-w-lg rounded-3xl border border-slate-700 bg-slate-900 p-4 shadow-2xl">
        <div className="flex items-center mb-3">
          <h3 className="text-lg font-semibold">Jupyter Settings</h3>
          <div className="ml-auto">
            <Button onClick={onClose}>Close</Button>
          </div>
        </div>
        <div className="space-y-3">
          <label className="block text-sm">
            Base URL
            <input
              className="mt-1 w-full rounded-xl bg-slate-800 border border-slate-600 px-3 py-2"
              value={b}
              onChange={(e) => setB(e.target.value)}
              placeholder="http://localhost:8888"
            />
          </label>
          <label className="block text-sm">
            Token (leave blank if proxied)
            <input
              className="mt-1 w-full rounded-xl bg-slate-800 border border-slate-600 px-3 py-2"
              value={t}
              onChange={(e) => setT(e.target.value)}
              placeholder="paste token"
            />
          </label>
          <div className="flex gap-2 justify-end">
            <Button onClick={() => onSave(b, t)}>Save</Button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ------------------------------ Main Component ------------------------------

export default function QuantumCircuitBuilder() {
  const [numQubits, setNumQubits] = useState(3);
  const [numColumns, setNumColumns] = useState(12);
  /** @type {[Gate[], Function]} */
  const [gates, setGates] = useState([]);
  const [python, setPython] = useState("");
  const gridRef = useRef(null);

  // In-app notebook modal
  const [showNotebook, setShowNotebook] = useState(false);
  const [notebookCode, setNotebookCode] = useState("");

  // Jupyter kernel session (persist across runs)
  const jupyterSessionRef = useRef(null);
  const [jupyterOut, setJupyterOut] = useState("");
  const [jupyterBusy, setJupyterBusy] = useState(false);
  const [showJupyterSettings, setShowJupyterSettings] = useState(false);
  const [jupyterBaseUrl, setJupyterBaseUrl] = useState(
    localStorage.getItem("jupyterBaseUrl") || "http://localhost:8888"
  );
  const [jupyterToken, setJupyterToken] = useState(localStorage.getItem("jupyterToken") || "");

  // Quick lookup: map column->row occupancy
  const occupancy = useMemo(() => {
    /** @type {Record<string, Gate>} */
    const map = {};
    for (const g of gates) {
      map[`${g.column}:${g.target}`] = g;
      if (g.type === "CNOT" || g.type === "CZ") {
        if (typeof g.control === "number") {
          map[`${g.column}:${g.control}`] = g;
        }
      }
      if (g.type === "SWAP" && typeof g.pair === "number") {
        map[`${g.column}:${g.pair}`] = g;
      }
    }
    return map;
  }, [gates]);

  function clearAll() {
    setGates([]);
    setPython("");
    setNotebookCode("");
  }

  function undo() {
    setGates((prev) => prev.slice(0, -1));
  }

  function onDragStart(e, type) {
    e.dataTransfer.setData("text/plain", type);
  }

  function onDragOverCell(e) {
    e.preventDefault();
  }

  function cellHasGate(row, col) {
    return Boolean(occupancy[`${col}:${row}`]);
  }

  function placeGate(newGate) {
    // Prevent collisions on occupied cells (including multi-qubit endpoints)
    if (cellHasGate(newGate.target, newGate.column)) {
      alert("Cell already occupied.");
      return false;
    }
    if (newGate.type === "CNOT" || newGate.type === "CZ") {
      if (typeof newGate.control !== "number") return false;
      if (cellHasGate(newGate.control, newGate.column)) {
        alert("Control/target cell already occupied.");
        return false;
      }
    }
    if (newGate.type === "SWAP") {
      if (typeof newGate.pair !== "number") return false;
      if (cellHasGate(newGate.pair, newGate.column)) {
        alert("Swap partner cell already occupied.");
        return false;
      }
    }

    setGates((prev) => [...prev, newGate]);
    return true;
  }

  function handleDrop(e, row, col) {
    e.preventDefault();
    const type = e.dataTransfer.getData("text/plain");
    if (!type) return;

    // Single-qubit gates
    if (["H", "X", "Y", "Z", "S", "T", "MEASURE"].includes(type)) {
      placeGate({ id: uid(type), type, column: col, target: row });
      return;
    }

    if (["RX", "RY", "RZ"].includes(type)) {
      const input = window.prompt("Angle θ in radians (e.g., 3.1416)", "3.1416");
      if (input === null) return; // cancelled
      const angle = Number(input);
      if (!Number.isFinite(angle)) {
        alert("Invalid angle.");
        return;
      }
      placeGate({ id: uid(type), type, column: col, target: row, angle });
      return;
    }

    // Two-qubit gates
    if (type === "CNOT" || type === "CZ") {
      let control = window.prompt(
        `Choose control qubit (0..${numQubits - 1}, not ${row})`,
        String(Math.max(0, Math.min(numQubits - 1, row - 1)))
      );
      if (control === null) return; // cancelled
      const ctrl = Number(control);
      if (!Number.isInteger(ctrl) || ctrl < 0 || ctrl >= numQubits || ctrl === row) {
        alert("Invalid control qubit.");
        return;
      }
      placeGate({ id: uid(type), type, column: col, target: row, control: ctrl });
      return;
    }

    if (type === "SWAP") {
      let pair = window.prompt(
        `Choose partner qubit for SWAP (0..${numQubits - 1}, not ${row})`,
        String((row + 1) % numQubits)
      );
      if (pair === null) return; // cancelled
      const pr = Number(pair);
      if (!Number.isInteger(pr) || pr < 0 || pr >= numQubits || pr === row) {
        alert("Invalid partner qubit.");
        return;
      }
      placeGate({ id: uid(type), type, column: col, target: row, pair: pr });
      return;
    }
  }

  function removeGateAt(row, col) {
    setGates((prev) =>
      prev.filter((g) => {
        if (g.column !== col) return true;
        if (g.target === row) return false;
        if ((g.type === "CNOT" || g.type === "CZ") && g.control === row) return false;
        if (g.type === "SWAP" && g.pair === row) return false;
        return true;
      })
    );
  }

  // Build decorations for vertical connectors at each (row,col)
  function cellDecoration(row, col) {
    // Find a 2-qubit gate spanning this column
    const multi = gates.find(
      (g) =>
        g.column === col &&
        (((g.type === "CNOT" || g.type === "CZ") && typeof g.control === "number") ||
          (g.type === "SWAP" && typeof g.pair === "number"))
    );
    if (!multi) return null;

    let top, bottom;
    if (multi.type === "SWAP") {
      top = Math.min(multi.target, multi.pair);
      bottom = Math.max(multi.target, multi.pair);
    } else {
      top = Math.min(multi.target, /** @type {number} */ (multi.control));
      bottom = Math.max(multi.target, /** @type {number} */ (multi.control));
    }

    if (row < top || row > bottom) return null;

    // decide which symbol to render on endpoints
    let symbol = null;
    if (row === multi.target) {
      if (multi.type === "CNOT") symbol = "⊕"; // target
      if (multi.type === "CZ") symbol = "Z";
      if (multi.type === "SWAP") symbol = "×";
    } else if ((multi.type === "CNOT" || multi.type === "CZ") && row === multi.control) {
      symbol = "•"; // control
    } else if (multi.type === "SWAP" && row === multi.pair) {
      symbol = "×";
    }

    return { top, bottom, symbol, kind: multi.type };
  }

  function renderCellContent(row, col) {
    const g = occupancy[`${col}:${row}`];
    if (g) {
      // Single-qubit gate or endpoint symbol for multi-qubit is still handled here
      if (["H", "X", "Y", "Z", "S", "T"].includes(g.type)) return <Pill>{g.type}</Pill>;
      if (["RX", "RY", "RZ"].includes(g.type))
        return (
          <Pill>
            {g.type}
            {g.angle !== undefined ? `(${Number(g.angle.toFixed(4))})` : "(θ)"}
          </Pill>
        );
      if (g.type === "MEASURE") return <Pill>⟨M⟩</Pill>;

      // For multi-qubit endpoints we render symbol via decoration; here we keep space
      return <div className="w-6 h-6" />;
    }

    // No direct gate, but there might be a connector passing through
    const deco = cellDecoration(row, col);
    if (deco) {
      return (
        <div className="relative flex items-center justify-center w-full h-full">
          {/* vertical line */}
          <div className="absolute left-1/2 -translate-x-1/2 w-[2px] h-full bg-slate-500" />
          {deco.symbol && (
            <div className="relative z-10 flex items-center justify-center w-6 h-6 rounded-full bg-slate-900 border border-slate-600 text-slate-100">
              {deco.symbol}
            </div>
          )}
        </div>
      );
    }

    return null;
  }

  function generatePython() {
    const sorted = [...gates].sort((a, b) => a.column - b.column || a.target - b.target);
    const markedMeasure = new Set(sorted.filter((g) => g.type === "MEASURE").map((g) => g.target));

    const lines = [];
    lines.push("# Auto-generated by Quantum Circuit Builder (React)\n");
    lines.push("# Requires: qiskit, qiskit-aer\n");
    lines.push("from qiskit import QuantumCircuit\nfrom qiskit_aer import AerSimulator\n\n");
    lines.push(`n_qubits = ${numQubits}\n`);
    lines.push("qc = QuantumCircuit(n_qubits, n_qubits)\n\n");

    let currentCol = -1;
    for (const g of sorted) {
      if (g.column !== currentCol) {
        lines.push(`\n# --- Column ${g.column} ---\n`);
        currentCol = g.column;
      }
      switch (g.type) {
        case "H":
          lines.push(`qc.h(${g.target})\n`);
          break;
        case "X":
          lines.push(`qc.x(${g.target})\n`);
          break;
        case "Y":
          lines.push(`qc.y(${g.target})\n`);
          break;
        case "Z":
          lines.push(`qc.z(${g.target})\n`);
          break;
        case "S":
          lines.push(`qc.s(${g.target})\n`);
          break;
        case "T":
          lines.push(`qc.t(${g.target})\n`);
          break;
        case "RX":
          lines.push(`qc.rx(${g.angle ?? 0}, ${g.target})\n`);
          break;
        case "RY":
          lines.push(`qc.ry(${g.angle ?? 0}, ${g.target})\n`);
          break;
        case "RZ":
          lines.push(`qc.rz(${g.angle ?? 0}, ${g.target})\n`);
          break;
        case "CNOT":
          lines.push(`qc.cx(${g.control}, ${g.target})\n`);
          break;
        case "CZ":
          lines.push(`qc.cz(${g.control}, ${g.target})\n`);
          break;
        case "SWAP":
          lines.push(`qc.swap(${g.target}, ${g.pair})\n`);
          break;
        case "MEASURE":
          // defer measure
          break;
        default:
          break;
      }
    }

    lines.push("\n# Measurement\n");
    if (markedMeasure.size > 0) {
      for (const q of Array.from(markedMeasure).sort((a, b) => a - b)) {
        lines.push(`qc.measure(${q}, ${q})\n`);
      }
    } else {
      lines.push("for q in range(n_qubits):\n    qc.measure(q, q)\n");
    }

    lines.push(
      "\n# Simulate with AerSimulator\n" +
        "sim = AerSimulator()\n" +
        "result = sim.run(qc, shots=1024).result()\n" +
        "counts = result.get_counts()\n" +
        "print(counts)\n"
    );

    const code = lines.join("");
    setPython(code);
    setNotebookCode(code);
  }

  function downloadPython() {
    if (!python) {
      generatePython();
      setTimeout(() => doDownload(), 50);
    } else {
      doDownload();
    }
  }

  function doDownload() {
    const blob = new Blob([python || "# (empty)\n"], { type: "text/x-python" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "generated_circuit.py";
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  function saveDesign() {
    const data = { numQubits, numColumns, gates };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "circuit_design.json";
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  function loadDesign(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const obj = JSON.parse(String(reader.result));
        if (typeof obj.numQubits === "number") setNumQubits(obj.numQubits);
        if (typeof obj.numColumns === "number") setNumColumns(obj.numColumns);
        if (Array.isArray(obj.gates)) setGates(obj.gates);
      } catch (err) {
        alert("Invalid JSON");
      }
    };
    reader.readAsText(file);
  }

  // --------- Jupyter kernel execution ---------
  async function ensureJupyterSession() {
    if (jupyterSessionRef.current && jupyterSessionRef.current.kernel) {
      return jupyterSessionRef.current;
    }

    const settings = ServerConnection.makeSettings({
      baseUrl: jupyterBaseUrl,
      token: jupyterToken || undefined,
      init: { credentials: "omit" },
      // wsUrl is inferred from baseUrl by @jupyterlab/services
    });

    const sessions = new SessionManager({ serverSettings: settings });
    const session = await sessions.startNew({
      name: "quantum-react-session",
      type: "notebook",
      path: "quantum-react.ipynb",
      kernel: { name: "python3" },
    });

    jupyterSessionRef.current = session;
    return session;
  }

  async function runOnJupyter() {
    try {
      if (!python) generatePython();
      setJupyterBusy(true);
      setJupyterOut("");
      const session = await ensureJupyterSession();

      const future = session.kernel.requestExecute({ code: python, stop_on_error: true });
      future.onIOPub = (msg) => {
        const t = msg.header.msg_type;
        const c = msg.content || {};
        if (t === "stream") setJupyterOut((prev) => prev + (c.text || ""));
        else if (t === "error")
          setJupyterOut(
            (prev) =>
              prev +
              `\n[ERR] ${c.ename}: ${c.evalue}\n${(c.traceback || []).join("\n")}\n`
          );
        else if (t === "execute_result" || t === "display_data") {
          const data = c.data || {};
          if (data["text/plain"]) setJupyterOut((prev) => prev + String(data["text/plain"]) + "\n");
        }
      };
      await future.done;
      setJupyterOut((prev) => prev + "\n[done]\n");
    } catch (e) {
      setJupyterOut((prev) => prev + "\n[ERR] " + String(e) + "\n");
    } finally {
      setJupyterBusy(false);
    }
  }

  return (
    <div className="min-h-screen w-full bg-slate-950 text-slate-100 p-4 sm:p-6">
      <div className="mx-auto max-w-7xl">
        <header className="flex items-center justify-between mb-4">
          <h1 className="text-2xl sm:text-3xl font-bold">Ranjan Quantum Simulation</h1>
          <div className="flex items-center gap-2">
            <Button onClick={clearAll}>Clear</Button>
            <Button onClick={undo}>Undo</Button>
            <Button onClick={generatePython}>Generate Python</Button>
            <Button onClick={downloadPython}>Download .py</Button>
            <Button onClick={() => setShowNotebook(true)}>Open In-App Notebook</Button>
            <Button disabled={jupyterBusy}>
              <a href="https://colab.research.google.com/notebooks/snippets/importing_libraries.ipynb" target="_blank">Run on Jupyter Notebook</a>
            </Button>
            <Button onClick={() => setShowJupyterSettings(true)}>Jupyter Settings</Button>
            <Button><a href="https://github.com/ranjankumarmandal/Ranjan-Quantum-Simulation" target="_blank">GitHub</a></Button>
          </div>
        </header>

        <section className="grid grid-cols-1 lg:grid-cols-[260px,1fr] gap-4">
          {/* Palette */}
          <div className="rounded-3xl border border-slate-700 bg-slate-900 p-3">
            <h2 className="text-lg font-semibold mb-2">Gate Palette</h2>
            <div className="grid grid-cols-3 gap-2">
              {GATE_PALETTE.map((g) => (
                <div
                  key={g.type}
                  draggable
                  onDragStart={(e) => onDragStart(e, g.type)}
                  className="cursor-grab active:cursor-grabbing select-none rounded-xl border border-slate-600 bg-slate-800 hover:bg-slate-700 p-2 text-center font-semibold"
                  title={`Drag ${g.label} onto the circuit`}
                >
                  {g.label}
                </div>
              ))}
            </div>

            <div className="mt-4 space-y-2 text-sm opacity-80">
              <p>• Drag a gate, drop onto a cell (row=qubit, col=time).</p>
              <p>• For CNOT/CZ/SWAP, you will be asked to choose the other qubit.</p>
              <p>• Double-click a cell to remove a gate at that position.</p>
            </div>
          </div>

          {/* Main Canvas */}
          <div className="rounded-3xl border border-slate-700 bg-slate-900 p-3">
            <div className="flex flex-wrap items-center gap-3 mb-3">
              <label className="flex items-center gap-2">
                Qubits
                <input
                  type="number"
                  min={1}
                  max={16}
                  value={numQubits}
                  onChange={(e) =>
                    setNumQubits(Math.max(1, Math.min(16, Number(e.target.value))))
                  }
                  className="w-20 rounded-xl bg-slate-800 border border-slate-600 px-3 py-1"
                />
              </label>
              <label className="flex items-center gap-2">
                Columns
                <input
                  type="number"
                  min={1}
                  max={48}
                  value={numColumns}
                  onChange={(e) =>
                    setNumColumns(Math.max(1, Math.min(48, Number(e.target.value))))
                  }
                  className="w-20 rounded-xl bg-slate-800 border border-slate-600 px-3 py-1"
                />
              </label>
              <div className="ml-auto flex items-center gap-2">
                <Button onClick={saveDesign}>Save JSON</Button>
                <label className="inline-flex items-center gap-2 cursor-pointer">
                  <span className="rounded-2xl px-4 py-2 font-medium shadow-sm border border-slate-600 bg-slate-800">
                    Load JSON
                  </span>
                  <input
                    type="file"
                    accept="application/json"
                    className="hidden"
                    onChange={loadDesign}
                  />
                </label>
              </div>
            </div>

            {/* Grid */}
            <div ref={gridRef} className="overflow-x-auto">
              <div className="inline-block">
                <div
                  className="grid"
                  style={{ gridTemplateColumns: `80px repeat(${numColumns}, 72px)` }}
                >
                  {/* Header Row */}
                  <div className="sticky left-0 bg-slate-900/80 backdrop-blur rounded-l-xl" />
                  {Array.from({ length: numColumns }).map((_, c) => (
                    <div key={c} className="text-center text-sm py-1 opacity-80">
                      t{c}
                    </div>
                  ))}

                  {/* Rows */}
                  {Array.from({ length: numQubits }).map((_, r) => (
                    <React.Fragment key={r}>
                      {/* Qubit label */}
                      <div className="sticky left-0 bg-slate-900/80 backdrop-blur rounded-l-xl pr-3 flex items-center justify-end text-sm">
                        q{r}
                      </div>

                      {/* Cells */}
                      {Array.from({ length: numColumns }).map((_, c) => (
                        <div
                          key={`${r}-${c}`}
                          onDragOver={onDragOverCell}
                          onDrop={(e) => handleDrop(e, r, c)}
                          onDoubleClick={() => removeGateAt(r, c)}
                          className="relative w-[72px] h-[56px] border border-slate-800/70 hover:bg-slate-800/40 transition-colors"
                        >
                          {/* Wire */}
                          <div className="absolute top-1/2 left-0 right-0 h-[2px] -translate-y-1/2 bg-slate-700" />
                          <div className="relative z-10 flex items-center justify-center w-full h-full">
                            {renderCellContent(r, c)}
                          </div>
                        </div>
                      ))}
                    </React.Fragment>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Python Output & Jupyter Output */}
        <section className="rounded-3xl border border-slate-700 bg-slate-900 p-3 mt-4">
          <div className="flex items-center justify-between mb-2">
            <h2 className="text-lg font-semibold">Generated Python (Qiskit + Aer)</h2>
            <div className="flex items-center gap-2">
              <Button
                onClick={() => {
                  if (!python) generatePython();
                  navigator.clipboard.writeText(python || "");
                }}
              >
                Copy
              </Button>
              <Button onClick={downloadPython}>Download .py</Button>
            </div>
          </div>
          <textarea
            className="w-full min-h-[200px] rounded-xl bg-slate-950 border border-slate-700 p-3 font-mono text-sm"
            placeholder='Click "Generate Python" after building your circuit.'
            value={python}
            onChange={(e) => setPython(e.target.value)}
          />
          <div className="text-xs opacity-75 mt-2">
            Tip: Install with <code>pip install qiskit qiskit-aer</code> and run the downloaded
            script.
          </div>
          <div className="text-xs opacity-75 mt-2">
            <p>&copy; 2025 Ranjan Kumar Mandal. All rights reserved.</p>
          </div>
        </section>

        {showNotebook && (
          <InAppNotebook code={notebookCode} onClose={() => setShowNotebook(false)} />
        )}

        {showJupyterSettings && (
          <JupyterSettingsModal
            baseUrl={jupyterBaseUrl}
            token={jupyterToken}
            onClose={() => setShowJupyterSettings(false)}
            onSave={(b, t) => {
              setJupyterBaseUrl(b);
              setJupyterToken(t);
              localStorage.setItem("jupyterBaseUrl", b);
              localStorage.setItem("jupyterToken", t);
              setShowJupyterSettings(false);
            }}
          />
        )}
      </div>
    </div>
  );
}

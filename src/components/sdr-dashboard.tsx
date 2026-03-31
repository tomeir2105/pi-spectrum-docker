"use client";

import { useState } from "react";

type SdrStatus = {
  lsusb: string;
  rtlTestOutput: string;
  rtlTestExitCode: number;
  deviceDetected: boolean;
  driverConflictLikely: boolean;
};

type ScanResult = {
  request: {
    startMHz: number;
    endMHz: number;
    binHz: number;
    integrationSec: number;
    gain: number;
  };
  command: string;
  outputPreview: string;
  outputFile: string;
  error?: string;
};

type SpectrumPoint = {
  frequencyMHz: number;
  powerDb: number;
};

type ScanForm = {
  startMHz: number;
  endMHz: number;
  binHz: number;
  integrationSec: number;
  gain: number;
};

const initialForm: ScanForm = {
  startMHz: 88,
  endMHz: 108,
  binHz: 10000,
  integrationSec: 2,
  gain: 20.7,
};

function parseSpectrum(outputPreview: string): SpectrumPoint[] {
  const firstLine = outputPreview
    .split("\n")
    .map((line) => line.trim())
    .find(Boolean);

  if (!firstLine) {
    return [];
  }

  const columns = firstLine.split(",").map((part) => part.trim());
  if (columns.length < 7) {
    return [];
  }

  const startHz = Number(columns[2]);
  const stepHz = Number(columns[4]);
  const powerColumns = columns.slice(6).map(Number);

  if (!Number.isFinite(startHz) || !Number.isFinite(stepHz) || stepHz <= 0) {
    return [];
  }

  return powerColumns
    .filter((powerDb) => Number.isFinite(powerDb))
    .map((powerDb, index) => ({
      frequencyMHz: (startHz + stepHz * index) / 1_000_000,
      powerDb,
    }));
}

function buildSpectrumPath(points: SpectrumPoint[], width: number, height: number) {
  if (points.length < 2) {
    return "";
  }

  const frequencies = points.map((point) => point.frequencyMHz);
  const powers = points.map((point) => point.powerDb);
  const minFreq = Math.min(...frequencies);
  const maxFreq = Math.max(...frequencies);
  const minPower = Math.min(...powers);
  const maxPower = Math.max(...powers);
  const freqRange = Math.max(maxFreq - minFreq, 0.000001);
  const powerRange = Math.max(maxPower - minPower, 0.000001);

  return points
    .map((point, index) => {
      const x = ((point.frequencyMHz - minFreq) / freqRange) * width;
      const y = height - ((point.powerDb - minPower) / powerRange) * height;
      return `${index === 0 ? "M" : "L"} ${x.toFixed(1)} ${y.toFixed(1)}`;
    })
    .join(" ");
}

function SpectrumChart({ scan }: { scan: ScanResult }) {
  const points = parseSpectrum(scan.outputPreview);

  if (points.length < 2) {
    return <p className="muted">Run a scan to render the spectrum trace.</p>;
  }

  const width = 760;
  const height = 240;
  const path = buildSpectrumPath(points, width, height);
  const powers = points.map((point) => point.powerDb);
  const minPower = Math.min(...powers);
  const maxPower = Math.max(...powers);
  const strongestPoint = points.reduce((best, point) => (point.powerDb > best.powerDb ? point : best), points[0]);

  return (
    <div className="chart-card">
      <div className="chart-meta">
        <p>
          Peak signal:{" "}
          <strong>
            {strongestPoint.frequencyMHz.toFixed(3)} MHz @ {strongestPoint.powerDb.toFixed(2)} dB
          </strong>
        </p>
        <p>
          Window:{" "}
          <strong>
            {points[0].frequencyMHz.toFixed(3)}-{points[points.length - 1].frequencyMHz.toFixed(3)} MHz
          </strong>
        </p>
      </div>

      <svg viewBox={`0 0 ${width} ${height}`} className="spectrum-chart" role="img" aria-label="Spectrum scan plot">
        <defs>
          <linearGradient id="traceFill" x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stopColor="#0086ff" stopOpacity="0.28" />
            <stop offset="100%" stopColor="#0086ff" stopOpacity="0.02" />
          </linearGradient>
        </defs>

        <rect x="0" y="0" width={width} height={height} rx="14" className="chart-bg" />
        <line x1="0" y1={height} x2={width} y2={height} className="chart-axis" />
        <line x1="0" y1="0" x2="0" y2={height} className="chart-axis" />
        <path d={`${path} L ${width} ${height} L 0 ${height} Z`} fill="url(#traceFill)" />
        <path d={path} className="chart-line" />
      </svg>

      <div className="chart-scale">
        <span>{points[0].frequencyMHz.toFixed(3)} MHz</span>
        <span>
          {minPower.toFixed(1)} to {maxPower.toFixed(1)} dB
        </span>
        <span>{points[points.length - 1].frequencyMHz.toFixed(3)} MHz</span>
      </div>
    </div>
  );
}

export function SdrDashboard() {
  const [status, setStatus] = useState<SdrStatus | null>(null);
  const [scan, setScan] = useState<ScanResult | null>(null);
  const [form, setForm] = useState<ScanForm>(initialForm);
  const [statusLoading, setStatusLoading] = useState(false);
  const [scanLoading, setScanLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function checkStatus() {
    setStatusLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/sdr/status");
      const data = (await response.json()) as SdrStatus;
      setStatus(data);
    } catch {
      setError("Failed to fetch SDR status.");
    } finally {
      setStatusLoading(false);
    }
  }

  async function runScan() {
    setScanLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/sdr/scan", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(form),
      });

      const data = (await response.json()) as ScanResult;
      if (!response.ok || data.error) {
        throw new Error(data.error ?? "Scan failed");
      }
      setScan(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to run scan.");
    } finally {
      setScanLoading(false);
    }
  }

  function updateField<K extends keyof ScanForm>(field: K, value: number) {
    setForm((current) => ({
      ...current,
      [field]: Number.isNaN(value) ? current[field] : value,
    }));
  }

  return (
    <main className="container">
      <section className="card">
        <h1>RTL-SDR Control Panel</h1>
        <p>
          Check USB passthrough, then run a one-shot <code>rtl_power</code> scan from this Next.js app.
        </p>

        <div className="buttons">
          <button type="button" onClick={checkStatus} disabled={statusLoading}>
            {statusLoading ? "Checking..." : "Check USB / Device"}
          </button>
        </div>

        {status ? (
          <div className="status">
            <p>
              Device detected:{" "}
              <strong className={status.deviceDetected ? "ok" : "bad"}>
                {status.deviceDetected ? "yes" : "no"}
              </strong>
            </p>
            <p>
              Kernel driver conflict:{" "}
              <strong className={status.driverConflictLikely ? "bad" : "ok"}>
                {status.driverConflictLikely ? "likely" : "not detected"}
              </strong>
            </p>
            <pre>{status.lsusb || "No lsusb output"}</pre>
            <pre>{status.rtlTestOutput || "No rtl_test output"}</pre>
          </div>
        ) : null}
      </section>

      <section className="card">
        <h2>Spectrum Sweep</h2>
        <div className="form-grid">
          <label>
            Start MHz
            <input
              type="number"
              value={form.startMHz}
              onChange={(event) => updateField("startMHz", Number(event.target.value))}
            />
          </label>
          <label>
            End MHz
            <input
              type="number"
              value={form.endMHz}
              onChange={(event) => updateField("endMHz", Number(event.target.value))}
            />
          </label>
          <label>
            Bin Hz
            <input
              type="number"
              value={form.binHz}
              onChange={(event) => updateField("binHz", Number(event.target.value))}
            />
          </label>
          <label>
            Integration Sec
            <input
              type="number"
              value={form.integrationSec}
              onChange={(event) => updateField("integrationSec", Number(event.target.value))}
            />
          </label>
          <label>
            Gain dB
            <input
              type="number"
              step="0.1"
              value={form.gain}
              onChange={(event) => updateField("gain", Number(event.target.value))}
            />
          </label>
        </div>

        <div className="buttons">
          <button type="button" onClick={runScan} disabled={scanLoading}>
            {scanLoading ? "Scanning..." : "Run One Scan"}
          </button>
        </div>

        {error ? <p className="bad">{error}</p> : null}

        {scan ? (
          <div className="status">
            <SpectrumChart scan={scan} />
            <p>
              Command: <code>{scan.command}</code>
            </p>
            <p>
              CSV file: <code>{scan.outputFile}</code>
            </p>
            <pre>{scan.outputPreview || "No scan output yet"}</pre>
          </div>
        ) : null}
      </section>
    </main>
  );
}

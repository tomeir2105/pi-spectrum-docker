import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import { promisify } from "node:util";
import { acquireSdr } from "@/lib/sdr-lock";

const execFileAsync = promisify(execFile);

export type SdrStatus = {
  lsusb: string;
  rtlTestOutput: string;
  rtlTestExitCode: number;
  deviceDetected: boolean;
  driverConflictLikely: boolean;
};

export type ScanRequest = {
  startMHz: number;
  endMHz: number;
  binHz: number;
  integrationSec: number;
  gain: number;
};

export type ScanResult = {
  command: string;
  outputPreview: string;
  outputFile: string;
};

export type SpectrumPoint = {
  frequencyMHz: number;
  powerDb: number;
};

export type StationCandidate = {
  frequencyMHz: number;
  powerDb: number;
};

export type FmBandScanRequest = {
  startMHz: number;
  endMHz: number;
  binHz: number;
  integrationSec: number;
  gain: number;
  thresholdDb: number;
  limit: number;
};

const RTL_TEST_PATH = process.env.RTL_TEST_PATH ?? "rtl_test";
const RTL_POWER_PATH = process.env.RTL_POWER_PATH ?? "rtl_power";

function safeNum(value: unknown, fallback: number): number {
  if (typeof value !== "number" || Number.isNaN(value) || !Number.isFinite(value)) {
    return fallback;
  }
  return value;
}

export function normalizeScanRequest(input: Partial<ScanRequest>): ScanRequest {
  const startMHz = Math.max(24, Math.min(1766, safeNum(input.startMHz, 88)));
  const endMHz = Math.max(startMHz + 1, Math.min(1766, safeNum(input.endMHz, 108)));
  const binHz = Math.max(10, Math.min(500000, Math.round(safeNum(input.binHz, 10000))));
  const integrationSec = Math.max(1, Math.min(30, safeNum(input.integrationSec, 2)));
  const gain = Math.max(0, Math.min(49.6, safeNum(input.gain, 20.7)));

  return { startMHz, endMHz, binHz, integrationSec, gain };
}

export function normalizeFmBandScanRequest(input: Partial<FmBandScanRequest>): FmBandScanRequest {
  const base = normalizeScanRequest({
    startMHz: safeNum(input.startMHz, 87.5),
    endMHz: safeNum(input.endMHz, 108),
    binHz: safeNum(input.binHz, 200000),
    integrationSec: safeNum(input.integrationSec, 2),
    gain: safeNum(input.gain, 20.7),
  });
  const thresholdDb = Math.max(-80, Math.min(-5, safeNum(input.thresholdDb, -26)));
  const limit = Math.max(3, Math.min(30, Math.round(safeNum(input.limit, 12))));

  return { ...base, thresholdDb, limit };
}

export function parseSpectrumPreview(outputPreview: string): SpectrumPoint[] {
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

export function detectStations(points: SpectrumPoint[], thresholdDb: number, limit: number): StationCandidate[] {
  if (points.length < 3) {
    return [];
  }

  const candidates: StationCandidate[] = [];

  for (let index = 1; index < points.length - 1; index += 1) {
    const previous = points[index - 1];
    const current = points[index];
    const next = points[index + 1];

    if (
      current.powerDb >= thresholdDb &&
      current.powerDb >= previous.powerDb &&
      current.powerDb >= next.powerDb
    ) {
      const snapped = Math.round(current.frequencyMHz * 10) / 10;
      const existing = candidates.find((candidate) => Math.abs(candidate.frequencyMHz - snapped) < 0.15);
      if (!existing || current.powerDb > existing.powerDb) {
        if (existing) {
          existing.frequencyMHz = snapped;
          existing.powerDb = current.powerDb;
        } else {
          candidates.push({
            frequencyMHz: snapped,
            powerDb: current.powerDb,
          });
        }
      }
    }
  }

  return candidates.sort((a, b) => b.powerDb - a.powerDb).slice(0, limit);
}

export async function getSdrStatus(): Promise<SdrStatus> {
  const release = acquireSdr("status check");
  const lsusb = await execFileAsync("lsusb", [], { timeout: 8000 })
    .then((r) => r.stdout || r.stderr)
    .catch((error) => `lsusb failed: ${error.message}`);

  let rtlTestOutput = "";
  let rtlTestExitCode = 0;

  try {
    try {
      const result = await execFileAsync(RTL_TEST_PATH, ["-t"], {
        timeout: 12000,
      });
      rtlTestOutput = `${result.stdout}${result.stderr}`.trim();
    } catch (error: unknown) {
      const err = error as {
        stdout?: string;
        stderr?: string;
        message?: string;
        code?: number;
      };
      rtlTestExitCode = typeof err.code === "number" ? err.code : 1;
      rtlTestOutput = `${err.stdout ?? ""}${err.stderr ?? ""}`.trim();
      if (!rtlTestOutput) {
        rtlTestOutput = err.message ?? "rtl_test failed";
      }
    }
  
    const combined = `${lsusb}\n${rtlTestOutput}`;
    const deviceDetected = /Realtek|RTL2832|Found\s+\d+\s+device/i.test(combined);
    const driverConflictLikely = /usb_claim_interface|Kernel driver is active|No supported devices found/i.test(
      rtlTestOutput,
    );

    return {
      lsusb: lsusb.trim(),
      rtlTestOutput,
      rtlTestExitCode,
      deviceDetected,
      driverConflictLikely,
    };
  } finally {
    release();
  }
}

export async function runSingleScan(request: ScanRequest): Promise<ScanResult> {
  const release = acquireSdr("scan");
  const now = new Date().toISOString().replace(/[:.]/g, "-");
  const outputFile = `/tmp/rtl_power_${now}.csv`;

  const args = [
    "-f",
    `${request.startMHz}M:${request.endMHz}M:${request.binHz}`,
    "-i",
    `${request.integrationSec}`,
    "-g",
    `${request.gain}`,
    "-1",
    outputFile,
  ];

  try {
    try {
      await execFileAsync(RTL_POWER_PATH, args, { timeout: 25000 });
    } catch (error: unknown) {
      const err = error as {
        stdout?: string;
        stderr?: string;
        message?: string;
      };
      const output = `${err.stdout ?? ""}${err.stderr ?? ""}`.trim();
      throw new Error(output || err.message || "rtl_power failed");
    }

    const content = await fs.readFile(outputFile, "utf-8");
    const lines = content.split("\n").filter(Boolean).slice(0, 20);

    return {
      command: `${RTL_POWER_PATH} ${args.join(" ")}`,
      outputPreview: lines.join("\n"),
      outputFile,
    };
  } finally {
    release();
  }
}

export async function findFmStations(request: FmBandScanRequest) {
  const scan = await runSingleScan(request);
  const points = parseSpectrumPreview(scan.outputPreview);
  const stations = detectStations(points, request.thresholdDb, request.limit);

  return {
    ...scan,
    stations,
  };
}

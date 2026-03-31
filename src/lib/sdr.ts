import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import { promisify } from "node:util";

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

export async function getSdrStatus(): Promise<SdrStatus> {
  const lsusb = await execFileAsync("lsusb", [], { timeout: 8000 })
    .then((r) => r.stdout || r.stderr)
    .catch((error) => `lsusb failed: ${error.message}`);

  let rtlTestOutput = "";
  let rtlTestExitCode = 0;

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
}

export async function runSingleScan(request: ScanRequest): Promise<ScanResult> {
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
}

import { NextResponse } from "next/server";
import { normalizeScanRequest, runSingleScan } from "@/lib/sdr";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as Record<string, number>;
    const normalized = normalizeScanRequest({
      startMHz: body.startMHz,
      endMHz: body.endMHz,
      binHz: body.binHz,
      integrationSec: body.integrationSec,
      gain: body.gain,
    });

    const result = await runSingleScan(normalized);
    return NextResponse.json({
      request: normalized,
      ...result,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Scan failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

import { NextResponse } from "next/server";
import { findFmStations, normalizeFmBandScanRequest } from "@/lib/sdr";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as Record<string, number>;
    const normalized = normalizeFmBandScanRequest({
      startMHz: body.startMHz,
      endMHz: body.endMHz,
      binHz: body.binHz,
      integrationSec: body.integrationSec,
      gain: body.gain,
      thresholdDb: body.thresholdDb,
      limit: body.limit,
    });

    const result = await findFmStations(normalized);
    return NextResponse.json({
      request: normalized,
      ...result,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "FM station scan failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

import { NextResponse } from "next/server";
import { getSdrStatus } from "@/lib/sdr";

export const runtime = "nodejs";

export async function GET() {
  const status = await getSdrStatus();
  return NextResponse.json(status);
}

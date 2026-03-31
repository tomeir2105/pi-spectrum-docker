import { spawn } from "node:child_process";
import { acquireSdr } from "@/lib/sdr-lock";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function clampNumber(value: string | null, fallback: number, min: number, max: number) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.max(min, Math.min(max, parsed));
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const frequencyMHz = clampNumber(searchParams.get("frequency"), 99.5, 76, 108);
  const gain = clampNumber(searchParams.get("gain"), 20.7, 0, 49.6);

  let release: (() => void) | undefined;

  try {
    release = acquireSdr("live audio");
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "SDR is busy";
    return new Response(message, { status: 409 });
  }

  const rtlFm = spawn(
    "rtl_fm",
    [
      "-f",
      `${frequencyMHz}M`,
      "-M",
      "wbfm",
      "-s",
      "170k",
      "-r",
      "48k",
      "-E",
      "deemp",
      "-A",
      "fast",
      "-g",
      `${gain}`,
    ],
    { stdio: ["ignore", "pipe", "pipe"] },
  );

  const ffmpeg = spawn(
    "ffmpeg",
    [
      "-loglevel",
      "error",
      "-f",
      "s16le",
      "-ar",
      "48000",
      "-ac",
      "1",
      "-i",
      "pipe:0",
      "-ac",
      "2",
      "-f",
      "mp3",
      "-b:a",
      "128k",
      "pipe:1",
    ],
    { stdio: ["pipe", "pipe", "pipe"] },
  );

  rtlFm.stdout.pipe(ffmpeg.stdin);

  const stderrChunks: string[] = [];
  const capture = (chunk: Buffer) => {
    stderrChunks.push(chunk.toString("utf-8"));
    if (stderrChunks.length > 20) {
      stderrChunks.shift();
    }
  };

  rtlFm.stderr.on("data", capture);
  ffmpeg.stderr.on("data", capture);

  const shutdown = () => {
    rtlFm.kill("SIGTERM");
    ffmpeg.kill("SIGTERM");
    release?.();
  };

  request.signal.addEventListener("abort", shutdown);

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      ffmpeg.stdout.on("data", (chunk: Buffer) => controller.enqueue(new Uint8Array(chunk)));

      ffmpeg.stdout.on("end", () => controller.close());

      const fail = () => {
        const details = stderrChunks.join("").trim() || "FM stream stopped unexpectedly";
        controller.error(new Error(details));
      };

      rtlFm.on("error", fail);
      ffmpeg.on("error", fail);

      ffmpeg.on("close", (code) => {
        if (code !== 0 && !request.signal.aborted) {
          fail();
        }
        release?.();
      });
    },
    cancel() {
      shutdown();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "audio/mpeg",
      "Cache-Control": "no-store",
      Connection: "keep-alive",
    },
  });
}

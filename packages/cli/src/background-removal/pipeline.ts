/**
 * Background-removal rendering pipeline.
 *
 * Decode source frames via ffmpeg → run inference per frame → encode the RGBA
 * stream via a second ffmpeg process. Output formats:
 *   .webm → VP9 with alpha (HTML5-native, ~1 MB / 4s @ 1080p)
 *   .mov  → ProRes 4444 with alpha (editing round-trip)
 *   .png  → single RGBA still (only when input is also a single image)
 *
 * The encode flags for VP9-with-alpha mirror the `chunkEncoder.ts` pattern in
 * @hyperframes/engine — `-pix_fmt yuva420p` plus the
 * `-metadata:s:v:0 alpha_mode=1` tag are what make Chrome's `<video>` element
 * decode the alpha plane.
 */
import { spawn } from "node:child_process";
import { extname } from "node:path";
import { hasFFmpeg, hasFFprobe } from "../whisper/manager.js";
import { createSession, type Session } from "./inference.js";
import { type Device, type ModelId } from "./manager.js";

export type OutputFormat = "webm" | "mov" | "png";

export interface RenderOptions {
  inputPath: string;
  outputPath: string;
  device?: Device;
  model?: ModelId;
  onProgress?: (event: ProgressEvent) => void;
}

export type ProgressEvent =
  | { kind: "info"; message: string }
  | { kind: "metadata"; width: number; height: number; fps: number; frameCount: number }
  | { kind: "frame"; index: number; total: number; avgMsPerFrame: number };

export interface RenderResult {
  outputPath: string;
  framesProcessed: number;
  durationSeconds: number;
  avgMsPerFrame: number;
  provider: string;
  format: OutputFormat;
}

const VIDEO_EXTENSIONS = new Set([".mp4", ".mov", ".webm", ".mkv", ".avi"]);
const IMAGE_EXTENSIONS = new Set([".jpg", ".jpeg", ".png", ".webp"]);

interface MediaInfo {
  width: number;
  height: number;
  fps: number;
  frameCount: number;
}

export function inferOutputFormat(outputPath: string): OutputFormat {
  const ext = extname(outputPath).toLowerCase();
  if (ext === ".webm") return "webm";
  if (ext === ".mov") return "mov";
  if (ext === ".png") return "png";
  throw new Error(
    `Unsupported output extension: ${ext}. Use .webm (VP9 alpha), .mov (ProRes 4444), or .png.`,
  );
}

export function inferInputKind(inputPath: string): "video" | "image" {
  const ext = extname(inputPath).toLowerCase();
  if (VIDEO_EXTENSIONS.has(ext)) return "video";
  if (IMAGE_EXTENSIONS.has(ext)) return "image";
  throw new Error(
    `Unsupported input: ${ext}. Use a video (mp4/mov/webm/mkv/avi) or image (jpg/png/webp).`,
  );
}

interface EngineMetadata {
  width: number;
  height: number;
  fps: number;
  durationSeconds: number;
}

async function probeMedia(inputPath: string): Promise<MediaInfo> {
  const isImage = inferInputKind(inputPath) === "image";
  const engine = (await import("@hyperframes/engine")) as {
    extractMediaMetadata: (path: string) => Promise<EngineMetadata>;
  };
  const meta = await engine.extractMediaMetadata(inputPath);

  if (isImage) {
    return { width: meta.width, height: meta.height, fps: 0, frameCount: 1 };
  }

  const fps = meta.fps || 30;
  const frameCount = meta.durationSeconds ? Math.round(meta.durationSeconds * fps) : 0;
  return { width: meta.width, height: meta.height, fps, frameCount };
}

export function buildEncoderArgs(
  format: OutputFormat,
  width: number,
  height: number,
  fps: number,
  outputPath: string,
): string[] {
  const base = [
    "-y",
    "-f",
    "rawvideo",
    "-pix_fmt",
    "rgba",
    "-s",
    `${width}x${height}`,
    "-r",
    String(fps || 30),
    "-i",
    "-",
  ];

  if (format === "webm") {
    return [
      ...base,
      "-c:v",
      "libvpx-vp9",
      "-b:v",
      "0",
      "-crf",
      "30",
      "-deadline",
      "good",
      "-row-mt",
      "1",
      "-auto-alt-ref",
      "0",
      "-pix_fmt",
      "yuva420p",
      "-metadata:s:v:0",
      "alpha_mode=1",
      "-an",
      outputPath,
    ];
  }
  if (format === "mov") {
    return [
      ...base,
      "-c:v",
      "prores_ks",
      "-profile:v",
      "4444",
      "-vendor",
      "apl0",
      "-pix_fmt",
      "yuva444p10le",
      "-an",
      outputPath,
    ];
  }
  return [...base, "-frames:v", "1", "-pix_fmt", "rgba", "-update", "1", outputPath];
}

async function* readFrames(
  stream: NodeJS.ReadableStream,
  frameBytes: number,
): AsyncGenerator<Buffer> {
  let buffered: Buffer = Buffer.alloc(0);
  for await (const chunk of stream) {
    buffered =
      buffered.length === 0 ? (chunk as Buffer) : Buffer.concat([buffered, chunk as Buffer]);
    while (buffered.length >= frameBytes) {
      // Copy because the next concat would clobber the underlying memory.
      yield Buffer.from(buffered.subarray(0, frameBytes));
      buffered = buffered.subarray(frameBytes);
    }
  }
}

export async function render(options: RenderOptions): Promise<RenderResult> {
  if (!hasFFmpeg() || !hasFFprobe()) {
    throw new Error("ffmpeg and ffprobe are required. Install: brew install ffmpeg");
  }

  const format = inferOutputFormat(options.outputPath);
  const inputKind = inferInputKind(options.inputPath);

  if (inputKind === "image" && format !== "png") {
    throw new Error(
      `Image input requires a .png output (got ${extname(options.outputPath)}). Use a video input for .webm/.mov.`,
    );
  }
  if (inputKind === "video" && format === "png") {
    throw new Error(
      `Video input requires a .webm or .mov output (got .png). Use an image input for .png.`,
    );
  }

  const media = await probeMedia(options.inputPath);

  options.onProgress?.({
    kind: "metadata",
    width: media.width,
    height: media.height,
    fps: media.fps,
    frameCount: media.frameCount,
  });

  const session = await createSession({
    model: options.model,
    device: options.device,
    onProgress: (msg) => options.onProgress?.({ kind: "info", message: msg }),
  });

  try {
    const start = Date.now();
    const framesProcessed = await runPipeline(options, session, media, format);
    const durationSeconds = (Date.now() - start) / 1000;
    const avgMsPerFrame = framesProcessed ? (durationSeconds * 1000) / framesProcessed : 0;

    return {
      outputPath: options.outputPath,
      framesProcessed,
      durationSeconds,
      avgMsPerFrame,
      provider: session.provider,
      format,
    };
  } finally {
    await session.close();
  }
}

const RECENT_WINDOW = 30;

async function runPipeline(
  options: RenderOptions,
  session: Session,
  media: MediaInfo,
  format: OutputFormat,
): Promise<number> {
  const { inputPath, outputPath } = options;
  const { width, height, fps, frameCount } = media;
  const frameBytes = width * height * 3;

  const decoder = spawn(
    "ffmpeg",
    ["-loglevel", "error", "-i", inputPath, "-f", "rawvideo", "-pix_fmt", "rgb24", "-an", "-"],
    { stdio: ["ignore", "pipe", "pipe"] },
  );

  let decoderStderr = "";
  decoder.stderr?.on("data", (d: Buffer) => {
    decoderStderr += d.toString();
  });
  const decoderExit = waitForExit(decoder, "ffmpeg decoder", () => decoderStderr);

  const encoder = spawn("ffmpeg", buildEncoderArgs(format, width, height, fps || 30, outputPath), {
    stdio: ["pipe", "ignore", "pipe"],
  });
  let encoderStderr = "";
  encoder.stderr?.on("data", (d: Buffer) => {
    encoderStderr += d.toString();
  });
  const encoderExit = waitForExit(encoder, "ffmpeg encoder", () => encoderStderr);

  let processed = 0;
  const total = frameCount;

  // Running average over the last RECENT_WINDOW frames.
  const recentMs = new Array<number>(RECENT_WINDOW).fill(0);
  let recentSum = 0;
  let recentSlot = 0;
  let recentCount = 0;

  try {
    for await (const rgb of readFrames(decoder.stdout!, frameBytes)) {
      const t0 = Date.now();
      const rgba = await session.process(rgb, width, height);
      const elapsed = Date.now() - t0;

      recentSum += elapsed - recentMs[recentSlot]!;
      recentMs[recentSlot] = elapsed;
      recentSlot = (recentSlot + 1) % RECENT_WINDOW;
      if (recentCount < RECENT_WINDOW) recentCount++;

      if (!encoder.stdin!.write(rgba)) {
        await new Promise<void>((resolve) => encoder.stdin!.once("drain", () => resolve()));
      }

      processed++;
      options.onProgress?.({
        kind: "frame",
        index: processed,
        total,
        avgMsPerFrame: recentSum / recentCount,
      });
    }
  } catch (err) {
    decoder.kill("SIGKILL");
    encoder.kill("SIGKILL");
    throw err;
  }

  encoder.stdin!.end();
  await Promise.all([decoderExit, encoderExit]);

  if (processed === 0) {
    throw new Error(
      `No frames produced from ${inputPath}. Decoder stderr:\n${decoderStderr.slice(-400)}`,
    );
  }

  return processed;
}

export function waitForExit(
  proc: ReturnType<typeof spawn>,
  label: string,
  getStderr: () => string,
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    proc.on("error", reject);
    // Per Node docs the exit callback is (code, signal): on a normal exit
    // `code` is the numeric exit status and `signal` is null; on a
    // signal-killed exit `code` is null and `signal` is the signal name.
    // Treating null-code as success would silently report SIGTERM/SIGKILL
    // as a successful render.
    proc.on("exit", (code, signal) => {
      if (code === 0 && !signal) {
        resolve();
        return;
      }
      const cause = signal ? `killed by ${signal}` : `exited with code ${code}`;
      reject(new Error(`${label} ${cause}: ${getStderr().slice(-400)}`));
    });
  });
}

/**
 * u2net_human_seg inference: RGB frame → RGBA frame (alpha = human mask).
 *
 * Pre/postprocessing matches rembg's u2net session
 * (https://github.com/danielgatis/rembg/blob/main/rembg/sessions/u2net.py)
 * so output should be pixel-equivalent to `rembg new_session("u2net_human_seg")`.
 */
import type { InferenceSession, Tensor } from "onnxruntime-node";
import type sharpType from "sharp";
import { ensureModel, selectProviders, type Device, type ModelId } from "./manager.js";

const INPUT_SIZE = 320;
const INPUT_PLANE = INPUT_SIZE * INPUT_SIZE;

// Must match rembg's U2netHumanSegSession.predict — ImageNet mean/std, NOT the
// (1.0, 1.0, 1.0) std used by the general-purpose u2net session.
// https://github.com/danielgatis/rembg/blob/main/rembg/sessions/u2net_human_seg.py#L33
export const MEAN = [0.485, 0.456, 0.406] as const;
export const STD = [0.229, 0.224, 0.225] as const;

type Sharp = typeof sharpType;
interface OrtModule {
  InferenceSession: typeof InferenceSession;
  Tensor: typeof Tensor;
}

export interface Session {
  /** Run inference on one RGB frame, return RGBA bytes (H*W*4). */
  process(rgb: Buffer, width: number, height: number): Promise<Buffer>;
  /** ORT EP that was actually selected. */
  provider: string;
  close(): Promise<void>;
}

export interface CreateSessionOptions {
  model?: ModelId;
  device?: Device;
  onProgress?: (message: string) => void;
}

export async function createSession(options: CreateSessionOptions = {}): Promise<Session> {
  const ort = (await import("onnxruntime-node")) as unknown as OrtModule;
  const sharpMod = await import("sharp");
  const sharp = sharpMod.default as Sharp;

  const choice = selectProviders(options.device ?? "auto");
  const path = await ensureModel(options.model, { onProgress: options.onProgress });

  options.onProgress?.(`Loading model on ${choice.label}...`);

  const tryCreate = (providers: string[]) =>
    ort.InferenceSession.create(path, {
      executionProviders: providers,
      graphOptimizationLevel: "all",
    });

  let session: InferenceSession;
  let providerUsed = choice.label;
  try {
    session = await tryCreate(choice.providers);
  } catch (err) {
    if (choice.providers[0] === "cpu") throw err;
    options.onProgress?.(
      `${choice.label} provider failed (${(err as Error).message}); falling back to CPU.`,
    );
    session = await tryCreate(["cpu"]);
    providerUsed = "CPU";
  }

  const inputName = session.inputNames[0];
  const outputName = session.outputNames[0];
  if (!inputName || !outputName) {
    throw new Error("ONNX session is missing input or output bindings");
  }

  // Pre-allocated per-frame buffers reused across every process() call.
  // At 1080p this saves ~9 MB of allocations per frame. rgbaBuf is sized
  // lazily on the first call (we don't know W/H until then).
  const inputData = new Float32Array(3 * INPUT_PLANE);
  const maskBuf = Buffer.allocUnsafe(INPUT_PLANE);
  let rgbaBuf: Buffer | null = null;

  return {
    provider: providerUsed,
    async process(rgb, width, height) {
      const tensor = await preprocess(sharp, ort, rgb, width, height, inputData);
      const outputs = await session.run({ [inputName]: tensor });
      const output = outputs[outputName];
      if (!output) throw new Error(`Model did not return output '${outputName}'`);
      const expectedBytes = width * height * 4;
      if (!rgbaBuf || rgbaBuf.length !== expectedBytes) {
        rgbaBuf = Buffer.allocUnsafe(expectedBytes);
      }
      return await postprocess(sharp, output, rgb, width, height, maskBuf, rgbaBuf);
    },
    async close() {
      await session.release();
    },
  };
}

async function preprocess(
  sharp: Sharp,
  ort: OrtModule,
  rgb: Buffer,
  width: number,
  height: number,
  inputData: Float32Array,
): Promise<Tensor> {
  const resized = await sharp(rgb, { raw: { width, height, channels: 3 } })
    .resize(INPUT_SIZE, INPUT_SIZE, { kernel: "lanczos3", fit: "fill" })
    .raw()
    .toBuffer();

  // rembg's normalize divides by `np.max(im_ary)` (NOT 255). Match exactly so
  // we hit the same operating point as the model's training distribution.
  let maxPixel = 0;
  for (let i = 0; i < resized.length; i++) {
    if (resized[i]! > maxPixel) maxPixel = resized[i]!;
  }
  if (maxPixel === 0) maxPixel = 1;

  for (let y = 0; y < INPUT_SIZE; y++) {
    for (let x = 0; x < INPUT_SIZE; x++) {
      const src = (y * INPUT_SIZE + x) * 3;
      const dst = y * INPUT_SIZE + x;
      inputData[dst] = (resized[src]! / maxPixel - MEAN[0]) / STD[0];
      inputData[INPUT_PLANE + dst] = (resized[src + 1]! / maxPixel - MEAN[1]) / STD[1];
      inputData[2 * INPUT_PLANE + dst] = (resized[src + 2]! / maxPixel - MEAN[2]) / STD[2];
    }
  }

  return new ort.Tensor("float32", inputData, [1, 3, INPUT_SIZE, INPUT_SIZE]);
}

async function postprocess(
  sharp: Sharp,
  output: Tensor,
  rgb: Buffer,
  width: number,
  height: number,
  maskBuf: Buffer,
  rgbaBuf: Buffer,
): Promise<Buffer> {
  const raw = output.data as Float32Array;

  let lo = Infinity;
  let hi = -Infinity;
  for (let i = 0; i < INPUT_PLANE; i++) {
    const v = raw[i]!;
    if (v < lo) lo = v;
    if (v > hi) hi = v;
  }
  const range = hi - lo || 1;

  for (let i = 0; i < INPUT_PLANE; i++) {
    const norm = (raw[i]! - lo) / range;
    maskBuf[i] = Math.max(0, Math.min(255, Math.round(norm * 255)));
  }

  // lanczos3 keeps soft edges; nearest leaves visible jaggies on hair.
  const fullMask = await sharp(maskBuf, {
    raw: { width: INPUT_SIZE, height: INPUT_SIZE, channels: 1 },
  })
    .resize(width, height, { kernel: "lanczos3", fit: "fill" })
    .raw()
    .toBuffer();

  for (let i = 0; i < width * height; i++) {
    rgbaBuf[i * 4] = rgb[i * 3]!;
    rgbaBuf[i * 4 + 1] = rgb[i * 3 + 1]!;
    rgbaBuf[i * 4 + 2] = rgb[i * 3 + 2]!;
    rgbaBuf[i * 4 + 3] = fullMask[i]!;
  }
  return rgbaBuf;
}

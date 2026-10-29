import sharp from "sharp";
import { decodeMaskToRaster, parseImageStream, recordsOfKind, type ResponsesEvent, type SegmentationMask, type SegmentationMaskBounds } from "@meta-sam/parser";

export interface Mask {
  mask: SegmentationMask;
  bounds: SegmentationMaskBounds;
  confidence?: number;
}

/** Decode SAM 3.1's token text (one image) into masks with their source-pixel bounds. */
export async function parseSam(text: string): Promise<Mask[]> {
  if (!text.trim()) return [];
  const lane = { item_id: "m", output_index: 0, content_index: 0 };
  async function* events(): AsyncIterable<ResponsesEvent> {
    yield { type: "response.output_text.delta", ...lane, delta: text };
    yield { type: "response.output_text.done", ...lane, text };
    yield { type: "response.completed" };
  }
  const parsed = parseImageStream(events());
  for await (const _ of parsed) { /* drain snapshots; we only need the final result */ }
  const result = await parsed.finalResult;
  return recordsOfKind(result.records, "mask").map((r) => ({ mask: r.mask, bounds: r.bounds, confidence: r.confidence }));
}

/**
 * Cut one object out of the plate: crop to the mask's bounds and use the mask as alpha.
 * Returns the PNG and its placement on the stage (x centre %, y bottom %, w %).
 */
export async function cutout(plate: Buffer, m: Mask) {
  const meta = await sharp(plate).metadata();
  const W = meta.width!, H = meta.height!;
  const { left, top, right, bottom } = m.bounds;
  const bw = right - left, bh = bottom - top;
  const raster = decodeMaskToRaster(m.mask);
  // The raster may be coarser than its bounds; scale it up to the crop.
  const alpha = await sharp(Buffer.from(raster.map((v) => (v ? 255 : 0))), { raw: { width: m.mask.width, height: m.mask.height, channels: 1 } })
    .resize(bw, bh, { kernel: "nearest" })
    .blur(0.6)
    .raw()
    .toBuffer();
  const rgb = await sharp(plate).extract({ left, top, width: bw, height: bh }).removeAlpha().raw().toBuffer();
  const png = await sharp(rgb, { raw: { width: bw, height: bh, channels: 3 } }).joinChannel(alpha, { raw: { width: bw, height: bh, channels: 1 } }).png().toBuffer();
  return {
    png,
    x: +(((left + right) / 2 / W) * 100).toFixed(2),
    y: +((bottom / H) * 100).toFixed(2),
    w: +((bw / W) * 100).toFixed(2),
  };
}

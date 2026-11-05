import {
  FULL_QUALITY,
  IMAGE_MAX_EDGE,
  MEDIA_MAX_BYTES,
  PHOTO_MAX_EDGE,
  THUMB_EDGE,
  THUMB_QUALITY,
  type MediaVariant,
} from "../../shared/media";

export interface ProcessedImage {
  blob: Blob;
  width: number;
  height: number;
}

interface Decoded {
  source: CanvasImageSource;
  width: number;
  height: number;
  release: () => void;
}

const QUALITY_STEPS = [1, 0.85, 0.7, 0.55];

async function decode(file: File): Promise<Decoded> {
  if (!file.type.startsWith("image/")) throw new Error(`"${file.name}" is not an image`);

  if (typeof createImageBitmap === "function") {
    try {
      const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
      return { source: bitmap, width: bitmap.width, height: bitmap.height, release: () => bitmap.close() };
    } catch {
      void 0;
    }
  }

  const url = URL.createObjectURL(file);
  const img = new Image();
  img.src = url;
  try {
    await img.decode();
  } catch {
    URL.revokeObjectURL(url);
    throw new Error(`"${file.name}" could not be read as an image`);
  }
  return { source: img, width: img.naturalWidth, height: img.naturalHeight, release: () => URL.revokeObjectURL(url) };
}

function draw(decoded: Decoded, maxEdge: number): { canvas: HTMLCanvasElement; width: number; height: number } {
  const scale = Math.min(1, maxEdge / Math.max(decoded.width, decoded.height));
  const width = Math.max(1, Math.round(decoded.width * scale));
  const height = Math.max(1, Math.round(decoded.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("This browser cannot process images");
  context.imageSmoothingQuality = "high";
  context.drawImage(decoded.source, 0, 0, width, height);
  return { canvas, width, height };
}

function encode(canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob((blob) => resolve(blob), type, quality));
}

async function encodeWithin(canvas: HTMLCanvasElement, baseQuality: number, maxBytes: number): Promise<Blob> {
  let type = "image/webp";
  for (const step of QUALITY_STEPS) {
    const blob = await encode(canvas, type, baseQuality * step);
    if (!blob) throw new Error("The image could not be compressed");
    if (blob.type !== type && type === "image/webp") {
      type = "image/jpeg";
      const fallback = await encode(canvas, type, baseQuality * step);
      if (!fallback) throw new Error("The image could not be compressed");
      if (fallback.size <= maxBytes) return fallback;
      continue;
    }
    if (blob.size <= maxBytes) return blob;
  }
  throw new Error("The image is too large even after compression");
}

async function render(decoded: Decoded, maxEdge: number, quality: number, variant: MediaVariant): Promise<ProcessedImage> {
  const { canvas, width, height } = draw(decoded, maxEdge);
  const blob = await encodeWithin(canvas, quality, MEDIA_MAX_BYTES[variant]);
  return { blob, width, height };
}

export async function processGalleryImage(file: File): Promise<{ full: ProcessedImage; thumb: ProcessedImage }> {
  const decoded = await decode(file);
  try {
    const full = await render(decoded, IMAGE_MAX_EDGE, FULL_QUALITY, "full");
    const thumb = await render(decoded, THUMB_EDGE, THUMB_QUALITY, "thumb");
    return { full, thumb };
  } finally {
    decoded.release();
  }
}

export async function processPortrait(file: File): Promise<ProcessedImage> {
  const decoded = await decode(file);
  try {
    return await render(decoded, PHOTO_MAX_EDGE, FULL_QUALITY, "photo");
  } finally {
    decoded.release();
  }
}

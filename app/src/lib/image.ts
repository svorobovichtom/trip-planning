// Receipt photos before upload: downscale to <= 1600 px JPEG. Quick to
// upload and to read, and HEIC from iPhones becomes a JPEG the background
// scan accepts (the server only reads JPEG/PNG/WebP). PDFs go as they are.

export const MAX_SIDE = 1600;
export const MAX_BYTES = 10 * 1024 * 1024; // receipt field limit
const KEEP_JPEG_BYTES = 1.5e6;

/** Target size that fits `max` on the longer side; never upscales. */
export function fitSize(w: number, h: number, max = MAX_SIDE): { w: number; h: number; k: number } {
  if (!(w > 0) || !(h > 0)) return { w: 0, h: 0, k: 1 };
  const k = Math.min(1, max / Math.max(w, h));
  return { w: Math.max(1, Math.round(w * k)), h: Math.max(1, Math.round(h * k)), k };
}

/** A small JPEG that already fits is uploaded untouched. */
export function keepAsIs(type: string, size: number, w: number, h: number, max = MAX_SIDE): boolean {
  return type === "image/jpeg" && size < KEEP_JPEG_BYTES && Math.max(w, h) <= max;
}

/** Formats the background scan can read. */
export const SCANNABLE_TYPE = /^image\/(jpeg|png|webp)$/;
export const SCANNABLE_NAME = /\.(jpe?g|png|webp)$/i;
export const isPdf = (typeOrName: string) => /pdf$/i.test(typeOrName);

export const jpegName = (name: string) => (name || "receipt").replace(/\.[^.]+$/, "") + ".jpg";

/** Downscaled JPEG, or the original file if it can't be decoded (or is a PDF). */
export async function compressImage(file: File): Promise<File> {
  if (!/^image\//.test(file.type) && !/\.(heic|heif)$/i.test(file.name)) return file;
  try {
    const bmp = await createImageBitmap(file, { imageOrientation: "from-image" });
    try {
      if (keepAsIs(file.type, file.size, bmp.width, bmp.height)) return file;
      const t = fitSize(bmp.width, bmp.height);
      const c = document.createElement("canvas");
      c.width = t.w;
      c.height = t.h;
      const ctx = c.getContext("2d");
      if (!ctx) return file;
      ctx.drawImage(bmp, 0, 0, t.w, t.h);
      const blob = await new Promise<Blob | null>((r) => c.toBlob(r, "image/jpeg", 0.82));
      if (!blob) return file;
      return new File([blob], jpegName(file.name), { type: "image/jpeg" });
    } finally {
      bmp.close?.();
    }
  } catch {
    return file;
  }
}

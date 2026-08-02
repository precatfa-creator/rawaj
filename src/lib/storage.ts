import { supabase } from '../db/supabase';

export const PRODUCT_IMAGE_BUCKET = 'product-images';
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
export const ACCEPTED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/avif', 'image/gif'];

const EXTENSIONS: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/avif': 'avif',
  'image/gif': 'gif',
};

export type UploadResult = { url: string; message?: undefined } | { url?: undefined; message: string };

/**
 * Uploads one image and returns its public URL.
 *
 * The object key is generated rather than taken from the file name: Arabic
 * filenames do not round-trip cleanly through public URLs, and a shared name
 * would let one product silently overwrite another's image. `upsert: false`
 * makes any collision an error instead of a silent replacement.
 *
 * The checks here are for fast feedback only — the bucket enforces the same
 * size and MIME limits server-side.
 */
export const uploadProductImage = async (file: File): Promise<UploadResult> => {
  if (!ACCEPTED_IMAGE_TYPES.includes(file.type)) {
    return { message: 'الصيغة غير مدعومة. استخدم JPG أو PNG أو WEBP أو AVIF أو GIF.' };
  }
  if (file.size > MAX_IMAGE_BYTES) {
    return { message: 'حجم الصورة يتجاوز 5 ميجابايت.' };
  }

  const path = `${crypto.randomUUID()}.${EXTENSIONS[file.type] ?? 'bin'}`;
  const { error } = await supabase.storage
    .from(PRODUCT_IMAGE_BUCKET)
    .upload(path, file, { contentType: file.type, upsert: false, cacheControl: '31536000' });

  if (error) {
    console.error('uploadProductImage failed', error);
    return { message: 'تعذر رفع الصورة. حاول مرة أخرى.' };
  }

  const { data } = supabase.storage.from(PRODUCT_IMAGE_BUCKET).getPublicUrl(path);
  return { url: data.publicUrl };
};

/** Object key for a URL in our bucket, or null for anything hosted elsewhere. */
export const bucketPathFromUrl = (url: string): string | null => {
  const marker = `/storage/v1/object/public/${PRODUCT_IMAGE_BUCKET}/`;
  const index = url.indexOf(marker);
  if (index === -1) return null;
  const path = url.slice(index + marker.length).split('?')[0];
  return path ? decodeURIComponent(path) : null;
};

/**
 * Removes images belonging to our bucket. External URLs are ignored.
 *
 * ponytail: removing an image from a product's gallery does NOT delete the
 * object — only deleting the product does. That leaves occasional orphans, which
 * is the cheaper mistake: a cancel path that deleted a live image would lose
 * data the user still expects to be there. Add a sweeper if storage cost ever
 * matters.
 */
export const deleteProductImages = async (urls: string[]): Promise<void> => {
  const paths = urls.map(bucketPathFromUrl).filter((path): path is string => path !== null);
  if (paths.length === 0) return;
  const { error } = await supabase.storage.from(PRODUCT_IMAGE_BUCKET).remove(paths);
  if (error) console.error('deleteProductImages failed', error);
};

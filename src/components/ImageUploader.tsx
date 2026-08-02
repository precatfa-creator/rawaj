import React, { useId, useRef, useState } from 'react';
import { ImagePlus, Loader2, Star, Trash2, Upload } from 'lucide-react';
import { ACCEPTED_IMAGE_TYPES, uploadProductImage } from '../lib/storage';
import { ErrorNote } from './Confirm';

interface ImageUploaderProps {
  images: string[];
  onChange: (images: string[]) => void;
  max?: number;
}

/** Gallery uploader. The first image is the one the product card shows. */
export const ImageUploader: React.FC<ImageUploaderProps> = ({ images, onChange, max = 4 }) => {
  const id = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [dragging, setDragging] = useState(false);

  const remaining = max - images.length;

  const handleFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setError('');
    const batch = Array.from(files).slice(0, Math.max(0, remaining));
    if (batch.length === 0) {
      setError(`الحد الأقصى ${max} صور.`);
      return;
    }

    setBusy(true);
    const uploaded: string[] = [];
    for (const file of batch) {
      const result = await uploadProductImage(file);
      if (result.url) uploaded.push(result.url);
      else { setError(result.message); break; }
    }
    setBusy(false);
    if (uploaded.length > 0) onChange([...images, ...uploaded]);
    if (inputRef.current) inputRef.current.value = '';
  };

  const makeCover = (index: number) =>
    onChange([images[index], ...images.filter((_, i) => i !== index)]);

  const removeAt = (index: number) => onChange(images.filter((_, i) => i !== index));

  return (
    <div>
      <span className="block text-sm font-bold text-surface-700 mb-1.5">صور المنتج</span>

      {images.length > 0 && (
        <ul className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-3">
          {images.map((url, index) => (
            <li key={url} className="relative group rounded-xl overflow-hidden border border-surface-200 bg-surface-50 aspect-square">
              <img src={url} alt={`صورة المنتج ${index + 1}`} loading="lazy" className="w-full h-full object-cover" />

              {index === 0 && (
                <span className="absolute top-1.5 right-1.5 bg-primary-700 text-white text-[11px] font-bold px-2 py-0.5 rounded-md">
                  الغلاف
                </span>
              )}

              <div className="absolute inset-x-0 bottom-0 flex justify-center gap-1 p-1.5 bg-gradient-to-t from-surface-900/70 to-transparent transition-opacity md:opacity-0 md:group-hover:opacity-100 md:group-focus-within:opacity-100">
                {index !== 0 && (
                  <button
                    type="button"
                    onClick={() => makeCover(index)}
                    aria-label={`اجعل الصورة ${index + 1} غلافاً`}
                    title="اجعلها الغلاف"
                    className="w-9 h-9 grid place-items-center rounded-lg bg-white/90 text-surface-700 hover:text-primary-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
                  >
                    <Star size={15} />
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => removeAt(index)}
                  aria-label={`إزالة الصورة ${index + 1}`}
                  title="إزالة"
                  className="w-9 h-9 grid place-items-center rounded-lg bg-white/90 text-surface-700 hover:text-rose-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-500"
                >
                  <Trash2 size={15} />
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {remaining > 0 && (
        <label
          htmlFor={id}
          onDragOver={event => { event.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={event => { event.preventDefault(); setDragging(false); void handleFiles(event.dataTransfer.files); }}
          className={`flex flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed p-6 cursor-pointer transition-colors ${
            dragging ? 'border-primary-500 bg-primary-50' : 'border-surface-300 bg-surface-50 hover:border-primary-400 hover:bg-primary-50/40'
          } ${busy ? 'pointer-events-none opacity-70' : ''}`}
        >
          {busy ? <Loader2 size={22} className="animate-spin text-primary-700" /> : <ImagePlus size={22} className="text-primary-700" />}
          <span className="text-sm font-bold text-surface-800">
            {busy ? 'جارٍ الرفع…' : 'اسحب صورة هنا أو اضغط للاختيار'}
          </span>
          <span className="text-xs text-surface-500">
            JPG · PNG · WEBP · AVIF · GIF — حتى 5 ميجابايت — {remaining} متبقية
          </span>
          <input
            ref={inputRef}
            id={id}
            type="file"
            accept={ACCEPTED_IMAGE_TYPES.join(',')}
            multiple={remaining > 1}
            disabled={busy}
            onChange={event => void handleFiles(event.target.files)}
            className="sr-only"
          />
        </label>
      )}

      <div className="mt-2 flex items-center gap-2">
        <Upload size={14} className="text-surface-400 shrink-0" />
        <input
          type="url"
          dir="ltr"
          placeholder="أو الصق رابط صورة…"
          aria-label="إضافة صورة عبر رابط"
          onKeyDown={event => {
            if (event.key !== 'Enter') return;
            event.preventDefault();
            const input = event.currentTarget;
            const value = input.value.trim();
            if (!value) return;
            if (images.length >= max) { setError(`الحد الأقصى ${max} صور.`); return; }
            onChange([...images, value]);
            input.value = '';
            setError('');
          }}
          className="flex-1 bg-white border border-surface-200 rounded-lg px-3 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-primary-500/30"
        />
      </div>

      {error && <ErrorNote message={error} />}
    </div>
  );
};

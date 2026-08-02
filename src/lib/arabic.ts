const DIACRITICS_AND_TATWEEL = /[ً-ٰٟـ]/g;

/**
 * Folds the Arabic spelling variants users actually type into a single form so
 * search matches regardless of how the value was entered:
 * hamza/madda on alef, taa marbuta, alef maqsura, waw/yaa hamza, diacritics,
 * tatweel. Latin text is lowercased so SKU lookups are case-insensitive.
 */
export const normalizeArabic = (value: string): string =>
  value
    .replace(DIACRITICS_AND_TATWEEL, '')
    .replace(/[أإآٱ]/g, 'ا') // أ إ آ ٱ → ا
    .replace(/ة/g, 'ه') // ة → ه
    .replace(/ى/g, 'ي') // ى → ي
    .replace(/ؤ/g, 'و') // ؤ → و
    .replace(/ئ/g, 'ي') // ئ → ي
    .trim()
    .toLowerCase();

export const matchesSearch = (haystack: string, needle: string): boolean =>
  normalizeArabic(haystack).includes(normalizeArabic(needle));

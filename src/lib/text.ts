/**
 * Strips leading/trailing whitespace from every text value in a row payload, so
 * " طرابلس " and "طرابلس" never end up as two different cities.
 *
 * Applied at the row builders in mutations.ts rather than at each form: every
 * write goes through one of them, including the bulk importers, so no new code
 * path can forget it. Arrays are mapped element-wise (images/colors/sizes);
 * numbers, booleans and nulls pass through untouched.
 */
/**
 * A list a person typed into one field: sizes, or the zones a rep covers.
 *
 * Both Arabic and Latin separators are accepted because an Arabic keyboard
 * produces "،" and "؛" where the same person's English keyboard produces "," and
 * ";" — treating one of them as ordinary text would make "S، M" a single size.
 */
export const splitList = (value: string): string[] =>
  value.split(/[,،;؛\n]/).map(part => part.trim()).filter(Boolean);

export const trimRow = <T extends Record<string, unknown>>(row: T): T => {
  const out: Record<string, unknown> = {};
  Object.entries(row).forEach(([key, value]) => {
    if (typeof value === 'string') out[key] = value.trim();
    else if (Array.isArray(value)) out[key] = value.map(item => (typeof item === 'string' ? item.trim() : item));
    else out[key] = value;
  });
  return out as T;
};

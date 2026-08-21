import { splitList } from './text';
import type { OrderVariantValue, ProductVariant, ProductVariantOption } from '../types';

/**
 * Adds whatever a person just typed into one axis to the values it already has.
 *
 * Duplicates are dropped rather than rejected: a repeated value would produce a
 * second identical row in the combination matrix, each with its own stock box,
 * and no way to tell them apart. Pasting "أسود، أحمر، أسود" keeps the first two.
 */
export const addOptionValues = (values: readonly string[], typed: string): string[] => {
  const next = [...values];
  splitList(typed).forEach(value => { if (!next.includes(value)) next.push(value); });
  return next;
};

/** Stable identity for one combination; option ids and order come from the product. */
export const variantKey = (
  options: readonly ProductVariantOption[],
  values: Record<string, string>,
): string => JSON.stringify(options.map(option => [option.id, values[option.id] ?? '']));

/** Every possible combination in option order. An incomplete axis yields no variants. */
export const variantCombinations = (
  options: readonly ProductVariantOption[],
): Array<Record<string, string>> => {
  if (options.length === 0 || options.some(option => option.values.length === 0)) return [];
  return options.reduce<Array<Record<string, string>>>(
    (rows, option) => rows.flatMap(row => option.values.map(value => ({ ...row, [option.id]: value }))),
    [{}],
  );
};

export const variantSnapshot = (
  options: readonly ProductVariantOption[],
  variant: Pick<ProductVariant, 'optionValues'>,
): OrderVariantValue[] => options.map(option => ({
  option: option.name,
  value: variant.optionValues[option.id] ?? '',
})).filter(entry => entry.value !== '');

export const variantLabel = (
  values: readonly OrderVariantValue[] | undefined,
): string => (values ?? []).map(entry => `${entry.option}: ${entry.value}`).join(' · ');

type VariantQuantity = { variantId?: string; quantity: number };

/**
 * Repeatedly adding one product should walk through its sellable combinations.
 * Existing active orders already own their quantities, so those reservations
 * are added back only while deciding what that same order may still contain.
 */
export const nextVariantForOrder = (
  variants: readonly Pick<ProductVariant, 'id' | 'stock'>[],
  currentItems: readonly VariantQuantity[],
  reservedItems: readonly VariantQuantity[] = [],
): Pick<ProductVariant, 'id' | 'stock'> | undefined => {
  const quantities = (items: readonly VariantQuantity[]) => items.reduce<Map<string, number>>((map, item) => {
    if (item.variantId) map.set(item.variantId, (map.get(item.variantId) ?? 0) + item.quantity);
    return map;
  }, new Map());
  const ordered = quantities(currentItems);
  const reserved = quantities(reservedItems);
  const remaining = (variant: Pick<ProductVariant, 'id' | 'stock'>) =>
    variant.stock + (reserved.get(variant.id) ?? 0) - (ordered.get(variant.id) ?? 0);

  return variants.find(variant => !ordered.has(variant.id) && remaining(variant) > 0)
    ?? variants.find(variant => remaining(variant) > 0);
};

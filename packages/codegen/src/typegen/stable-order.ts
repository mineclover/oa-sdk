/**
 * Compare generated declaration keys by Unicode code point order.
 *
 * `localeCompare` follows the host locale, which would make generated output
 * differ across developer machines and CI runners.
 */
export function compareTypegenKeys(left: string, right: string): number {
  if (left === right) return 0
  return left < right ? -1 : 1
}

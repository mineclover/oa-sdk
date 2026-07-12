/**
 * OAS Responses Object에서 기본 상태 코드 선택
 *
 * 우선순위 (OAS 3.2 §4.8.16):
 *   1. 정확한 3자리 2xx (가장 낮은 것)
 *   2. 정확한 3자리 (2xx 없으면 가장 낮은 것)
 *   3. 범위 코드 2XX
 *   4. 범위 코드 (2XX 없으면 가장 낮은 것)
 *   5. default → 200
 */
export function pickDefaultStatus(responses: Record<string, unknown>): number {
  const keys = Object.keys(responses)

  const exact = keys.filter(k => /^[1-5]\d{2}$/.test(k)).map(Number).sort((a, b) => a - b)
  const ok2xx = exact.find(c => c >= 200 && c < 300)
  if (ok2xx !== undefined) return ok2xx
  if (exact.length > 0) return exact[0]!

  const ranges = keys.filter(k => /^[1-5]XX$/i.test(k)).sort()
  const range2xx = ranges.find(k => k[0] === '2')
  if (range2xx) return 200
  if (ranges.length > 0) return parseInt(ranges[0]![0]! + '00', 10)

  if (keys.includes('default')) return 200

  return 200
}

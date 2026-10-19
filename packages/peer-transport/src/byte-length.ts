/**
 * @oa-sdk/peer-transport — UTF-8 byte length without Node's Buffer
 *
 * The wire limits are byte limits, and this package runs in browsers, where
 * `Buffer` does not exist. The count matches `Buffer.byteLength(text, 'utf8')`
 * and `TextEncoder`: a lone surrogate is encoded as U+FFFD (3 bytes).
 */
export function utf8ByteLength(text: string): number {
  let bytes = 0
  for (let index = 0; index < text.length; index++) {
    const code = text.charCodeAt(index)
    if (code < 0x80) {
      bytes += 1
    } else if (code < 0x800) {
      bytes += 2
    } else if (code >= 0xd800 && code <= 0xdbff && index + 1 < text.length && (text.charCodeAt(index + 1) & 0xfc00) === 0xdc00) {
      // A surrogate pair is one code point outside the BMP.
      bytes += 4
      index++
    } else {
      bytes += 3
    }
  }
  return bytes
}

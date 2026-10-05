/**
 * Replaces `owner[key]` with an own property holding `value` and returns the
 * undo, which restores the original own property (or removes the replacement
 * when there was none, uncovering an inherited one again).
 */
export function replaceProperty(owner: object, key: PropertyKey, value: unknown): () => void {
  const original = Object.getOwnPropertyDescriptor(owner, key)
  Object.defineProperty(owner, key, { value, configurable: true, writable: true, enumerable: original?.enumerable ?? true })
  return () => {
    if (original) Object.defineProperty(owner, key, original)
    else Reflect.deleteProperty(owner, key)
  }
}

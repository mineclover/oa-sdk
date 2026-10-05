/**
 * Observes whether the mock generated a response, without touching the
 * generator.
 *
 * Generating a response, or the events of a stream, from a schema reads that
 * schema, while serving a response generated earlier does not, and neither
 * does validating against a schema the validator compiled earlier. A spy on
 * `generator.fold` cannot show this: replacing a method of the shared
 * generator customizes it, and the mock then generates every response anew.
 */

export type ReadCounter = {
  /** Number of looks at the watched object so far. */
  reads(): number
}

/**
 * Replaces `owner[key]` with a proxy that counts every look at it: property
 * reads, `in` checks, own-key listings and descriptor lookups.
 */
export function countReads(owner: object, key: PropertyKey): ReadCounter {
  const target: unknown = Reflect.get(owner, key)
  if (target === null || typeof target !== 'object') throw new Error(`expected an object at ${String(key)}`)
  let reads = 0
  const count = () => { reads += 1 }
  Reflect.set(owner, key, new Proxy(target, {
    get: (object, property, receiver) => (count(), Reflect.get(object, property, receiver)),
    has: (object, property) => (count(), Reflect.has(object, property)),
    ownKeys: (object) => (count(), Reflect.ownKeys(object)),
    getOwnPropertyDescriptor: (object, property) => (count(), Reflect.getOwnPropertyDescriptor(object, property)),
  }))
  return { reads: () => reads }
}

import { readFileSync } from 'node:fs'
import { dirname, relative, resolve } from 'node:path'
import { parse as parseYaml } from 'yaml'
import { appendJsonPointer, formatJsonPointer, isRelativeRef, parseJsonPointer } from '@oa-sdk/parser'

/** Fields of a Reference Object that override those of its target (OpenAPI 3.1+). */
const REFERENCE_OVERRIDE_FIELDS = new Set(['summary', 'description'])

/** Where a `$ref` points: a JSON pointer into one file. */
interface RefTarget {
  file: string
  pointer: string
}

/** A `$ref` as written: its value, the file it is written in, and the output pointer it is bundled at. */
interface RefSite {
  ref: string
  file: string
  at: string
}

/**
 * `document`, read from the file `entryPath`, as one self-contained document: every `$ref` to
 * another file (a path relative to the file the ref is written in, with or without a JSON pointer
 * fragment) is replaced by a copy of what it names, so the document means the same wherever it is
 * written and whatever later happens to the files it referred to. `oa-gen normalize` writes this,
 * and `oa-gen diff` compares this, so a change made in a referenced file is a change of the spec.
 *
 * - A `components` entry that is just a `$ref` to another file gets the copy, and every other `$ref`
 *   to the same target refers to that entry (`#/components/...`).
 * - Any other `$ref` to another file is replaced by the copy in place. Fields next to the `$ref`
 *   keep their meaning: `summary`, `description` and `x-` extensions override those of the copy,
 *   other (JSON Schema) fields apply with it, through `allOf`; in OpenAPI 3.0 and Swagger 2.0, where
 *   fields next to a `$ref` are ignored, they are dropped.
 * - A `$ref` inside a copy that leads back to a target being copied refers to that copy (recursion).
 * - A `$ref` into the entry document is a fragment (`#...`): one written in another file, or naming
 *   the entry file, becomes one. A `$ref` to a URL is kept as written, and not followed.
 *
 * Throws when a referenced file cannot be read or does not contain the target.
 */
export function bundleExternalRefs(document: Record<string, unknown>, entryPath: string): Record<string, unknown> {
  return new ExternalRefBundler(document, resolve(entryPath)).bundle()
}

class ExternalRefBundler {
  private readonly documents = new Map<string, unknown>()
  /**
   * Targets with a `components` entry of the entry document that is just a `$ref` to them, with
   * the output pointer of that entry, which holds their copy.
   */
  private readonly homes = new Map<string, string>()
  /** Targets being copied, with the pointer of their copy in the output: refs to them are recursion. */
  private readonly copying = new Map<string, string>()
  private readonly siblingsIgnored: boolean

  constructor(
    private readonly document: Record<string, unknown>,
    private readonly entryFile: string,
  ) {
    this.documents.set(entryFile, document)
    this.siblingsIgnored = typeof document.swagger === 'string'
      || (typeof document.openapi === 'string' && document.openapi.startsWith('3.0'))
  }

  bundle(): Record<string, unknown> {
    this.findComponentHomes()
    return this.visit(this.document, '', this.entryFile) as Record<string, unknown>
  }

  private findComponentHomes(): void {
    const components = this.document.components
    if (!isRecord(components)) return
    for (const [section, entries] of Object.entries(components)) {
      if (!isRecord(entries)) continue
      for (const [name, entry] of Object.entries(entries)) {
        if (!isRecord(entry) || typeof entry.$ref !== 'string' || Object.keys(entry).length !== 1) continue
        const at = formatJsonPointer(['components', section, name])
        const target = this.locate({ ref: entry.$ref, file: this.entryFile, at })
        if (target === undefined || target.file === this.entryFile) continue
        const key = targetKey(target)
        if (!this.homes.has(key)) this.homes.set(key, at)
      }
    }
  }

  /** The output for `value`, written in `file`, placed at the JSON pointer `at` of the output. */
  private visit(value: unknown, at: string, file: string): unknown {
    if (Array.isArray(value)) return value.map((item, index) => this.visit(item, appendJsonPointer(at, index), file))
    if (!isRecord(value)) return value
    if (typeof value.$ref === 'string') return this.visitRef(value, value.$ref, at, file)
    return this.visitFields(value, at, file)
  }

  private visitFields(value: Record<string, unknown>, at: string, file: string): Record<string, unknown> {
    const output: Record<string, unknown> = {}
    for (const [key, child] of Object.entries(value)) {
      output[key] = this.visit(child, appendJsonPointer(at, key), file)
    }
    return output
  }

  private visitRef(value: Record<string, unknown>, ref: string, at: string, file: string): unknown {
    const site: RefSite = { ref, file, at }
    const target = this.locate(site)
    // A ref to a URL is not followed.
    if (target === undefined) return this.visitFields(value, at, file)
    if (target.file === this.entryFile) {
      // A fragment-only ref of the entry document stays as written; one naming the entry file by
      // name, or written in another file, becomes a fragment, as the bundle may be written elsewhere.
      const local = file === this.entryFile && ref.startsWith('#') ? ref : `#${target.pointer}`
      return { ...this.visitFields(value, at, file), $ref: local }
    }

    const key = targetKey(target)
    const existing = this.copying.get(key) ?? this.homeOtherThan(key, at)
    if (existing !== undefined) return { ...this.visitFields(value, at, file), $ref: `#${existing}` }

    const { $ref: _ref, ...fields } = value
    const siblings = Object.keys(fields)
    if (siblings.length === 0 || this.siblingsIgnored) return this.copy(site, target, at)

    const visited = this.visitFields(fields, at, file)
    if (siblings.every(isOverrideField)) {
      const copy = this.copy(site, target, at)
      if (isRecord(copy)) return { ...copy, ...visited }
    }
    const allOf = visited.allOf === undefined ? [] : Array.isArray(visited.allOf) ? visited.allOf : [visited.allOf]
    const copy = this.copy(site, target, appendJsonPointer(appendJsonPointer(at, 'allOf'), allOf.length))
    return { ...visited, allOf: [...allOf, copy] }
  }

  /** The output pointer of the `components` entry that holds the copy of `key`, unless it is `at`. */
  private homeOtherThan(key: string, at: string): string | undefined {
    const home = this.homes.get(key)
    return home === at ? undefined : home
  }

  /** A copy of the target of the ref at `site`, placed at `at`, with the refs in it bundled. */
  private copy(site: RefSite, target: RefTarget, at: string): unknown {
    const content = this.read(site, target)
    const key = targetKey(target)
    this.copying.set(key, at)
    try {
      return this.visit(content, at, target.file)
    } finally {
      this.copying.delete(key)
    }
  }

  /** Where the ref at `site` points; undefined for a URL. */
  private locate(site: RefSite): RefTarget | undefined {
    const { ref, file } = site
    const hash = ref.indexOf('#')
    const filePart = hash === -1 ? ref : ref.slice(0, hash)
    if (filePart !== '' && !isRelativeRef(ref)) return undefined

    const fragment = hash === -1 ? '' : ref.slice(hash + 1)
    let tokens: string[] | undefined
    try {
      tokens = parseJsonPointer(decodeURIComponent(fragment))
    } catch {
      tokens = undefined
    }
    if (tokens === undefined) {
      // A plain-name fragment (`#name`) is an anchor inside the document: kept, never copied.
      if (filePart === '' && file === this.entryFile) return { file, pointer: fragment }
      throw this.error(site, `"#${fragment}" is not a JSON pointer`)
    }
    return { file: filePart === '' ? file : resolve(dirname(file), filePart), pointer: formatJsonPointer(tokens) }
  }

  /** The target of the ref at `site`. */
  private read(site: RefSite, target: RefTarget): unknown {
    let document = this.documents.get(target.file)
    if (document === undefined) {
      try {
        const raw = readFileSync(target.file, 'utf8')
        document = target.file.endsWith('.json') ? JSON.parse(raw) : parseYaml(raw)
      } catch (error) {
        throw this.error(site, `cannot read ${this.display(target.file)}: ${errorMessage(error)}`, error)
      }
      this.documents.set(target.file, document)
    }

    let current = document
    for (const token of parseJsonPointer(target.pointer) ?? []) {
      if (current === null || typeof current !== 'object' || !Object.prototype.hasOwnProperty.call(current, token)) {
        throw this.error(site, `${this.display(target.file)} has nothing at #${target.pointer}`)
      }
      current = (current as Record<string, unknown>)[token]
    }
    return current
  }

  private error(site: RefSite, reason: string, cause?: unknown): Error {
    return new Error(
      `$ref "${site.ref}" in ${this.display(site.file)} (at #${site.at} of the bundled document): ${reason}`,
      cause === undefined ? undefined : { cause },
    )
  }

  /** `file` relative to the directory of the entry document, as messages name it. */
  private display(file: string): string {
    return relative(dirname(this.entryFile), file) || file
  }
}

function targetKey(target: RefTarget): string {
  return `${target.file}#${target.pointer}`
}

function isOverrideField(field: string): boolean {
  return REFERENCE_OVERRIDE_FIELDS.has(field) || field.startsWith('x-')
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

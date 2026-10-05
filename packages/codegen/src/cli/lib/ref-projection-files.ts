import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { parse as parseYaml } from 'yaml'
import { parseBuildSpecProvenanceMap } from './provenance-report.js'
import {
  createRefProjectionArtifact,
  rootRelativePath,
  type RefProjectionArtifact,
  type RefProjectionArtifactGenerator,
  type RefProjectionArtifactSourceFile,
} from './ref-projection-artifact.js'

export type CreateRefProjectionArtifactFromFilesOptions = {
  /** OpenAPI YAML or JSON entry document. */
  specPath: string
  /** Provenance map JSON written by `oa-gen build-spec --provenance`. */
  provenancePath?: string
  /**
   * Project root: relative input paths resolve against it, and the input files
   * and the fragment `sourcePath`s of the provenance map are written relative
   * to it with `/` separators.
   */
  root: string
  generator: RefProjectionArtifactGenerator
}

/**
 * Read an OpenAPI document and, optionally, its build-spec provenance map,
 * and project them into an `oa-sdk.ref-projection.v1` artifact. Each input is
 * identified by its root-relative path and the SHA-256 of its bytes.
 * Unreadable or malformed input throws.
 */
export function createRefProjectionArtifactFromFiles(
  options: CreateRefProjectionArtifactFromFilesOptions,
): RefProjectionArtifact {
  const specPath = resolve(options.root, options.specPath)
  if (specPath.endsWith('.tsp')) {
    throw new Error(`TypeSpec 문서는 직접 투영하지 않습니다. OpenAPI로 compile한 결과를 spec으로 전달하세요: ${specPath}`)
  }
  const spec = readInputFile('spec', specPath, options.root)
  const document = parseSpecDocument(spec.text, specPath)

  const provenance = options.provenancePath === undefined
    ? undefined
    : readProvenance(resolve(options.root, options.provenancePath), options.root)

  return createRefProjectionArtifact({
    document,
    entryPath: specPath,
    spec: spec.source,
    ...(provenance !== undefined ? { provenance } : {}),
    generator: options.generator,
  })
}

type InputFile = {
  text: string
  source: RefProjectionArtifactSourceFile
}

function readInputFile(label: string, path: string, root: string): InputFile {
  let bytes: Buffer
  try {
    bytes = readFileSync(path)
  } catch (error) {
    throw new Error(`${label} 파일을 읽을 수 없습니다: ${path} (${errorMessage(error)})`)
  }
  return {
    text: bytes.toString('utf8'),
    source: {
      path: rootRelativePath(root, path),
      contentHash: `sha256:${createHash('sha256').update(bytes).digest('hex')}`,
    },
  }
}

function parseSpecDocument(text: string, path: string): Record<string, unknown> {
  let parsed: unknown
  try {
    parsed = path.endsWith('.json') ? JSON.parse(text) : parseYaml(text)
  } catch (error) {
    throw new Error(`spec 파일을 파싱할 수 없습니다: ${path} (${errorMessage(error)})`)
  }
  if (!isRecord(parsed)) {
    throw new Error(`spec 파일은 OpenAPI 문서 객체여야 합니다: ${path}`)
  }
  return parsed
}

function readProvenance(path: string, root: string) {
  const file = readInputFile('provenance', path, root)
  let parsed: unknown
  try {
    parsed = JSON.parse(file.text)
  } catch (error) {
    throw new Error(`provenance 파일을 파싱할 수 없습니다: ${path} (${errorMessage(error)})`)
  }
  return { map: parseBuildSpecProvenanceMap(parsed, path), source: file.source, root }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

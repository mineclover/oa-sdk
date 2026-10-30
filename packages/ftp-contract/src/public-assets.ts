import { existsSync, readFileSync } from 'node:fs'

/** Read a declaration asset from source checkouts or the sanitized dist tree. */
export function readPublicAsset(path: string): string {
  const candidates = [
    new URL(`../${path}`, import.meta.url),
    new URL(`./${path}`, import.meta.url),
  ]
  const asset = candidates.find(candidate => existsSync(candidate))
  if (asset === undefined) throw new Error(`FTP contract asset not found: ${path}`)
  return readFileSync(asset, 'utf8')
}

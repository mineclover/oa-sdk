import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

/**
 * An API in three files: the spec refers to a response schema in
 * `schemas.yaml` and to the path item of `/users/{id}` in `paths/user.yaml`,
 * which refers back to the schemas. `getUser` and `deleteUser` are defined only
 * in that path item.
 */
export const MULTI_FILE_SPEC: Readonly<Record<string, string>> = {
  'api/contract.yaml': `openapi: 3.2.0
info: { title: Multi-file API, version: 1.0.0 }
paths:
  /health:
    get:
      operationId: getHealth
      responses:
        '200':
          description: OK
          content:
            application/json:
              schema: { $ref: './schemas.yaml#/Health' }
  /users/{id}:
    $ref: './paths/user.yaml'
    parameters:
      - { name: id, in: path, required: true, schema: { type: string } }
`,
  'api/schemas.yaml': `Health:
  type: object
  required: [ok]
  properties:
    ok: { type: boolean }
User:
  type: object
  required: [id]
  properties:
    id: { type: string }
`,
  'api/paths/user.yaml': `get:
  operationId: getUser
  responses:
    '200':
      description: OK
      content:
        application/json:
          schema: { $ref: '../schemas.yaml#/User' }
delete:
  operationId: deleteUser
  responses:
    '204': { description: Deleted }
`,
}

/** The spec file of MULTI_FILE_SPEC, relative to the directory it is written to. */
export const MULTI_FILE_SPEC_ENTRY = 'api/contract.yaml'

/** Writes `files` (relative path to content) under `root`. */
export function writeSpecFiles(root: string, files: Readonly<Record<string, string>>): void {
  for (const [file, content] of Object.entries(files)) {
    const path = join(root, file)
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, content)
  }
}

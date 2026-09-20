import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import * as os from 'node:os'
import * as path from 'node:path'
import * as fs from 'node:fs'
import { generateClientCommand, packClientCommand } from '../../cli/commands/generate-client.js'

describe('CLI: oa-gen pack:client / generate:client --pack', () => {
  let tmpDir: string
  let sampleSpecPath: string

  const sampleSpecYaml = `
openapi: 3.1.0
info:
  title: Standalone Package Test API
  version: 1.0.0
paths:
  /users:
    get:
      operationId: listUsers
      summary: List all users
      responses:
        '200':
          description: List of users
          content:
            application/json:
              schema:
                type: array
                items:
                  type: object
                  required:
                    - id
                    - name
                  properties:
                    id:
                      type: string
                    name:
                      type: string
    post:
      operationId: createUser
      summary: Create user
      requestBody:
        required: true
        content:
          application/json:
            schema:
              type: object
              required:
                - name
              properties:
                name:
                  type: string
      responses:
        '201':
          description: Created user
          content:
            application/json:
              schema:
                type: object
                required:
                  - id
                  - name
                properties:
                  id:
                    type: string
                  name:
                    type: string
`

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'oa-pack-client-test-'))
    sampleSpecPath = path.join(tmpDir, 'spec.yaml')
    fs.writeFileSync(sampleSpecPath, sampleSpecYaml, 'utf8')
  })

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  it('builds a standalone client SDK package with dist/ and 0 runtime dependencies via --pack', async () => {
    const outPkgDir = path.join(tmpDir, 'packages/my-api-client')

    await generateClientCommand.run(
      {
        spec: sampleSpecPath,
        pack: true,
        output: outPkgDir,
        name: '@test/my-api-client',
        'package-version': '2.4.0',
        description: 'Test client package',
      },
      { cwd: tmpDir, projectRoot: tmpDir },
    )

    // 1. Verify directory structure
    expect(fs.existsSync(path.join(outPkgDir, 'package.json'))).toBe(true)
    expect(fs.existsSync(path.join(outPkgDir, 'README.md'))).toBe(true)
    expect(fs.existsSync(path.join(outPkgDir, 'src/types.ts'))).toBe(true)
    expect(fs.existsSync(path.join(outPkgDir, 'src/client.ts'))).toBe(true)
    expect(fs.existsSync(path.join(outPkgDir, 'src/index.ts'))).toBe(true)

    // 2. Verify compiled dist/ outputs
    expect(fs.existsSync(path.join(outPkgDir, 'dist/index.js'))).toBe(true)
    expect(fs.existsSync(path.join(outPkgDir, 'dist/index.d.ts'))).toBe(true)
    expect(fs.existsSync(path.join(outPkgDir, 'dist/client.js'))).toBe(true)
    expect(fs.existsSync(path.join(outPkgDir, 'dist/client.d.ts'))).toBe(true)
    expect(fs.existsSync(path.join(outPkgDir, 'dist/types.d.ts'))).toBe(true)

    // 3. Verify package.json contents
    const pkg = JSON.parse(fs.readFileSync(path.join(outPkgDir, 'package.json'), 'utf8'))
    expect(pkg.name).toBe('@test/my-api-client')
    expect(pkg.version).toBe('2.4.0')
    expect(pkg.description).toBe('Test client package')
    expect(pkg.type).toBe('module')
    expect(pkg.main).toBe('./dist/index.js')
    expect(pkg.types).toBe('./dist/index.d.ts')
    expect(pkg.exports['.'].import).toBe('./dist/index.js')
    expect(pkg.exports['.'].types).toBe('./dist/index.d.ts')
    expect(pkg.dependencies).toEqual({}) // MUST be 0 runtime dependencies

    // 4. Verify compiled JS contains createApiClient
    const distJs = fs.readFileSync(path.join(outPkgDir, 'dist/index.js'), 'utf8')
    expect(distJs).toContain('export')

    const clientJs = fs.readFileSync(path.join(outPkgDir, 'dist/client.js'), 'utf8')
    expect(clientJs).toContain('createClient')
  })

  it('packClientCommand alias runs identically to generate:client --pack', async () => {
    const outPkgDir = path.join(tmpDir, 'packages/aliased-client')

    await packClientCommand.run(
      {
        spec: sampleSpecPath,
        output: outPkgDir,
        name: '@test/aliased-client',
      },
      { cwd: tmpDir, projectRoot: tmpDir },
    )

    expect(fs.existsSync(path.join(outPkgDir, 'package.json'))).toBe(true)
    expect(fs.existsSync(path.join(outPkgDir, 'dist/index.js'))).toBe(true)
    expect(fs.existsSync(path.join(outPkgDir, 'dist/index.d.ts'))).toBe(true)

    const pkg = JSON.parse(fs.readFileSync(path.join(outPkgDir, 'package.json'), 'utf8'))
    expect(pkg.name).toBe('@test/aliased-client')
    expect(pkg.dependencies).toEqual({})
  })
})

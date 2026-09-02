import { describe, expect, it } from 'vitest'
import * as path from 'node:path'
import * as fs from 'node:fs/promises'
import * as fsSync from 'node:fs'
import ts from 'typescript'
import * as yaml from 'yaml'
import { z } from 'zod'

describe('Documentation Syntax & Schema Architecture Hardening Suite (R4)', () => {
  const docPath = '/Users/junwoobang/workflow/browser-studio/docs/guides/schema-architecture-and-conventions.md'

  const readDoc = async (): Promise<string> => {
    return await fs.readFile(docPath, 'utf8')
  }

  interface ExtractedSnippet {
    index: number
    lang: string
    code: string
    startLine: number
  }

  const extractSnippets = (content: string): ExtractedSnippet[] => {
    const lines = content.split(/\r?\n/)
    const snippets: ExtractedSnippet[] = []
    let inBlock = false
    let currentLang = ''
    let currentLines: string[] = []
    let blockStartIndex = 0
    let snippetCount = 0

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]!
      if (line.startsWith('```')) {
        if (!inBlock) {
          inBlock = true
          currentLang = line.replace(/^```/, '').trim()
          currentLines = []
          blockStartIndex = i + 1
        } else {
          inBlock = false
          snippetCount++
          snippets.push({
            index: snippetCount,
            lang: currentLang || 'unspecified',
            code: currentLines.join('\n'),
            startLine: blockStartIndex,
          })
        }
      } else if (inBlock) {
        currentLines.push(line)
      }
    }
    return snippets
  }

  // =========================================================================
  // 1. EXTRACTION & SYNTAX VALIDATION OF ALL CODE SNIPPETS
  // =========================================================================
  describe('Markdown Code Snippet Extraction & Parsing', () => {
    it('verifies that the convention guide file exists and is populated (>50KB)', async () => {
      expect(fsSync.existsSync(docPath)).toBe(true)
      const stat = await fs.stat(docPath)
      expect(stat.size).toBeGreaterThan(50000)
    })

    it('extracts and syntax-checks all TypeScript snippets with zero parse diagnostics', async () => {
      const content = await readDoc()
      const snippets = extractSnippets(content)
      const tsSnippets = snippets.filter(s => s.lang === 'typescript' || s.lang === 'ts')

      expect(tsSnippets.length).toBeGreaterThanOrEqual(10)

      for (const snippet of tsSnippets) {
        const sourceFile = ts.createSourceFile(
          `doc_snippet_${snippet.index}.ts`,
          snippet.code,
          ts.ScriptTarget.Latest,
          true,
          ts.ScriptKind.TS,
        )

        const parseDiagnostics = (sourceFile as any).parseDiagnostics || []
        if (parseDiagnostics.length > 0) {
          const formatted = parseDiagnostics.map((d: any) => d.messageText).join(', ')
          throw new Error(
            `TypeScript syntax diagnostic error in snippet #${snippet.index} (line ${snippet.startLine}): ${formatted}\nCode:\n${snippet.code}`,
          )
        }
        expect(parseDiagnostics).toHaveLength(0)
      }
    })

    it('extracts and parses all JSON snippets as valid JSON documents', async () => {
      const content = await readDoc()
      const snippets = extractSnippets(content)
      const jsonSnippets = snippets.filter(s => s.lang === 'json')

      expect(jsonSnippets.length).toBeGreaterThanOrEqual(4)

      for (const snippet of jsonSnippets) {
        expect(() => {
          try {
            JSON.parse(snippet.code)
          } catch (err: any) {
            throw new Error(
              `JSON parse error in snippet #${snippet.index} (line ${snippet.startLine}): ${err.message}\nCode:\n${snippet.code}`,
            )
          }
        }).not.toThrow()
      }
    })

    it('extracts and parses all YAML snippets as valid YAML documents', async () => {
      const content = await readDoc()
      const snippets = extractSnippets(content)
      const yamlSnippets = snippets.filter(s => s.lang === 'yaml' || s.lang === 'yml')

      expect(yamlSnippets.length).toBeGreaterThanOrEqual(2)

      for (const snippet of yamlSnippets) {
        expect(() => {
          try {
            yaml.parse(snippet.code)
          } catch (err: any) {
            throw new Error(
              `YAML parse error in snippet #${snippet.index} (line ${snippet.startLine}): ${err.message}\nCode:\n${snippet.code}`,
            )
          }
        }).not.toThrow()
      }
    })
  })

  // =========================================================================
  // 2. RFC 9457 PROBLEM DETAILS SCHEMA VERIFICATION
  // =========================================================================
  describe('RFC 9457 Problem Details Master Schema Conformance', () => {
    // Re-create the master ProblemDetailsSchema as specified in the guide
    const InvalidParamSchema = z.object({
      name: z.string().min(1).describe('Name of the invalid parameter or property'),
      reason: z.string().min(1).describe('Human-readable description of the constraint violation'),
      path: z.string().optional().describe('JSON pointer or path to the invalid property'),
      code: z.string().optional().describe('Machine-readable validation code'),
    })

    const ProblemDetailsSchema = z.object({
      type: z.string().url().default('about:blank'),
      title: z.string().min(1),
      status: z.number().int().min(100).max(599),
      detail: z.string().optional(),
      instance: z.string().optional(),
      code: z.string().min(1).optional(),
      invalidParams: z.array(InvalidParamSchema).optional(),
      details: z.record(z.string(), z.unknown()).optional(),
    })

    it('validates 422 Unprocessable Content error payload matching RFC 9457 standard', () => {
      const payload422 = {
        type: 'https://browser-studio.dev/errors/validation-failed',
        title: 'Validation Error',
        status: 422,
        detail: 'Invalid surface patch range offsets',
        instance: '/rpc/materialize.css#tx-001',
        code: 'RANGE_OUT_OF_BOUNDS',
        invalidParams: [
          { name: 'start', reason: 'Start offset exceeds document length', path: '/range/start', code: 'MAX_VIOLATION' },
        ],
        details: { documentLength: 1024, requestedStart: 1050 },
      }

      const parsed = ProblemDetailsSchema.parse(payload422)
      expect(parsed.status).toBe(422)
      expect(parsed.invalidParams).toHaveLength(1)
      expect(parsed.invalidParams![0]!.name).toBe('start')
    })

    it('validates 409 Lease Conflict error payload matching RFC 9457 standard', () => {
      const payload409 = {
        type: 'https://browser-studio.dev/errors/lease-conflict',
        title: 'Lease Conflict',
        status: 409,
        detail: 'The requested workspace resource is currently locked by another agent session',
        instance: '/rpc/lease.acquire',
        code: 'LEASE_CONFLICT',
        details: {
          activeLeaseToken: 'lease-9a8b',
          holderSessionId: 'agent-session-42',
          expiresAt: 1725300500,
        },
      }

      const parsed = ProblemDetailsSchema.parse(payload409)
      expect(parsed.status).toBe(409)
      expect(parsed.code).toBe('LEASE_CONFLICT')
    })

    it('validates 500 Internal Error payload with default type "about:blank"', () => {
      const payload500 = {
        type: 'about:blank',
        title: 'Internal Server Error',
        status: 500,
        detail: 'Unexpected filesystem read error on host',
      }

      const parsed = ProblemDetailsSchema.parse(payload500)
      expect(parsed.status).toBe(500)
      expect(parsed.type).toBe('about:blank')
    })

    it('rejects invalid problem details payloads (status out of range or empty title)', () => {
      expect(() => {
        ProblemDetailsSchema.parse({
          type: 'about:blank',
          title: '', // empty title
          status: 422,
        })
      }).toThrow()

      expect(() => {
        ProblemDetailsSchema.parse({
          type: 'about:blank',
          title: 'Error',
          status: 99, // status < 100
        })
      }).toThrow()

      expect(() => {
        ProblemDetailsSchema.parse({
          type: 'about:blank',
          title: 'Error',
          status: 600, // status > 599
        })
      }).toThrow()
    })
  })

  // =========================================================================
  // 3. RECURSIVE SCHEMAS WITH Z.LAZY & CYCLIC $REF
  // =========================================================================
  describe('Recursive Schemas with z.lazy Specification', () => {
    interface TreeNode {
      id: string
      children?: TreeNode[]
    }

    const TreeNodeSchema: z.ZodType<TreeNode> = z.lazy(() =>
      z.object({
        id: z.string().min(1),
        children: z.array(TreeNodeSchema).optional(),
      }),
    )

    it('validates multi-level nested recursive tree structures', () => {
      const tree: TreeNode = {
        id: 'root',
        children: [
          {
            id: 'child-1',
            children: [
              { id: 'leaf-1-1' },
              { id: 'leaf-1-2' },
            ],
          },
          { id: 'child-2' },
        ],
      }

      const parsed = TreeNodeSchema.parse(tree)
      expect(parsed.children).toHaveLength(2)
      expect(parsed.children![0]!.children).toHaveLength(2)
    })

    it('rejects invalid node elements within nested recursion', () => {
      const invalidTree = {
        id: 'root',
        children: [
          { id: '' }, // empty id fails min(1)
        ],
      }

      expect(() => TreeNodeSchema.parse(invalidTree)).toThrow()
    })
  })

  // =========================================================================
  // 4. NORMATIVE SECTIONS & CONVENTIONS COMPLETENESS
  // =========================================================================
  describe('Normative Convention Content Verification', () => {
    it('verifies presence of all 17 Native RPC operations in the table and text', async () => {
      const content = await readDoc()
      const requiredRpcOps = [
        'session.hello',
        'workspace.list',
        'workspace.approve',
        'workspace.snapshot.save',
        'binding.resolve',
        'binding.verify-style',
        'source.inspect',
        'materialize.css',
        'materialize.rollback',
        'mcp.control',
        'journal.get',
        'diff.preview',
        'lease.acquire',
        'lease.renew',
        'lease.release',
        'lease.inspect',
        'utility.patch',
      ]

      for (const op of requiredRpcOps) {
        expect(content).toContain(op)
      }
    })

    it('verifies presence of all 14 MCP operations in the table and text', async () => {
      const content = await readDoc()
      const requiredMcpOps = [
        'session.status',
        'tabs.list',
        'targets.list',
        'selection.select',
        'style.inspect',
        'preview.style',
        'commit.style',
        'rollback',
        'history.get',
        'diff.preview',
        'lease.acquire',
        'lease.renew',
        'lease.release',
        'lease.inspect',
      ]

      for (const op of requiredMcpOps) {
        expect(content).toContain(op)
      }
    })

    it('verifies x-surface-* scope rules (targetProperty vs inline)', async () => {
      const content = await readDoc()
      expect(content).toMatch(/x-surface-/i)
      expect(content).toContain('targetProperty')
    })

    it('verifies V3 Unified Architecture JSDoc tag specifications (@minimum, @format, @discriminator)', async () => {
      const content = await readDoc()
      expect(content).toContain('@minimum')
      expect(content).toContain('@format')
      expect(content).toContain('@discriminator')
    })
  })
})

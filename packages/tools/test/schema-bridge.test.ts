import { describe, expect, it } from 'vitest'
import {
  createSchemaTool,
  createMcpServer,
  createCli,
  createToolContext,
  executeTool,
  promptMissingFields,
} from '../src/index.js'

describe('@oa-sdk/tools — TypeSpec JSON Schema to Tool Bridge', () => {
  // Simulating a TypeSpec-generated JSON Schema Draft 2020-12 definition
  const typeSpecUploadSchema = {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    type: 'object',
    properties: {
      id: { type: 'string', description: 'Internal database identifier' },
      name: { type: 'string', description: 'File name with extension' },
      content: { type: 'string', description: 'File body content' },
      folderId: { type: 'string', description: 'Target folder ID' },
      role: {
        type: 'string',
        enum: ['viewer', 'editor', 'owner'],
        default: 'viewer',
        description: 'Initial permission role',
      },
      auditSecret: { type: 'string', description: 'Internal audit secret token' },
    },
    required: ['id', 'name', 'content'],
  }

  describe('1. Schema Bridge Customization & Normalization', () => {
    it('creates tool from raw TypeSpec JSON Schema without duplication', () => {
      const tool = createSchemaTool({
        name: 'drive_upload_file',
        description: 'Uploads a file to cloud drive storage.',
        category: 'drive',
        schema: typeSpecUploadSchema,
        execute: async (_ctx, input: any) => {
          return { uploadedId: input.id, fileName: input.name }
        },
      })

      expect(tool.name).toBe('drive_upload_file')
      expect(tool.category).toBe('drive')
      expect(tool.description).toBe('Uploads a file to cloud drive storage.')
      expect(tool.inputSchema.properties.name).toBeDefined()
      expect(tool.inputSchema.required).toEqual(['id', 'name', 'content'])
    })

    it('supports field picking and omitting for high-level agent ergonomics', () => {
      const tool = createSchemaTool({
        name: 'drive_upload_file',
        description: 'Uploads a file.',
        schema: typeSpecUploadSchema,
        // Omit internal database ID and audit secret
        omit: ['id', 'auditSecret'],
        execute: async (_ctx, input: any) => input,
      })

      expect(tool.inputSchema.properties.name).toBeDefined()
      expect(tool.inputSchema.properties.content).toBeDefined()
      expect(tool.inputSchema.properties.folderId).toBeDefined()
      expect(tool.inputSchema.properties.id).toBeUndefined()
      expect(tool.inputSchema.properties.auditSecret).toBeUndefined()
      // 'id' should also be removed from required
      expect(tool.inputSchema.required).toEqual(['name', 'content'])
    })

    it('supports property overrides and extensions (e.g. LLM-friendly helper fields)', () => {
      const tool = createSchemaTool({
        name: 'drive_upload_file',
        description: 'Uploads a file.',
        schema: typeSpecUploadSchema,
        omit: ['id', 'auditSecret'],
        overrides: {
          content: {
            description: 'File content (plain text, markdown, or base64 string)',
          },
        },
        extend: {
          isBase64: {
            type: 'boolean',
            default: false,
            description: 'Set true if content is base64 encoded binary data',
          },
        },
        execute: async (_ctx, input: any) => {
          return `Uploaded ${input.name} (base64=${input.isBase64 ?? false})`
        },
      })

      expect(tool.inputSchema.properties.content.description).toBe(
        'File content (plain text, markdown, or base64 string)',
      )
      expect(tool.inputSchema.properties.isBase64).toBeDefined()
      expect(tool.inputSchema.properties.isBase64.type).toBe('boolean')
      expect(tool.inputSchema.properties.isBase64.default).toBe(false)
    })
  })

  describe('2. MCP Server Integration with Schema Bridge', () => {
    it('exposes bridged tools in MCP ListTools format with clean Draft 2020-12 schema', () => {
      const uploadTool = createSchemaTool({
        name: 'drive_upload_file',
        description: 'Upload a file to Google Drive',
        schema: typeSpecUploadSchema,
        omit: ['id', 'auditSecret'],
        execute: async (_ctx, input: any) => {
          return { success: true, name: input.name }
        },
      })

      const mcpServer = createMcpServer([uploadTool], { name: 'google-drive-mcp' })
      const tools = mcpServer.getTools()

      expect(tools).toHaveLength(1)
      expect(tools[0]!.name).toBe('drive_upload_file')
      expect(tools[0]!.description).toBe('Upload a file to Google Drive')
      expect(tools[0]!.inputSchema.type).toBe('object')
      expect((tools[0]!.inputSchema.properties as any).name.type).toBe('string')
      expect((tools[0]!.inputSchema.properties as any).id).toBeUndefined()
    })

    it('executes bridged tool returning Markdown text response for agent', async () => {
      const tool = createSchemaTool({
        name: 'drive_upload_file',
        description: 'Upload a file',
        schema: typeSpecUploadSchema,
        omit: ['id', 'auditSecret'],
        execute: async (_ctx, input: any) => {
          return `✅ File uploaded: **${input.name}**`
        },
      })

      const ctx = createToolContext()
      const result = await executeTool(tool, { name: 'report.md', content: '# Hello' }, ctx)
      expect(result).toBe('✅ File uploaded: **report.md**')
    })
  })

  describe('3. CLI Integration with Schema Bridge', () => {
    it('creates Commander command hierarchy with options matching the schema', () => {
      const tool = createSchemaTool({
        name: 'drive_upload',
        description: 'Upload file command',
        category: 'drive',
        schema: typeSpecUploadSchema,
        omit: ['id', 'auditSecret'],
        cli: {
          command: 'upload',
          arguments: [{ name: 'name', description: 'File name', required: true }],
        },
        execute: async (_ctx, input: any) => input,
      })

      const cli = createCli([tool], { name: 'gt' })
      const driveCmd = cli.commands.find((c) => c.name() === 'drive')
      expect(driveCmd).toBeDefined()

      const uploadSub = driveCmd!.commands.find((c) => c.name() === 'upload')
      expect(uploadSub).toBeDefined()
      expect(uploadSub!.description()).toBe('Upload file command')
    })

    it('promptMissingFields returns immediately when all required fields exist', async () => {
      const schema = {
        type: 'object',
        properties: { name: { type: 'string' } },
        required: ['name'],
      }

      const input = { name: 'existing.txt' }
      const result = await promptMissingFields(schema, input)
      expect(result).toEqual({ name: 'existing.txt' })
    })
  })
})

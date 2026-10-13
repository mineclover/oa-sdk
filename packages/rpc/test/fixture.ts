import { parseDocument, type OasDocument } from '@oa-sdk/parser'
import { buildRpcContract } from '@oa-sdk/surface-ir'
import type { RpcContract } from '../src/index.js'

const json = (schema: object) => ({ content: { 'application/json': { schema } } })
const problem = { description: 'problem', ...json({ $ref: '#/components/schemas/Problem' }) }

export const petstoreDocument = {
  openapi: '3.2.0',
  info: { title: 'Pets', version: '1.0.0' },
  paths: {
    '/pets': {
      get: {
        operationId: 'listPets',
        tags: ['pets'],
        parameters: [
          { name: 'limit', in: 'query', schema: { type: 'integer', minimum: 1 } },
          { name: 'tags', in: 'query', schema: { type: 'array', items: { type: 'string' } } },
          { name: 'ids', in: 'query', explode: false, schema: { type: 'array', items: { type: 'integer' } } },
          { name: 'filter', in: 'query', style: 'deepObject', schema: { type: 'object', properties: { minAge: { type: 'integer' }, vaccinated: { type: 'boolean' } } } },
          { name: 'tenant', in: 'cookie', schema: { type: 'string' } },
          { name: 'names', in: 'query', explode: false, schema: { type: 'array', items: { type: 'string' } } },
          { name: 'maxAge', in: 'query', schema: { anyOf: [{ type: 'integer' }, { type: 'null' }] } },
          { name: 'meta', in: 'query', schema: { type: 'object', additionalProperties: { type: 'string' } } },
        ],
        responses: { '200': { description: 'ok', ...json({ type: 'array', items: { $ref: '#/components/schemas/Pet' } }) } },
      },
      post: {
        operationId: 'createPet',
        tags: ['pets'],
        requestBody: { required: true, ...json({ $ref: '#/components/schemas/NewPet' }) },
        responses: { '201': { description: 'created', ...json({ $ref: '#/components/schemas/Pet' }) }, '409': problem },
      },
    },
    '/pets/{petId}': {
      get: {
        operationId: 'getPet',
        tags: ['pets'],
        parameters: [
          { name: 'petId', in: 'path', required: true, schema: { type: 'integer' } },
          { name: 'X-Trace', in: 'header', schema: { type: 'string' } },
        ],
        responses: { '200': { description: 'ok', ...json({ $ref: '#/components/schemas/Pet' }) }, '404': problem },
      },
      patch: {
        operationId: 'updatePet',
        tags: ['pets'],
        parameters: [
          { name: 'petId', in: 'path', required: true, schema: { type: 'integer' } },
          { name: 'X-Tenant', in: 'header', schema: { type: 'string' } },
        ],
        requestBody: { required: true, ...json({ type: 'object', properties: { name: { type: 'string' } } }) },
        responses: { '200': { description: 'ok', ...json({ type: 'object' }) } },
      },
      delete: {
        operationId: 'deletePet',
        tags: ['pets'],
        parameters: [{ name: 'petId', in: 'path', required: true, schema: { type: 'integer' } }],
        responses: { '204': { description: 'deleted' } },
      },
    },
    '/pets/{petId}/photos': {
      put: {
        operationId: 'replacePhotos',
        tags: ['pets'],
        parameters: [{ name: 'petId', in: 'path', required: true, schema: { type: 'integer' } }],
        requestBody: { required: true, ...json({ type: 'array', items: { type: 'string' } }) },
        responses: { '200': { description: 'ok', ...json({ type: 'array', items: { type: 'string' } }) } },
      },
    },
    '/coords/{point}': {
      get: {
        operationId: 'echoPoint',
        tags: ['geo'],
        parameters: [
          { name: 'point', in: 'path', required: true, style: 'matrix', explode: true, schema: { type: 'object', properties: { x: { type: 'number' }, y: { type: 'number' } } } },
        ],
        responses: { '200': { description: 'ok', ...json({ type: 'object' }) } },
      },
    },
    '/health': {
      get: { operationId: 'health', responses: { '200': { description: 'ok', content: { 'text/plain': { schema: { type: 'string' } } } } } },
    },
  },
  components: {
    schemas: {
      NewPet: {
        type: 'object',
        required: ['name'],
        properties: { name: { type: 'string', minLength: 1 }, tag: { type: 'string' } },
        additionalProperties: false,
      },
      Pet: {
        type: 'object',
        required: ['id', 'name'],
        properties: { id: { type: 'integer' }, name: { type: 'string' }, tag: { type: 'string' } },
      },
      Problem: {
        type: 'object',
        required: ['code', 'message'],
        properties: { code: { type: 'string' }, message: { type: 'string' } },
      },
    },
  },
} as unknown as OasDocument

export type Pet = { id: number; name: string; tag?: string }

/** Procedure types as the codegen RPC generator would emit them. */
export type PetProcedures = {
  'pets.listPets': {
    input: {
      limit?: number
      tags?: string[]
      ids?: number[]
      filter?: { minAge?: number; vaccinated?: boolean }
      tenant?: string
      names?: string[]
      maxAge?: number | null
      meta?: Record<string, string>
    }
    output: Pet[]
  }
  'pets.createPet': { input: { name: string; tag?: string }; output: Pet }
  'pets.getPet': { input: { petId: number; 'X-Trace'?: string }; output: Pet }
  'pets.updatePet': { input: { petId: number; 'X-Tenant'?: string; name?: string; [key: string]: unknown }; output: Record<string, unknown> }
  'pets.deletePet': { input: { petId: number }; output: void }
  'pets.replacePhotos': { input: { petId: number; body: string[] }; output: string[] }
  'geo.echoPoint': { input: { point: { x?: number; y?: number } }; output: Record<string, unknown> }
  health: { input: Record<string, never>; output: string }
}

export function petContract(): RpcContract {
  return buildRpcContract(parseDocument(structuredClone(petstoreDocument)))
}

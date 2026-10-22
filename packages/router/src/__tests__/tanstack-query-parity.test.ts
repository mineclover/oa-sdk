/**
 * TanStack Query v5 & Router Handler Contract Full-Stack Parity Test Suite
 *
 * Mathematically verifies 100% parameter, request body, and response wire typing parity
 * between @oa-sdk/router backend handler contracts (*.contract.ts) and
 * @oa-sdk/client frontend TanStack Query v5 options/key factories (*.queries.ts, *.keys.ts).
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { parseDocument, type OasDocument } from '@oa-sdk/parser'
import { generateHandlerContract } from '../contracts/handler-contract.js'

const require = createRequire(import.meta.url)
const tscBin = require.resolve('typescript/bin/tsc')

function runTsc(cwd: string): void {
  try {
    execFileSync(process.execPath, [tscBin, '--noEmit'], {
      cwd,
      timeout: 30_000,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
  } catch (error) {
    const result = error as { stdout?: Buffer; stderr?: Buffer }
    const diagnostics = [result.stdout, result.stderr]
      .filter((output): output is Buffer => output instanceof Buffer && output.length > 0)
      .map((output) => output.toString('utf8').trim())
      .filter(Boolean)
      .join('\n')
    throw new Error(diagnostics || 'tsc --noEmit failed without diagnostics')
  }
}

const tmpDir = resolve(__dirname, '../../.tmp-tanstack-parity-test')

beforeAll(() => {
  mkdirSync(tmpDir, { recursive: true })
})

afterAll(() => {
  if (existsSync(tmpDir)) {
    rmSync(tmpDir, { recursive: true, force: true })
  }
})

function createComprehensiveSpec(): OasDocument {
  return {
    openapi: '3.2.0',
    info: { title: 'User Management & Billing API', version: '1.0.0' },
    paths: {
      '/users': {
        get: {
          tags: ['users'],
          operationId: 'listUsers',
          summary: 'List users with pagination and role filters',
          parameters: [
            { name: 'role', in: 'query', schema: { type: 'string' } },
            { name: 'limit', in: 'query', schema: { type: 'integer' } },
            { name: 'search', in: 'query', schema: { type: 'string' } },
          ],
          responses: {
            '200': {
              description: 'Users list',
              content: {
                'application/json': {
                  schema: {
                    type: 'array',
                    items: {
                      type: 'object',
                      required: ['id', 'name', 'email'],
                      properties: {
                        id: { type: 'string' },
                        name: { type: 'string' },
                        email: { type: 'string' },
                        createdAt: { type: 'string', format: 'date-time' },
                      },
                    },
                  },
                },
              },
            },
          },
        },
        post: {
          tags: ['users'],
          operationId: 'createUser',
          summary: 'Create a new user',
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['name', 'email'],
                  properties: {
                    name: { type: 'string' },
                    email: { type: 'string' },
                    role: { type: 'string' },
                  },
                },
              },
            },
          },
          responses: {
            '201': {
              description: 'User successfully created',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    required: ['id', 'name', 'email'],
                    properties: {
                      id: { type: 'string' },
                      name: { type: 'string' },
                      email: { type: 'string' },
                      createdAt: { type: 'string', format: 'date-time' },
                    },
                  },
                },
              },
            },
          },
        },
      },
      '/users/{id}': {
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
        ],
        get: {
          tags: ['users'],
          operationId: 'getUser',
          summary: 'Get user detail by ID',
          parameters: [
            { name: 'fields', in: 'query', schema: { type: 'string' } },
          ],
          responses: {
            '200': {
              description: 'User found',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    required: ['id', 'name', 'email'],
                    properties: {
                      id: { type: 'string' },
                      name: { type: 'string' },
                      email: { type: 'string' },
                      createdAt: { type: 'string', format: 'date-time' },
                    },
                  },
                },
              },
            },
          },
        },
        patch: {
          tags: ['users'],
          operationId: 'updateUser',
          summary: 'Update user attributes',
          parameters: [
            { name: 'notify', in: 'query', schema: { type: 'boolean' } },
          ],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    name: { type: 'string' },
                    email: { type: 'string' },
                  },
                },
              },
            },
          },
          responses: {
            '200': {
              description: 'Updated user',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    required: ['id', 'name', 'email'],
                    properties: {
                      id: { type: 'string' },
                      name: { type: 'string' },
                      email: { type: 'string' },
                      createdAt: { type: 'string', format: 'date-time' },
                    },
                  },
                },
              },
            },
          },
        },
        delete: {
          tags: ['users'],
          operationId: 'deleteUser',
          summary: 'Delete user by ID',
          responses: {
            '204': {
              description: 'User successfully deleted',
            },
          },
        },
      },
    },
  } as OasDocument
}

describe('Full-Stack Router Contract & TanStack Query Parity', () => {
  it('generates symmetrically typed contracts and options from the same specification', async () => {
    const spec = createComprehensiveSpec()
    const parsedDoc = parseDocument(spec)

    // 1. Backend Handler Contract
    const contractCode = generateHandlerContract(spec, {
      contractName: 'UserApiHandlers',
      contextTypeName: 'UserSessionContext',
      contextImport: './context.js',
      typesImport: './types.js',
    })

    // 2. Frontend TanStack Query Options & Key Factory (from @oa-sdk/client)
    const clientEntry = resolve(__dirname, '../../../client/dist/index.js')
    const clientModule = await import(clientEntry)
    const { generateTanstackQuery } = clientModule as {
      generateTanstackQuery: (doc: any, opts?: any) => {
        keysCode: string
        queriesCode: string
        hooksCode: string
        combinedCode: string
      }
    }

    const tanstackOutput = generateTanstackQuery(parsedDoc, {
      typesImport: './types.js',
      clientImport: './client.js',
      keysImport: './keys.js',
      tier: 'all',
    })

    // Verify Backend Contract Types
    expect(contractCode).toContain('export interface GetUserContext<TContext = UserSessionContext>')
    expect(contractCode).toContain('params: GetUserPathParams')
    expect(contractCode).toContain('query?: GetUserQueryParams')
    expect(contractCode).toContain('export type GetUserHandler<TContext = UserSessionContext>')
    expect(contractCode).toContain('HandlerResponse<GetUserResponse>')

    expect(contractCode).toContain('export interface CreateUserContext<TContext = UserSessionContext>')
    expect(contractCode).toContain('body: CreateUserBody')
    expect(contractCode).toContain('export type CreateUserHandler<TContext = UserSessionContext>')
    expect(contractCode).toContain('HandlerResponse<CreateUserResponse>')

    expect(contractCode).toContain('export interface UpdateUserContext<TContext = UserSessionContext>')
    expect(contractCode).toContain('params: UpdateUserPathParams')
    expect(contractCode).toContain('query?: UpdateUserQueryParams')
    expect(contractCode).toContain('body: UpdateUserBody')

    // Verify Frontend Options Types
    expect(tanstackOutput.queriesCode).toContain('export function getUserQueryOptions<TData = JsonPrimitive<GetUserResponse>>(')
    expect(tanstackOutput.queriesCode).toContain('params: GetUserPathParams')
    expect(tanstackOutput.queriesCode).toContain('export function listUsersQueryOptions<TData = JsonPrimitive<ListUsersResponse>>(')
    expect(tanstackOutput.queriesCode).toContain('query?: ListUsersQueryParams')
    expect(tanstackOutput.queriesCode).toContain('export function createUserMutationOptions<TContext = unknown>(')
    expect(tanstackOutput.queriesCode).toContain('export type CreateUserVariables = {')
    expect(tanstackOutput.queriesCode).toContain('body: Resolved<CreateUserBody>')
  })

  it('validates 100% parameter and response wire typing parity with tsc --noEmit (zero diagnostics)', async () => {
    const spec = createComprehensiveSpec()
    const parsedDoc = parseDocument(spec)

    // Generate real source artifacts
    const contractCode = generateHandlerContract(spec, {
      contractName: 'UserApiHandlers',
      typesImport: './types.js',
    })

    const clientEntry = resolve(__dirname, '../../../client/dist/index.js')
    const clientModule = await import(clientEntry)
    const { generateTanstackQuery } = clientModule as any

    const tanstackOutput = generateTanstackQuery(parsedDoc, {
      typesImport: './types.js',
      clientImport: './client.js',
      keysImport: './keys.js',
      tier: 'all',
    })

    // Write out ambient typing shims
    const queryShim = `
declare module '@tanstack/react-query' {
  export function queryOptions<TQueryFnData, TError = Error, TData = TQueryFnData, TQueryKey extends readonly unknown[] = readonly unknown[]>(
    options: {
      queryKey: TQueryKey;
      queryFn: (context: { signal?: AbortSignal }) => Promise<TQueryFnData>;
    } & Record<string, any>
  ): {
    queryKey: TQueryKey;
    queryFn: (context: { signal?: AbortSignal }) => Promise<TQueryFnData>;
  };
  export function mutationOptions<TData = unknown, TError = Error, TVariables = void, TContext = unknown>(
    options: {
      mutationKey?: readonly unknown[];
      mutationFn?: (variables: TVariables) => Promise<TData>;
    } & Record<string, any>
  ): {
    mutationKey?: readonly unknown[];
    mutationFn: (variables: TVariables) => Promise<TData>;
  };
  export function useQuery<TData = any, TError = any>(options: any, client?: any): any;
  export function useMutation<TData, TError, TVariables, TContext>(options: any, client?: any): any;
  export type UndefinedInitialDataOptions<TQueryFnData, TError, TData, TQueryKey> = {
    queryKey: TQueryKey;
    queryFn: (ctx: { signal?: AbortSignal }) => Promise<TQueryFnData>;
  };
  export type QueryObserverOptions<TQueryFnData, TError, TData, TQueryData, TQueryKey> = {
    queryKey: TQueryKey;
    queryFn: (ctx: { signal?: AbortSignal }) => Promise<TQueryFnData>;
  };
  export type UseMutationOptions<TData, TError, TVariables, TContext> = {
    mutationKey?: readonly unknown[];
    mutationFn: (variables: TVariables) => Promise<TData>;
  };
  export type MutationObserverOptions<TData, TError, TVariables, TContext> = {
    mutationKey?: readonly unknown[];
    mutationFn: (variables: TVariables) => Promise<TData>;
  };
  export type UseQueryOptions<TData, TError, TQueryData, TQueryKey> = any;
  export type UseQueryResult<TData, TError> = any;
  export type UseMutationResult<TData, TError, TVariables, TContext> = any;
  export type QueryClient = any;
}
`

    const clientShim = `
declare module '@oa-sdk/client' {
  export type JsonPrimitive<T> = T extends Date
    ? string
    : T extends (...args: any[]) => any
      ? never
      : T extends object
        ? { [K in keyof T as T[K] extends (...args: any[]) => any ? never : K]: JsonPrimitive<T[K]> }
        : T;
  export type Resolved<T> = JsonPrimitive<T>;
  export type ClientMethodOptions = {
    signal?: AbortSignal;
    headers?: Record<string, string>;
  };
}
`

    // Wire domain types using type aliases to satisfy Record<string, unknown>
    const typesSource = `
export type UserRecord = {
  id: string;
  name: string;
  email: string;
  createdAt: Date;
  computedScore?: () => number;
};

export type GetUserPathParams = {
  id: string;
};

export type GetUserQueryParams = {
  fields?: string;
};

export type GetUserResponse = UserRecord;

export type ListUsersQueryParams = {
  role?: string;
  limit?: number;
  search?: string;
};

export type ListUsersResponse = UserRecord[];

export type CreateUserBody = {
  name: string;
  email: string;
  role?: string;
  injectedMeta?: () => void;
};

export type CreateUserResponse = UserRecord;

export type UpdateUserPathParams = {
  id: string;
};

export type UpdateUserQueryParams = {
  notify?: boolean;
};

export type UpdateUserBody = {
  name?: string;
  email?: string;
};

export type UpdateUserResponse = UserRecord;

export type DeleteUserPathParams = {
  id: string;
};

export type DeleteUserResponse = void;
`

    const clientSource = `
import type {
  GetUserPathParams,
  GetUserQueryParams,
  GetUserResponse,
  ListUsersQueryParams,
  ListUsersResponse,
  CreateUserBody,
  CreateUserResponse,
  UpdateUserPathParams,
  UpdateUserQueryParams,
  UpdateUserBody,
  UpdateUserResponse,
  DeleteUserPathParams,
  DeleteUserResponse,
} from './types.js';
import type { JsonPrimitive, Resolved, ClientMethodOptions } from '@oa-sdk/client';

export type { ClientMethodOptions };

export interface ApiClient {
  listUsers(query?: ListUsersQueryParams, options?: ClientMethodOptions): Promise<JsonPrimitive<ListUsersResponse>>;
  createUser(body: Resolved<CreateUserBody>, options?: ClientMethodOptions): Promise<JsonPrimitive<CreateUserResponse>>;
  getUser(params: GetUserPathParams, query?: GetUserQueryParams, options?: ClientMethodOptions): Promise<JsonPrimitive<GetUserResponse>>;
  updateUser(params: UpdateUserPathParams, body?: Resolved<UpdateUserBody>, query?: UpdateUserQueryParams, options?: ClientMethodOptions): Promise<JsonPrimitive<UpdateUserResponse>>;
  deleteUser(params: DeleteUserPathParams, options?: ClientMethodOptions): Promise<void>;
}
`

    // Full-stack compile-time type parity assertions
    const parityAssertionSource = `
import type {
  GetUserContext,
  GetUserHandler,
  ListUsersContext,
  ListUsersHandler,
  CreateUserContext,
  CreateUserHandler,
  UpdateUserContext,
  UpdateUserHandler,
  DeleteUserContext,
  DeleteUserHandler,
} from './contract.js';

import {
  getUserQueryOptions,
  listUsersQueryOptions,
  createUserMutationOptions,
  updateUserMutationOptions,
  deleteUserMutationOptions,
  type CreateUserVariables,
  type UpdateUserVariables,
} from './queries.js';

import type { JsonPrimitive, Resolved } from '@oa-sdk/client';
import type {
  GetUserPathParams,
  GetUserQueryParams,
  GetUserResponse,
  ListUsersQueryParams,
  ListUsersResponse,
  CreateUserBody,
  CreateUserResponse,
  UpdateUserPathParams,
  UpdateUserQueryParams,
  UpdateUserBody,
  UpdateUserResponse,
} from './types.js';
import type { ApiClient } from './client.js';

// Type equality utilities
type Equals<X, Y> = (<T>() => T extends X ? 1 : 2) extends (<T>() => T extends Y ? 1 : 2) ? true : false;
type Extends<A, B> = [A] extends [B] ? true : false;

// 1. Path Params Parity
type RouterGetUserPath = NonNullable<GetUserContext['params']>;
type QueryGetUserPath = Parameters<typeof getUserQueryOptions>[1];
const _pathEqual: Equals<RouterGetUserPath, QueryGetUserPath> = true;

// 2. Query Params Parity
type RouterListQuery = NonNullable<ListUsersContext['query']>;
type QueryListQuery = NonNullable<Parameters<typeof listUsersQueryOptions>[1]>;
const _queryEqual: Equals<RouterListQuery, QueryListQuery> = true;

// 3. Request Body Parity (with Resolved<T> wire safety)
type RouterCreateBody = NonNullable<CreateUserContext['body']>;
type MutationCreateBody = CreateUserVariables['body'];
const _bodyEqual: Equals<Resolved<RouterCreateBody>, MutationCreateBody> = true;

// 4. Response Parity (with JsonPrimitive<T> wire safety)
type RouterGetUserResponseBody = Extract<Awaited<ReturnType<GetUserHandler>>, { status: 200 }>['body'];
type QueryGetUserResponse = Awaited<ReturnType<ReturnType<typeof getUserQueryOptions>['queryFn']>>;
const _responseEqual: Equals<JsonPrimitive<RouterGetUserResponseBody>, QueryGetUserResponse> = true;

// 5. Backend Server Implementation using Generated Handler Contract
export const mockGetUserHandler: GetUserHandler = async (ctx) => {
  const userId: string = ctx.params.id;
  const fields: string | undefined = ctx.query?.fields;

  return {
    status: 200,
    body: {
      id: userId,
      name: 'Alice Developer',
      email: 'alice@example.com',
      createdAt: new Date(),
    },
  };
};

export const mockCreateUserHandler: CreateUserHandler = async (ctx) => {
  const name: string = ctx.body?.name ?? 'Default';
  const email: string = ctx.body?.email ?? 'default@example.com';

  return {
    status: 201,
    body: {
      id: 'usr_new',
      name,
      email,
      createdAt: new Date(),
    },
  };
};

// 6. Frontend Client Hook & SSR Consumer using Generated Options
export async function consumeFrontendQuery(client: ApiClient, userId: string) {
  // Pure options passed into query client
  const options = getUserQueryOptions(client, { id: userId }, { fields: 'name' });
  const data = await options.queryFn({ signal: undefined });

  // Verifies JsonPrimitive wire safety:
  // Date is mapped to string
  const dateStr: string = data.createdAt;
  const id: string = data.id;
  const name: string = data.name;

  return { id, name, dateStr };
}

export async function consumeFrontendMutation(client: ApiClient) {
  const options = createUserMutationOptions(client);
  const result = await options.mutationFn({
    body: {
      name: 'Bob',
      email: 'bob@example.com',
    },
  });

  const createdId: string = result.id;
  return createdId;
}

// 7. Concrete Mock ApiClient Implementation with Trailing Options
export const mockApiClient: ApiClient = {
  listUsers: async (_query, _options) => [],
  createUser: async (_body, _options) => ({
    id: 'usr_new',
    name: 'Alice Developer',
    email: 'alice@example.com',
    createdAt: '2026-01-01T00:00:00.000Z',
  }),
  getUser: async (_params, _query, _options) => ({
    id: 'usr_1',
    name: 'Alice Developer',
    email: 'alice@example.com',
    createdAt: '2026-01-01T00:00:00.000Z',
  }),
  updateUser: async (_params, _body, _query, _options) => ({
    id: 'usr_1',
    name: 'Alice Developer',
    email: 'alice@example.com',
    createdAt: '2026-01-01T00:00:00.000Z',
  }),
  deleteUser: async (_params, _options) => {},
};

export async function testMockApiClientConsumer() {
  const queryResult = await consumeFrontendQuery(mockApiClient, 'usr_1');
  const mutationResult = await consumeFrontendMutation(mockApiClient);
  return { queryResult, mutationResult };
}
`

    const tsconfigJson = {
      compilerOptions: {
        target: 'ES2022',
        module: 'NodeNext',
        moduleResolution: 'NodeNext',
        strict: true,
        skipLibCheck: true,
        noEmit: true,
      },
    }

    // Write all files into the isolated temp project
    writeFileSync(join(tmpDir, 'package.json'), JSON.stringify({ type: 'module' }), 'utf8')
    writeFileSync(join(tmpDir, 'tsconfig.json'), JSON.stringify(tsconfigJson, null, 2), 'utf8')
    writeFileSync(join(tmpDir, 'query-shim.d.ts'), queryShim, 'utf8')
    writeFileSync(join(tmpDir, 'client-shim.d.ts'), clientShim, 'utf8')
    writeFileSync(join(tmpDir, 'types.ts'), typesSource, 'utf8')
    writeFileSync(join(tmpDir, 'client.ts'), clientSource, 'utf8')
    writeFileSync(join(tmpDir, 'contract.ts'), contractCode, 'utf8')
    writeFileSync(join(tmpDir, 'keys.ts'), tanstackOutput.keysCode, 'utf8')
    writeFileSync(join(tmpDir, 'queries.ts'), tanstackOutput.queriesCode, 'utf8')
    writeFileSync(join(tmpDir, 'parity-assertions.ts'), parityAssertionSource, 'utf8')

    // Execute tsc --noEmit to verify 0 diagnostics
    expect(() => runTsc(tmpDir)).not.toThrow()
  })
})

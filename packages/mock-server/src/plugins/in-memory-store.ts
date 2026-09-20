import type { MockPlugin, MockPluginContext, MockPluginResponse } from '../core/plugin.js'

export interface InMemoryStoreOptions {
  /**
   * Initial data for collections, keyed by collection path (e.g. `'/users'` or `'users'`).
   */
  seed?: Record<string, any[]>
  /**
   * Custom ID generator function for POST inserts.
   * Defaults to crypto.randomUUID() or timestamp fallback.
   */
  generateId?: () => string
}

export interface InMemoryStorePlugin extends MockPlugin {
  readonly collections: Map<string, any[]>
  reset(): void
  getCollection<T = any>(nameOrPath: string): T[] | undefined
  setCollection<T = any>(nameOrPath: string, items: T[]): void
}

function normalizePath(rawPath: string): string {
  let p = rawPath.trim()
  if (!p.startsWith('/')) p = `/${p}`
  if (p.length > 1 && p.endsWith('/')) p = p.slice(0, -1)
  return p
}

function defaultGenerateId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
}

function cloneData<T>(data: T): T {
  if (typeof structuredClone === 'function') {
    return structuredClone(data)
  }
  return JSON.parse(JSON.stringify(data))
}

export function inMemoryStorePlugin(options: InMemoryStoreOptions = {}): InMemoryStorePlugin {
  const { seed = {}, generateId = defaultGenerateId } = options

  const collections = new Map<string, any[]>()

  function initializeFromSeed(): void {
    collections.clear()
    for (const [key, items] of Object.entries(seed)) {
      collections.set(normalizePath(key), cloneData(items))
    }
  }

  initializeFromSeed()

  const plugin: InMemoryStorePlugin = {
    name: 'in-memory-store',
    collections,

    reset(): void {
      initializeFromSeed()
    },

    getCollection<T = any>(nameOrPath: string): T[] | undefined {
      return collections.get(normalizePath(nameOrPath)) as T[] | undefined
    },

    setCollection<T = any>(nameOrPath: string, items: T[]): void {
      collections.set(normalizePath(nameOrPath), cloneData(items))
    },

    onMatch(context: MockPluginContext): MockPluginResponse | void {
      const { entry, parts } = context
      const method = entry.method.toLowerCase()
      const openApiPath = normalizePath(entry.openApiPath)

      const lastSlashIndex = openApiPath.lastIndexOf('/')
      const isMember = lastSlashIndex > 0 && openApiPath.endsWith('}')
      const collectionPath = isMember ? openApiPath.slice(0, lastSlashIndex) : openApiPath

      // Handle Collection Endpoints: GET (list), POST (create)
      if (!isMember) {
        if (method === 'get') {
          const items = collections.get(collectionPath)
          if (!items && !context.entry.responses['200']) {
            return undefined
          }
          const allItems = items ?? []

          // Check for pagination query parameters
          const queryParams = parts.queryParams || {}
          const limitParam = queryParams.limit ?? queryParams.pageSize ?? queryParams.per_page
          const offsetParam = queryParams.offset
          const pageParam = queryParams.page

          let returnedData: any = allItems

          if (limitParam !== undefined) {
            const limit = parseInt(Array.isArray(limitParam) ? limitParam[0]! : limitParam, 10)
            const offset = offsetParam !== undefined
              ? parseInt(Array.isArray(offsetParam) ? offsetParam[0]! : offsetParam, 10)
              : (pageParam !== undefined ? (Math.max(1, parseInt(Array.isArray(pageParam) ? pageParam[0]! : pageParam, 10)) - 1) * limit : 0)

            if (!Number.isNaN(limit) && limit >= 0) {
              const sliced = allItems.slice(offset, offset + limit)
              const res200Schema = (entry.responses['200'] as any)?.content?.['application/json']?.schema
              if (res200Schema && typeof res200Schema === 'object') {
                if (res200Schema.properties?.items) {
                  returnedData = {
                    items: sliced,
                    total: allItems.length,
                    ...(pageParam !== undefined && { page: parseInt(Array.isArray(pageParam) ? pageParam[0]! : pageParam, 10) }),
                    limit,
                  }
                } else if (res200Schema.properties?.data) {
                  returnedData = {
                    data: sliced,
                    total: allItems.length,
                  }
                } else {
                  returnedData = sliced
                }
              } else {
                returnedData = sliced
              }
            }
          }

          return {
            status: 200,
            contentType: 'application/json',
            body: returnedData,
          }
        }

        if (method === 'post') {
          let list = collections.get(collectionPath)
          if (!list) {
            list = []
            collections.set(collectionPath, list)
          }

          const rawBody = parts.body
          let newItem: any
          if (typeof rawBody === 'object' && rawBody !== null && !Array.isArray(rawBody)) {
            const id = (rawBody as any).id ?? generateId()
            newItem = { ...rawBody, id }
          } else {
            newItem = rawBody
          }

          list.push(newItem)

          const status = entry.responses['201'] ? 201 : (entry.responses['200'] ? 200 : 201)
          return {
            status,
            contentType: 'application/json',
            body: newItem,
          }
        }

        return undefined
      }

      // Handle Member Endpoints: GET (find), PUT (replace), PATCH (update), DELETE (remove)
      const paramName = openApiPath.slice(lastSlashIndex + 1).replace(/^\{|\}$/g, '')
      const idVal = parts.pathParams[paramName] ?? Object.values(parts.pathParams).pop()
      if (idVal === undefined) return undefined

      const list = collections.get(collectionPath)
      if (!list) {
        // If collection doesn't exist in memory store, allow fallback to standard spec generator
        return undefined
      }

      const itemIndex = list.findIndex(item => {
        if (typeof item !== 'object' || item === null) return false
        return String(item.id) === String(idVal) || String(item[paramName]) === String(idVal)
      })

      if (method === 'get') {
        if (itemIndex === -1) {
          return {
            status: 404,
            contentType: 'application/json',
            body: { error: { code: 'NOT_FOUND', message: `Item with id '${idVal}' not found` } },
          }
        }
        return {
          status: 200,
          contentType: 'application/json',
          body: list[itemIndex],
        }
      }

      if (method === 'put') {
        if (itemIndex === -1) {
          return {
            status: 404,
            contentType: 'application/json',
            body: { error: { code: 'NOT_FOUND', message: `Item with id '${idVal}' not found` } },
          }
        }
        const updated = typeof parts.body === 'object' && parts.body !== null
          ? { ...parts.body, id: list[itemIndex].id ?? idVal }
          : parts.body
        list[itemIndex] = updated
        return {
          status: 200,
          contentType: 'application/json',
          body: updated,
        }
      }

      if (method === 'patch') {
        if (itemIndex === -1) {
          return {
            status: 404,
            contentType: 'application/json',
            body: { error: { code: 'NOT_FOUND', message: `Item with id '${idVal}' not found` } },
          }
        }
        const existing = list[itemIndex]
        const merged = typeof parts.body === 'object' && parts.body !== null
          ? { ...existing, ...parts.body, id: existing.id ?? idVal }
          : parts.body
        list[itemIndex] = merged
        return {
          status: 200,
          contentType: 'application/json',
          body: merged,
        }
      }

      if (method === 'delete') {
        if (itemIndex === -1) {
          return {
            status: 404,
            contentType: 'application/json',
            body: { error: { code: 'NOT_FOUND', message: `Item with id '${idVal}' not found` } },
          }
        }
        list.splice(itemIndex, 1)
        if (entry.responses['204'] || !entry.responses['200']) {
          return {
            status: 204,
            body: undefined,
          }
        }
        return {
          status: 200,
          contentType: 'application/json',
          body: { success: true },
        }
      }

      return undefined
    },
  }

  return plugin
}

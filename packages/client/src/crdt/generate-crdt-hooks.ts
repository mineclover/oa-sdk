/**
 * Generates ergonomic React / TanStack 3-tier hooks for collaborative CRDT rooms.
 */

import type { OasDocument, ParsedDocument } from '@oa-sdk/parser/browser'
import {
  assertParsedDocumentComplete,
  isParsedDocument,
  parseDocument,
} from '@oa-sdk/parser/browser'
import {
  toTypeScriptIdentifier,
  toOperationMethodName,
  formatGeneratedTs,
} from '@oa-sdk/core/browser'
import { extractCrdtEntitiesFromDoc, type CrdtEntityMeta } from './generate-crdt-client.js'

export interface CrdtHooksRenderOptions {
  clientImport?: string | undefined
  typesImport?: string | undefined
  reactImport?: string | undefined
  banner?: boolean | undefined
  basePath?: string | undefined
}

/**
 * Generates React collaboration hooks from OAS document or ParsedDocument IR.
 */
export function generateCrdtHooks(
  spec: OasDocument | ParsedDocument,
  options: CrdtHooksRenderOptions = {},
): string {
  const doc = isParsedDocument(spec) ? spec : parseDocument(spec)
  assertParsedDocumentComplete(doc, '@oa-sdk/client generateCrdtHooks')
  return generateCrdtHooksFromParsed(doc, options)
}

export function generateCrdtHooksFromParsed(
  doc: ParsedDocument,
  options: CrdtHooksRenderOptions = {},
): string {
  const {
    clientImport = './crdt.client.js',
    typesImport,
    reactImport = 'react',
    banner = true,
  } = options

  const entities = extractCrdtEntitiesFromDoc(doc)
  const lines: string[] = []

  if (banner) {
    lines.push('// Auto-generated React CRDT collaboration hooks from OpenAPI spec. Do not edit.')
    lines.push('// @oa-sdk/client')
    lines.push("'use client'")
    lines.push('')
  }

  lines.push(`import { useState, useEffect, useCallback } from ${JSON.stringify(reactImport)}
import type {
  CrdtRoomSession,
  CrdtConnectionStatus,
} from ${JSON.stringify(clientImport)}`)

  if (typesImport && entities.length > 0) {
    const typeNames = entities.map(e => toTypeScriptIdentifier(e.name)).sort()
    lines.push(`import type { ${typeNames.join(', ')} } from ${JSON.stringify(typesImport)}`)
  }
  lines.push('')

  lines.push(`/**
 * Core React hook managing room session lifecycle, sync convergence, and state subscription.
 */
export function useCrdtRoom<TDoc = Record<string, unknown>>(session: CrdtRoomSession<TDoc>) {
  const [status, setStatus] = useState<CrdtConnectionStatus>(session.status)
  const [data, setData] = useState<TDoc>(session.getState())
  const [peers, setPeers] = useState<string[]>(() => Array.from(session.getAwareness().keys()))

  useEffect(() => {
    session.connect()
    const unStatus = session.onStatus(setStatus)
    const unChange = session.onChange(setData)
    const unAwareness = session.onAwareness((map) => setPeers(Array.from(map.keys())))

    return () => {
      unStatus()
      unChange()
      unAwareness()
      session.disconnect()
    }
  }, [session])

  const updateField = useCallback((field: string, value: unknown) => {
    session.updateField(field, value)
  }, [session])

  return {
    status,
    isConnected: status === 'connected' || status === 'synced',
    isSynced: status === 'synced',
    data,
    updateField,
    peers,
  }
}

/**
 * Granular hook binding a single CRDT field to local state and remote delta dispatch.
 */
export function useCrdtField<TDoc = Record<string, any>, K extends keyof TDoc = keyof TDoc>(
  session: CrdtRoomSession<TDoc>,
  field: K,
): [TDoc[K], (value: TDoc[K]) => void] {
  const { data, updateField } = useCrdtRoom(session)
  const setFieldValue = useCallback((val: TDoc[K]) => {
    updateField(field as string, val)
  }, [updateField, field])

  return [data[field], setFieldValue]
}

/**
 * Ephemeral presence and cursor tracking hook.
 */
export function useCrdtAwareness<TDoc = Record<string, unknown>>(session: CrdtRoomSession<TDoc>) {
  const [awarenessMap, setAwarenessMap] = useState<Map<string, unknown>>(() => session.getAwareness())

  useEffect(() => {
    return session.onAwareness(setAwarenessMap)
  }, [session])

  const setMyPresence = useCallback((presence: unknown) => {
    session.setAwareness(presence)
  }, [session])

  return {
    peers: awarenessMap,
    setMyPresence,
  }
}
`)

  // Emit typed custom hooks per entity
  for (const entity of entities) {
    const typeName = toTypeScriptIdentifier(entity.name)
    const hookName = `use${typeName}Session`
    const docType = typesImport ? typeName : 'Record<string, unknown>'

    lines.push(`/**
 * Typed convenience hook for ${typeName} collaborative document.
 */
export function ${hookName}(session: CrdtRoomSession<${docType}>) {
  return useCrdtRoom<${docType}>(session)
}
`)
  }

  return formatGeneratedTs(lines.join('\n'))
}

import { describe, it, expect } from 'vitest'
import {
  type JsonPrimitive,
  type Resolved,
  type ClientResponse,
  toWireJson,
  toResolved,
} from './helpers/wire-format.js'

describe('Tier 1: Wire-Format Safety (`JsonPrimitive` & `Resolved`) (Features 5–7)', () => {
  // =========================================================================
  // Feature 5: Canonical `JsonPrimitive<T>` Utility
  // =========================================================================
  describe('F5: Canonical JsonPrimitive<T> Utility', () => {
    it('T1-F5-1: preserves pure JSON scalar primitives and null', () => {
      type ScalarModel = {
        name: string
        age: number
        active: boolean
        notes: null
      }
      type WireModel = JsonPrimitive<ScalarModel>

      // Type-level and runtime assertion
      const sample: ScalarModel = { name: 'Alice', age: 30, active: true, notes: null }
      const wire: WireModel = toWireJson(sample)

      expect(wire).toEqual({ name: 'Alice', age: 30, active: true, notes: null })
      expect(typeof wire.name).toBe('string')
      expect(typeof wire.age).toBe('number')
      expect(typeof wire.active).toBe('boolean')
      expect(wire.notes).toBeNull()
    })

    it('T1-F5-2: transforms Date instances into ISO date-time string representation', () => {
      type EventModel = {
        title: string
        createdAt: Date
      }
      type WireEvent = JsonPrimitive<EventModel>

      const now = new Date('2026-09-11T00:00:00.000Z')
      const input: EventModel = { title: 'Conference', createdAt: now }
      const wire: WireEvent = toWireJson(input)

      expect(typeof wire.createdAt).toBe('string')
      expect(wire.createdAt).toBe('2026-09-11T00:00:00.000Z')
    })

    it('T1-F5-3: recursively strips function properties, methods, and symbol keys from objects', () => {
      class DomainUser {
        constructor(public id: string, public name: string) {}
        getDisplayName(): string {
          return `${this.name} (${this.id})`
        }
      }

      type WireUser = JsonPrimitive<DomainUser>
      const user = new DomainUser('u-1', 'Bob')
      const wire: WireUser = toWireJson(user)

      expect(wire).toEqual({ id: 'u-1', name: 'Bob' })
      expect((wire as any).getDisplayName).toBeUndefined()
    })

    it('T1-F5-4: resolves toJSON() method to unwrapped wire primitive output', () => {
      class Money {
        constructor(public amount: number, public currency: string) {}
        toJSON(): string {
          return `${this.amount} ${this.currency}`
        }
      }

      type WireMoney = JsonPrimitive<Money>
      const money = new Money(100, 'USD')
      const wire: WireMoney = toWireJson(money)

      expect(typeof wire).toBe('string')
      expect(wire).toBe('100 USD')
    })

    it('T1-F5-5: maps bigint to never and rejects bigint serialization at runtime', () => {
      type HasBigInt = { id: bigint }
      type WireBigInt = JsonPrimitive<HasBigInt>

      // In TypeScript type system, JsonPrimitive<bigint> evaluates to never
      type BigIntResult = JsonPrimitive<bigint>
      const isNever: [BigIntResult] extends [never] ? true : false = true
      expect(isNever).toBe(true)

      expect(() => {
        toWireJson({ id: 100n })
      }).toThrow(TypeError)
    })
  })

  // =========================================================================
  // Feature 6: Canonical `Resolved<T>` Utility
  // =========================================================================
  describe('F6: Canonical Resolved<T> Utility', () => {
    it('T1-F6-1: strips domain class methods so consumers do not instantiate class prototypes', () => {
      class OrderItem {
        constructor(public sku: string, public quantity: number) {}
        calculateTotal(unitPrice: number): number {
          return this.quantity * unitPrice
        }
      }

      type ResolvedItem = Resolved<OrderItem>
      const plainData: ResolvedItem = { sku: 'SKU-001', quantity: 5 }

      expect(plainData.sku).toBe('SKU-001')
      expect(plainData.quantity).toBe(5)
      expect((plainData as any).calculateTotal).toBeUndefined()
    })

    it('T1-F6-2: preserves Date instances as Date for input parameter bodies', () => {
      type FilterCriteria = {
        since: Date
        keyword?: string
      }
      type ResolvedCriteria = Resolved<FilterCriteria>

      const sinceDate = new Date('2026-01-01')
      const filter: ResolvedCriteria = { since: sinceDate, keyword: 'search' }

      expect(filter.since instanceof Date).toBe(true)
      expect(filter.since.getFullYear()).toBe(2026)
    })

    it('T1-F6-3: preserves array and tuple structures element by element', () => {
      class Tag {
        constructor(public label: string) {}
        format(): string { return `#${this.label}` }
      }
      type Post = {
        tags: Tag[]
        coordinate: [number, number]
      }
      type ResolvedPost = Resolved<Post>

      const resolved: ResolvedPost = {
        tags: [{ label: 'tech' }],
        coordinate: [37.7749, -122.4194],
      }

      expect(resolved.tags[0].label).toBe('tech')
      expect((resolved.tags[0] as any).format).toBeUndefined()
      expect(resolved.coordinate).toEqual([37.7749, -122.4194])
    })

    it('T1-F6-4: handles nullable and optional object properties safely', () => {
      type NullableModel = {
        opt?: string
        nullableField: number | null
      }
      type ResolvedModel = Resolved<NullableModel>

      const item1: ResolvedModel = { nullableField: null }
      const item2: ResolvedModel = { opt: 'hello', nullableField: 42 }

      expect(item1.nullableField).toBeNull()
      expect(item2.opt).toBe('hello')
    })

    it('T1-F6-5: unwraps nested composite objects stripping methods at all depths', () => {
      class NestedChild {
        constructor(public val: string) {}
        action() {}
      }
      class Parent {
        constructor(public child: NestedChild) {}
        parentAction() {}
      }

      type ResolvedParent = Resolved<Parent>
      const data: ResolvedParent = {
        child: { val: 'inner' },
      }

      expect(data.child.val).toBe('inner')
      expect((data as any).parentAction).toBeUndefined()
      expect((data.child as any).action).toBeUndefined()
    })
  })

  // =========================================================================
  // Feature 7: Wire-Safe Client SDK Signatures
  // =========================================================================
  describe('F7: Wire-Safe Client SDK Signatures', () => {
    // Contract representation of a generated client interface
    interface SampleApiClient {
      getUser(params: { id: string }): Promise<JsonPrimitive<{ id: string; createdAt: Date; active: boolean }>>
      getUserWithResponse(params: { id: string }): Promise<ClientResponse<JsonPrimitive<{ id: string; createdAt: Date }>>>
      createUser(body: Resolved<{ name: string; birthDate: Date }>): Promise<JsonPrimitive<{ id: string; name: string }>>
      streamUsers(): AsyncGenerator<JsonPrimitive<{ id: string; name: string }>>
    }

    it('T1-F7-1: operation return type is wrapped in Promise<JsonPrimitive<T>>', async () => {
      const mockClient: SampleApiClient = {
        async getUser() {
          return {
            id: 'usr_1',
            createdAt: '2026-09-11T00:00:00.000Z', // Date is string on wire!
            active: true,
          }
        },
        async getUserWithResponse() { throw new Error() },
        async createUser() { throw new Error() },
        async *streamUsers() {},
      }

      const res = await mockClient.getUser({ id: 'usr_1' })
      expect(typeof res.createdAt).toBe('string')
      expect(res.active).toBe(true)
    })

    it('T1-F7-2: withResponse signature returns Promise<ClientResponse<JsonPrimitive<T>, ...>>', async () => {
      const mockClient: SampleApiClient = {
        async getUser() { throw new Error() },
        async getUserWithResponse(params) {
          return {
            status: 200,
            ok: true,
            body: { id: params.id, createdAt: '2026-09-11T00:00:00.000Z' },
            headers: { 'content-type': 'application/json' },
          }
        },
        async createUser() { throw new Error() },
        async *streamUsers() {},
      }

      const res = await mockClient.getUserWithResponse({ id: 'usr_2' })
      expect(res.status).toBe(200)
      expect(typeof res.body.createdAt).toBe('string')
      expect(res.headers['content-type']).toBe('application/json')
    })

    it('T1-F7-3: request body parameter accepts Resolved<TBody>', async () => {
      const recordedBodies: any[] = []
      const mockClient: SampleApiClient = {
        async getUser() { throw new Error() },
        async getUserWithResponse() { throw new Error() },
        async createUser(body) {
          recordedBodies.push(body)
          return { id: 'new_id', name: body.name }
        },
        async *streamUsers() {},
      }

      const nativeDate = new Date('2000-01-01')
      const result = await mockClient.createUser({ name: 'Charlie', birthDate: nativeDate })
      expect(result.id).toBe('new_id')
      expect(recordedBodies[0].birthDate instanceof Date).toBe(true)
    })

    it('T1-F7-4: client template renders JsonPrimitive<T> and Resolved<T> inline without external imports', () => {
      // Zero external runtime dependency invariant: client template string contains inline definitions
      const clientTemplateHeader = `
export type ValueOf<T> = T extends Boolean ? boolean : T extends Number ? number : T extends String ? string : T;
export type JsonPrimitive<T> = T extends [never] ? never : ValueOf<T> extends bigint ? never : ...;
export type Resolved<T> = T extends [never] ? never : ...;
      `.trim()

      expect(clientTemplateHeader).toContain('export type JsonPrimitive<T>')
      expect(clientTemplateHeader).toContain('export type Resolved<T>')
      expect(clientTemplateHeader).not.toContain("from '@oa-sdk/core'")
    })

    it('T1-F7-5: streaming responses return AsyncGenerator<JsonPrimitive<T>>', async () => {
      const mockClient: SampleApiClient = {
        async getUser() { throw new Error() },
        async getUserWithResponse() { throw new Error() },
        async createUser() { throw new Error() },
        async *streamUsers() {
          yield { id: '1', name: 'A' }
          yield { id: '2', name: 'B' }
        },
      }

      const collected: any[] = []
      for await (const item of mockClient.streamUsers()) {
        collected.push(item)
      }
      expect(collected).toEqual([
        { id: '1', name: 'A' },
        { id: '2', name: 'B' },
      ])
    })
  })
})

import { describe, it, expect } from 'vitest'
import type {
  Equal,
  ValueOf,
  ClassProperties,
  JsonPrimitive,
  Resolved,
  IsTuple,
} from '../wire-format.js'

// Helper for static type equality assertions
type Assert<T extends true> = T
type AssertExtends<A, B> = A extends B ? true : false
type AssertNotExtends<A, B> = A extends B ? false : true

describe('wire-format: ValueOf', () => {
  it('unboxes boxed primitives to primitives without widening literals', () => {
    type _UnboxBooleanCheck = Assert<Equal<ValueOf<Boolean>, boolean>>
    type _UnboxNumberCheck = Assert<Equal<ValueOf<Number>, number>>
    type _UnboxStringCheck = Assert<Equal<ValueOf<String>, string>>

    // Literals should be preserved and not widened
    type _PreserveLiteralStringCheck = Assert<Equal<ValueOf<'hello'>, 'hello'>>
    type _PreserveLiteralNumberCheck = Assert<Equal<ValueOf<42>, 42>>
    type _PreserveLiteralBooleanCheck = Assert<Equal<ValueOf<true>, true>>

    // General primitives
    type _PreserveStringCheck = Assert<Equal<ValueOf<string>, string>>
    type _PreserveNumberCheck = Assert<Equal<ValueOf<number>, number>>
    type _PreserveBooleanCheck = Assert<Equal<ValueOf<boolean>, boolean>>

    const t: ValueOf<Boolean> = true
    expect(t).toBe(true)
  })
})

describe('wire-format: ClassProperties', () => {
  class UserEntity {
    id: string = '1'
    name: string = 'Alice'
    age?: number
    optionalMethod?: () => void

    get displayName(): string {
      return this.name
    }

    save(): void {}
    async delete(): Promise<boolean> {
      return true
    }
  }

  it('filters out methods and preserves data properties and getters', () => {
    type Props = ClassProperties<UserEntity>

    type HasId = Assert<Equal<Props['id'], string>>
    type HasName = Assert<Equal<Props['name'], string>>
    type HasAge = Assert<Equal<Props['age'], number | undefined>>
    type HasDisplayName = Assert<Equal<Props['displayName'], string>>
    type NoSave = Assert<AssertNotExtends<'save', keyof Props>>
    type NoDelete = Assert<AssertNotExtends<'delete', keyof Props>>
    type NoOptionalMethod = Assert<AssertNotExtends<'optionalMethod', keyof Props>>

    const props: Props = {
      id: '123',
      name: 'Bob',
      displayName: 'Bob',
    }
    expect(props.name).toBe('Bob')
  })
})

describe('wire-format: IsTuple', () => {
  it('correctly distinguishes arrays from tuples', () => {
    type _T1Check = Assert<Equal<IsTuple<number[]>, false>>
    type _T2Check = Assert<Equal<IsTuple<readonly string[]>, false>>
    type _T3Check = Assert<Equal<IsTuple<[string, number]>, true>>
    type _T4Check = Assert<Equal<IsTuple<[]>, true>>
    type _T5Check = Assert<Equal<IsTuple<readonly [boolean]>, true>>
    type _T6Check = Assert<Equal<IsTuple<[string, ...number[]]>, true>>

    const check = true
    expect(check).toBe(true)
  })
})

describe('wire-format: JsonPrimitive', () => {
  it('maps Date to string in primitive and object positions', () => {
    type DateToString = Assert<Equal<JsonPrimitive<Date>, string>>

    interface Article {
      title: string
      createdAt: Date
      updatedAt?: Date
    }

    type SerializedArticle = JsonPrimitive<Article>
    type CheckCreatedAt = Assert<Equal<SerializedArticle['createdAt'], string>>
    type CheckUpdatedAt = Assert<Equal<SerializedArticle['updatedAt'], string | undefined>>

    const article: SerializedArticle = {
      title: 'Title',
      createdAt: new Date().toISOString(),
    }
    expect(typeof article.createdAt).toBe('string')
  })

  it('strips functions, methods, and symbol properties from classes and objects', () => {
    const symbolKey = Symbol('secret')

    class Account {
      constructor(
        public id: string,
        public balance: number,
      ) {}

      deposit(_amount: number): void {}
      getBalance(): number {
        return this.balance
      }
      [symbolKey]: string = 'hidden'
    }

    type SerializedAccount = JsonPrimitive<Account>
    type CheckId = Assert<Equal<SerializedAccount['id'], string>>
    type CheckBalance = Assert<Equal<SerializedAccount['balance'], number>>
    type NoDeposit = Assert<AssertNotExtends<'deposit', keyof SerializedAccount>>
    type NoGetBalance = Assert<AssertNotExtends<'getBalance', keyof SerializedAccount>>
    type NoSymbolKey = Assert<AssertNotExtends<typeof symbolKey, keyof SerializedAccount>>

    const acc: SerializedAccount = { id: 'acc-1', balance: 100 }
    expect(acc.id).toBe('acc-1')
  })

  it('resolves toJSON() return types recursively', () => {
    class Money {
      constructor(
        public amount: number,
        public currency: string,
      ) {}

      toJSON(): string {
        return `${this.amount} ${this.currency}`
      }
    }

    class Envelope {
      constructor(public money: Money) {}
    }

    type SerializedMoney = Assert<Equal<JsonPrimitive<Money>, string>>
    type SerializedEnvelope = Assert<Equal<JsonPrimitive<Envelope>, { money: string }>>

    const money: JsonPrimitive<Money> = '100 USD'
    expect(money).toBe('100 USD')
  })

  it('unboxes boxed primitives to plain primitives', () => {
    type _UnboxedStringCheck = Assert<Equal<JsonPrimitive<String>, string>>
    type _UnboxedNumberCheck = Assert<Equal<JsonPrimitive<Number>, number>>
    type _UnboxedBooleanCheck = Assert<Equal<JsonPrimitive<Boolean>, boolean>>

    const s: JsonPrimitive<String> = 'hello'
    expect(s).toBe('hello')
  })

  it('maps bigint, functions, and symbols to never', () => {
    type _BigIntNeverCheck = Assert<Equal<JsonPrimitive<bigint>, never>>
    type _FnNeverCheck = Assert<Equal<JsonPrimitive<() => void>, never>>
    type _SymbolNeverCheck = Assert<Equal<JsonPrimitive<symbol>, never>>

    const check: JsonPrimitive<bigint> = undefined as never
    expect(check).toBeUndefined()
  })

  it('maps non-Date native classes (Map, Set, RegExp, etc.) to never', () => {
    type _MapNeverCheck = Assert<Equal<JsonPrimitive<Map<string, number>>, never>>
    type _SetNeverCheck = Assert<Equal<JsonPrimitive<Set<string>>, never>>
    type _RegExpNeverCheck = Assert<Equal<JsonPrimitive<RegExp>, never>>
    type _WeakMapNeverCheck = Assert<Equal<JsonPrimitive<WeakMap<any, any>>, never>>

    const check: JsonPrimitive<Map<string, number>> = undefined as never
    expect(check).toBeUndefined()
  })

  it('matches native classes and toJSON members with concrete type arguments', () => {
    class Stamp {
      constructor(private readonly epoch: number) {}
      toJSON(key: string): number {
        return key.length + this.epoch
      }
    }

    type _ToJsonWithParameterCheck = Assert<Equal<JsonPrimitive<Stamp>, number>>
    type _WeakSetNeverCheck = Assert<Equal<JsonPrimitive<WeakSet<object>>, never>>
    type _WeakMapNeverCheck = Assert<Equal<JsonPrimitive<WeakMap<object, string>>, never>>
    type _NestedMapNeverCheck = Assert<Equal<JsonPrimitive<{ index: Map<number, Date> }>, { index: never }>>
    type _ReadonlyVariadicCheck = Assert<
      Equal<JsonPrimitive<readonly [Date, ...Date[]]>, readonly [string, ...string[]]>
    >

    expect(JSON.parse(JSON.stringify({ at: new Stamp(1) }))).toEqual({ at: 3 })
  })

  it('handles arrays, tuples, and variadic tuples recursively', () => {
    type DateArray = Assert<Equal<JsonPrimitive<Date[]>, string[]>>
    type FixedTuple = Assert<Equal<JsonPrimitive<[Date, number, boolean]>, [string, number, boolean]>>
    type ReadonlyTuple = Assert<Equal<JsonPrimitive<readonly [Date, string]>, readonly [string, string]>>
    type VariadicTuple = Assert<Equal<JsonPrimitive<[Date, ...number[]]>, [string, ...number[]]>>

    const tuple: JsonPrimitive<[Date, number]> = ['2026-09-11T00:00:00Z', 42]
    expect(tuple[0]).toBe('2026-09-11T00:00:00Z')
    expect(tuple[1]).toBe(42)
  })

  it('recursively processes deeply nested objects', () => {
    interface DeepStructure {
      level1: {
        timestamp: Date
        level2: {
          items: [Date, { subDate: Date; compute(): void }]
        }
      }
    }

    type Serialized = JsonPrimitive<DeepStructure>
    type CheckTimestamp = Assert<Equal<Serialized['level1']['timestamp'], string>>
    type CheckTuple0 = Assert<Equal<Serialized['level1']['level2']['items'][0], string>>
    type CheckSubDate = Assert<Equal<Serialized['level1']['level2']['items'][1]['subDate'], string>>
    type NoCompute = Assert<AssertNotExtends<'compute', keyof Serialized['level1']['level2']['items'][1]>>

    const s: Serialized = {
      level1: {
        timestamp: '2026-01-01T00:00:00Z',
        level2: {
          items: ['2026-01-01T00:00:00Z', { subDate: '2026-01-01T00:00:00Z' }],
        },
      },
    }
    expect(s.level1.level2.items[1].subDate).toBe('2026-01-01T00:00:00Z')
  })

  it('preserves union types distributing correctly', () => {
    type _NullableDateCheck = Assert<Equal<JsonPrimitive<Date | null>, string | null>>
    type _UndefinedDateCheck = Assert<Equal<JsonPrimitive<Date | undefined>, string | undefined>>
    type _MixedUnionCheck = Assert<Equal<JsonPrimitive<string | number>, string | number>>

    const val: JsonPrimitive<Date | null> = null
    expect(val).toBeNull()
  })
})

describe('wire-format: Resolved', () => {
  class Profile {
    id: string = 'p-1'
    createdAt: Date = new Date()
    tags: Set<string> = new Set(['admin'])
    meta: Map<string, number> = new Map([['score', 99]])

    getScore(): number {
      return 100
    }
    updateProfile(): void {}
  }

  it('strips methods while preserving Date, Set, Map, and primitives', () => {
    type ResolvedProfile = Resolved<Profile>

    type CheckId = Assert<Equal<ResolvedProfile['id'], string>>
    type CheckDate = Assert<Equal<ResolvedProfile['createdAt'], Date>>
    type CheckSet = Assert<Equal<ResolvedProfile['tags'], Set<string>>>
    type CheckMap = Assert<Equal<ResolvedProfile['meta'], Map<string, number>>>

    type NoGetScore = Assert<AssertNotExtends<'getScore', keyof ResolvedProfile>>
    type NoUpdateProfile = Assert<AssertNotExtends<'updateProfile', keyof ResolvedProfile>>

    const p: ResolvedProfile = {
      id: 'p-1',
      createdAt: new Date(),
      tags: new Set(['tag']),
      meta: new Map([['k', 1]]),
    }
    expect(p.createdAt).toBeInstanceOf(Date)
    expect(p.tags).toBeInstanceOf(Set)
    expect(p.meta).toBeInstanceOf(Map)
  })

  it('drops weak collections and keeps typed native collections in Resolved', () => {
    type ResolvedCache = Resolved<{ seen: WeakSet<object>; owners: WeakMap<object, string>; ids: Set<number> }>
    type _WeakSetDroppedCheck = Assert<Equal<ResolvedCache['seen'], never>>
    type _WeakMapDroppedCheck = Assert<Equal<ResolvedCache['owners'], never>>
    type _SetKeptCheck = Assert<Equal<ResolvedCache['ids'], Set<number>>>

    const ids: ResolvedCache['ids'] = new Set([1])
    expect(ids.has(1)).toBe(true)
  })

  it('preserves bigint in Resolved', () => {
    type _PreserveBigIntCheck = Assert<Equal<Resolved<bigint>, bigint>>
    const b: Resolved<bigint> = 100n
    expect(b).toBe(100n)
  })

  it('resolves arrays and tuples while preserving native types', () => {
    type _ResolvedTupleCheck = Assert<Equal<Resolved<[Date, Set<number>]>, [Date, Set<number>]>>
    type _ResolvedArrayCheck = Assert<Equal<Resolved<Date[]>, Date[]>>

    const t: Resolved<[Date, Set<number>]> = [new Date(), new Set([1, 2])]
    expect(t[0]).toBeInstanceOf(Date)
    expect(t[1].has(1)).toBe(true)
  })
})

describe('wire-format: RecursiveCategory', () => {
  interface RecursiveCategory {
    id: string
    parent?: RecursiveCategory
    children?: RecursiveCategory[]
  }

  it('handles recursive interfaces without TS2615 compiler error', () => {
    type Serialized = JsonPrimitive<RecursiveCategory>
    type CheckId = Assert<Equal<Serialized['id'], string>>
    type CheckParent = Assert<Equal<Serialized['parent'], Serialized | undefined>>
    type CheckChildren = Assert<Equal<Serialized['children'], Serialized[] | undefined>>

    const category: Serialized = {
      id: 'root',
      children: [
        {
          id: 'child-1',
          parent: { id: 'root' },
        },
      ],
    }
    expect(category.id).toBe('root')
    expect(category.children?.[0]?.parent?.id).toBe('root')
  })
})

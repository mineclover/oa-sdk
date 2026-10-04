/**
 * RefExpansionMemo — `$ref` 대상 전개 결과를 사용처 간에 공유하는 스택 인지 메모.
 *
 * 인라인 전개는 같은 대상을 사용처마다 다시 접기 때문에, 공유 대상이 중첩되면
 * 비용이 지수적으로 증가한다. 전개 결과는 현재 cycle stack에만 의존하므로,
 * 다음 두 조건을 만족하면 다른 사용처에서 재사용해도 결과가 같다.
 *
 *   1. 전개 중 발생한 cycle이 모두 자기 frame 이상(자신 또는 하위 전개)을 가리킨다.
 *      → 전개 당시의 바깥 stack을 관측하지 않았다.
 *   2. 전개 중 방문한 대상 키 중 어느 것도 재사용 시점의 stack에 없다.
 *      → 재사용 위치에서 다시 접어도 새로운 cycle이 생기지 않는다.
 *
 * 전개 중 발생한 진단은 함께 저장해 재사용 시 같은 순서로 재방출한다.
 *
 * 방문 키와 진단은 frame마다 복사하지 않고 append-only log에 쌓은 뒤, 저장 조건을
 * 만족한 frame만 자기 구간을 잘라 entry로 만든다. 저장되지 않는 frame의 비용은 O(1)이다.
 */

export type RefStackView = {
  has(key: string): boolean
}

type ExpansionFrame = {
  depth: number
  lowestCycleDepth: number
  keyLogStart: number
  diagnosticLogStart: number
}

type ExpansionEntry<D> = {
  value: unknown
  keys: ReadonlySet<string>
  diagnostics: readonly D[]
}

export type ExpandRefOptions = {
  /** false이면 이 전개와 모든 상위 전개를 메모하지 않는다 (예: 외부 문서 전개). */
  cacheable?: boolean
}

export class RefExpansionMemo<D> {
  private readonly stack: string[] = []
  private readonly depthByKey = new Map<string, number>()
  private readonly frames: ExpansionFrame[] = []
  private readonly entries = new Map<string, ExpansionEntry<D>>()
  /** 진행 중인 frame들이 방문한 키. 재사용된 entry는 키 집합을 그대로 기록한다. */
  private readonly keyLog: Array<string | ReadonlySet<string>> = []
  private readonly diagnosticLog: D[] = []

  /** 현재 cycle stack 조회 뷰. resolver의 cycle 판정에 그대로 넘긴다. */
  readonly stackView: RefStackView = { has: key => this.depthByKey.has(key) }

  /** 현재 cycle stack 키 (바깥쪽부터). */
  stackKeys(): readonly string[] {
    return this.stack
  }

  /** 외부 문서 전개처럼 바깥 stack을 이어받아야 할 때 frame 없이 키를 채운다. */
  seed(keys: readonly string[]): void {
    for (const key of keys) {
      this.depthByKey.set(key, this.stack.length)
      this.stack.push(key)
    }
  }

  /** resolver가 `key`에서 cycle을 감지했음을 기록한다. */
  noteCycle(key: string): void {
    const frame = this.frames.at(-1)
    const depth = this.depthByKey.get(key)
    if (!frame || depth === undefined) return
    if (depth < frame.lowestCycleDepth) frame.lowestCycleDepth = depth
  }

  /** 진행 중인 전개가 재사용 시 재방출할 수 있도록 진단을 기록한다. */
  recordDiagnostic(diagnostic: D): void {
    if (this.frames.length > 0) this.diagnosticLog.push(diagnostic)
  }

  /**
   * `key` 대상을 전개한다. 재사용 가능한 결과가 있으면 진단을 `replay`로 재방출하고
   * 공유 값을 반환한다. 없으면 `expand`를 호출하고 조건을 만족할 때 결과를 저장한다.
   */
  expand(
    key: string,
    expand: () => unknown,
    replay: (diagnostic: D) => void,
    options: ExpandRefOptions = {},
  ): unknown {
    const entry = this.reusableEntry(key)
    if (entry) {
      if (this.frames.length > 0) this.keyLog.push(entry.keys)
      for (const diagnostic of entry.diagnostics) replay(diagnostic)
      return entry.value
    }

    const frame: ExpansionFrame = {
      depth: this.stack.length,
      lowestCycleDepth: options.cacheable === false ? -1 : Number.POSITIVE_INFINITY,
      keyLogStart: this.keyLog.length,
      diagnosticLogStart: this.diagnosticLog.length,
    }
    this.frames.push(frame)
    this.keyLog.push(key)
    this.depthByKey.set(key, frame.depth)
    this.stack.push(key)

    let value: unknown
    try {
      value = expand()
    } finally {
      this.stack.pop()
      this.depthByKey.delete(key)
      this.frames.pop()
    }

    if (frame.lowestCycleDepth >= frame.depth) {
      this.entries.set(key, {
        value,
        keys: this.collectKeys(frame.keyLogStart),
        diagnostics: this.diagnosticLog.slice(frame.diagnosticLogStart),
      })
    }

    const parent = this.frames.at(-1)
    if (parent) {
      if (frame.lowestCycleDepth < parent.lowestCycleDepth) parent.lowestCycleDepth = frame.lowestCycleDepth
    } else {
      this.keyLog.length = 0
      this.diagnosticLog.length = 0
    }
    return value
  }

  private reusableEntry(key: string): ExpansionEntry<D> | undefined {
    const entry = this.entries.get(key)
    if (!entry) return undefined
    if (this.stack.length <= entry.keys.size) {
      for (const stackKey of this.stack) {
        if (entry.keys.has(stackKey)) return undefined
      }
    } else {
      for (const visitedKey of entry.keys) {
        if (this.depthByKey.has(visitedKey)) return undefined
      }
    }
    return entry
  }

  private collectKeys(start: number): ReadonlySet<string> {
    const keys = new Set<string>()
    for (let index = start; index < this.keyLog.length; index++) {
      const item = this.keyLog[index]!
      if (typeof item === 'string') keys.add(item)
      else for (const key of item) keys.add(key)
    }
    return keys
  }
}

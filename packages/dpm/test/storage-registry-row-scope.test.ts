import { describe, expect, it } from 'vitest'

import {
  assertDpmRegistryRowMatchesSnapshot,
} from '../src/storage/registry-row-scope.js'
import {
  storageRegistryRows,
} from './support/storage-registry-fixtures.js'

describe('DPM registry storage row scope guard', () => {
  it('refuses storage rows outside the requested dataset or registry version', () => {
    expect(() =>
      assertDpmRegistryRowMatchesSnapshot(
        {
          datasetId: 'commerce_ai',
          registryVersion: 'reg-2026-07-01',
        },
        {
          ...storageRegistryRows[0],
          datasetId: 'other_dataset',
        },
      ),
    ).toThrow('Registry row other_dataset/reg-2026-07-01/rel_orders_customer@1 does not match requested snapshot commerce_ai@reg-2026-07-01')
  })
})

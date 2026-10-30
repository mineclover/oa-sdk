import { defineContract, event, method } from '../../src/index.js'

export type Init = { documentId: string; locale: string }

export const contract = defineContract({
  id: 'asset-selector',
  init: (value: unknown): Init => {
    const v = value as Partial<Init> | null
    if (typeof v?.documentId !== 'string' || typeof v.locale !== 'string') throw new Error('documentId and locale are required')
    return v as Init
  },
  methods: {
    'asset.select': method<{ multiple?: boolean }, { assetIds: string[] }>(),
    'asset.getSnapshot': method<void, { revision: number; assetIds: string[] }>(),
    'asset.save': method<{ name: string }, { saved: number }>(),
    'asset.readSelection': method<void, { text: string }>(),
    'asset.upload': method<{ bytes: ArrayBuffer }, { length: number }>(),
    'asset.download': method<{ size: number }, { bytes: ArrayBuffer }>(),
    'asset.leak': method<void, { handle: unknown }>(),
  },
  events: {
    'asset.selectionChanged': event<{ assetIds: string[] }>(),
    'asset.progress': event<{ percent: number }>({ replay: { capacity: 200 } }),
  },
  host: { 'host.document.getSelection': method<void, { text: string }>() },
})

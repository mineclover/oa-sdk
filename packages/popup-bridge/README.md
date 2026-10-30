# `@oa-sdk/popup-bridge`

Open a separately hosted popup web app, hand it an `init` context, and exchange typed RPC calls and events in both directions after an origin-verified handshake.

> Private workspace package, no runtime dependencies. Full conventions, wire format and error codes:
> [팝업 브리지 사용 가이드](../../docs/guides/popup-bridge.md).

| Entry | Use |
| --- | --- |
| `@oa-sdk/popup-bridge` | `defineContract`, `method`, `event`, `definePopup`, RPC generation utilities, `createRpcEndpoint` |
| `@oa-sdk/popup-bridge/host` | `createPopupBridge().open(definition, { init, host })` → `PopupSession` (`call`, `api`, `subscribe`, `close`) |
| `@oa-sdk/popup-bridge/popup` | `createPopupRuntime({ contract, allowedHostOrigins })` (`implement`, `emit`, `host.call`, `start`) |
| `@oa-sdk/popup-bridge/testing` | `createMemoryBrowser()` for tests without a browser |

```ts
const contract = defineContract({
  id: 'asset-selector',
  methods: { 'asset.select': method<{ multiple?: boolean }, { assetIds: string[] }>() },
})
const definition = definePopup(contract, { url: 'https://tools.example.com/asset-selector' })

// host
const popup = await createPopupBridge().open(definition, { init: {} })
const { assetIds } = await popup.api.asset.select({ multiple: false })

// popup
const runtime = createPopupRuntime({ contract, allowedHostOrigins: ['https://app.example.com'] })
runtime.implement({ 'asset.select': async () => ({ assetIds: ['a1'] }) })
await runtime.start()
```

The popup is opened synchronously inside `open()`; call it directly from a click handler.

Optional protocol features are negotiated in the handshake and only their intersection is used, so a peer without them keeps working: `events.replay` (bounded per-event buffer, `event({ replay })`, `session.resync()`) recovers missed events instead of a snapshot, and `events.coalesce` (`event({ coalesce })`) merges high-frequency events within a window. HELLO and resubscribe retries use cancellable exponential backoff with jitter and an injectable `Clock` (`retry` events).

Tests: `test` runs unit and in-memory integration tests; `test:e2e` drives real Chromium against three origins (needs `playwright-core`'s Chromium revision installed).

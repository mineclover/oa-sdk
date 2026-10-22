---
"@oa-sdk/webmcp-peer": patch
---

Name the package's actual version in the agent client.

`PACKAGE_VERSION` stayed at `0.1.0` when the package moved to `0.2.0`, so
`initialize` sent `clientInfo.version: "0.1.0"` and the user-agent said
`framebook-peer-mcp-client/0.1.0`. The release test caught the drift. Version
`0.2.1` reports `0.2.1` in both places.

Also update the preview browser-runtime smoke allowlist for the Node-only
`typegen` graph semantic exports and `isStreamingOperation`, keeping the local
CI mirror green after the v0.10.0 release.

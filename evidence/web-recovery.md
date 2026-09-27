# Browser durability check

On 28 September 2026, the exported static app ran in the in-app browser at `http://localhost:8083`, against an isolated API and two synthetic vocabulary items. It used the actual SQL.js WASM and IndexedDB adapter.

1. Paired the browser and synchronized Ephemeral and Lucid.
2. Revealed Ephemeral, selected Good, and observed a saved acknowledgment and server-confirmed next-review time before pressing Next.
3. Stopped the API, revealed Lucid and selected Good. The page reported a locally saved pending review and an unchanged due date.
4. Reloaded the page and opened Connection and sync. It showed one pending review and zero failed operations.
5. Restarted the API and reopened the client. Automatic synchronization reduced pending reviews to zero. The server contained exactly two accepted review events, one per item.
6. Loaded the versioned offline shell, stopped both the static host and API, and reloaded the browser. Both cached vocabulary items rendered with a visible synchronization failure.

The test database was `/private/tmp/recallx-ui.sqlite`; no personal learning history was used. These observations complement the transaction, failed-commit, cross-tab revision and duplicate-acknowledgment tests. They describe the in-app browser used for this run.

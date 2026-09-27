# Client and platform verification — 28 September 2026

## Reproducible client checks

| Check | Observed result |
| --- | --- |
| `npm run typecheck` | Passed, no TypeScript errors |
| `npm run test:ci -- --silent` | 51 suites, 335 tests passed |
| `npm run test:offline` | Passed: generated cache version changes with content; offline navigation returns cached shell; API and authenticated requests bypass the cache |
| `npm run export:web` | Passed; 35 static routes and 77 precached files |

Current web output is `dist/`. The verified export contains entry `a7ca6857c8953eda03d59afe36f345e5`, offline manifest version `56abf4ecf287b2e23af4`, and the installed SQL.js browser and common WASM binaries. Deployment must keep the generated HTML, JavaScript, WASM, and service worker from the same export together. The browser cache requires localhost or HTTPS with Web Locks and IndexedDB.

The root agent also inspected the in-app browser during the offline recovery check, stopping both the owned static host on port 8083 and the test API on port 8765, and reloading the tab. The cached two-item library rendered with a visible sync-failure message. This is a real stopped-host reload check in addition to the service-worker unit harness.

The database tests exercise actual SQL.js and IndexedDB transactions, schema adoption, rollback on failed durable writes, reopening persisted data, coordination between two independent database instances, and preservation of acknowledged state when a concurrent snapshot is older. Review tests cover immutable UUID retries after a lost response, atomic draft/outbox persistence, confirmed server ratings, offline self-ratings, and assisted clarification that cannot schedule reviews. Pending settings/rubric requests preserve their exact body and identity across lost replies, reject replacement with changed values, and archive definitively rejected requests before allowing a corrected intent. Word and tag mutations persist an immutable UUID envelope before sending, keep pending/acknowledged/failed receipts, preserve original create IDs across lost acknowledgements, and replay during synchronization. Pairing attempts retain native credentials in SecureStore and do not log bootstrap secrets. Review corrections show the saved rating and reason before explicit retry. Setup exposes scheduled typed recall, self-rated flashcards, and tutor practice, using confirmed snapshot due states with pending submissions excluded. Setup and the retention dashboard refresh on focus, foreground, and every 30 seconds while visible. Device pairing includes a list of active devices and confirmed revocation controls. Additional regression checks pin reviews to the context displayed when the card opened, start a fresh draft when the same card returns in a new session, avoid concurrent pairing polls, and allow model requests to complete beyond the server’s 180-second inference deadline. Export tests retain full server evidence and fail visibly when a complete JSON export cannot be fetched.

## Native browser checks

Chrome 153.0.8010.53 (build 8010.53) and Safari 27.0 (build 22625.1.29.11.27) each loaded the static export with JavaScript entry `018030476e517640c949949d96f491d8`, paired to the isolated fixture API on port 8765, synced Ephemeral and Lucid, and retained the two-item library after reloading. These checks used the actual browser applications through their UI. Chrome then reloaded the final `a7ca6857c8953eda03d59afe36f345e5` export against the API with all nine migrations applied. Pairing persisted, the setup showed Scheduled recall, Self-rated flashcards, and Tutor practice, and it displayed the two confirmed due items. The final automated tests cover the later durability refinements.

## Shared Expo build configuration

After the last export, Chrome reloaded entry `a7ca6857c8953eda03d59afe36f345e5` against the API with all nine migrations. Pairing persisted and Start Review rendered the three final review modes with the confirmed due count.

- Expo SDK 54.0.33, React 19.1.0, `react-native` pinned to `npm:react-native-tvos@0.81.5-2`, Jest Expo 54.0.17.
- The supported TV event hook replaces custom native key forwarding. The previous custom plugin source is retained, but the plugin is no longer registered.
- `EXPO_TV=0` preserves phone configuration. `EXPO_TV=1` enables the Expo TV config plugin. The phone EAS profile sets `EXPO_TV=0` explicitly.
- Native generation and builds used isolated copies below `/tmp/recallx-platform-1104x0pq`; the project's existing ignored native folders and prior edits were preserved.

## Completed native checks

| Target | Completed check | Evidence |
| --- | --- | --- |
| iPhone | Expo iOS generation; CocoaPods installation; signed release simulator build; SecureStore pairing; shared-library sync; revealed flashcard rating acknowledged before Next | Xcode 26.4.1 build 17E202; iOS Simulator SDK 26.4; iPhone 15 Pro runtime iOS 26.4; simulator ID `A5E7DD76-7E4C-4704-BFCF-683DF323534C`; review smoke launch process 92874; final package launch process 6334 |
| Android phone | Expo native generation with `EXPO_TV=0`; normal launcher manifest inspection | `/tmp/recallx-platform-1104x0pq/phone/android` |
| Android TV | Expo native generation with `EXPO_TV=1`; Leanback launcher, TV banner, and optional touch-feature inspection | `/tmp/recallx-platform-1104x0pq/tv/android` |

The iPhone compilation includes 103 CocoaPods, the TV fork's iOS prebuilt framework, Expo SQLite, and Expo SecureStore. Both arm64 and x86_64 simulator code compiled. The signed iPhone simulator also completed device pairing through SecureStore, synced both fixture items, revealed Ephemeral, and acknowledged a Good self-rating before navigation. Its UI showed “Saved to your shared history and schedule” and a server-confirmed next review of 30 September 2026 at 4:39:48 PM. The fixture API and database were isolated from the learner library.

The final signed app was then reinstalled and launched as process 6334. Its Library retained both items without re-pairing, and Shared review history displayed all three confirmed fixture attempts, including the native Good review at 4:39:48 PM. This verifies pairing/cache continuity through that final simulator update.

Native artifact and logs:

- App: `/tmp/recallx-platform-1104x0pq/derived/Build/Products/Release-iphonesimulator/RecallX.app`
- First release build: `/tmp/recallx-platform-1104x0pq/phone-build.log` — `BUILD SUCCEEDED`
- Source/export follow-up build: `/tmp/recallx-platform-1104x0pq/phone-final-build.log` — `BUILD SUCCEEDED`
- Final retry and safe-area build: `/tmp/recallx-platform-1104x0pq/phone-verified-build.log` — `BUILD SUCCEEDED`
- Simulator signing and secure-storage build: `/tmp/recallx-platform-1104x0pq/phone-keychain-build.log` — `BUILD SUCCEEDED`; Xcode injected simulator application/keychain entitlements. SecureStore remained enabled.
- Final signed release bundle: `/tmp/recallx-platform-1104x0pq/phone-release-final-build.log` — `BUILD SUCCEEDED`
- Initial launch screenshot: `/tmp/recallx-platform-1104x0pq/iphone-launch.png`
- Android phone generation: `/tmp/recallx-platform-1104x0pq/phone-android-prebuild.log`

Official compatibility references: [Expo SDK 54](https://docs.expo.dev/versions/v54.0.0/), [React Native TV 0.81.5-2 release](https://github.com/react-native-tvos/react-native-tvos/releases/tag/v0.81.5-2), and [Expo TV build guide](https://docs.expo.dev/guides/building-for-tv/).

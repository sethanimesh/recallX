# HyperFrames Composition Brief: RecallX

## Objective

Create a short, clean product film showing how the RecallX vocabulary library and self-rated review appear on mobile, web, and Android TV.

## Output

- Composition: `brag-output-2026-10-04-210507/composition/`
- Rendered video: `brag-output-2026-10-04-210507/brag.mp4`
- Poster: `brag-output-2026-10-04-210507/brag.jpg`
- Format: landscape, 1920 × 1080
- Duration: 24.6 seconds

## Source material

- Project root: `/Users/animesh/Animesh/Projects/RecallX`
- Main files read: `app/(tabs)/index.tsx`, `app/recall-setup.tsx`, `src/screens/CentralReviewScreen.tsx`, `app/history.tsx`, `evidence/platforms.md`, and `docs/demo.md`
- Product: RecallX
- Core claim: the mobile, web, and Android TV clients use a shared learner library and review history
- Real UI asset: `composition/assets/images/web-library-capture.jpg`, copied from `assets/screenshots/library.png`
- Demo data: 20 constructed words plus one deliberately saved “Good” review in an isolated local database; no real learner records
- TV evidence: native build and source checks exist, but no Android TV runtime screenshot. TV UI in the video is a reconstruction from the current `Platform.isTV` source paths, explicitly not a screen capture.

## Creative direction

- Tone: app-store, polished, concise
- Angle: one review loop across a phone, browser, and living-room screen, with each view reflecting its actual controls and layout
- Hook: a three-device library tableau with “Your words. Every screen.”
- Final copy: “One library. One shared review history.”
- Avoid generic SaaS claims, retention outcomes, fake analytics, sideways TV controls, and blended review states.

## Visual identity

- Canvas `#F3F4F6`; white cards; text `#111827`; muted text `#596273`
- RecallX blues `#3B82F6` and `#2563EB`; confirmation green `#047857`
- System sans-serif typography, rounded cards, open spacing
- TV controls stack vertically, following the default React Native view direction in `CentralReviewScreen.tsx`.

## Storyboard

Use the eight-screen storyboard in `brag-plan.md` as the content contract. It covers the three-platform library, mobile library, deck selection, mobile prompt/reveal/receipt, captured web library, shared history, TV prompt/reveal/receipt, and the multi-device close. Total duration is 24.6 seconds.

## Audio

- Music: `assets/music/happy-beats-business-moves-vol-12-by-ende-dot-app.mp3`, cut to 24.6 seconds at low level
- Music cue preset: `assets/music/cues/happy-beats-business-moves-vol-12-by-ende-dot-app.music-cues.json`
- Primary cue locks: mobile reveal 9.288s, TV reveal 18.564s, final logo emphasis 22.93s
- SFX: local light click, card reveal, confirmation, and TV selection; no voiceover
- Keep the music under UI copy; use no waveform or invented performance data.

## HyperFrames notes

- Each screen state is separate and legible; transition only after its key copy has held.
- Mobile prompt omits the answer; reveal state includes the definition, example, and vertical ratings; acknowledged state removes the ratings and shows the server-confirmed message, next-review time, and Next/Exit.
- TV scene follows the source: the next due word after the mobile rating, enlarged text, example after reveal, and vertically stacked Again/Good focus states. It stops before submitting this next card.
- The web library image is the existing real screenshot. Newer mobile and TV states are source-matched constructions based on current code and seeded vocabulary.

# Hyperframes Composition Brief: RecallX

## Objective
Create a clean, mobile-first launch video that shows RecallX’s vocabulary review flow and the same learner library across phone, browser, and Android TV.

## Output
- Composition directory: `brag-output/composition/`
- Rendered video: `brag-output/brag.mp4`
- Poster: `brag-output/brag.jpg`, chosen from a settled hook frame and baked as frame 0
- Format: landscape — 1920x1080
- Duration: 21 seconds

## Source Material
- Project root: `/Users/animesh/Animesh/Projects/RecallX`
- Primary files read: `README.md`, `package.json`, `src/utils/theme.ts`, `app/flashcard.tsx`, `app/recall-setup.tsx`, `src/screens/CentralReviewScreen.tsx`, `src/components/TVFocusable.tsx`, `assets/screenshots/library.png`, `examples/demo-library.json`
- Product name: RecallX
- Strongest claim: paired phone, browser, and Android TV clients share one learner library and review history
- Key UI or visual moment: a self-rated flashcard answer reveal and acknowledged rating; show the browser library capture and a TV-sized version of that review card
- Copy that must appear verbatim: “One library. Every screen.”; “Self-rated review”; “Reveal answer”; “Good — remembered”; “Saved to your shared history and schedule.”; “Mobile · Web · Android TV”; “One shared review history.”
- Fixture note: the sample words and library screenshot are constructed demo vocabulary, not real learner data. Use `Ephemeral` and its exact fixture definition; show no personal information, credentials, device IDs, API URLs, or bootstrap secrets.

## Creative Direction
- Tone preset: app-store
- Creative direction: crisp mobile-first product film that widens into a clearly legible three-screen setup
- Interpretation: feature-forward but warm; make the phone the visual anchor, then reveal browser and Android TV as equal supported clients. Keep interfaces recognizably grounded in source screens.
- Angle: one personal vocabulary library travels from a phone to a browser to Android TV, while review history stays shared.
- Hook: phone-led trio and “One library. Every screen.” in the first three seconds.
- Outro: RecallX, “Mobile · Web · Android TV”, “One shared review history.”
- Avoid: generic SaaS language, claims of improved retention, abstract filler, simulated semantic grading, or a product UI unrelated to RecallX.

## Visual Identity
- Background: `#F3F4F6`
- Text: `#111827`; secondary `#6B7280`
- Accent: `#3B82F6`; cards white `#FFFFFF`; borders `#E5E7EB`
- Display and body fonts: system sans-serif, matching the app UI
- Visual references: the app’s actual light review interface and captured web library; product card proportions and blue primary actions from source code
- Design system: `composition/DESIGN.md`

## Storyboard
Use `brag-output/brag-plan.md` as the creative contract.

1. One library, every screen — 3s — start on the fully visible phone-led device trio; phone, Web, and Android TV are all named from frame one.
2. Recall on mobile — 4s — reveal “Ephemeral,” show its fixture definition, select “Good — remembered”.
3. Browser library — 3s — actual captured browser library inside a laptop frame.
4. Android TV — 3s — real review flow reconstructed at TV scale with remote focus movement.
5. Shared history — 4.5s — all three devices with the exact acknowledged-state copy.
6. RecallX — 3.5s — platform line and shared-history close; leave a clean held frame for the poster.

## Audio
- Audio role: clean rhythmic bed with sparse professional UI accents
- Audio arc: low steady bed, a soft reveal/select accent, gentle confirmation, quiet logo tail
- Music: `assets/music/recallx-bed-21s.mp3`, trimmed from Vol. 12 with a 0.5s fade-in and a 1s fade-out
- Music treatment: around 0.24 volume; fade in across 0.5s and out across the final second
- Music cue guidance: bundled preset JSON at `assets/music/cues/happy-beats-business-moves-vol-12-by-ende-dot-app.music-cues.json`; use at most three strong-cue locks near 8.74s, 10.93s, and 17.47s if compatible with readable holds
- Audio-reactive treatment: extraction was attempted with the bundled HyperFrames helper but could not run because Python `numpy` is not installed. Document the skip and keep the blue sync ornament static; do not fake an audio-data response.
- Audio-coupled moments: flashcard answer reveal, self-rating, arrival of browser/TV, and saved-history acknowledgement
- SFX selection guidance: use the bundled `brag` SFX analysis guidance at `/Users/animesh/.codex/plugins/cache/brag/brag/0.4.0/skills/brag/assets/sfx/sfx-analysis.md`; choose soft touch/select/confirmation sounds that match existing UI motion
- Exact SFX choice: choose only after animation is built; keep the sound palette coherent and sparse
- Audio files: local copies belong in `composition/assets/`

## Hyperframes Instructions
Use the Hyperframes composition contract and CLI guidance already present in the local Hyperframes skill. `/brag` owns the product angle and storyboard; implement the UI frames, device transitions, precise timing, sound alignment, validation, and render in Hyperframes. Do not route into a generic video-entry interview. Run `npx hyperframes check` before render and fix every reported error. Render locally to `../brag.mp4`, choose a settled, self-contained poster frame, and bake it as frame 0.

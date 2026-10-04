# Brag Plan: RecallX

## What is this app?
RecallX is a vocabulary learning app whose phone, browser, and Android TV clients share one learner library and review history.

## The angle
One personal vocabulary library follows the learner from a phone to a browser to the living-room TV. Keep the phone and a real flashcard interaction as the visual anchor, then widen the frame to show the same study experience across screens. The edit stays honest about the product: it shows self-rated flashcard review and a server-confirmed shared history, with no claim that RecallX has proved better retention.

## Hook (first 2-3 seconds)
A clean phone-led three-device tableau lands immediately. A single vocabulary card is visible on the phone, with browser and Android TV screens beside it. The line “One library. Every screen.” earns the reveal.

## Key moments (the middle)
- On the phone, open a self-rated flashcard, reveal “Ephemeral,” and rate it “Good — remembered.”
- Pull out to the browser library, using the actual captured library UI with its constructed vocabulary fixtures.
- Give the Android TV version its own full-screen moment with the same review card and TV-sized controls.
- Return to all three devices as the review acknowledgement appears: “Saved to your shared history and schedule.”

## Outro / punchline
RecallX resolves as the shared home for the study session: “Mobile · Web · Android TV” and “One shared review history.”

## User flow worth showing
Open the synced vocabulary library → attempt a self-rated flashcard and reveal its meaning → choose a rating and see the acknowledged review saved to shared history and schedule. The same learner library is available in the phone, browser, and Android TV clients.

## Tone
- Preset: app-store
- Creative direction: clean, mobile-first product film that widens into a three-screen study setup
- Interpretation: smooth feature-led pacing, restrained blue accents, readable UI, and short confident copy; keep the phone largest in the opening and return to it in the closing device group.

## Format: landscape — 1920x1080
## Duration: 21 seconds

## Visual identity (from the project)
- Background: `#F3F4F6` (light UI); use `#12141C` and `#1E2230` only for the optional dark TV frame
- Accent: `#3B82F6`
- Text: `#111827`; secondary text `#6B7280`
- Display font: system sans-serif, as in the app UI
- Body font: system sans-serif, as in the app UI
- Strongest visual element: the blue-button, light-card self-rated flashcard UI; a real browser library capture grounds the laptop scene.

## Share copy (draft)
One vocabulary library, from your phone to your browser to Android TV — with one shared review history.

## Audio direction
- Role: clean rhythmic bed with light interface accents
- Music: `happy-beats-business-moves-vol-12-by-ende-dot-app.mp3`, steady and polished
- Music treatment: start at 0s around 0.24 volume, fade in over the first half-second and out over the last second; let device reveals land near selected strong cues.
- Music cue guidance: bundled preset at `assets/music/cues/happy-beats-business-moves-vol-12-by-ende-dot-app.music-cues.json`, estimated 109.96 BPM. Strong cues at 8.74s, 10.93s and 17.47s; use at most three if they support the reveals. The grid is roughly 0.54s per beat. Keep readable copy on screen for its full hold rather than advancing text on each beat.
- Audio-reactive treatment: unavailable in this environment because the bundled extraction helper needs Python `numpy`, which is not installed. Keep the blue sync line static rather than faking a data-driven reaction.
- SFX posture: sparse, soft UI taps synced to reveal/rating and a quiet confirmation note for the saved review.
- Audio-coupled moments: phone tap/reveal at 3-7s; web and TV device arrivals near 8.74s and 10.93s; acknowledgement and RecallX close near 17.47s.
- Restraint rule: keep the music below the UI; no loud chimes or busy transitions.

## Storyboard

### Scene 1 — One library, every screen — 3s
At first frame, a crisp phone leads a clean device trio. Its screen shows a RecallX vocabulary card; browser and Android TV forms sit beside it. Settle the hook “One library. Every screen.” with labels “Mobile”, “Web”, and “Android TV” visible immediately. Use blue only for active UI and the thin rule below the hook. Use a reconstructed phone UI based on `app/flashcard.tsx` and `src/screens/CentralReviewScreen.tsx`; use the captured browser library in the laptop. This instantly establishes a phone-first product and the multi-device story.
Sequential/interaction: none; the three supported screens are visible on frame one, with only a short rule draw beneath the hook.
Audio intent: warm beat starts under the fully readable first frame; keep the UI silent until the review interaction.
Audio-coupled idea: no beat-by-beat copy; the rule draw can settle into the opening beat.
Music: clean, steady, upbeat bed.
Transition mood: smooth push toward the phone → Scene 2

### Scene 2 — Recall on mobile — 4s
Phone fills most of frame. Show “Self-rated review”, the real demo-fixture word “Ephemeral”, a tap on “Reveal answer”, then “Lasting for a very short time.” and the app’s “Good — remembered” choice. Rebuild the genuine UI from `CentralReviewScreen.tsx` using the real blue-button/light-card palette. Keep each label long enough to read.
Sequential/interaction: yes — tap “Reveal answer”, show the definition, then select “Good — remembered”.
Audio intent: quiet touch sound on reveal; a soft confirmation accent on the rating.
Audio-coupled idea: the card change and rating respond to simulated taps, not rapid beat-by-beat text.
Music: continues at a low level.
Transition mood: smooth zoom back to expose the browser → Scene 3

### Scene 3 — Browser library — 3s
Reveal the actual `assets/screenshots/library.png` inside a light laptop frame. Give the real browser library a clean, readable hold with the “Web” label. The captured list displays the constructed demo fixtures only; do not add dates, counts, or learner outcomes.
Sequential/interaction: yes — the laptop and its existing browser controls arrive as one focused reveal.
Audio intent: airy transition with no heavy accent.
Audio-coupled idea: device arrival may align near the 8.74s strong cue; keep the sync label steady afterward.
Music: steady and clean.
Transition mood: smooth slide across the same study card → Scene 4

### Scene 4 — Android TV — 3s
The TV frame takes focus. Recreate the app’s self-rated review card at TV scale: “Ephemeral”, “Reveal answer”, and “Good — remembered”. Label it “Android TV”. Add a restrained directional-focus outline to suggest remote navigation, based on `TVFocusable` and the Android TV route.
Sequential/interaction: yes — the active remote focus moves from “Reveal answer” to “Good — remembered” once, then holds.
Audio intent: one quiet remote/select click; never arcade-like.
Audio-coupled idea: let the TV card finish arriving near the 10.93s strong cue, then move the remote focus after the answer reveal.
Music: the same polished bed.
Transition mood: dissolve into all three devices together → Scene 5

### Scene 5 — Shared history — 4.5s
Bring phone, browser, and TV back together, each still showing the same study context. The acknowledgement appears as a legible chip on the phone: “Saved to your shared history and schedule.” Add a small connection line between device edges; keep the app UI as the point of focus.
Sequential/interaction: yes — one saved-state check appears, then the linking line completes across the three devices.
Audio intent: soft confirmation tone, followed by a short breathing space.
Audio-coupled idea: the acknowledgement appears with a soft accent, stays legible, then hands off to the logo at 17.47s.
Music: begins its gentle ending after the confirmation.
Transition mood: clean fade to the product close → Scene 6

### Scene 6 — RecallX — 3.5s
Show a compact device trio with the phone largest and the browser and Android TV clearly labeled. RecallX wordmark resolves above: “Mobile · Web · Android TV” and “One shared review history.” Hold the final frame long enough to stand alone as a thumbnail.
Sequential/interaction: yes — wordmark, then the three platform labels; all remain together through the end.
Audio intent: quiet, resolved music tail; no final boom.
Audio-coupled idea: wordmark lands on the 17.47s strong cue if it has not been used for the preceding confirmation; let the music resolve naturally.
Music: gentle fade to silence at 21s.
Transition mood: final soft fade to light background.

**Music mood for this video:** polished, lightly upbeat.
**Audio summary:** A quiet rhythmic bed carries phone interaction into the laptop and TV reveals, then softens under the confirmed shared-history moment and simple logo hold.

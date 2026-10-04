# Brag Plan: RecallX

## What is this app?

RecallX is a vocabulary learning app with mobile, web, and Android TV clients. Its word library and confirmed review history sync through the shared server.

## The angle

Show the same study loop at the size each screen is built for: browse words on a phone, choose a review deck, reveal and rate a card, then see the confirmed event in web history. Give Android TV its own moment with large type and vertically stacked remote controls. The visual states follow the current screen code, and the TV composition is clearly treated as a source-matched reconstruction because a TV runtime screen capture is not in the evidence set.

The local isolated demo database was seeded with 12 additional constructed words, bringing the demo library to 20. No real learner history or production database is used.

## Hook (first 2–3 seconds)

Open on a three-device tableau: real web library capture, phone library, and Android TV library. “Your words. Every screen.” identifies the product and the cross-device story immediately.

## Key moments (the middle)

- Browse the phone library, including search, definitions, tabs, and add control.
- Choose a deck and the “Self-rated flashcards” mode; show the current 20-word due count.
- On mobile, show the actual seeded “Alleviate” review prompt, reveal its definition and example, self-rate it, and show the acknowledged save state with its server-confirmed next review time.
- Return to the browser library using the authentic captured UI.
- Show the shared review history screen with the confirmed “Alleviate · Good” event and its correction action.
- Reconstruct the next Android TV review from `CentralReviewScreen.tsx`: after Alleviate is acknowledged on mobile, show Ambiguous as the next due word, its definition and example, and vertically stacked Again/Good controls with remote focus. A real Android TV runtime screenshot was not captured, so this is presented as a source-matched reconstruction.

## Outro

RecallX, Mobile, Web, Android TV — “One library. One shared review history.”

## Storyboard (24.6 seconds)

| Time | Screen / beat | Text and action |
| --- | --- | --- |
| 0.0–2.4 | Three-device library opener | “Your words. Every screen.” Actual web library capture; source-matched mobile and TV library views. |
| 2.4–5.0 | Mobile library | Search, vocabulary rows, bottom tabs, and add control. “A good word is worth keeping.” |
| 5.0–7.4 | Choose a deck | Self-rated flashcards selected; Jumbled / Alphabetical / Newest; All Words; 20 due now; Today’s Words (12); Start. |
| 7.4–12.0 | Mobile self-rated review | Alleviate, 1 / 20 → Reveal answer → definition and example → Again / Good → saved message and confirmed next review time. |
| 12.0–14.6 | Web library | Hold the actual captured browser library. |
| 14.6–17.1 | Shared review history | One confirmed Alleviate rating with its timestamp and “Correct this review,” reconstructed from `app/history.tsx`. |
| 17.1–21.1 | Android TV self-rated review | Next due word Ambiguous, 1 / 19; reveal its definition and example; show vertically stacked Again/Good controls with remote focus on Good. Source-matched reconstruction, not a runtime capture. |
| 21.1–24.6 | Device close | RecallX wordmark, Mobile · Web · Android TV, “One library. One shared review history.” |

## Tone and format

- Preset: app-store
- Creative direction: clean, phone-led product film that widens into browser and living-room screens
- Format: landscape, 1920 × 1080
- Duration: 24.6 seconds
- Voiceover: off

## Visual identity

- Canvas: `#F3F4F6`
- Cards: `#FFFFFF`
- Text: `#111827`; secondary `#596273`
- Action blue: `#3B82F6` / `#2563EB`
- Confirmation green: `#047857`
- Typeface: system sans-serif, matching the app
- Screens: actual web library capture plus source-matched mobile/TV layouts. Avoid mixing prompt, reveal, and acknowledged states.

## Audio direction

- Music: `happy-beats-business-moves-vol-12-by-ende-dot-app.mp3`, first 24.6 seconds
- Level: restrained, about 0.22, under three clear UI accents
- Cue guidance: bundled music cue preset; major accents at 9.288s (mobile answer reveal), 18.564s (TV answer reveal), and 22.93s (logo emphasis). These are timing hints, not a reason to shorten screen holds.
- SFX: one light click, a soft card reveal, a quiet rating confirmation, and one remote selection click. No narration.

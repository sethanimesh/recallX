# RecallX Video Design System

## Style

Light, clear product film grounded in RecallX screens. Move from a phone library and deck setup into a self-rated review, then widen to the browser and Android TV. Each screenshot or reconstructed screen must show one coherent app state. Use open spacing, softened device edges, thin dividers, small blue focus states, and rounded white cards.

## Source accuracy

- The web library image is an authentic capture from the local sample-data app.
- Mobile review copy and state transitions follow `src/screens/CentralReviewScreen.tsx`; the Alleviate card is from the 20-word isolated demo set.
- Library and setup controls follow `app/(tabs)/index.tsx` and `app/recall-setup.tsx`.
- History controls follow `app/history.tsx`.
- TV UI follows `Platform.isTV` source branches and the native TV review styles. It is a source-matched reconstruction; no Android TV runtime screen capture is represented as real footage.
- All demo vocabulary is constructed. No learner outcomes or production records are implied.

## Colors

- Canvas: `#F3F4F6`
- Card: `#FFFFFF`
- Primary text: `#111827`
- Secondary text: `#596273`
- RecallX blue: `#3B82F6`; button blue: `#2563EB`
- Confirmation green: `#047857`
- TV bezel only: `#12141C`

## Type and motion

System sans-serif, semibold controls, large legible words. Use calm glides, short focus changes, and enough still time to read the card, example, and saved state.

## Avoid

No neon, generic SaaS art, fake charts, retention statistics, horizontal TV rating rows, invented prompt/answer states, or unsupported learning claims.

# Handoff Spec: Modern Loading Page

## Overview
A minimal, performance-optimized loading page designed for page transitions with moderate animation. Displays a spinning progress indicator with percentage, scaling responsively from desktop to mobile. The page provides visual feedback during the 3–5 second page load period while minimizing layout shift and animation jank.

**Use case:** Display during initial page load or major navigation transitions. Users see a calming spinner and progress percentage, reassuring them the page is loading.

**Performance focus:** Minimal DOM, hardware-accelerated animations (transform/opacity only), no repaints, sub-50KB bundle footprint including React.

---

## Layout & Grid System

### Desktop (≥1024px)
- Centered full-viewport container, `display: flex`, `align-items: center`, `justify-content: center`
- Spinner + text block stacked vertically, centered
- Safe area: 32px padding (100% – 64px width/height)
- Spinner: 40px diameter
- Text block: 200px width, center-aligned

### Tablet (768px – 1023px)
- Same centering behavior
- Spinner: 36px diameter
- Padding: 24px
- Text block: 180px width

### Mobile (<768px)
- Same centering
- Spinner: 28px diameter
- Padding: 20px
- Text block: 140px width, single line "Loading"
- Optional: hide percentage text on very small screens (<360px) — show spinner only

---

## Design Tokens Used

| Token | Value | Usage |
|-------|-------|-------|
| `color-border-tertiary` | `rgba(0, 0, 0, 0.15)` light / `rgba(255, 255, 255, 0.15)` dark | Spinner ring (inactive portion) |
| `color-text-info` | `#185FA5` light / `#85B7EB` dark | Spinner ring (active/top arc) |
| `color-text-secondary` | `#888780` light / `#B4B2A9` dark | Secondary text ("Loading your content") |
| `color-text-primary` | `#2C2C2A` light / `#F1EFE8` dark | Percentage text |
| `color-background-primary` | `#FFFFFF` light / `#1a1a1a` dark | Page background |
| `spacing-sm` | 16px | Component gaps |
| `spacing-md` | 24px | Section padding |
| `spacing-lg` | 32px | Large viewport padding |
| `font-size-body` | 13px | Secondary text |
| `font-size-heading` | 14px | Percentage display |

---

## Components & Composition

### Spinner Ring
- **Element:** SVG or CSS border-based circle
- **Dimensions:** 40px (desktop), 36px (tablet), 28px (mobile)
- **Border width:** 2.5px (desktop/tablet), 2px (mobile)
- **Border color:** `color-border-tertiary` (full ring)
- **Top border color:** `color-text-info` (rotating arc)
- **Border radius:** 50% (perfect circle)
- **Animation:** `spin-smooth 0.8s linear infinite`
  - Rotation: 0deg → 360deg over 0.8s
  - Easing: linear (constant speed)
  - GPU accelerated: `transform: rotate(...)` only

### Text Block
**Heading (secondary text)**
- Content: "Loading your content" (desktop/tablet) or "Loading" (mobile)
- Font size: 13px (desktop/tablet), 11px (mobile)
- Font weight: 400
- Color: `color-text-secondary`
- Text align: center
- Line height: 1.4
- Margin bottom: 4px

**Percentage**
- Content: Progressive percentage (0–100%) that updates in real time
- Font size: 14px (desktop/tablet), 12px (mobile)
- Font weight: 500
- Color: `color-text-primary`
- Text align: center
- Accessible name: `aria-label="Loading progress, ${percent} percent complete"`

---

## States & Interactions

| State | Appearance | Behavior | Trigger |
|-------|-----------|----------|---------|
| **Idle** | Spinner fully visible, static position. Text displays "Loading your content" or "Loading". Percentage shows "0%". | None — initial state. | Page mount or load start. |
| **Loading** | Spinner rotates smoothly. Percentage updates per 100ms interval. Text remains static. | Continuous rotation. Percentage increments based on load progress. | While fetch is in-flight. |
| **Complete** | Fade out over 300ms (opacity: 1 → 0). Pointer events disabled after fade. | Opacity transition, no transform. Page content fades in behind. | When fetch completes or `onLoadComplete` called. |
| **Error** | Text changes to "Something went wrong". Spinner stops rotating (opacity fades to 0.3). Optional: Red error icon appears. | No animation. User can retry via button. | If fetch fails with error code. |

---

## Animation & Motion

| Element | Trigger | Animation | Duration | Easing | GPU? |
|---------|---------|-----------|----------|--------|------|
| Spinner ring | Mount | `rotate(0deg)` → `rotate(360deg)` | 800ms | linear | Yes (transform) |
| Percentage text | Increment | None (instant update) | — | — | N/A |
| Loading page (exit) | Complete | `opacity: 1` → `opacity: 0` | 300ms | ease-out | Yes (opacity) |
| Error state | Error | `opacity: 0.3` | 200ms | ease-in-out | Yes (opacity) |

**Performance notes:**
- Spinner uses `transform: rotate()` only — no layout or paint cost.
- Exit fade uses `opacity` only — no reflow.
- Percentage updates: text content swap, not animation. Keeps jank-free.
- Disable `will-change` unless targeting sub-60fps hardware. Standard modern browsers handle spin smoothly without hints.

---

## Responsive Behavior

| Breakpoint | Spinner | Text | Padding | Notes |
|------------|---------|------|---------|-------|
| Desktop (≥1024px) | 40px | 13px, "Loading your content" | 32px | Full text, larger spinner. |
| Tablet (768–1023px) | 36px | 13px, "Loading your content" | 24px | Same text, slightly smaller spinner. |
| Mobile (<768px) | 28px | 11px, "Loading" | 20px | Compact text, smallest spinner. |
| Very small (<360px) | 24px | 11px, "Loading" | 16px | Optional: hide percentage entirely. |

**Responsive implementation:**
```jsx
const spinnerSize = {
  desktop: 40,
  tablet: 36,
  mobile: 28,
  small: 24
}[breakpoint];
```

---

## Edge Cases

### Slow Connections (10s+ load)
- **Behavior:** Spinner continues indefinitely. Percentage caps at 95% after 5s elapsed (don't reach 100% until page is truly ready).
- **Rationale:** Prevents false "nearly done" signals on very slow networks.
- **Implementation:** Use max-progress logic: `min(95, (elapsed / expectedTime) * 100)`.

### Instant Completion (<500ms)
- **Behavior:** Skip fade-out animation. Jump directly to loaded state (show page immediately).
- **Rationale:** Fade is only noticeable if loading is visible; instant loads feel unresponsive with animation delay.
- **Implementation:** `if (loadTime < 500) { skipFade = true; }`.

### Network Error / Timeout
- **Behavior:** Spinner stops, text updates to "Something went wrong". Optional: Show retry button.
- **Appearance:** Spinner opacity fades to 0.3 over 200ms. Text color stays `color-text-primary`.
- **User action:** Retry button calls `location.reload()` or re-triggers fetch.

### User Navigates Away (mid-load)
- **Behavior:** Abort fetch, clear animation frame, unmount component.
- **Implementation:** Cleanup in `useEffect` return: cancel fetch AbortController, cancel animation frame.

### Dark Mode Transition
- **Behavior:** CSS variables auto-update. No React re-render needed (pure CSS).
- **Testing:** Verify spinner and text visible on both light and dark backgrounds.

---

## Accessibility

### Focus & Keyboard
- Loading page is **non-interactive** — no tab stops.
- Once page loads, focus transfers to first focusable element on loaded content.
- If error state shows retry button: button is keyboard accessible (`tabindex="0"` or native `<button>`).

### ARIA Labels
```jsx
<div 
  role="status" 
  aria-live="polite" 
  aria-busy="true"
  aria-label="Loading page, please wait"
>
  {/* spinner + text */}
</div>

<div aria-label={`Loading progress, ${percent} percent complete`}>
  {percent}%
</div>
```

- **role="status"**: Announces loading state to screen readers.
- **aria-live="polite"**: Updates to percentage are read aloud (not aggressive "assertive").
- **aria-busy="true"**: Indicates interaction is pending.

### Color Contrast
- Spinner: `color-text-info` (Blue 185FA5 / Blue 85B7EB in dark) on `color-background-primary` → WCAG AA pass.
- Text: `color-text-secondary` on background → WCAG AA pass.
- Error state (red): Use `color-text-danger` (Red 800 / Red 100) → WCAG AA pass on light/dark.

### Motion & Vestibular
- Spinner rotates at 1.25 rev/sec (0.8s per rotation) — moderate, not dizzying.
- Fade-out uses 300ms — within guideline for non-essential motion.
- **Optional:** Respect `prefers-reduced-motion`:
  ```css
  @media (prefers-reduced-motion: reduce) {
    .spinner { animation: none; opacity: 0.5; }
    .loading-page { transition: none; }
  }
  ```

### Screen Reader Testing
- VoiceOver / NVDA should announce: "Loading page, please wait. Loading progress, 45 percent complete."
- Percentage updates should be read every 1–2 updates (batched to reduce verbosity).

---

## Implementation Notes for Developers

### React Hook for Progress Tracking
```jsx
const [progress, setProgress] = useState(0);

useEffect(() => {
  const startTime = Date.now();
  const interval = setInterval(() => {
    const elapsed = Date.now() - startTime;
    const newProgress = Math.min(95, (elapsed / 5000) * 100); // 5s expected load
    setProgress(Math.round(newProgress));
  }, 100);

  return () => clearInterval(interval);
}, []);
```

### CSS-Only Spinner Alternative
If SVG spinner is not preferred, use CSS border approach:
```css
.spinner {
  width: 40px;
  height: 40px;
  border: 2.5px solid var(--color-border-tertiary);
  border-top-color: var(--color-text-info);
  border-radius: 50%;
  animation: spin-smooth 0.8s linear infinite;
}

@keyframes spin-smooth {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}
```

### File Size Budget
- React component: <3 KB (minified + gzip)
- CSS: <1 KB
- SVG spinner (if used): <0.5 KB
- Total: **<5 KB** (with React already loaded)

### Exit Strategy
When page content is ready:
```jsx
useEffect(() => {
  if (pageReady) {
    const timer = setTimeout(() => setIsLoading(false), 300); // wait for fade
    return () => clearTimeout(timer);
  }
}, [pageReady]);
```

---

## States Specification

### Loading
- Spinner rotating continuously
- Percentage: 0–95% (updates every 100ms)
- Text: "Loading your content" (or "Loading" on mobile)
- Opacity: 100%

### Complete
- Spinner: still visible, but fading
- Page content: fading in behind
- Transition: 300ms ease-out
- Final: component unmounts, page is interactive

### Error
- Spinner: static, opacity 30%
- Text: "Something went wrong"
- Optional button: "Try again"
- Color: `color-text-danger` (red)
- User action required to retry

---

## Testing Checklist

- [ ] Spinner rotates smoothly at 60 fps (no jank)
- [ ] Percentage increments smoothly and caps at 95%
- [ ] Fade-out completes in 300ms
- [ ] Works on Safari, Chrome, Firefox (last 2 versions)
- [ ] Responsive: test at 320px, 768px, 1024px widths
- [ ] Dark mode: colors update without re-render
- [ ] Reduced motion: spinner stops or slows on `prefers-reduced-motion: reduce`
- [ ] Screen reader: "Loading, 45 percent" is announced
- [ ] Error state: displays correctly, retry button works
- [ ] Network throttle (slow 3G): spinner displays, no timeout <10s
- [ ] AbortController cleanup: no memory leaks if user navigates away mid-load

---

## Variants & Future States

### With ETA Timer
If expected load time varies, show countdown:
```
Loading your content
2:34 remaining
```
Keep font-size consistent, update every 1s.

### Progress Ring (instead of Spinner)
Replace rotating circle with ring fill:
- Ring 0–100% filled based on `progress`
- Segment moves clockwise
- Use `stroke-dasharray` for CSS animation
- Same dimensions and colors

### Loading Steps
If multi-step loading (upload → process → save):
```
Uploading... ✓
Processing... → (in progress)
Saving...
```
Update text per step, keep spinner visible.

---

## Design System Integration

This loading page integrates with:
- **Colors:** Uses semantic `color-text-info` for active state, `color-text-secondary` for helper text
- **Spacing:** Uses standard rem scale (1rem = 16px)
- **Typography:** Body and heading weights only (400, 500)
- **Motion:** `ease-out` for exits, `linear` for continuous spinners
- **Accessibility:** WCAG AA contrast, ARIA live regions, respects `prefers-reduced-motion`

No custom tokens or colors introduced; fully themed with existing design system.

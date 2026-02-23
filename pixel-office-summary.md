# Pixel office v2 upgrade

## What changed
- Upgraded `/office` canvas scene from a simple flat room into a richer top‑down pixel office with depth and many props:
  - Multi‑desk bay (desk + chair per agent) with monitor glow per agent status
  - Lounge area (rug, couch, coffee table + laptop)
  - Whiteboard with "scribbles" + markers
  - Bookshelf with books + blinking gadget
  - Server rack with animated LEDs
  - Window with sky + city skyline + twinkling building lights
  - Hanging lamps with night-only warm light cones
  - Floor tiles (8×8) with subtle speckles + wall trim shadow
  - Ambient overlays: scanlines, vignette, light film grain

## Character sprites (distinct per agent)
- New procedural pixel sprites (not just color swaps):
  - **Yuri**: blue hoodie + glasses
  - **Jarvis**: green suit with lapels
  - **Friday**: orange beanie
  - **Glass**: purple coat edge highlight
  - **Epstein**: red cap with brim
- Animations:
  - 4‑frame walk cycle (legs)
  - Idle breathing + blinking
  - Typing animation (arms)
  - Sleep animation for offline (Z’s)

## Effects & UI polish
- Smooth movement (velocity/accel smoothing instead of teleport)
- Busy status emits spark bursts + floating code symbol particles
- Speech bubble has pixel-rounded style + typed text reveal + blinking cursor
- Name labels under agents with status dot + accent underline
- Click-to-inspect: selecting an agent shows an info card (status + current task)
- Responsive legend: desktop full labels, mobile compact

## Day/night cycle
- Palette & window sky changes based on **WIB (UTC+7)** time.

## Sound (optional)
- Subtle procedural typing clicks using WebAudio (noise burst through bandpass)
- Mute toggle button (default OFF to avoid surprise audio)

## Build / deploy
- `npm run build` passes.
- Convex deploy executed with `npx convex deploy --cmd 'npm run build'`.

## Files touched
- `src/app/office/page.tsx` (major upgrade)
- `src/app/providers.tsx` (safe fallback Convex URL for builds; still uses env in real deploy)

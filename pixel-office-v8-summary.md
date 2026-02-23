# Pixel Office v8 – Complete Rebuild (Office Page)

## What changed
Rebuilt `src/app/office/page.tsx` into a 4-room, sprite-sheet, canvas-rendered pixel office with realistic behaviors + audio.

## Implemented features (per spec)
- **4 rooms layout** (internal 480×320, scaled w/ `image-rendering: pixelated`):
  - **Yuri’s private office (top-left):** enclosed walls + doorway to main office, big desk feel (desk + counter extension), bookshelf, plant, chair, coffee mug, dual monitors.
  - **Main office (bottom-left):** 4 desks (Jarvis/Friday/Glass/Epstein) with chairs + mugs.
  - **Kitchen (top-right):** vending, counter, fridge, water cooler + **WIB clock** on wall.
  - **Lounge (bottom-right):** couch, painting, bookshelf, plant.
- **Character animations (realistic):**
  - **Working:** seated at desk facing monitor, typing animation (2-frame) w/ faster cadence when **busy**.
  - **Idle:** casual slow wandering to destinations (kitchen, lounge, peers) and **occasionally reporting to Yuri’s door**.
  - **Walking:** 4-frame walk cycle, directional facing.
  - **Offline:** character hidden; monitors stay off.
- **No walking through furniture:** tile-based **A\* pathfinding** + collision grid from walls/props.
- **Sub-agent spawning visual:** when Convex sees a new running agentRun, agent **spawns at Yuri’s door** with sparkle/flash VFX, then walks to their desk.
- **Sound effects (Web Audio API; no external files):**
  - typing clicks, footsteps, spawn chime, completion ding.
  - default **muted** with 🔇/🔊 toggle.
- **Details:**
  - monitor glow + scrolling “code lines” when active/busy.
  - shadows under characters.
  - name labels + **status dot** (green/amber/gray).
  - click character to open sidebar: name, status, current task.
  - **day/night tint** based on WIB hour.
- **Performance:** requestAnimationFrame loop **capped to ~20fps**.

## Deploy + build
- `npm run build` passes.
- `npx convex deploy --cmd 'npm run build'` deployed to `determined-pig-729`.

## Git
- Commit: `upgrade: pixel office v8 - complete rebuild with all features`
- Pushed to `main`.

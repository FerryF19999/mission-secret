# Pixel office v5 (image-bg approach)

## What changed
- Rebuilt `/office` page to use a **static background image** (`/public/office-bg.jpg`) instead of drawing the office via canvas.
- Added 5 **agent overlays** using the **exact character reference sprites** from `/public/characters-ref.jpg`.
- Overlays are positioned with `%` coordinates to match desk/kitchen/lounge areas.
- Click any agent to open a **clean HTML sidebar** showing status + current task.

## Animation behavior (per latest updates)
- Background stays static.
- Characters **walk slowly** when idle (random destinations around the office).
- When active/busy: walk to their desk.
- When offline: move to couch area and dim.
- Walk cycle uses a **4-frame sheet generated at runtime** from the reference sprite (re-draws the exact sprite with tiny y-offsets) and advances frames only while moving.
- Animation runs via `requestAnimationFrame` but is capped to ~20fps.

## Files
- Rewritten: `src/app/office/page.tsx`
- Added: `public/office-bg.jpg`, `public/characters-ref.jpg`

## Build + deploy
- `npm run build` ✅
- `npx convex deploy --cmd 'npm run build'` ✅ (using provided key)

## Git
- Commit: `rebuild: pixel office v5 - static image background, simple overlays`

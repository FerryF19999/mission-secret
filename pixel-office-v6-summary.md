# Pixel office v6 — real sprite sheets + canvas renderer

## What changed
- Added **real, generated PNG sprite sheets** (no background-image overlay)
  - `scripts/generate-sprites.js` (Node + `canvas`)
  - Outputs:
    - `public/sprites/characters.png` — 5 characters × 4 directions × (4 walk + idle + 2 typing)
    - `public/sprites/office.png` — tiles + furniture blocks (wood/beige/carpet, walls, desks, chairs, shelves, plants, boxes, vending, couch, painting, counter, fridge, water cooler)
- Rebuilt `/office` as a **canvas-rendered pixel scene**:
  - `src/app/office/page.tsx`
  - Renders a tilemap at **internal resolution 384×256** with `imageSmoothingEnabled=false` and CSS scaling (`image-rendering: pixelated`).
  - Draws office tile-by-tile and furniture from the office tileset.
  - Draws characters from the characters sprite sheet with:
    - slow idle wandering (4-frame walk cycle)
    - typing animation when `active/busy` at desk
    - `offline` agents not rendered
  - Click character (hit-test on canvas) → selects agent; sidebar shows status + task.

## How to regenerate sprites
```bash
node scripts/generate-sprites.js
```

## Notes
- Sprite sheets are programmatically generated so the app ships with **actual PNG assets**.
- Office layout approximates the reference: main office (wood), kitchen (beige), lounge (blue carpet) with matching furniture.

# Pixel Office – WebAudio Sound Effects (subtask)

## What changed
Added subtle, programmatically-generated sound effects to `src/app/office/page.tsx` using the Web Audio API (no external audio files).

### Included SFX
- **Typing clicks**: soft noise-burst “clicks” when agents are **active/busy** (pitch/filter randomized, low volume).
- **Footsteps**: tiny filtered taps triggered on walk-cycle frame changes while characters move.
- **Ambient office hum**: very faint sine hum + filtered noise bed (optional but enabled when unmuted).
- **Spawn chime**: gentle sparkle when an agent run transitions to `running`.
- **Task complete ding**: subtle two-tone ding when a run stops being `running`.

## UX / Controls
- **Default muted** (no AudioContext created until user unmutes).
- Corner toggle button on the canvas: **🔇 / 🔊**.
- On unmute, audio resumes via user gesture to satisfy autoplay policies.

## Notes
- All audio is generated via `OscillatorNode` + short noise buffers with envelopes and filters.
- Volumes are intentionally kept low for a cozy ambient feel.
- Build succeeded after changes.

## Commit
- `feat(office): add subtle WebAudio SFX + mute toggle`

# Polytrack Local

A local browser racing game inspired by PolyTrack's low-poly time-trial format.

## Run locally

```bash
cd /home/liuhc/polytrack
python3 -m http.server 5173
```

Open http://localhost:5173 in a browser.

## Controls

- `Enter` or `Space`: start / restart
- `Arrow keys` or `WASD`: drive
- `R`: restart current run
- `F`: toggle fullscreen
- `Esc`: exit fullscreen

## Test hook support

The game exposes:

- `window.render_game_to_text()`
- `window.advanceTime(ms)`

for deterministic Playwright automation.

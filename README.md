# Tanks Amaze

An aerial-view tank capture-the-flag game. Every level is a procedurally
generated maze themed as a different terrain — City, Town, Forest, Desert,
Tundra — full of dead ends and choke points. Steal the enemy flag and haul
it back to your base pad while AI tanks hunt you and try to capture yours.

**Play it:** open `index.html` in any modern browser, or serve the folder:

```sh
python3 -m http.server 8000
# then visit http://localhost:8000
```

No build step, no dependencies — plain HTML/CSS/JS on a canvas.

## How to play

- Capture the **red flag** from the top-right base and return it to your
  **green pad** (bottom-left) to score and advance to the next terrain.
- The enemy team sends a tank after *your* flag — three enemy captures and
  you lose.
- Destroyed tanks respawn at their base; a dropped flag returns home after
  15 seconds if nobody touches it.

### Weapons & damage (strongest → weakest)

| Source | Damage | Notes |
| --- | --- | --- |
| Tank ram | up to 50 | scales with closing speed, hurts both tanks |
| Mine | 45 | explodes when run over; after 1 minute idle it starts a beeping 10-second countdown, then detonates |
| Shell | 25 (+splash) | 1 s reload |
| Machine gun | 4 / round | high rate of fire, slight spread |

Armor repairs itself automatically a few seconds after the last hit. A tank
explodes when its armor reaches zero.

### Controls

| Action | Keyboard | Touch |
| --- | --- | --- |
| Drive / steer | `W A S D` or arrow keys | left-thumb virtual joystick |
| Fire shell | `Space` | **FIRE** button |
| Machine gun | hold `F` (or `Shift`) | hold **MG** button |
| Drop mine | `E` | **MINE** button (max 4 active) |

The page locks out pull-to-refresh, overscroll navigation, pinch zoom and
double-tap zoom so touch steering never reloads or scrolls the page.

## Code layout

```
index.html      page shell, HUD markup, touch controls, overlay screens
css/style.css   HUD/controls styling + mobile gesture lockdown
js/maze.js      maze generation (recursive backtracker + braiding), wall
                rects, BFS pathfinding
js/input.js     keyboard + touch joystick/buttons, gesture prevention
js/entities.js  Tank, Shell, Bullet, Mine, collision & LOS helpers
js/game.js      themes, levels, AI, CTF rules, HUD, rendering, audio
```

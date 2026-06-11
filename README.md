# Tanks Amaze

An aerial-view tank capture-the-flag game. Every level is a procedurally
generated maze across three terrains, each with its own character:

- **City** — tight streets, lots of crumbling buildings, dense barricades
  and barbed wire.
- **Forest** — a river splits the map (bridges + an under-river tunnel),
  boggy mud everywhere, few barricades.
- **Desert** — open, loopy dune mazes, soft sand that slows tracks,
  cracked adobe walls.

Steal the enemy flag and haul it back to your base pad while AI tanks hunt
you and try to capture yours. Three difficulties (Easy / Normal / Hard)
tune enemy numbers, speed, reload time, and how many captures you can
afford to lose.

**▶ Play it now:** <https://nsdesign.github.io/Tanks-Amaze/>

Or run it locally — open `index.html` in any modern browser, or serve the folder:

```sh
python3 -m http.server 8000
# then visit http://localhost:8000
```

No build step, no dependencies — plain HTML/CSS/JS on a canvas.

## How to play

- Capture the **red flag** from the top-right base and return it to your
  **green pad** (bottom-left) to score and advance to the next terrain.
- The enemy team sends a tank after *your* flag — three enemy captures and
  you lose. After every capture the round resets: all tanks (enemies
  included) respawn at their bases and the field is cleared.
- Destroyed tanks respawn at their base; a dropped flag returns home after
  15 seconds if nobody touches it.

### Obstacles & terrain

- **Mud** bogs tanks down to half speed.
- **Barbed wire** drags at your tracks; *dense* wire all but traps a tank —
  bullets and shells fly straight over it.
- **Czech hedgehogs** (steel tank barricades) stop tanks dead, but
  projectiles pass between the beams.
- **Weakened walls** crack and crumble after 1–3 shell hits, opening new
  routes through the maze.
- **Rivers** (Forest) cut the map in half — cross by **bridge**, or take
  the stone **tunnel** underneath; nobody outside can see you in there.

### Special items (drive over the floating crates)

1. **Auto-target** `◎` — the turret locks onto a visible enemy and tracks
   it for 2 seconds at a time, re-acquiring targets for 10 seconds.
2. **Armor** `⛨` — Steel, Composite or Reactive plating takes 70% off
   incoming damage; the 3, 4 or 5 second timer only starts counting from
   the first hit you take.
3. **Air support** `✈` — a plane sweeps the enemy's side of the map with
   bombs, napalm, or a heavy machine-gun strafing run.
4. **Extra mines** `+` — raises your mine capacity by 2 (up to 8).

On mobile the FIRE button shows the reload as a fill rising bottom-to-top
that re-reveals the shell icon, and the mine button shows your mines as
little pips — spent ones stay behind as outlines until they detonate.

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

## Deployment

Every push of the game code triggers the GitHub Actions workflow in
`.github/workflows/deploy-pages.yml`, which publishes the repo root to
GitHub Pages — the live site updates automatically.

## License

[MIT](LICENSE)

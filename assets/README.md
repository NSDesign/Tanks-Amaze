# Custom artwork

Flag artwork lives here, one set per team:

- `allied-flag.svgz` / `allied-flag.svg` — your (green team) flag
- `enemy-flag.svgz` / `enemy-flag.svg` — the enemy (red team) flag

The game prefers the compressed `.svgz` (inflating it in the browser),
falls back to the plain `.svg`, and finally to a built-in vector pennant
if neither exists. Artwork is scaled to flag height from its viewBox and
anchored so a pole-with-round-base composition stands on the ground
point. It is used at the base, on the ground, and carried by tanks.

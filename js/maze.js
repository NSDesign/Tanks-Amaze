/* Maze generation (recursive backtracker) + wall geometry + BFS pathfinding.
   Walls per cell are [top, right, bottom, left]. A small fraction of dead
   ends are "braided" open so each terrain has loops as well as dead ends. */

const Maze = (() => {
  // dx, dy, wall index in cell, wall index in neighbor
  const DIRS = [
    [0, -1, 0, 2],
    [1, 0, 1, 3],
    [0, 1, 2, 0],
    [-1, 0, 3, 1],
  ];

  function generate(cols, rows, braid = 0.18, rng = Math.random) {
    const cells = [];
    for (let x = 0; x < cols; x++) {
      cells[x] = [];
      for (let y = 0; y < rows; y++) {
        cells[x][y] = { x, y, walls: [true, true, true, true], visited: false };
      }
    }

    const stack = [];
    let cur = cells[0][0];
    cur.visited = true;
    let visitedCount = 1;

    while (visitedCount < cols * rows) {
      const options = [];
      for (const d of DIRS) {
        const nx = cur.x + d[0], ny = cur.y + d[1];
        if (nx >= 0 && nx < cols && ny >= 0 && ny < rows && !cells[nx][ny].visited) {
          options.push({ d, cell: cells[nx][ny] });
        }
      }
      if (options.length) {
        const pick = options[(rng() * options.length) | 0];
        cur.walls[pick.d[2]] = false;
        pick.cell.walls[pick.d[3]] = false;
        stack.push(cur);
        cur = pick.cell;
        cur.visited = true;
        visitedCount++;
      } else {
        cur = stack.pop();
      }
    }

    // Braid: knock a wall out of some dead ends so the maze has loops,
    // but keep most dead ends intact.
    for (let x = 0; x < cols; x++) {
      for (let y = 0; y < rows; y++) {
        const c = cells[x][y];
        const wallCount = c.walls.filter(Boolean).length;
        if (wallCount === 3 && rng() < braid) {
          const closed = [];
          for (const d of DIRS) {
            const nx = x + d[0], ny = y + d[1];
            if (nx >= 0 && nx < cols && ny >= 0 && ny < rows && c.walls[d[2]]) {
              closed.push(d);
            }
          }
          if (closed.length) {
            const d = closed[(rng() * closed.length) | 0];
            c.walls[d[2]] = false;
            cells[x + d[0]][y + d[1]].walls[d[3]] = false;
          }
        }
      }
    }
    return cells;
  }

  /* Convert cell walls into axis-aligned rectangles for collision/drawing.
     Each interior wall is emitted once (from the top/left side). */
  function buildWallRects(cells, cellSize, thickness) {
    const cols = cells.length, rows = cells[0].length;
    const t = thickness, h = t / 2;
    const rects = [];
    for (let x = 0; x < cols; x++) {
      for (let y = 0; y < rows; y++) {
        const c = cells[x][y];
        const px = x * cellSize, py = y * cellSize;
        if (c.walls[0]) rects.push({ x: px - h, y: py - h, w: cellSize + t, h: t });
        if (c.walls[3]) rects.push({ x: px - h, y: py - h, w: t, h: cellSize + t });
        if (x === cols - 1 && c.walls[1]) rects.push({ x: px + cellSize - h, y: py - h, w: t, h: cellSize + t });
        if (y === rows - 1 && c.walls[2]) rects.push({ x: px - h, y: py + cellSize - h, w: cellSize + t, h: t });
      }
    }
    return rects;
  }

  /* BFS shortest path between two cells; returns array of {x, y} cell
     coordinates including both endpoints, or null if unreachable. */
  function bfsPath(cells, fromX, fromY, toX, toY) {
    const cols = cells.length, rows = cells[0].length;
    fromX = Math.min(cols - 1, Math.max(0, fromX | 0));
    fromY = Math.min(rows - 1, Math.max(0, fromY | 0));
    toX = Math.min(cols - 1, Math.max(0, toX | 0));
    toY = Math.min(rows - 1, Math.max(0, toY | 0));

    const prev = new Array(cols * rows).fill(-1);
    const idx = (x, y) => y * cols + x;
    const queue = [idx(fromX, fromY)];
    prev[idx(fromX, fromY)] = idx(fromX, fromY);
    let head = 0;

    while (head < queue.length) {
      const cur = queue[head++];
      const cx = cur % cols, cy = (cur / cols) | 0;
      if (cx === toX && cy === toY) break;
      const c = cells[cx][cy];
      for (const d of DIRS) {
        if (c.walls[d[2]]) continue;
        const nx = cx + d[0], ny = cy + d[1];
        if (nx < 0 || nx >= cols || ny < 0 || ny >= rows) continue;
        const ni = idx(nx, ny);
        if (prev[ni] === -1) {
          prev[ni] = cur;
          queue.push(ni);
        }
      }
    }

    const goal = idx(toX, toY);
    if (prev[goal] === -1) return null;
    const path = [];
    let cur = goal;
    while (true) {
      path.push({ x: cur % cols, y: (cur / cols) | 0 });
      if (cur === prev[cur]) break;
      cur = prev[cur];
    }
    path.reverse();
    return path;
  }

  return { generate, buildWallRects, bfsPath, DIRS };
})();

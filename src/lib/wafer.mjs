// Lays apps out as dies on a circular wafer, with the most compatible status at
// the center so the rings read as proportions. Spare dies stay unprobed.

const STATUS_ORDER = { native: 0, prism: 1, broken: 2 };

// Dies at the same distance form a ring. Taking every other die around the ring
// keeps a partly filled ring balanced, where scanning top-down would fill one side.
function balanceRings(cells, center, pitch) {
  const rings = new Map();
  for (const cell of cells) {
    const key = cell.dist.toFixed(2);
    rings.set(key, [...(rings.get(key) ?? []), cell]);
  }
  const angle = (c) => Math.atan2(c.y + pitch / 2 - center, c.x + pitch / 2 - center);
  return [...rings.keys()]
    .sort((a, b) => Number(a) - Number(b))
    .flatMap((key) => {
      const ring = rings.get(key).sort((a, b) => angle(a) - angle(b));
      const bits = Math.ceil(Math.log2(ring.length || 1));
      const reversed = (i) => parseInt(i.toString(2).padStart(bits, '0').split('').reverse().join('') || '0', 2);
      return ring
        .map((cell, i) => ({ cell, rank: bits ? reversed(i) : 0 }))
        .sort((a, b) => a.rank - b.rank)
        .map(({ cell }) => cell);
    });
}

export function waferLayout(apps, { size = 480, spare = 1.18 } = {}) {
  const center = size / 2;
  const radius = center - 6;
  const target = Math.max(Math.ceil(apps.length * spare), 12);

  // Walk down from a coarse grid until enough whole dies fit inside the circle.
  let pitch = radius;
  let cells = [];
  for (let n = 4; n < 200; n += 1) {
    pitch = (radius * 2) / n;
    cells = [];
    for (let row = 0; row < n; row += 1) {
      for (let col = 0; col < n; col += 1) {
        const x = col * pitch + (center - radius);
        const y = row * pitch + (center - radius);
        const far = Math.max(
          Math.hypot(x - center, y - center),
          Math.hypot(x + pitch - center, y - center),
          Math.hypot(x - center, y + pitch - center),
          Math.hypot(x + pitch - center, y + pitch - center),
        );
        if (far <= radius) {
          cells.push({ x, y, dist: Math.hypot(x + pitch / 2 - center, y + pitch / 2 - center) });
        }
      }
    }
    if (cells.length >= target) break;
  }

  const orderedCells = balanceRings(cells, center, pitch);

  const ordered = [...apps].sort(
    (a, b) =>
      STATUS_ORDER[a.status] - STATUS_ORDER[b.status] || a.name.localeCompare(b.name, 'en'),
  );

  const gap = Math.max(1, pitch * 0.09);
  const dies = orderedCells.map((cell, i) => ({
    x: +(cell.x + gap / 2).toFixed(2),
    y: +(cell.y + gap / 2).toFixed(2),
    w: +(pitch - gap).toFixed(2),
    delay: +(cell.dist / radius).toFixed(3),
    app: ordered[i] ?? null,
  }));

  return { size, center, radius, dies };
}

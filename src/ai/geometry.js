export function closestPoint(p, a, b) {
  const dx = b.x - a.x, dy = b.y - a.y;
  const lengthSquared = dx * dx + dy * dy;
  const t = lengthSquared ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / lengthSquared)) : 0;
  return { x: a.x + t * dx, y: a.y + t * dy };
}

export function segmentDistance(a, b, c, d) {
  const cross = (u, v) => u.x * v.y - u.y * v.x;
  const subtract = (u, v) => ({ x: u.x - v.x, y: u.y - v.y });
  const ab = subtract(b, a), cd = subtract(d, c), ac = subtract(c, a);
  const denominator = cross(ab, cd);
  if (Math.abs(denominator) > 1e-10) {
    const t = cross(ac, cd) / denominator, u = cross(ac, ab) / denominator;
    if (t >= 0 && t <= 1 && u >= 0 && u <= 1) return 0;
  }
  const distance = (p, x, y) => {
    const q = closestPoint(p, x, y);
    return Math.hypot(p.x - q.x, p.y - q.y);
  };
  return Math.min(distance(a, c, d), distance(b, c, d), distance(c, a, b), distance(d, a, b));
}

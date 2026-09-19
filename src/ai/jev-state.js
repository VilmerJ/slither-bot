import { closestPoint, segmentDistance } from './geometry.js';

const turns = { forward: 0, slight_left: -20, slight_right: 20, left: -45, right: 45,
  hard_left: -90, hard_right: 90, back_left: -135, back_right: 135, reverse: 180 };
const round = value => Math.round(value * 10) / 10;
const angleDifference = (a, b) => Math.atan2(Math.sin(a - b), Math.cos(a - b));

// Geometry is computed over ALL loaded live opponents; only descriptive examples
// are capped. This is a compact model input, not a replacement for GameState.
export function buildJevDecision(state, { lookahead = 240, allowBoost = true } = {}) {
  const me = state.self, origin = me.head;
  const relative = p => ({ dx: round(p.x - origin.x), dy: round(p.y - origin.y) });
  const otherSnakes = state.snakes.filter(s => !s.isSelf && s.alive);
  const obstacles = [];
  const nearbySnakes = otherSnakes.map(s => {
    const points = [...s.body.filter(p => !p.dying), s.head];
    let closest = s.head, closestDistance = Math.hypot(s.head.x - origin.x, s.head.y - origin.y);
    for (let i = 0; i < points.length; i++) {
      const a = points[i], b = points[i + 1] ?? a;
      const radius = (me.visualRadius ?? 15) + (s.visualRadius ?? 15) + 12;
      obstacles.push({ a, b, radius });
      const p = closestPoint(origin, a, b), distance = Math.hypot(p.x - origin.x, p.y - origin.y);
      if (distance < closestDistance) { closest = p; closestDistance = distance; }
    }
    return { id: s.id, head: relative(s.head), nearestBody: relative(closest),
      distance: round(closestDistance), radius: round(s.visualRadius ?? 15),
      headingDegrees: round(s.heading * 180 / Math.PI), speed: s.speed };
  }).sort((a, b) => a.distance - b.distance);
  const food = state.food.filter(f => !f.eaten);
  const prey = state.prey.filter(p => !p.eaten);
  const candidates = {}, actions = {}, criteria = {};
  const edgeClearance = p => state.arena.bounded
    ? round(state.arena.radius - Math.hypot(p.x - state.arena.center.x, p.y - state.arena.center.y) - (me.visualRadius ?? 15)) : null;
  for (const [name, degrees] of Object.entries(turns)) {
    for (const boost of allowBoost && me.segmentCount > 2 ? [false, true] : [false]) {
      const id = `${name}${boost ? '_boost' : ''}`;
      const heading = me.heading + degrees * Math.PI / 180;
      const distance = lookahead * (boost ? Math.max(1, Math.min(3, me.boostSpeed / me.normalSpeed || 2)) : 1);
      const end = { x: origin.x + Math.cos(heading) * distance, y: origin.y + Math.sin(heading) * distance };
      let clearance = Infinity;
      for (const obstacle of obstacles) clearance = Math.min(clearance, segmentDistance(origin, end, obstacle.a, obstacle.b) - obstacle.radius);
      let foodValue = 0;
      for (const f of food) {
        const dx = f.position.x - origin.x, dy = f.position.y - origin.y, d = Math.hypot(dx, dy);
        if (d < 600) foodValue += Math.max(0, Math.cos(angleDifference(Math.atan2(dy, dx), heading))) ** 8 * f.size / (1 + d / 80);
      }
      candidates[id] = { turnDegrees: degrees, boost, lookahead: round(distance),
        bodyClearance: Number.isFinite(clearance) ? round(clearance) : null,
        edgeClearance: edgeClearance(end), foodValue: round(foodValue) };
      actions[id] = { heading, boost };
      criteria[id] = `Choose candidates.${id}: ${degrees === 0 ? 'continue straight' : `steer ${Math.abs(degrees)} degrees ${degrees < 0 ? 'left' : 'right'}`}${boost ? ', boost and consume length' : ', normal speed'}.`;
    }
  }
  const nearest = items => items.map(p => ({ ...relative(p.position), size: p.size,
    distance: round(Math.hypot(p.position.x - origin.x, p.position.y - origin.y)) })).sort((a, b) => a.distance - b.distance);
  return {
    actions,
    state: {
      game: 'slither.io', coverage: 'Only client-loaded entities are known; distant space is unknown.',
      geometry: 'Units are world coordinates: x right, y down. Left is negative turn. Clearances are approximate static straight-path gaps including both snake radii and 12 units margin. Negative means collision risk. Actual turns take time and opponents move. null bodyClearance means no loaded opponents, NOT globally safe.',
      self: { headingDegrees: round(me.heading * 180 / Math.PI), radius: me.visualRadius, score: me.score,
        segmentCount: me.segmentCount, speed: me.speed, edgeClearance: edgeClearance(origin) },
      center: relative(state.arena.center),
      counts: { snakes: otherSnakes.length, food: food.length, prey: prey.length },
      nearbySnakes: nearbySnakes.slice(0, 8), nearestFood: nearest(food).slice(0, 16), nearestPrey: nearest(prey).slice(0, 4),
      candidates,
    },
    questions: { move: {
      type: 'choice',
      instructions: 'Which candidate action should our snake execute next to survive and grow? Prioritize avoiding enemy bodies and the arena edge, then collecting food. Compare candidates bodyClearance, edgeClearance, foodValue, turnDegrees, and nearbySnakes. Avoid negative clearances and unnecessary sharp turns. Prefer smooth forward progress. Boost consumes length and increases risk; use it only when its escape or food benefit justifies it. These are estimates, not guaranteed safe paths. Choose exactly one candidate, including the least dangerous choice if every path is risky.',
      criteria,
    } },
  };
}

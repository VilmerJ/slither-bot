import { closestPoint, segmentDistance } from './geometry.js';

export const moves = [
  { name: 'forward', turn: 0 },
  { name: 'left', turn: -Math.PI / 6 }, { name: 'right', turn: Math.PI / 6 },
  { name: 'hard_left', turn: -Math.PI / 2 }, { name: 'hard_right', turn: Math.PI / 2 },
];
const angleDifference = (a, b) => Math.atan2(Math.sin(a - b), Math.cos(a - b));
const distanceToSegment = (p, a, b) => {
  const q = closestPoint(p, a, b);
  return Math.hypot(p.x - q.x, p.y - q.y);
};

// Index inflated capsules by their bounding boxes, so a long body crossing the
// local region is included even when both endpoints are far away.
class SpatialIndex {
  cells = new Map();
  constructor(origin, reach) {
    this.minX = Math.floor((origin.x - reach) / 120); this.maxX = Math.floor((origin.x + reach) / 120);
    this.minY = Math.floor((origin.y - reach) / 120); this.maxY = Math.floor((origin.y + reach) / 120);
  }
  keys(a, b, radius = 0) {
    const keys = [];
    for (let x = Math.max(this.minX, Math.floor((Math.min(a.x, b.x) - radius) / 120)); x <= Math.min(this.maxX, Math.floor((Math.max(a.x, b.x) + radius) / 120)); x++) {
      for (let y = Math.max(this.minY, Math.floor((Math.min(a.y, b.y) - radius) / 120)); y <= Math.min(this.maxY, Math.floor((Math.max(a.y, b.y) + radius) / 120)); y++) keys.push(`${x},${y}`);
    }
    return keys;
  }
  add(item, a, b, radius) {
    for (const key of this.keys(a, b, radius)) {
      if (!this.cells.has(key)) this.cells.set(key, []);
      this.cells.get(key).push(item);
    }
  }
  query(a, b) {
    const items = new Set();
    for (const key of this.keys(a, b)) for (const item of this.cells.get(key) ?? []) items.add(item);
    return items;
  }
}

export function createModel(observation, { stepMs = 200, depth = 10, safetyMargin = 8 } = {}) {
  const me = observation.self, origin = me.head;
  // Client: vfr = elapsedMs / 8; travel = speed * vfr / 4.
  const speed = (me.normalSpeed ?? me.speed ?? 5) * 31.25;
  const radius = me.visualRadius ?? 15;
  const scale = Math.max(1, Math.min(6, me.scale ?? 1));
  const turnRate = me.turnRate ?? 0.033 * 125 * (0.13 + 0.87 * ((7 - scale) / 6) ** 2);
  const horizon = stepMs / 1000 * depth, reach = speed * horizon + 150;
  const bodies = new SpatialIndex(origin, reach + 200), foodIndex = new SpatialIndex(origin, reach + 200), heads = [], food = [];
  for (const snake of observation.snakes) {
    if (snake.isSelf || !snake.alive) continue;
    const bodyRadius = radius + (snake.visualRadius ?? 15) + safetyMargin;
    const points = [...snake.body.filter(p => !p.dying), snake.head];
    for (let i = 0; i < points.length; i++) {
      const a = points[i], b = points[i + 1] ?? a;
      if (distanceToSegment(origin, a, b) > reach + bodyRadius) continue;
      bodies.add({ a, b, radius: bodyRadius }, a, b, bodyRadius + 80);
    }
    const velocity = (snake.speed ?? 5) * 31.25;
    if (Math.hypot(snake.head.x - origin.x, snake.head.y - origin.y) <= reach + velocity * horizon + bodyRadius) {
      heads.push({ origin: snake.head, vx: Math.cos(snake.heading) * velocity,
        vy: Math.sin(snake.heading) * velocity, radius: bodyRadius });
    }
  }
  for (const item of observation.food) {
    if (item.eaten || Math.hypot(item.position.x - origin.x, item.position.y - origin.y) > reach) continue;
    const f = { id: food.length, position: item.position, size: item.size ?? 1, radius: radius + 5 + (item.size ?? 1) };
    food.push(f);
    foodIndex.add(f, f.position, f.position, f.radius);
  }
  const goals = [...food].sort((a, b) => Math.hypot(a.position.x - origin.x, a.position.y - origin.y) -
    Math.hypot(b.position.x - origin.x, b.position.y - origin.y)).slice(0, 32);
  const edgeClearance = p => observation.arena.bounded
    ? observation.arena.radius - Math.hypot(p.x - observation.arena.center.x, p.y - observation.arena.center.y) - radius - safetyMargin
    : Infinity;
  const initial = { x: origin.x, y: origin.y, heading: me.heading, time: 0,
    alive: true, eaten: new Set(), food: 0, clearance: 80, turning: 0 };

  function step(state, move) {
    if (!state.alive) return state;
    const next = { ...state, eaten: new Set(state.eaten) };
    const target = state.heading + move.turn;
    const count = Math.ceil(stepMs / 40), dt = stepMs / 1000 / count;
    for (let i = 0; i < count; i++) {
      const before = { x: next.x, y: next.y };
      const turn = Math.max(-turnRate * dt, Math.min(turnRate * dt, angleDifference(target, next.heading)));
      next.heading += turn;
      next.turning += Math.abs(turn);
      next.x += Math.cos(next.heading) * speed * dt;
      next.y += Math.sin(next.heading) * speed * dt;
      next.time += dt;
      let clearance = Math.min(80, edgeClearance(before), edgeClearance(next));
      for (const body of bodies.query(before, next)) clearance = Math.min(clearance, segmentDistance(before, next, body.a, body.b) - body.radius);
      for (const head of heads) {
        // Keep existing bodies fixed; extend each head into a new straight trail.
        // A growing margin acknowledges uncertainty in the future head position.
        const end = { x: head.origin.x + head.vx * next.time, y: head.origin.y + head.vy * next.time };
        clearance = Math.min(clearance, segmentDistance(before, next, head.origin, end) - head.radius - 12 * next.time);
      }
      next.clearance = Math.min(next.clearance, clearance);
      if (clearance <= 0) { next.alive = false; return next; }
      for (const f of foodIndex.query(before, next)) {
        if (!next.eaten.has(f.id) && distanceToSegment(f.position, before, next) <= f.radius) {
          next.eaten.add(f.id);
          next.food += f.size;
        }
      }
    }
    return next;
  }

  function reward(state) {
    if (!state.alive) return 0.05 * Math.min(1, state.time / horizon);
    let attraction = 0;
    for (const f of goals) if (!state.eaten.has(f.id)) {
      attraction = Math.max(attraction, Math.min(1, f.size / 5) * Math.exp(-Math.hypot(state.x - f.position.x, state.y - f.position.y) / 160));
    }
    // Surviving any complete rollout is worth more than dying with food.
    return 0.6 + 0.22 * (1 - Math.exp(-state.food / 20)) + 0.08 * Math.max(0, state.clearance) / 80 +
      0.1 * attraction - 0.03 * Math.min(1, state.turning / (Math.PI * 2));
  }
  return { initial, step, reward, speed, turnRate, horizon };
}

import { closestPoint } from '../ai/geometry.js';

export const featureSchema = 'slither-rl-v1';
export const sectors = 16;
export const featureCount = sectors * 6 + 8;
export const viewRadius = 800;
export const actionTurns = [0, -Math.PI / 6, Math.PI / 6, -Math.PI / 2, Math.PI / 2];
const clamp = (x, min = 0, max = 1) => Math.max(min, Math.min(max, x));
export const snakeLength = snake => Math.max(0, (snake.segmentCount ?? 0) + (snake.growth ?? 0));
export const angleDifference = (a, b) => Math.atan2(Math.sin(a - b), Math.cos(a - b));

export function actionIndex(heading, target) {
  const difference = angleDifference(target, heading);
  let best = 0;
  for (let i = 1; i < actionTurns.length; i++) if (Math.abs(actionTurns[i] - difference) < Math.abs(actionTurns[best] - difference)) best = i;
  return best;
}

// One encoder is shared by training, demonstrations, and live inference.
// Channels: food, enemy body, own body, enemy head, enemy length, closing speed.
export function encodeState(state) {
  const me = state.self, values = new Float32Array(featureCount);
  const headDistance = new Float64Array(sectors).fill(Infinity);
  const relative = p => {
    const dx = p.x - me.head.x, dy = p.y - me.head.y;
    const angle = angleDifference(Math.atan2(dy, dx), me.heading);
    return { dx, dy, distance: Math.hypot(dx, dy), angle,
      sector: (Math.round(angle / (Math.PI * 2) * sectors) + sectors) % sectors };
  };
  for (const snake of state.snakes) {
    if (!snake.alive) continue;
    const points = [...snake.body.filter(p => !p.dying), snake.head];
    const radius = (snake.visualRadius ?? 15) + (me.visualRadius ?? 15);
    const mark = p => {
      const r = relative(p);
      if (r.distance > viewRadius || (snake.isSelf && r.distance < radius * 1.5)) return;
      const channel = snake.isSelf ? 2 : 1;
      const closeness = 1 - clamp((r.distance - radius) / viewRadius);
      const spread = Math.min(4, Math.ceil(Math.asin(Math.min(1, radius / Math.max(1, r.distance))) / (Math.PI * 2) * sectors));
      for (let offset = -spread; offset <= spread; offset++) {
        const index = channel * sectors + (r.sector + offset + sectors) % sectors;
        values[index] = Math.max(values[index], closeness);
      }
    };
    for (let i = 0; i < points.length; i++) {
      const a = points[i], b = points[i + 1] ?? a;
      mark(a);
      mark(closestPoint(me.head, a, b));
    }
    if (!snake.isSelf) {
      const r = relative(snake.head);
      if (r.distance < viewRadius && r.distance < headDistance[r.sector]) {
        headDistance[r.sector] = r.distance;
        values[3 * sectors + r.sector] = 1 - r.distance / viewRadius;
        values[4 * sectors + r.sector] = clamp(Math.log1p(snakeLength(snake)) / Math.log(257));
        const vx = Math.cos(snake.heading) * (snake.speed ?? 5) - Math.cos(me.heading) * (me.speed ?? 5);
        const vy = Math.sin(snake.heading) * (snake.speed ?? 5) - Math.sin(me.heading) * (me.speed ?? 5);
        values[5 * sectors + r.sector] = clamp(-(vx * r.dx + vy * r.dy) / (Math.max(1, r.distance) * 24), -1, 1);
      }
    }
  }
  let nearestFood = null, nearestDistance = Infinity;
  for (const food of state.food) {
    if (food.eaten) continue;
    const r = relative(food.position);
    if (r.distance > viewRadius) continue;
    values[r.sector] += (food.size ?? 1) / 10 * Math.exp(-r.distance / 160);
    if (r.distance < nearestDistance) { nearestDistance = r.distance; nearestFood = r; }
  }
  for (let i = 0; i < sectors; i++) values[i] = Math.tanh(values[i]);
  const center = relative(state.arena.center);
  const scalar = sectors * 6;
  values[scalar] = clamp(Math.log1p(snakeLength(me)) / Math.log(257));
  values[scalar + 1] = clamp((me.speed ?? 5) / 12);
  values[scalar + 2] = clamp((me.turnRate ?? 4) / 8);
  values[scalar + 3] = state.arena.bounded ? clamp((state.arena.radius - center.distance - (me.visualRadius ?? 15)) / viewRadius) : 1;
  values[scalar + 4] = clamp(Math.cos(center.angle) * center.distance / viewRadius, -1, 1);
  values[scalar + 5] = clamp(Math.sin(center.angle) * center.distance / viewRadius, -1, 1);
  values[scalar + 6] = nearestFood ? Math.cos(nearestFood.angle) * Math.min(1, nearestFood.distance / 200) : 0;
  values[scalar + 7] = nearestFood ? Math.sin(nearestFood.angle) * Math.min(1, nearestFood.distance / 200) : 0;
  return Array.from(values);
}

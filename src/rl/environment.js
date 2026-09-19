import { closestPoint, segmentDistance } from '../ai/geometry.js';
import { actionTurns, angleDifference, encodeState, snakeLength, viewRadius } from './features.js';

export function seededRandom(seed) {
  return () => { seed = Math.imul(seed, 1664525) + 1013904223 >>> 0; return seed / 4294967296; };
}
const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const pointDistance = (p, a, b) => distance(p, closestPoint(p, a, b));
export const killBonus = (length, weight = 1) => weight * Math.log2(1 + Math.max(0, length) / 20);

export class SlitherEnvironment {
  constructor({ opponents = 3, foodCount = 220, radius = 1400, maxSteps = 600,
    foodWeight = 0.02, killWeight = 1, deathPenalty = 5, randomizePhysics = true } = {}) {
    for (const [name, value, min, max] of [['opponents', opponents, 0, 12], ['foodCount', foodCount, 0, 2000],
      ['radius', radius, 400, 10000], ['maxSteps', maxSteps, 1, 100000],
      ['foodWeight', foodWeight, 0, 10], ['killWeight', killWeight, 0, 100], ['deathPenalty', deathPenalty, 0, 100]]) {
      if (!Number.isFinite(value) || value < min || value > max) throw new Error(`Invalid environment ${name}`);
    }
    if (![opponents, foodCount, maxSteps].every(Number.isInteger)) throw new Error('Environment counts must be integers');
    this.options = { opponents, foodCount, radius, maxSteps, foodWeight, killWeight, deathPenalty, randomizePhysics };
  }
  position(fraction = 0.9) {
    const angle = this.random() * Math.PI * 2, radius = Math.sqrt(this.random()) * this.options.radius * fraction;
    return { x: Math.cos(angle) * radius, y: Math.sin(angle) * radius };
  }
  updateSize(snake) {
    snake.segmentCount = Math.floor(snake.mass); snake.growth = snake.mass % 1;
    snake.scale = Math.min(6, 1 + (snake.mass - 2) / 106);
    snake.visualRadius = 14.5 * snake.scale;
    snake.normalSpeed = (4.25 + 0.5 * snake.scale) * this.speedFactor;
    snake.speed = snake.normalSpeed;
    snake.turnRate = 4.125 * (0.13 + 0.87 * ((7 - snake.scale) / 6) ** 2) * this.turnFactor;
    snake.score = Math.round(snake.mass * 15);
  }
  spawn(id) {
    let head;
    for (let attempt = 0; attempt < 100; attempt++) {
      head = this.position(0.75);
      if (this.snakes.every(s => !s.alive || distance(s.head, head) > 250)) break;
    }
    const heading = Math.atan2(-head.y, -head.x) + (this.random() - 0.5);
    const snake = { id, isSelf: id === 0, alive: true, head, heading, targetHeading: heading,
      mass: id === 0 ? 12 + this.random() * 20 : 12 + this.random() * 60, body: [], kills: 0 };
    this.updateSize(snake);
    // Public observations use tail-to-neck order. Trail is stored head first.
    snake.trail = Array.from({ length: Math.ceil(snake.mass * 6 / 8) }, (_, i) => ({
      x: head.x - Math.cos(heading) * i * 8, y: head.y - Math.sin(heading) * i * 8 }));
    snake.body = snake.trail.slice(1).reverse();
    return snake;
  }
  addFood(position = this.position(), size = 2 + this.random() * 6) {
    this.food.push({ id: this.nextFoodId++, position, size, eaten: false });
  }
  reset(seed = 1) {
    this.random = seededRandom(seed);
    this.speedFactor = this.options.randomizePhysics ? 0.95 + this.random() * 0.25 : 1;
    this.turnFactor = this.options.randomizePhysics ? 0.9 + this.random() * 0.2 : 1;
    this.snakes = []; this.food = []; this.steps = 0; this.nextFoodId = 1; this.done = false;
    this.totalFood = 0; this.totalKills = 0; this.totalReward = 0;
    for (let i = 0; i <= this.options.opponents; i++) this.snakes.push(this.spawn(i));
    for (let i = 0; i < this.options.foodCount; i++) this.addFood();
    // Some nearby food makes early learning less sparse without giving location hints.
    for (let i = 0; i < 20; i++) {
      const head = this.snakes[0].head, a = this.random() * Math.PI * 2, r = 40 + this.random() * 250;
      this.addFood({ x: head.x + Math.cos(a) * r, y: head.y + Math.sin(a) * r });
    }
    return { observation: encodeState(this.state()), info: this.info() };
  }
  state() {
    const self = this.snakes[0];
    return { schemaVersion: 1, capturedAt: this.steps * 200, status: self.alive ? 'playing' : 'dead',
      self, snakes: this.snakes.filter(s => s.isSelf || (s.alive && (distance(s.head, self.head) < viewRadius || s.body.some(p => distance(p, self.head) < viewRadius)))),
      food: this.food.filter(f => !f.eaten && distance(f.position, self.head) < viewRadius), prey: [],
      arena: { center: { x: 0, y: 0 }, radius: this.options.radius, bounded: true } };
  }
  opponentHeading(snake) {
    let goal = { x: 0, y: 0 }, best = Infinity;
    for (const f of this.food) if (!f.eaten) {
      const d = distance(f.position, snake.head);
      if (d < best) { best = d; goal = f.position; }
    }
    // A mixture of foragers, wanderers, and occasional attempts to cut ahead.
    if (snake.id % 3 === 0 && distance(snake.head, this.snakes[0].head) < 500) {
      const me = this.snakes[0]; goal = { x: me.head.x + Math.cos(me.heading) * 140, y: me.head.y + Math.sin(me.heading) * 140 };
    }
    let angle = Math.atan2(goal.y - snake.head.y, goal.x - snake.head.x);
    if (snake.id % 3 === 2 && this.steps % 10 < 3) angle = snake.heading + (this.random() - 0.5);
    let dx = Math.cos(angle), dy = Math.sin(angle);
    for (const other of this.snakes) if (other !== snake && other.alive) {
      for (let i = 0; i < other.trail.length; i += 3) {
        const p = other.trail[i], d = distance(p, snake.head);
        if (d < 120 && d > 0) { dx += (snake.head.x - p.x) / d * (1 - d / 120) * 2; dy += (snake.head.y - p.y) / d * (1 - d / 120) * 2; }
      }
    }
    const fromCenter = Math.hypot(snake.head.x, snake.head.y);
    if (this.options.radius - fromCenter < 250) { dx -= snake.head.x / fromCenter * 4; dy -= snake.head.y / fromCenter * 4; }
    return Math.atan2(dy, dx);
  }
  move(snake, target, dt) {
    snake.previous = snake.head;
    snake.heading += Math.max(-snake.turnRate * dt, Math.min(snake.turnRate * dt, angleDifference(target, snake.heading)));
    snake.head = { x: snake.head.x + Math.cos(snake.heading) * snake.speed * 31.25 * dt,
      y: snake.head.y + Math.sin(snake.heading) * snake.speed * 31.25 * dt };
    snake.trail.unshift(snake.head);
    let length = 0, keep = 1, targetLength = snake.mass * 6 * snake.scale;
    while (keep < snake.trail.length && length < targetLength) { length += distance(snake.trail[keep - 1], snake.trail[keep]); keep++; }
    snake.trail.length = keep;
    snake.body = snake.trail.slice(1).reverse();
  }
  collisions() {
    const deaths = new Map();
    for (const snake of this.snakes) if (snake.alive) {
      if (Math.hypot(snake.head.x, snake.head.y) + snake.visualRadius >= this.options.radius) { deaths.set(snake.id, null); continue; }
      for (const other of this.snakes) if (other !== snake && other.alive) {
        const radius = snake.visualRadius + other.visualRadius;
        for (let i = 0; i < other.trail.length - 1; i++) {
          const a = other.trail[i], b = other.trail[i + 1];
          if (Math.min(a.x, b.x) - radius > Math.max(snake.previous.x, snake.head.x) ||
            Math.max(a.x, b.x) + radius < Math.min(snake.previous.x, snake.head.x) ||
            Math.min(a.y, b.y) - radius > Math.max(snake.previous.y, snake.head.y) ||
            Math.max(a.y, b.y) + radius < Math.min(snake.previous.y, snake.head.y)) continue;
          if (segmentDistance(snake.previous, snake.head, a, b) <= radius) { deaths.set(snake.id, other.id); break; }
        }
        if (deaths.has(snake.id)) break;
      }
    }
    const kills = [];
    for (const [victimId, killerId] of deaths) {
      const victim = this.snakes[victimId], length = snakeLength(victim);
      victim.alive = false; victim.respawnAt = this.steps + 15;
      if (killerId !== null && !deaths.has(killerId)) {
        this.snakes[killerId].kills++;
        kills.push({ killerId, victimId, victimLength: length });
      }
      const count = Math.min(60, victim.trail.length);
      for (let i = 0; i < count; i++) this.addFood(victim.trail[Math.floor(i * victim.trail.length / count)], length * 15 * 0.7 / count);
    }
    return kills;
  }
  info(extra = {}) {
    return { steps: this.steps, seconds: this.steps * 0.2, food: this.totalFood, kills: this.totalKills,
      length: snakeLength(this.snakes[0]), return: this.totalReward, ...extra };
  }
  step(action) {
    if (this.done) throw new Error('Episode ended; call reset before step');
    if (!Number.isInteger(action) || action < 0 || action >= actionTurns.length) throw new Error('Action must be an integer from 0 to 4');
    const me = this.snakes[0], targets = this.snakes.map(s => s.isSelf ? s.heading + actionTurns[action] : s.alive ? this.opponentHeading(s) : 0);
    let foodCollected = 0;
    const kills = [];
    for (let substep = 0; substep < 5 && me.alive; substep++) {
      for (const snake of this.snakes) if (snake.alive) this.move(snake, targets[snake.id], 0.04);
      kills.push(...this.collisions().filter(kill => kill.killerId === 0));
      for (const snake of this.snakes) if (snake.alive) {
        for (const food of this.food) if (!food.eaten && pointDistance(food.position, snake.previous, snake.head) < snake.visualRadius + 5 + food.size) {
          food.eaten = true;
          snake.mass += food.size / 15;
          if (snake.isSelf) foodCollected += food.size;
        }
        this.updateSize(snake);
      }
    }
    this.steps++;
    this.food = this.food.filter(f => !f.eaten);
    while (this.food.length < this.options.foodCount) this.addFood();
    // Bound old dropped-food accumulation in long games.
    if (this.food.length > 2500) this.food.splice(0, this.food.length - 2500);
    for (let i = 1; i < this.snakes.length; i++) if (!this.snakes[i].alive && this.steps >= this.snakes[i].respawnAt) this.snakes[i] = this.spawn(i);
    const parts = { food: this.options.foodWeight * foodCollected,
      kills: kills.reduce((sum, kill) => sum + killBonus(kill.victimLength, this.options.killWeight), 0),
      death: me.alive ? 0 : -this.options.deathPenalty };
    const reward = parts.food + parts.kills + parts.death;
    this.totalFood += foodCollected; this.totalKills += kills.length; this.totalReward += reward;
    const terminated = !me.alive, truncated = !terminated && this.steps >= this.options.maxSteps;
    this.done = terminated || truncated;
    return { observation: encodeState(this.state()), reward, terminated, truncated, info: this.info({ rewardParts: parts, killEvents: kills }) };
  }
}

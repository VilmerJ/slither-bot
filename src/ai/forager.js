// A small state-using example, not a competitive policy.
export default function createPolicy() {
  return {
    name: 'forager',
    decide(state) {
      const { head, heading } = state.self;
      const center = state.arena.center;
      if (state.arena.bounded && Math.hypot(head.x - center.x, head.y - center.y) > state.arena.radius - 800) {
        return { heading: Math.atan2(center.y - head.y, center.x - head.x) };
      }
      let nearest, distance = Infinity;
      for (const food of state.food) {
        if (food.eaten) continue;
        const d = Math.hypot(food.position.x - head.x, food.position.y - head.y);
        if (d < distance) { nearest = food; distance = d; }
      }
      return { heading: nearest ? Math.atan2(nearest.position.y - head.y, nearest.position.x - head.x) : heading, boost: false };
    },
  };
}

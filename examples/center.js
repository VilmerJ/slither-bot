/** @type {import('../src/types.js').PolicyFactory} */
export default function createPolicy({ random, config }) {
  let heading;
  return {
    name: 'center-example',
    reset() { heading = random() * 2 * Math.PI; },
    decide(state) {
      // Illustrates access to player and arena geometry. Does not avoid snakes.
      const { x, y } = state.self.head;
      const center = state.arena.center;
      const distance = Math.hypot(center.x - x, center.y - y);
      if (distance > (config.centerRadius ?? 1000)) heading = Math.atan2(center.y - y, center.x - x);
      return { heading, boost: false };
    },
  };
}

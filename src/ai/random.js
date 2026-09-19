/** @returns {import('../types.js').Policy} */
export default function createPolicy({ random }) {
  return {
    name: 'random',
    decide() { return { heading: random() * Math.PI * 2, boost: false }; },
  };
}

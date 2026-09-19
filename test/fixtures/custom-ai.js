export default function createPolicy({ config }) {
  let decisions = 0;
  return {
    name: 'test-custom',
    reset() { decisions = 0; },
    async decide(state) { return { heading: state.self.heading + config.offset + decisions++, boost: true }; },
  };
}

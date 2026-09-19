export default function createPolicy() {
  return { decide() { while (true) { /* Simulate a broken synchronous policy. */ } } };
}

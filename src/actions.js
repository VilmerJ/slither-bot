export function validateAction(action) {
  if (!action || !Number.isFinite(action.heading)) throw new Error('AI must return { heading: finite radians, boost?: boolean }.');
  if (action.boost !== undefined && typeof action.boost !== 'boolean') throw new Error('AI boost must be a boolean.');
  const tau = 2 * Math.PI;
  return { heading: ((action.heading % tau) + tau) % tau, boost: action.boost ?? false };
}

export function aimPoint(heading, width, height) {
  const radius = Math.min(width, height) * 0.35;
  return { x: width / 2 + Math.cos(heading) * radius, y: height / 2 + Math.sin(heading) * radius };
}

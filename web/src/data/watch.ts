/**
 * A generation counter the fixture bumps after a write. `useResource` subscribes,
 * so the rail (which reads `getOverview`) refreshes when `/branches` creates or
 * deletes — without each caller threading a reload.
 */

let epoch = 0;
const listeners = new Set<() => void>();

export function subscribeData(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function dataEpoch(): number {
  return epoch;
}

export function invalidateData(): void {
  epoch += 1;
  for (const listener of listeners) listener();
}

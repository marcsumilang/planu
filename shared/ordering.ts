export function calculateMidpoint(prevOrder?: number, nextOrder?: number): number {
  if (prevOrder === undefined && nextOrder === undefined) return 1000;
  if (prevOrder === undefined) return nextOrder! / 2;
  if (nextOrder === undefined) return prevOrder + 1000;
  return (prevOrder + nextOrder) / 2;
}

export function requiresRebalance(prevOrder: number, nextOrder: number): boolean {
  return Math.abs(nextOrder - prevOrder) < 1e-4;
}

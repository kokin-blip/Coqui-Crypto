export function freezeValue<T>(value: T): T {
  if (value === null || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) freezeValue(child);
  return Object.freeze(value);
}

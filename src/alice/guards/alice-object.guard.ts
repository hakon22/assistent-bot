export const isAliceObject = (value: unknown): value is { [key: string]: unknown; } =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

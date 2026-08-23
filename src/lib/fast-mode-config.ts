export function fastModeEnabledFromConfig(
  serviceTier: unknown,
  featureEnabled: unknown,
): boolean {
  return (
    (serviceTier === "fast" || serviceTier === "priority") &&
    featureEnabled !== false
  );
}

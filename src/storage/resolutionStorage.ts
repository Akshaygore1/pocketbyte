import type { LogicalResolution } from "../runtime/runtimeAdapter";

const STORAGE_PREFIX = "handset.game-resolution.";

export function readGameResolution(
  identity: string,
  fallback: LogicalResolution,
): LogicalResolution {
  try {
    const stored = localStorage.getItem(`${STORAGE_PREFIX}${identity}`);
    if (!stored) return fallback;

    const parsed: unknown = JSON.parse(stored);
    return isLogicalResolution(parsed) ? parsed : fallback;
  } catch {
    return fallback;
  }
}

export function writeGameResolution(
  identity: string,
  resolution: LogicalResolution,
): void {
  try {
    localStorage.setItem(
      `${STORAGE_PREFIX}${identity}`,
      JSON.stringify(resolution),
    );
  } catch {
    // A blocked or full storage area should not prevent local play.
  }
}

function isLogicalResolution(value: unknown): value is LogicalResolution {
  if (typeof value !== "object" || value === null) return false;

  const candidate = value as Record<string, unknown>;
  return Number.isInteger(candidate.width)
    && Number.isInteger(candidate.height)
    && Number(candidate.width) > 0
    && Number(candidate.height) > 0;
}

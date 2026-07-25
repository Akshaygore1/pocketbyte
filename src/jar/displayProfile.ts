export interface DisplayResolution {
  width: number;
  height: number;
}

export type DisplayProfileConfidence = "high" | "medium" | "low";

export interface DetectedDisplayProfile {
  resolution: DisplayResolution;
  confidence: DisplayProfileConfidence;
  source: string;
}

export interface PngDisplayHint extends DisplayResolution {
  path: string;
}

export const SUPPORTED_DISPLAY_RESOLUTIONS = [
  { width: 128, height: 160 },
  { width: 176, height: 208 },
  { width: 176, height: 220 },
  { width: 208, height: 208 },
  { width: 240, height: 320 },
  { width: 240, height: 400 },
  { width: 320, height: 240 },
  { width: 320, height: 480 },
  { width: 352, height: 416 },
  { width: 360, height: 640 },
  { width: 480, height: 800 },
] as const satisfies readonly DisplayResolution[];

export const DEFAULT_DISPLAY_RESOLUTION: DisplayResolution = {
  width: 240,
  height: 320,
};

const DISPLAY_SIZE_ATTRIBUTE_NAMES = [
  "nokia-midlet-original-display-size",
  "nokia-midlet-target-display-size",
  "midlet-display-size",
  "midlet-screen-size",
  "screen-size",
] as const;

const TOUCH_ATTRIBUTE_NAMES = [
  "midlet-touch-support",
  "nokia-midlet-on-screen-keypad",
  "nokia-midlet-touch-support",
  "samsung-midlet-touch-support",
] as const;

export function detectDisplayProfile(
  manifest: string,
  sourceFileName?: string,
  pngHints: readonly PngDisplayHint[] = [],
): DetectedDisplayProfile {
  const attributes = readManifestMainAttributes(manifest);

  const manifestProfile = detectManifestSize(attributes);
  if (manifestProfile) return manifestProfile;

  const filenameProfile = detectFilenameSize(sourceFileName);
  if (filenameProfile) return filenameProfile;

  const identifyingText = [
    sourceFileName,
    ...attributes.values(),
  ].filter(Boolean).join(" ");
  const deviceProfile = detectKnownDevice(identifyingText);
  if (deviceProfile) return deviceProfile;

  const artworkProfile = detectArtworkSize(
    pngHints,
    hasTouchSupport(attributes),
  );
  if (artworkProfile) return artworkProfile;

  return {
    resolution: { ...DEFAULT_DISPLAY_RESOLUTION },
    confidence: "low",
    source: "safe default",
  };
}

export function readPngDisplayHint(
  path: string,
  bytes: Uint8Array,
): PngDisplayHint | null {
  if (
    bytes.length < 24
    || bytes[0] !== 0x89
    || bytes[1] !== 0x50
    || bytes[2] !== 0x4e
    || bytes[3] !== 0x47
    || bytes[4] !== 0x0d
    || bytes[5] !== 0x0a
    || bytes[6] !== 0x1a
    || bytes[7] !== 0x0a
    || readPngU32(bytes, 8) !== 13
    || readPngU32(bytes, 12) !== 0x49484452
  ) {
    return null;
  }

  const width = readPngU32(bytes, 16);
  const height = readPngU32(bytes, 20);
  return isSupportedResolution(width, height) ? { path, width, height } : null;
}

function detectManifestSize(
  attributes: ReadonlyMap<string, string>,
): DetectedDisplayProfile | null {
  for (const name of DISPLAY_SIZE_ATTRIBUTE_NAMES) {
    const resolution = parseSupportedResolution(attributes.get(name));
    if (resolution) {
      return {
        resolution,
        confidence: "high",
        source: manifestAttributeLabel(name),
      };
    }
  }

  const pairedAttributes = [
    ["lge-midlet-targetlcd-width", "lge-midlet-targetlcd-height", "LGE target display"],
    ["samsung-midlet-targetlcd-width", "samsung-midlet-targetlcd-height", "Samsung target display"],
  ] as const;
  for (const [widthName, heightName, source] of pairedAttributes) {
    const width = Number(attributes.get(widthName));
    const height = Number(attributes.get(heightName));
    if (isSupportedResolution(width, height)) {
      return { resolution: { width, height }, confidence: "high", source };
    }
  }

  return null;
}

function detectFilenameSize(
  sourceFileName: string | undefined,
): DetectedDisplayProfile | null {
  if (!sourceFileName) return null;
  const matches = sourceFileName.matchAll(
    /(?:^|[^0-9])(\d{3})\s*[x×]\s*(\d{3})(?:[^0-9]|$)/gi,
  );
  for (const match of matches) {
    const width = Number(match[1]);
    const height = Number(match[2]);
    if (isSupportedResolution(width, height)) {
      return {
        resolution: { width, height },
        confidence: "high",
        source: "filename",
      };
    }
  }
  return null;
}

function detectKnownDevice(text: string): DetectedDisplayProfile | null {
  const devices = [
    {
      pattern: /(?:^|[^a-z0-9])(?:nokia[^a-z0-9]*)?n80(?:[^a-z0-9]|$)/i,
      width: 352,
      height: 416,
      source: "Nokia N80",
    },
    {
      pattern: /(?:^|[^a-z0-9])(?:nokia[^a-z0-9]*)?5800(?:[^a-z0-9]|$)/i,
      width: 360,
      height: 640,
      source: "Nokia 5800",
    },
    {
      pattern: /(?:^|[^a-z0-9])(?:samsung[^a-z0-9]*)?(?:s8000|jet)(?:[^a-z0-9]|$)/i,
      width: 480,
      height: 800,
      source: "Samsung S8000",
    },
  ] as const;

  const device = devices.find(({ pattern }) => pattern.test(text));
  return device
    ? {
        resolution: { width: device.width, height: device.height },
        confidence: "high",
        source: device.source,
      }
    : null;
}

function detectArtworkSize(
  pngHints: readonly PngDisplayHint[],
  touchSupported: boolean,
): DetectedDisplayProfile | null {
  // Landscape artwork is deliberately excluded: a horizontal splash image is
  // not evidence that the game's logical screen or output should be rotated.
  const portraitHints = pngHints.filter(({ width, height }) => height >= width);
  if (portraitHints.length === 0) return null;

  const counts = new Map<string, { hint: PngDisplayHint; count: number }>();
  portraitHints.forEach((hint) => {
    const key = `${hint.width}x${hint.height}`;
    const current = counts.get(key);
    counts.set(key, { hint, count: (current?.count ?? 0) + 1 });
  });
  // Touch suites commonly target full-screen handsets, so matching larger
  // artwork is stronger evidence than the number of same-sized assets.
  const best = Array.from(counts.values()).sort((left, right) => {
    const areaDifference = right.hint.width * right.hint.height
      - left.hint.width * left.hint.height;
    return touchSupported
      ? areaDifference || right.count - left.count
      : right.count - left.count || areaDifference;
  })[0].hint;

  return {
    resolution: { width: best.width, height: best.height },
    confidence: "low",
    source: touchSupported
      ? "touch and PNG artwork"
      : "PNG artwork",
  };
}

function hasTouchSupport(attributes: ReadonlyMap<string, string>): boolean {
  return TOUCH_ATTRIBUTE_NAMES.some((name) => {
    const value = attributes.get(name)?.toLowerCase();
    return value !== undefined && !["", "no", "false", "none", "off"].includes(value);
  });
}

function readManifestMainAttributes(manifest: string): Map<string, string> {
  const attributes = new Map<string, string>();
  let currentName: string | null = null;
  for (const line of manifest.replace(/^\uFEFF/, "").split(/\r\n|\n|\r/)) {
    if (line === "") break;
    if (line.startsWith(" ") && currentName) {
      attributes.set(
        currentName,
        `${attributes.get(currentName) ?? ""}${line.slice(1)}`,
      );
      continue;
    }
    const separator = line.indexOf(": ");
    if (separator <= 0) continue;
    currentName = line.slice(0, separator).toLowerCase();
    attributes.set(currentName, line.slice(separator + 2).trim());
  }
  return attributes;
}

function parseSupportedResolution(
  value: string | undefined,
): DisplayResolution | null {
  const match = value?.match(
    /(?:^|[^0-9])(\d{2,4})\s*[x×,]\s*(\d{2,4})(?:[^0-9]|$)/i,
  );
  if (!match) return null;
  const width = Number(match[1]);
  const height = Number(match[2]);
  return isSupportedResolution(width, height) ? { width, height } : null;
}

function isSupportedResolution(width: number, height: number): boolean {
  return Number.isInteger(width) && Number.isInteger(height)
    && SUPPORTED_DISPLAY_RESOLUTIONS.some(
      (resolution) => resolution.width === width && resolution.height === height,
    );
}

function manifestAttributeLabel(name: string): string {
  return name
    .split("-")
    .map((part) =>
      part.length <= 3
        ? part.toUpperCase()
        : `${part[0].toUpperCase()}${part.slice(1)}`,
    )
    .join("-");
}

function readPngU32(bytes: Uint8Array, offset: number): number {
  return (
    (bytes[offset] << 24)
    | (bytes[offset + 1] << 16)
    | (bytes[offset + 2] << 8)
    | bytes[offset + 3]
  ) >>> 0;
}

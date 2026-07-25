import type { DetectedDisplayProfile } from "./displayProfile";

export interface MidletManifestEntry {
  index: number;
  declaration: string;
  name: string;
  iconPath?: string;
  className: string;
}

export interface JarManifestMetadata {
  name?: string;
  vendor?: string;
  version?: string;
  iconPath?: string;
  profile?: string;
  configuration?: string;
  mainClass?: string;
  detectedDisplayProfile?: DetectedDisplayProfile;
  midlets: MidletManifestEntry[];
}

export class ManifestParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ManifestParseError";
  }
}

/**
 * Parse the main section of a JAR manifest. Manifest fields are case
 * insensitive, and a line beginning with one space continues the preceding
 * field as required by the JAR manifest format.
 */
export function parseJarManifest(manifest: string): JarManifestMetadata {
  const fields = new Map<string, { key: string; value: string }>();
  let sectionFields = fields;
  let current: { key: string; value: string } | undefined;
  let inMainSection = true;

  for (const line of manifest.replace(/^\uFEFF/, "").split(/\r\n|\n|\r/)) {
    if (line === "") {
      inMainSection = false;
      sectionFields = new Map();
      current = undefined;
      continue;
    }

    if (line.startsWith(" ")) {
      if (!current) {
        throw new ManifestParseError(
          "The manifest starts with a continuation line.",
        );
      }
      current.value += line.slice(1);
      continue;
    }

    const separator = line.indexOf(":");
    if (separator <= 0 || line.charAt(separator + 1) !== " ") {
      throw new ManifestParseError("The manifest contains a malformed field.");
    }

    const key = line.slice(0, separator);
    if (!/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(key)) {
      throw new ManifestParseError("The manifest contains an invalid field name.");
    }
    const normalizedKey = key.toLowerCase();
    if (sectionFields.has(normalizedKey)) {
      throw new ManifestParseError(`The manifest declares ${key} more than once.`);
    }

    current = { key, value: line.slice(separator + 2) };
    sectionFields.set(normalizedKey, current);
    if (inMainSection) fields.set(normalizedKey, current);
  }

  const midlets = Array.from(fields.values())
    .filter((field) => /^midlet-\d+$/i.test(field.key))
    .map((field) => ({
      field,
      index: parseMidletIndex(field.key),
    }))
    .sort((left, right) => left.index - right.index)
    .map(({ field, index }) =>
      parseMidletDeclaration(field.key, field.value, index),
    );

  const mainClass = getField(fields, "main-class");

  return {
    name: getField(fields, "midlet-name"),
    vendor: getField(fields, "midlet-vendor"),
    version: getField(fields, "midlet-version"),
    iconPath: getField(fields, "midlet-icon"),
    profile: getField(fields, "microedition-profile"),
    configuration: getField(fields, "microedition-configuration"),
    ...(mainClass ? { mainClass } : {}),
    midlets,
  };
}

function parseMidletIndex(declaration: string): number {
  const suffix = declaration.slice(declaration.indexOf("-") + 1);
  const index = Number(suffix);
  if (
    !Number.isSafeInteger(index) ||
    index <= 0 ||
    String(index) !== suffix
  ) {
    throw new ManifestParseError(
      `${declaration} must use a canonical positive MIDlet index.`,
    );
  }
  return index;
}

function getField(
  fields: Map<string, { key: string; value: string }>,
  name: string,
): string | undefined {
  const value = fields.get(name)?.value.trim();
  return value || undefined;
}

function parseMidletDeclaration(
  declaration: string,
  value: string,
  index: number,
): MidletManifestEntry {
  const parts = value.split(",").map((part) => part.trim());
  if (
    parts.length !== 3 ||
    !parts[0] ||
    !parts[2] ||
    !/^[A-Za-z_$][A-Za-z0-9_$]*(?:\.[A-Za-z_$][A-Za-z0-9_$]*)*$/.test(
      parts[2],
    )
  ) {
    throw new ManifestParseError(
      `${declaration} must contain a name, icon, and MIDlet class.`,
    );
  }

  return {
    index,
    declaration,
    name: parts[0],
    ...(parts[1] ? { iconPath: parts[1] } : {}),
    className: parts[2],
  };
}

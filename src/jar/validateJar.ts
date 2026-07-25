import { inflateSync } from "fflate";

import { copyBytes, sha256JarIdentity } from "./identity";
import {
  detectDisplayProfile,
  readPngDisplayHint,
  type PngDisplayHint,
} from "./displayProfile";
import {
  type JarManifestMetadata,
  ManifestParseError,
  parseJarManifest,
} from "./manifest";

export const DEFAULT_JAR_VALIDATION_LIMITS = {
  maxCompressedBytes: 20 * 1024 * 1024,
  maxEntries: 2_048,
  maxDecompressedBytes: 100 * 1024 * 1024,
  maxManifestBytes: 128 * 1024,
} as const;

export interface JarValidationLimits {
  maxCompressedBytes: number;
  maxEntries: number;
  maxDecompressedBytes: number;
  maxManifestBytes: number;
}

export class JarValidationError extends Error {
  constructor(
    readonly code:
      | "file-too-large"
      | "not-zip"
      | "unsupported-zip"
      | "too-many-entries"
      | "too-much-content"
      | "dangerous-path"
      | "duplicate-critical-entry"
      | "missing-manifest"
      | "desktop-java"
      | "no-midlets"
      | "invalid-manifest"
      | "identity-failed",
    message: string,
  ) {
    super(message);
    this.name = "JarValidationError";
  }
}

export interface ValidatedJar {
  bytes: Uint8Array;
  identity: string;
  metadata: JarManifestMetadata;
  archive: {
    entryCount: number;
    decompressedSize: number;
  };
}

interface ZipEntry {
  name: string;
  flags: number;
  compression: number;
  checksum: number;
  compressedSize: number;
  uncompressedSize: number;
  localHeaderOffset: number;
  dataOffset: number;
  dataEnd: number;
  localEnd: number;
}

interface ZipDirectory {
  entries: ZipEntry[];
  totalUncompressed: number;
}

const MANIFEST_PATH = "meta-inf/manifest.mf";
const CRC32_TABLE = Uint32Array.from({ length: 256 }, (_, value) => {
  let checksum = value;
  for (let bit = 0; bit < 8; bit += 1) {
    checksum =
      (checksum >>> 1) ^ (checksum & 1 ? 0xedb88320 : 0);
  }
  return checksum >>> 0;
});

/**
 * Validates the complete archive and reads metadata without evaluating guest
 * classes. Every inflate is bounded by the entry's already-budgeted size.
 */
export async function validateJarBytes(
  source: ArrayBuffer | ArrayBufferView,
  limits: JarValidationLimits = DEFAULT_JAR_VALIDATION_LIMITS,
  sourceFileName?: string,
): Promise<ValidatedJar> {
  const bytes = copyBytes(source);
  if (bytes.byteLength > limits.maxCompressedBytes) {
    throw new JarValidationError(
      "file-too-large",
      `JAR files must be ${formatMegabytes(limits.maxCompressedBytes)} MB or smaller.`,
    );
  }

  const { entries, totalUncompressed } = readZipDirectory(bytes, limits);
  const manifests = entries.filter(
    (entry) => entry.name.toLowerCase() === MANIFEST_PATH,
  );
  if (manifests.length === 0) {
    throw new JarValidationError(
      "missing-manifest",
      "This archive does not contain META-INF/MANIFEST.MF.",
    );
  }
  if (manifests.length > 1) {
    throw new JarValidationError(
      "duplicate-critical-entry",
      "This archive contains multiple manifest entries.",
    );
  }
  if (manifests[0].uncompressedSize > limits.maxManifestBytes) {
    throw new JarValidationError(
      "invalid-manifest",
      "The JAR manifest is too large.",
    );
  }

  let manifestBytes: Uint8Array | undefined;
  const pngHints: PngDisplayHint[] = [];
  for (const entry of entries) {
    const content = readZipEntry(bytes, entry);
    if (entry === manifests[0]) manifestBytes = content;
    if (entry.name.toLowerCase().endsWith(".png")) {
      const hint = readPngDisplayHint(entry.name, content);
      if (hint) pngHints.push(hint);
    }
  }

  let manifestText: string;
  try {
    manifestText = new TextDecoder("utf-8", { fatal: true }).decode(
      manifestBytes,
    );
  } catch {
    throw new JarValidationError(
      "invalid-manifest",
      "The JAR manifest is not valid UTF-8 text.",
    );
  }

  let metadata: JarManifestMetadata;
  try {
    metadata = parseJarManifest(manifestText);
    metadata.detectedDisplayProfile = detectDisplayProfile(
      manifestText,
      sourceFileName,
      pngHints,
    );
  } catch (error) {
    const detail =
      error instanceof ManifestParseError ? error.message : "unknown error";
    throw new JarValidationError(
      "invalid-manifest",
      `Invalid JAR manifest: ${detail}`,
    );
  }

  if (metadata.mainClass) {
    throw new JarValidationError(
      "desktop-java",
      "This is a desktop Java archive, not a Java ME MIDlet suite.",
    );
  }
  if (metadata.midlets.length === 0) {
    throw new JarValidationError(
      "no-midlets",
      "This JAR does not declare a MIDlet application.",
    );
  }

  let identity: string;
  try {
    identity = await sha256JarIdentity(bytes);
  } catch {
    throw new JarValidationError(
      "identity-failed",
      "The JAR was valid, but its local SHA-256 identity could not be calculated.",
    );
  }

  return {
    bytes,
    identity,
    metadata,
    archive: {
      entryCount: entries.length,
      decompressedSize: totalUncompressed,
    },
  };
}

/**
 * Reads one resource after the containing JAR has passed validation. Manifest
 * resource paths may start with a slash even though ZIP entry names do not.
 */
export function readValidatedJarResource(
  source: ArrayBuffer | ArrayBufferView,
  resourcePath: string,
): Uint8Array | null {
  const bytes = copyBytes(source);
  const normalizedPath = resourcePath.replace(/^\/+/, "");
  if (!normalizedPath) return null;

  const directory = readZipDirectory(bytes, DEFAULT_JAR_VALIDATION_LIMITS);
  const entry = directory.entries.find(
    (candidate) => candidate.name === normalizedPath,
  );
  return entry ? readZipEntry(bytes, entry) : null;
}

function readZipDirectory(
  bytes: Uint8Array,
  limits: JarValidationLimits,
): ZipDirectory {
  const eocd = findEndOfCentralDirectory(bytes);
  if (eocd < 0) {
    throw new JarValidationError(
      "not-zip",
      "This file is not a valid ZIP/JAR archive.",
    );
  }

  const disk = readU16(bytes, eocd + 4);
  const directoryDisk = readU16(bytes, eocd + 6);
  const diskEntries = readU16(bytes, eocd + 8);
  const entryCount = readU16(bytes, eocd + 10);
  const directorySize = readU32(bytes, eocd + 12);
  const directoryOffset = readU32(bytes, eocd + 16);

  if (
    disk !== 0 ||
    directoryDisk !== 0 ||
    diskEntries !== entryCount ||
    entryCount === 0xffff ||
    directorySize === 0xffffffff ||
    directoryOffset === 0xffffffff
  ) {
    throw new JarValidationError(
      "unsupported-zip",
      "Multi-part and ZIP64 JAR archives are unsupported.",
    );
  }
  if (entryCount > limits.maxEntries) {
    throw new JarValidationError(
      "too-many-entries",
      "This JAR contains too many files.",
    );
  }
  if (
    directoryOffset > eocd ||
    directorySize > eocd - directoryOffset ||
    directoryOffset + directorySize !== eocd
  ) {
    throw new JarValidationError(
      "not-zip",
      "The ZIP directory is truncated or inconsistent.",
    );
  }

  const entries: ZipEntry[] = [];
  const exactNames = new Set<string>();
  let position = directoryOffset;
  let totalUncompressed = 0;

  for (let index = 0; index < entryCount; index += 1) {
    if (
      position + 46 > eocd ||
      readU32(bytes, position) !== 0x02014b50
    ) {
      throw new JarValidationError(
        "not-zip",
        "The ZIP directory is malformed.",
      );
    }

    const flags = readU16(bytes, position + 8);
    const compression = readU16(bytes, position + 10);
    const checksum = readU32(bytes, position + 16);
    const compressedSize = readU32(bytes, position + 20);
    const uncompressedSize = readU32(bytes, position + 24);
    const nameLength = readU16(bytes, position + 28);
    const extraLength = readU16(bytes, position + 30);
    const commentLength = readU16(bytes, position + 32);
    const startDisk = readU16(bytes, position + 34);
    const localHeaderOffset = readU32(bytes, position + 42);
    const nextPosition =
      position + 46 + nameLength + extraLength + commentLength;

    if (nextPosition > eocd) {
      throw new JarValidationError("not-zip", "A ZIP entry is truncated.");
    }
    if (
      startDisk !== 0 ||
      compressedSize === 0xffffffff ||
      uncompressedSize === 0xffffffff ||
      localHeaderOffset === 0xffffffff
    ) {
      throw new JarValidationError(
        "unsupported-zip",
        "Multi-part and ZIP64 JAR entries are unsupported.",
      );
    }
    if ((flags & 0x0001) !== 0 || (flags & 0x0040) !== 0) {
      throw new JarValidationError(
        "unsupported-zip",
        "Encrypted JAR entries are unsupported.",
      );
    }
    if (compression !== 0 && compression !== 8) {
      throw new JarValidationError(
        "unsupported-zip",
        `ZIP compression method ${compression} is unsupported.`,
      );
    }

    const centralName = bytes.subarray(
      position + 46,
      position + 46 + nameLength,
    );
    const name = decodeName(centralName);
    if (isDangerousPath(name)) {
      throw new JarValidationError(
        "dangerous-path",
        `This JAR contains unsafe archive path ${name}.`,
      );
    }
    if (exactNames.has(name)) {
      throw new JarValidationError(
        name.toLowerCase() === MANIFEST_PATH
          ? "duplicate-critical-entry"
          : "not-zip",
        `This JAR contains duplicate entry ${name}.`,
      );
    }
    exactNames.add(name);

    totalUncompressed += uncompressedSize;
    if (
      !Number.isSafeInteger(totalUncompressed) ||
      totalUncompressed > limits.maxDecompressedBytes
    ) {
      throw new JarValidationError(
        "too-much-content",
        "This JAR expands beyond the safe size limit.",
      );
    }

    if (
      localHeaderOffset > directoryOffset - 30 ||
      readU32(bytes, localHeaderOffset) !== 0x04034b50
    ) {
      throw new JarValidationError(
        "not-zip",
        `The local ZIP header for ${name} is invalid.`,
      );
    }

    const localFlags = readU16(bytes, localHeaderOffset + 6);
    const localCompression = readU16(bytes, localHeaderOffset + 8);
    const localNameLength = readU16(bytes, localHeaderOffset + 26);
    const localExtraLength = readU16(bytes, localHeaderOffset + 28);
    const dataOffset =
      localHeaderOffset + 30 + localNameLength + localExtraLength;
    const dataEnd = dataOffset + compressedSize;
    const localName = bytes.subarray(
      localHeaderOffset + 30,
      localHeaderOffset + 30 + localNameLength,
    );

    if (
      dataOffset > directoryOffset ||
      dataEnd > directoryOffset ||
      localFlags !== flags ||
      localCompression !== compression ||
      !equalBytes(localName, centralName)
    ) {
      throw new JarValidationError(
        "not-zip",
        `The local and central ZIP records for ${name} disagree.`,
      );
    }

    let localEnd = dataEnd;
    if ((flags & 0x0008) !== 0) {
      let descriptorOffset = dataEnd;
      if (readU32(bytes, descriptorOffset) === 0x08074b50) {
        descriptorOffset += 4;
      }
      if (
        readU32(bytes, descriptorOffset) !== checksum ||
        readU32(bytes, descriptorOffset + 4) !== compressedSize ||
        readU32(bytes, descriptorOffset + 8) !== uncompressedSize
      ) {
        throw new JarValidationError(
          "not-zip",
          `The ZIP data descriptor for ${name} is invalid.`,
        );
      }
      localEnd = descriptorOffset + 12;
    } else if (
      readU32(bytes, localHeaderOffset + 14) !== checksum ||
      readU32(bytes, localHeaderOffset + 18) !== compressedSize ||
      readU32(bytes, localHeaderOffset + 22) !== uncompressedSize
    ) {
      throw new JarValidationError(
        "not-zip",
        `The local ZIP sizes for ${name} are inconsistent.`,
      );
    }

    if (localEnd > directoryOffset) {
      throw new JarValidationError(
        "not-zip",
        `The ZIP data for ${name} overlaps archive metadata.`,
      );
    }

    entries.push({
      name,
      flags,
      compression,
      checksum,
      compressedSize,
      uncompressedSize,
      localHeaderOffset,
      dataOffset,
      dataEnd,
      localEnd,
    });
    position = nextPosition;
  }

  if (position !== eocd) {
    throw new JarValidationError(
      "not-zip",
      "The ZIP directory has unexpected trailing data.",
    );
  }

  const entriesByOffset = [...entries].sort(
    (left, right) => left.localHeaderOffset - right.localHeaderOffset,
  );
  for (let index = 1; index < entriesByOffset.length; index += 1) {
    if (
      entriesByOffset[index].localHeaderOffset <
      entriesByOffset[index - 1].localEnd
    ) {
      throw new JarValidationError(
        "not-zip",
        "The JAR contains overlapping ZIP entries.",
      );
    }
  }

  return { entries, totalUncompressed };
}

function readZipEntry(bytes: Uint8Array, entry: ZipEntry): Uint8Array {
  const compressed = bytes.subarray(entry.dataOffset, entry.dataEnd);
  let result: Uint8Array;

  try {
    result =
      entry.compression === 0
        ? compressed
        : inflateSync(compressed, {
            out: new Uint8Array(entry.uncompressedSize + 1),
          });
  } catch {
    throw new JarValidationError(
      "not-zip",
      `The ZIP entry ${entry.name} cannot be decompressed.`,
    );
  }

  if (result.length > entry.uncompressedSize) {
    throw new JarValidationError(
      "too-much-content",
      `The ZIP entry ${entry.name} expands beyond its declared size.`,
    );
  }
  if (
    result.length !== entry.uncompressedSize ||
    crc32(result) !== entry.checksum
  ) {
    throw new JarValidationError(
      "not-zip",
      `The ZIP entry ${entry.name} has an invalid size or checksum.`,
    );
  }

  return result;
}

function findEndOfCentralDirectory(bytes: Uint8Array): number {
  const start = Math.max(0, bytes.length - 65_557);
  for (let position = bytes.length - 22; position >= start; position -= 1) {
    if (
      readU32(bytes, position) === 0x06054b50 &&
      position + 22 + readU16(bytes, position + 20) === bytes.length
    ) {
      return position;
    }
  }
  return -1;
}

function decodeName(bytes: Uint8Array): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new JarValidationError(
      "not-zip",
      "The ZIP directory contains an invalid filename.",
    );
  }
}

function isDangerousPath(name: string): boolean {
  return (
    !name ||
    name.includes("\0") ||
    name.includes("\\") ||
    name.startsWith("/") ||
    /^[A-Za-z]:/.test(name) ||
    name.split("/").some((part) => part === "." || part === "..")
  );
}

function equalBytes(left: Uint8Array, right: Uint8Array): boolean {
  return (
    left.length === right.length &&
    left.every((byte, index) => byte === right[index])
  );
}

function crc32(bytes: Uint8Array): number {
  let checksum = 0xffffffff;
  for (const byte of bytes) {
    checksum = CRC32_TABLE[(checksum ^ byte) & 0xff] ^ (checksum >>> 8);
  }
  return (checksum ^ 0xffffffff) >>> 0;
}

function readU16(bytes: Uint8Array, offset: number): number {
  if (offset < 0 || offset + 2 > bytes.length) {
    throw new JarValidationError("not-zip", "The ZIP archive is truncated.");
  }
  return bytes[offset] | (bytes[offset + 1] << 8);
}

function readU32(bytes: Uint8Array, offset: number): number {
  if (offset < 0 || offset + 4 > bytes.length) {
    throw new JarValidationError("not-zip", "The ZIP archive is truncated.");
  }
  return (
    (bytes[offset] |
      (bytes[offset + 1] << 8) |
      (bytes[offset + 2] << 16) |
      (bytes[offset + 3] << 24)) >>>
    0
  );
}

function formatMegabytes(bytes: number): string {
  return String(bytes / (1024 * 1024));
}

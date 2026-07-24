import { strToU8, zipSync } from "fflate";
import { describe, expect, it } from "vitest";

import { parseJarManifest } from "./manifest";
import {
  DEFAULT_JAR_VALIDATION_LIMITS,
  JarValidationError,
  type JarValidationLimits,
  validateJarBytes,
} from "./validateJar";

const manifest = [
  "MIDlet-Name: Tiny Fixture",
  "MIDlet-Vendor: Test Studio",
  "MIDlet-Version: 1.0",
  "MIDlet-Icon: /icon.png",
  "MicroEdition-Profile: MIDP-2.0",
  "MicroEdition-Configuration: CLDC-1.1",
  "MIDlet-1: Tiny Fixture, /icon.png, fixtures.TinyMidlet",
  "",
].join("\r\n");

function jar(entries: Record<string, string | Uint8Array>): Uint8Array {
  return zipSync(
    Object.fromEntries(
      Object.entries(entries).map(([name, contents]) => [
        name,
        typeof contents === "string" ? new Uint8Array(strToU8(contents)) : contents,
      ]),
    ),
  );
}

function validJar(): Uint8Array {
  return jar({
    "META-INF/MANIFEST.MF": manifest,
    "fixtures/TinyMidlet.class": new Uint8Array([0xca, 0xfe, 0xba, 0xbe]),
  });
}

async function expectRejection(
  source: Uint8Array,
  code: JarValidationError["code"],
  limits: JarValidationLimits = DEFAULT_JAR_VALIDATION_LIMITS,
): Promise<void> {
  await expect(validateJarBytes(source, limits)).rejects.toMatchObject({ code });
}

describe("parseJarManifest", () => {
  it("unfolds continuation lines and exposes all display metadata", () => {
    expect(
      parseJarManifest([
        "MIDlet-Name: Long Fixture",
        "MIDlet-Vendor: Test Studio",
        "MIDlet-Version: 1.0",
        "MIDlet-Icon: /icon.png",
        "MicroEdition-Profile: MIDP-2.0",
        "MicroEdition-Configuration: CLDC-1.1",
        "MIDlet-1: First, /one.png, fixtures.",
        " FirstMidlet",
        "MIDlet-2: Second, , fixtures.SecondMidlet",
        "",
      ].join("\r\n"),
    )).toEqual({
      name: "Long Fixture",
      vendor: "Test Studio",
      version: "1.0",
      iconPath: "/icon.png",
      profile: "MIDP-2.0",
      configuration: "CLDC-1.1",
      midlets: [
        {
          index: 1,
          declaration: "MIDlet-1",
          name: "First",
          iconPath: "/one.png",
          className: "fixtures.FirstMidlet",
        },
        {
          index: 2,
          declaration: "MIDlet-2",
          name: "Second",
          className: "fixtures.SecondMidlet",
        },
      ],
    });
  });
});

describe("validateJar", () => {
  it("validates a Java ME JAR without extracting its guest classes", async () => {
    const source = validJar();
    const result = await validateJarBytes(source);
    expect(result).toMatchObject({
      bytes: source,
      metadata: {
        name: "Tiny Fixture",
        vendor: "Test Studio",
        version: "1.0",
        iconPath: "/icon.png",
        profile: "MIDP-2.0",
        configuration: "CLDC-1.1",
        midlets: [
          {
            index: 1,
            declaration: "MIDlet-1",
            name: "Tiny Fixture",
            iconPath: "/icon.png",
            className: "fixtures.TinyMidlet",
          },
        ],
      },
    });
    expect(result.identity).toMatch(/^[a-f0-9]{64}$/);
  });

  it("rejects non-ZIP bytes, oversized inputs, and malformed archives", async () => {
    await expectRejection(strToU8("not a zip"), "not-zip");
    await expectRejection(validJar(), "file-too-large", {
      ...DEFAULT_JAR_VALIDATION_LIMITS,
      maxCompressedBytes: 1,
    });
    const truncated = validJar().slice(0, -8);
    await expectRejection(truncated, "not-zip");
  });

  it("rejects missing manifests, desktop archives, and suites without MIDlets", async () => {
    await expectRejection(jar({ "a.class": "x" }), "missing-manifest");
    await expectRejection(
      jar({ "META-INF/MANIFEST.MF": "Main-Class: app.Main\r\n\r\n" }),
      "desktop-java",
    );
    await expectRejection(
      jar({ "META-INF/MANIFEST.MF": "MIDlet-Name: Empty\r\n\r\n" }),
      "no-midlets",
    );
  });

  it("rejects invalid manifest declarations and continuation lines", async () => {
    await expectRejection(
      jar({ "META-INF/MANIFEST.MF": " continuation\r\nMIDlet-1: A, , a.A\r\n\r\n" }),
      "invalid-manifest",
    );
    await expectRejection(
      jar({ "META-INF/MANIFEST.MF": "MIDlet-1: Missing class, /icon.png\r\n\r\n" }),
      "invalid-manifest",
    );
  });

  it("enforces entry-count and decompressed-content budgets before extracting", async () => {
    await expectRejection(validJar(), "too-many-entries", {
      ...DEFAULT_JAR_VALIDATION_LIMITS,
      maxEntries: 1,
    });
    await expectRejection(validJar(), "too-much-content", {
      ...DEFAULT_JAR_VALIDATION_LIMITS,
      maxDecompressedBytes: 10,
    });
  });

  it("rejects unsafe archive paths", async () => {
    for (const path of ["../escape.class", "/absolute.class", "C:/drive.class", "bad\\path.class"]) {
      await expectRejection(
        jar({ "META-INF/MANIFEST.MF": manifest, [path]: "x" }),
        "dangerous-path",
      );
    }
  });

  it("rejects duplicate critical manifest entries", async () => {
    const source = makeDuplicateManifestJar();
    await expectRejection(source, "duplicate-critical-entry");
  });
});

/** Builds a tiny ZIP with two central-directory manifest records. */
function makeDuplicateManifestJar(): Uint8Array {
  const first = validJar();
  const eocd = findSignature(first, 0x06054b50);
  const directoryOffset = u32(first, eocd + 16);
  const directorySize = u32(first, eocd + 12);
  const firstEntryLength = 46 + u16(first, directoryOffset + 28) + u16(first, directoryOffset + 30) + u16(first, directoryOffset + 32);
  const duplicate = first.slice(directoryOffset, directoryOffset + firstEntryLength);
  const result = new Uint8Array(first.length + duplicate.length);
  result.set(first.slice(0, directoryOffset), 0);
  result.set(duplicate, directoryOffset);
  result.set(first.slice(directoryOffset, eocd), directoryOffset + duplicate.length);
  const newEocd = eocd + duplicate.length;
  result.set(first.slice(eocd), newEocd);
  putU16(result, newEocd + 8, u16(first, eocd + 8) + 1);
  putU16(result, newEocd + 10, u16(first, eocd + 10) + 1);
  putU32(result, newEocd + 12, directorySize + duplicate.length);
  return result;
}

function findSignature(bytes: Uint8Array, signature: number): number {
  for (let index = bytes.length - 4; index >= 0; index -= 1) if (u32(bytes, index) === signature) return index;
  throw new Error("fixture did not contain requested ZIP record");
}

function u16(bytes: Uint8Array, offset: number): number {
  return bytes[offset]! | (bytes[offset + 1]! << 8);
}

function u32(bytes: Uint8Array, offset: number): number {
  return (bytes[offset]! | (bytes[offset + 1]! << 8) | (bytes[offset + 2]! << 16) | (bytes[offset + 3]! << 24)) >>> 0;
}

function putU16(bytes: Uint8Array, offset: number, value: number): void {
  bytes[offset] = value & 0xff;
  bytes[offset + 1] = value >>> 8;
}

function putU32(bytes: Uint8Array, offset: number, value: number): void {
  bytes[offset] = value & 0xff;
  bytes[offset + 1] = (value >>> 8) & 0xff;
  bytes[offset + 2] = (value >>> 16) & 0xff;
  bytes[offset + 3] = (value >>> 24) & 0xff;
}

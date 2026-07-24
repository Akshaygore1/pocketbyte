// @vitest-environment node

import { deflateSync } from "fflate";
import { describe, expect, it, vi } from "vitest";

import {
  MAX_DECOMPRESSED_BYTES,
  MAX_JAR_BYTES,
  MAX_JAR_ENTRIES,
  validateJar,
} from "./validateJar";

const encoder = new TextEncoder();

interface ZipEntry {
  name: string;
  content: string | Uint8Array;
  compression?: "deflate" | "store";
  declaredUncompressedSize?: number;
}

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;

  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }

  return (crc ^ 0xffffffff) >>> 0;
}

function writeU16(target: Uint8Array, offset: number, value: number): void {
  new DataView(target.buffer).setUint16(offset, value, true);
}

function writeU32(target: Uint8Array, offset: number, value: number): void {
  new DataView(target.buffer).setUint32(offset, value, true);
}

function concat(chunks: Uint8Array[]): Uint8Array {
  const result = new Uint8Array(
    chunks.reduce((length, chunk) => length + chunk.length, 0),
  );
  let offset = 0;

  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }

  return result;
}

function zip(entries: ZipEntry[]): Uint8Array {
  const localChunks: Uint8Array[] = [];
  const centralChunks: Uint8Array[] = [];
  let localOffset = 0;

  for (const entry of entries) {
    const name = encoder.encode(entry.name);
    const content =
      typeof entry.content === "string"
        ? encoder.encode(entry.content)
        : entry.content;
    const method = entry.compression === "deflate" ? 8 : 0;
    const compressed = method === 8 ? deflateSync(content) : content;
    const checksum = crc32(content);
    const declaredSize = entry.declaredUncompressedSize ?? content.length;

    const local = new Uint8Array(30 + name.length + compressed.length);
    writeU32(local, 0, 0x04034b50);
    writeU16(local, 4, 20);
    writeU16(local, 6, 0x0800);
    writeU16(local, 8, method);
    writeU32(local, 14, checksum);
    writeU32(local, 18, compressed.length);
    writeU32(local, 22, declaredSize);
    writeU16(local, 26, name.length);
    local.set(name, 30);
    local.set(compressed, 30 + name.length);
    localChunks.push(local);

    const central = new Uint8Array(46 + name.length);
    writeU32(central, 0, 0x02014b50);
    writeU16(central, 4, 20);
    writeU16(central, 6, 20);
    writeU16(central, 8, 0x0800);
    writeU16(central, 10, method);
    writeU32(central, 16, checksum);
    writeU32(central, 20, compressed.length);
    writeU32(central, 24, declaredSize);
    writeU16(central, 28, name.length);
    writeU32(central, 42, localOffset);
    central.set(name, 46);
    centralChunks.push(central);

    localOffset += local.length;
  }

  const central = concat(centralChunks);
  const eocd = new Uint8Array(22);
  writeU32(eocd, 0, 0x06054b50);
  writeU16(eocd, 8, entries.length);
  writeU16(eocd, 10, entries.length);
  writeU32(eocd, 12, central.length);
  writeU32(eocd, 16, localOffset);

  return concat([...localChunks, central, eocd]);
}

function validManifest(overrides = ""): string {
  return [
    "Manifest-Version: 1.0",
    "MIDlet-Name: Tiny Suite",
    "MIDlet-Vendor: Fixture Authors",
    "MIDlet-Version: 1.2.3",
    "MIDlet-Icon: /suite.png",
    "MicroEdition-Profile: MIDP-2.0",
    "MicroEdition-Configuration: CLDC-1.1",
    "MIDlet-1: Tiny Game, /tiny.png, example.TinyMidlet",
    overrides,
    "",
  ].join("\r\n");
}

function validJar(manifest = validManifest()): Uint8Array {
  return zip([
    { name: "META-INF/MANIFEST.MF", content: manifest },
    {
      name: "example/TinyMidlet.class",
      content: new Uint8Array([0xca, 0xfe, 0xba, 0xbe]),
      compression: "deflate",
    },
  ]);
}

function asFile(bytes: Uint8Array, name = "tiny.jar"): File {
  return new File([new Uint8Array(bytes).buffer], name, {
    type: "application/java-archive",
  });
}

function findSignature(bytes: Uint8Array, signature: number): number {
  for (let offset = bytes.length - 4; offset >= 0; offset -= 1) {
    if (new DataView(bytes.buffer).getUint32(offset, true) === signature) {
      return offset;
    }
  }
  throw new Error("Synthetic ZIP fixture does not contain the requested record");
}

function findEntryRecords(
  bytes: Uint8Array,
  requestedName: string,
): { central: number; local: number; data: number } {
  const view = new DataView(bytes.buffer);
  const eocd = findSignature(bytes, 0x06054b50);
  const entryCount = view.getUint16(eocd + 10, true);
  let central = view.getUint32(eocd + 16, true);

  for (let index = 0; index < entryCount; index += 1) {
    const nameLength = view.getUint16(central + 28, true);
    const extraLength = view.getUint16(central + 30, true);
    const commentLength = view.getUint16(central + 32, true);
    const name = new TextDecoder().decode(
      bytes.subarray(central + 46, central + 46 + nameLength),
    );
    const local = view.getUint32(central + 42, true);
    const localNameLength = view.getUint16(local + 26, true);
    const localExtraLength = view.getUint16(local + 28, true);

    if (name === requestedName) {
      return {
        central,
        local,
        data: local + 30 + localNameLength + localExtraLength,
      };
    }
    central += 46 + nameLength + extraLength + commentLength;
  }

  throw new Error(`Synthetic ZIP fixture does not contain ${requestedName}`);
}

describe("validateJar", () => {
  it("returns reviewed Java ME metadata and a SHA-256 identity for a valid local JAR", async () => {
    const result = await validateJar(asFile(validJar()));

    expect(result).toEqual({
      ok: true,
      sha256:
        "ebe876dcbc41da048fce2e2b0c6b929cd180cf83bb92ea1d0ae72432e648d3cd",
      metadata: {
        suiteName: "Tiny Suite",
        vendor: "Fixture Authors",
        version: "1.2.3",
        icon: "/suite.png",
        profile: "MIDP-2.0",
        configuration: "CLDC-1.1",
        midlets: [
          {
            index: 1,
            name: "Tiny Game",
            icon: "/tiny.png",
            className: "example.TinyMidlet",
          },
        ],
      },
      archive: {
        entryCount: 2,
        decompressedSize: 256,
      },
    });
  });

  it("accepts already-local byte buffers through the same public boundary", async () => {
    await expect(validateJar(validJar())).resolves.toMatchObject({
      ok: true,
      sha256:
        "ebe876dcbc41da048fce2e2b0c6b929cd180cf83bb92ea1d0ae72432e648d3cd",
    });
  });

  it("rejects the wrong extension before reading local file bytes", async () => {
    const arrayBuffer = vi.fn<() => Promise<ArrayBuffer>>();
    const file = {
      name: "tiny.zip",
      size: 10,
      arrayBuffer,
    } as unknown as File;

    await expect(validateJar(file)).resolves.toMatchObject({
      ok: false,
      error: { code: "wrong-extension" },
    });
    expect(arrayBuffer).not.toHaveBeenCalled();
  });

  it("enforces the 20 MB file budget before reading local file bytes", async () => {
    const arrayBuffer = vi.fn<() => Promise<ArrayBuffer>>();
    const file = {
      name: "too-large.jar",
      size: MAX_JAR_BYTES + 1,
      arrayBuffer,
    } as unknown as File;

    await expect(validateJar(file)).resolves.toMatchObject({
      ok: false,
      error: { code: "file-too-large" },
    });
    expect(arrayBuffer).not.toHaveBeenCalled();
  });

  it("distinguishes a local file-read failure from a malformed archive", async () => {
    const file = {
      name: "unreadable.jar",
      size: 10,
      arrayBuffer: vi.fn().mockRejectedValue(new Error("permission denied")),
    } as unknown as File;

    await expect(validateJar(file)).resolves.toMatchObject({
      ok: false,
      error: {
        code: "file-read-failed",
        message: expect.stringContaining("could not be read"),
      },
    });
  });

  it.each([
    ["non-ZIP bytes", encoder.encode("not a zip"), "not-zip"],
    ["a missing manifest", zip([{ name: "game.class", content: "x" }]), "missing-manifest"],
    [
      "a desktop Java archive",
      zip([
        {
          name: "META-INF/MANIFEST.MF",
          content: "Manifest-Version: 1.0\r\nMain-Class: desktop.Main\r\n\r\n",
        },
      ]),
      "desktop-java",
    ],
    [
      "a suite without MIDlet declarations",
      zip([
        {
          name: "META-INF/MANIFEST.MF",
          content: "Manifest-Version: 1.0\r\nMIDlet-Name: Empty\r\n\r\n",
        },
      ]),
      "no-midlets",
    ],
  ])("rejects %s", async (_label, bytes, code) => {
    await expect(validateJar(asFile(bytes as Uint8Array))).resolves.toMatchObject({
      ok: false,
      error: { code },
    });
  });

  it.each([
    "../escape.class",
    "/absolute.class",
    "C:/drive.class",
    "unsafe\\path.class",
  ])("rejects dangerous archive path %s", async (path) => {
    const bytes = zip([
      { name: "META-INF/MANIFEST.MF", content: validManifest() },
      { name: path, content: "x" },
    ]);

    await expect(validateJar(asFile(bytes))).resolves.toMatchObject({
      ok: false,
      error: { code: "dangerous-path" },
    });
  });

  it("rejects duplicate critical entries including case variants", async () => {
    const bytes = zip([
      { name: "META-INF/MANIFEST.MF", content: validManifest() },
      { name: "meta-inf/manifest.mf", content: validManifest() },
    ]);

    await expect(validateJar(asFile(bytes))).resolves.toMatchObject({
      ok: false,
      error: { code: "duplicate-critical-entry" },
    });
  });

  it("enforces the production entry-count budget", async () => {
    const entries: ZipEntry[] = Array.from(
      { length: MAX_JAR_ENTRIES + 1 },
      (_, index) => ({ name: `entries/${index}.class`, content: "" }),
    );

    await expect(validateJar(asFile(zip(entries)))).resolves.toMatchObject({
      ok: false,
      error: { code: "too-many-entries" },
    });
  });

  it("enforces the production decompressed-size budget from ZIP metadata", async () => {
    const bytes = zip([
      {
        name: "META-INF/MANIFEST.MF",
        content: validManifest(),
        declaredUncompressedSize: MAX_DECOMPRESSED_BYTES + 1,
      },
    ]);

    await expect(validateJar(asFile(bytes))).resolves.toMatchObject({
      ok: false,
      error: { code: "too-much-content" },
    });
  });

  it("enforces the manifest-specific parsing budget", async () => {
    await expect(
      validateJar(asFile(validJar()), {
        maxCompressedBytes: MAX_JAR_BYTES,
        maxEntries: MAX_JAR_ENTRIES,
        maxDecompressedBytes: MAX_DECOMPRESSED_BYTES,
        maxManifestBytes: 8,
      }),
    ).resolves.toMatchObject({
      ok: false,
      error: { code: "invalid-manifest" },
    });
  });

  it("unfolds continuation lines and returns multiple MIDlet declarations", async () => {
    const manifest = [
      "Manifest-Version: 1.0",
      "MIDlet-Name: Long ",
      " Suite",
      "MIDlet-1: First, /one.png, example.",
      " FirstMidlet",
      "MIDlet-2: Second, , example.SecondMidlet",
      "",
    ].join("\r\n");

    await expect(validateJar(asFile(validJar(manifest)))).resolves.toMatchObject({
      ok: true,
      metadata: {
        suiteName: "Long Suite",
        midlets: [
          {
            index: 1,
            name: "First",
            icon: "/one.png",
            className: "example.FirstMidlet",
          },
          {
            index: 2,
            name: "Second",
            className: "example.SecondMidlet",
          },
        ],
      },
    });
  });

  it.each([
    " orphaned continuation\r\nMIDlet-1: Game, , example.Game\r\n\r\n",
    "Manifest-Version: 1.0\r\n\tbad continuation\r\nMIDlet-1: Game, , example.Game\r\n\r\n",
    "Manifest-Version: 1.0\r\nMIDlet-1: Missing class, /icon.png\r\n\r\n",
    "Manifest-Version: 1.0\r\nMIDlet-1: Game, , \r\n\r\n",
    "Manifest-Version: 1.0\r\nMIDlet-0: Game, , example.Game\r\n\r\n",
    "Manifest-Version: 1.0\r\nMIDlet-01: Game, , example.Game\r\n\r\n",
    "Manifest-Version: 1.0\r\nMIDlet-999999999999999999999: Game, , example.Game\r\n\r\n",
  ])("rejects malformed manifest declarations safely", async (manifest) => {
    await expect(validateJar(asFile(validJar(manifest)))).resolves.toMatchObject({
      ok: false,
      error: { code: "invalid-manifest" },
    });
  });

  it("rejects desktop entry points even when a MIDlet is also declared", async () => {
    const manifest = [
      validManifest().trimEnd(),
      "Main-Class: desktop.Main",
      "",
    ].join("\r\n");

    await expect(validateJar(asFile(validJar(manifest)))).resolves.toMatchObject({
      ok: false,
      error: { code: "desktop-java" },
    });
  });

  it("does not call a network boundary while validating local bytes", async () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);

    try {
      await expect(validateJar(asFile(validJar()))).resolves.toMatchObject({
        ok: true,
      });
      expect(fetch).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("distinguishes a SHA-256 failure from a malformed archive", async () => {
    vi.spyOn(globalThis.crypto.subtle, "digest").mockRejectedValueOnce(
      new Error("crypto unavailable"),
    );

    await expect(validateJar(validJar())).resolves.toMatchObject({
      ok: false,
      error: {
        code: "identity-failed",
        message: expect.stringContaining("SHA-256"),
      },
    });
  });

  it("rejects truncated and internally inconsistent ZIP structures", async () => {
    const truncated = validJar().slice(0, -8);
    const mismatchedLocalName = validJar();
    const classRecord = findEntryRecords(
      mismatchedLocalName,
      "example/TinyMidlet.class",
    );
    mismatchedLocalName[classRecord.local + 30] = "X".charCodeAt(0);

    for (const bytes of [truncated, mismatchedLocalName]) {
      await expect(validateJar(asFile(bytes))).resolves.toMatchObject({
        ok: false,
        error: { code: "not-zip" },
      });
    }
  });

  it("rejects unsupported or encrypted compression before reading guest content", async () => {
    const unsupported = validJar();
    const unsupportedClass = findEntryRecords(
      unsupported,
      "example/TinyMidlet.class",
    );
    writeU16(unsupported, unsupportedClass.central + 10, 99);
    writeU16(unsupported, unsupportedClass.local + 8, 99);

    const encrypted = validJar();
    const encryptedClass = findEntryRecords(
      encrypted,
      "example/TinyMidlet.class",
    );
    writeU16(encrypted, encryptedClass.central + 8, 0x0801);
    writeU16(encrypted, encryptedClass.local + 6, 0x0801);

    for (const bytes of [unsupported, encrypted]) {
      await expect(validateJar(asFile(bytes))).resolves.toMatchObject({
        ok: false,
        error: { code: "unsupported-zip" },
      });
    }
  });

  it("rejects a corrupt checksum in guest content before launch", async () => {
    const bytes = validJar();
    const classRecord = findEntryRecords(bytes, "example/TinyMidlet.class");
    writeU32(bytes, classRecord.central + 16, 0x12345678);
    writeU32(bytes, classRecord.local + 14, 0x12345678);

    await expect(validateJar(asFile(bytes))).resolves.toMatchObject({
      ok: false,
      error: { code: "not-zip" },
    });
  });

  it("bounds actual deflate expansion even when ZIP metadata understates it", async () => {
    const bytes = zip([
      {
        name: "META-INF/MANIFEST.MF",
        content: validManifest(),
        compression: "deflate",
        declaredUncompressedSize: 8,
      },
    ]);

    await expect(validateJar(asFile(bytes))).resolves.toMatchObject({
      ok: false,
      error: { code: "too-much-content" },
    });
  });

  it("rejects malformed continuation lines outside the main manifest section", async () => {
    const manifest = `${validManifest()}\r\nName: example/TinyMidlet.class\r\n orphan\r\n\r\n orphaned`;

    await expect(validateJar(asFile(validJar(manifest)))).resolves.toMatchObject({
      ok: false,
      error: { code: "invalid-manifest" },
    });
  });
});

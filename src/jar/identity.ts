/** Returns the stable, lowercase SHA-256 identity for a JAR's exact bytes. */
export async function sha256JarIdentity(
  jarBytes: ArrayBuffer | ArrayBufferView,
): Promise<string> {
  const bytes = copyBytes(jarBytes);
  // Copy into an ArrayBuffer-backed view: WebCrypto deliberately does not
  // accept SharedArrayBuffer-backed views.
  const digestInput: Uint8Array<ArrayBuffer> = new Uint8Array(bytes.byteLength);
  digestInput.set(bytes);
  const digest = await globalThis.crypto.subtle.digest(
    "SHA-256",
    digestInput,
  );

  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

export function copyBytes(
  source: ArrayBuffer | ArrayBufferView,
): Uint8Array<ArrayBuffer> {
  if (source instanceof ArrayBuffer) {
    return new Uint8Array(source.slice(0));
  }

  return new Uint8Array(
    source.buffer.slice(
      source.byteOffset,
      source.byteOffset + source.byteLength,
    ) as ArrayBuffer,
  );
}

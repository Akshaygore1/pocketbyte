import {
  DEFAULT_JAR_VALIDATION_LIMITS,
  JarValidationError,
  type JarValidationLimits,
  validateJarBytes,
} from "../jar/validateJar";

export const MAX_JAR_BYTES = DEFAULT_JAR_VALIDATION_LIMITS.maxCompressedBytes;
export const MAX_JAR_ENTRIES = DEFAULT_JAR_VALIDATION_LIMITS.maxEntries;
export const MAX_DECOMPRESSED_BYTES = DEFAULT_JAR_VALIDATION_LIMITS.maxDecompressedBytes;

export interface ReviewedMidlet {
  index: number;
  name: string;
  icon?: string;
  className: string;
}

export interface JarReview {
  suiteName?: string;
  vendor?: string;
  version?: string;
  icon?: string;
  profile?: string;
  configuration?: string;
  midlets: ReviewedMidlet[];
}

export type JarValidationDisplayErrorCode =
  | JarValidationError["code"]
  | "wrong-extension"
  | "file-read-failed";

export type JarValidationResult =
  | {
      ok: true;
      sha256: string;
      metadata: JarReview;
      archive: { entryCount: number; decompressedSize: number };
    }
  | {
      ok: false;
      error: { code: JarValidationDisplayErrorCode; message: string };
    };

export type JarValidationInput = File | ArrayBuffer | ArrayBufferView;

/**
 * The browser-facing validation boundary. It reads local bytes only, never
 * uploads them, and turns parser errors into display-ready failure states.
 */
export async function validateJar(
  source: JarValidationInput,
  limits: JarValidationLimits = DEFAULT_JAR_VALIDATION_LIMITS,
): Promise<JarValidationResult> {
  if (isFile(source)) {
    if (!source.name.toLowerCase().endsWith(".jar")) {
      return failure("wrong-extension", "Choose a Java ME .jar file.");
    }
    if (source.size > limits.maxCompressedBytes) {
      return failure(
        "file-too-large",
        `JAR files must be ${limits.maxCompressedBytes / (1024 * 1024)} MB or smaller.`,
      );
    }
  }

  let localBytes: ArrayBuffer | ArrayBufferView;
  try {
    localBytes = isFile(source) ? await source.arrayBuffer() : source;
  } catch {
    return failure(
      "file-read-failed",
      "The selected JAR could not be read from this device.",
    );
  }

  try {
    const validated = await validateJarBytes(localBytes, limits);
    return {
      ok: true,
      sha256: validated.identity,
      metadata: {
        suiteName: validated.metadata.name,
        vendor: validated.metadata.vendor,
        version: validated.metadata.version,
        icon: validated.metadata.iconPath,
        profile: validated.metadata.profile,
        configuration: validated.metadata.configuration,
        midlets: validated.metadata.midlets.map((midlet) => ({
          index: midlet.index,
          name: midlet.name,
          ...(midlet.iconPath ? { icon: midlet.iconPath } : {}),
          className: midlet.className,
        })),
      },
      archive: validated.archive,
    };
  } catch (error) {
    if (error instanceof JarValidationError) return failure(error.code, error.message);
    return failure("not-zip", "This file could not be read as a JAR archive.");
  }
}

function failure(
  code: JarValidationDisplayErrorCode,
  message: string,
): JarValidationResult {
  return { ok: false, error: { code, message } };
}

function isFile(source: JarValidationInput): source is File {
  return (
    typeof (source as File).name === "string" &&
    typeof (source as File).size === "number" &&
    typeof (source as File).arrayBuffer === "function"
  );
}

export { JarValidationError, type JarValidationLimits };

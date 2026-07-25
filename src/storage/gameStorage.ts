import type { GameRotation, LogicalResolution } from "../runtime/runtimeAdapter";

export type GameResolution = LogicalResolution;

export interface GameSettings {
  muted: boolean;
  resolution: GameResolution;
  /** Absent only on records cached before per-game rotation was introduced. */
  rotation?: GameRotation;
}

export interface MidletSelection {
  name: string;
  className: string;
  iconPath?: string;
}

export interface CachedGameInput<Metadata = unknown> {
  sourceFileName: string;
  jarBytes: ArrayBuffer | ArrayBufferView;
  metadata: Metadata;
  selectedMidlet?: MidletSelection;
  settings: GameSettings;
}

export interface CachedGame<Metadata = unknown>
  extends Omit<CachedGameInput<Metadata>, "jarBytes"> {
  identity: string;
  jarBytes: Uint8Array;
  cachedAt: number;
}

export interface GameStorageOptions {
  databaseName?: string;
  indexedDB?: IDBFactory;
}

export interface GameStorage {
  cacheGame<Metadata>(
    game: CachedGameInput<Metadata>,
  ): Promise<CachedGame<Metadata>>;
  getGame<Metadata = unknown>(
    identity: string,
  ): Promise<CachedGame<Metadata> | null>;
  getLastGame<Metadata = unknown>(): Promise<CachedGame<Metadata> | null>;
  updateGameSettings<Metadata = unknown>(
    identity: string,
    settings: GameSettings,
  ): Promise<CachedGame<Metadata>>;
  writeNativeSave(
    identity: string,
    key: string,
    data: ArrayBuffer | ArrayBufferView,
  ): Promise<void>;
  readNativeSave(identity: string, key: string): Promise<Uint8Array | null>;
  clearGameData(identity: string): Promise<void>;
  removeGame(identity: string): Promise<void>;
  close(): void;
}

interface LastGameRecord {
  key: "lastGame";
  identity: string;
}

interface NativeSaveRecord {
  identity: string;
  key: string;
  data: Uint8Array;
}

const DEFAULT_DATABASE_NAME = "freej2me-product-storage";
const DATABASE_VERSION = 2;
const GAMES_STORE = "games";
const STATE_STORE = "state";
const NATIVE_SAVES_STORE = "nativeSaves";
const NATIVE_SAVES_IDENTITY_INDEX = "byIdentity";

function copyBytes(
  source: ArrayBuffer | ArrayBufferView,
): Uint8Array<ArrayBuffer> {
  if (source instanceof ArrayBuffer) {
    return new Uint8Array(source.slice(0));
  }

  const copied = new Uint8Array(source.byteLength);
  copied.set(
    new Uint8Array(source.buffer, source.byteOffset, source.byteLength),
  );
  return copied;
}

export async function sha256JarIdentity(
  jarBytes: ArrayBuffer | ArrayBufferView,
): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest(
    "SHA-256",
    copyBytes(jarBytes),
  );

  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

function requestResult<Result>(request: IDBRequest<Result>): Promise<Result> {
  return new Promise((resolve, reject) => {
    request.addEventListener("success", () => resolve(request.result), {
      once: true,
    });
    request.addEventListener(
      "error",
      () => reject(request.error ?? new Error("IndexedDB request failed")),
      { once: true },
    );
  });
}

function transactionComplete(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.addEventListener("complete", () => resolve(), { once: true });
    transaction.addEventListener(
      "abort",
      () =>
        reject(transaction.error ?? new Error("IndexedDB transaction aborted")),
      { once: true },
    );
    transaction.addEventListener(
      "error",
      () =>
        reject(transaction.error ?? new Error("IndexedDB transaction failed")),
      { once: true },
    );
  });
}

function deleteNativeSaves(
  store: IDBObjectStore,
  identity: string,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = store
      .index(NATIVE_SAVES_IDENTITY_INDEX)
      .openKeyCursor(identity);

    request.addEventListener("success", () => {
      const cursor = request.result;
      if (!cursor) {
        resolve();
        return;
      }

      store.delete(cursor.primaryKey);
      cursor.continue();
    });
    request.addEventListener(
      "error",
      () =>
        reject(request.error ?? new Error("Could not enumerate native saves")),
      { once: true },
    );
  });
}

function openDatabase(factory: IDBFactory, name: string): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = factory.open(name, DATABASE_VERSION);

    request.addEventListener("upgradeneeded", () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(GAMES_STORE)) {
        database.createObjectStore(GAMES_STORE, { keyPath: "identity" });
      }
      if (!database.objectStoreNames.contains(STATE_STORE)) {
        database.createObjectStore(STATE_STORE, { keyPath: "key" });
      }
      if (!database.objectStoreNames.contains(NATIVE_SAVES_STORE)) {
        database
          .createObjectStore(NATIVE_SAVES_STORE, {
            keyPath: ["identity", "key"],
          })
          .createIndex(NATIVE_SAVES_IDENTITY_INDEX, "identity");
      }
    });
    request.addEventListener("success", () => resolve(request.result), {
      once: true,
    });
    request.addEventListener(
      "error",
      () => reject(request.error ?? new Error("Could not open game storage")),
      { once: true },
    );
  });
}

class IndexedDbGameStorage implements GameStorage {
  readonly #database: Promise<IDBDatabase>;

  constructor(options: GameStorageOptions) {
    const factory = options.indexedDB ?? globalThis.indexedDB;
    if (!factory) {
      throw new Error("IndexedDB is not available in this environment");
    }

    this.#database = openDatabase(
      factory,
      options.databaseName ?? DEFAULT_DATABASE_NAME,
    );
  }

  async cacheGame<Metadata>(
    game: CachedGameInput<Metadata>,
  ): Promise<CachedGame<Metadata>> {
    const identity = await sha256JarIdentity(game.jarBytes);
    const cached: CachedGame<Metadata> = {
      ...game,
      identity,
      jarBytes: copyBytes(game.jarBytes),
      cachedAt: Date.now(),
    };
    const database = await this.#database;
    const transaction = database.transaction(
      [GAMES_STORE, STATE_STORE],
      "readwrite",
    );
    const completed = transactionComplete(transaction);
    transaction.objectStore(GAMES_STORE).put(cached);
    transaction.objectStore(STATE_STORE).put({
      key: "lastGame",
      identity,
    } satisfies LastGameRecord);
    await completed;

    return { ...cached, jarBytes: copyBytes(cached.jarBytes) };
  }

  async getGame<Metadata = unknown>(
    identity: string,
  ): Promise<CachedGame<Metadata> | null> {
    const database = await this.#database;
    const transaction = database.transaction(GAMES_STORE, "readonly");
    const record = await requestResult<CachedGame<Metadata> | undefined>(
      transaction.objectStore(GAMES_STORE).get(identity),
    );

    return record
      ? { ...record, jarBytes: copyBytes(record.jarBytes) }
      : null;
  }

  async getLastGame<Metadata = unknown>(): Promise<CachedGame<Metadata> | null> {
    const database = await this.#database;
    const transaction = database.transaction(STATE_STORE, "readonly");
    const lastGame = await requestResult<LastGameRecord | undefined>(
      transaction.objectStore(STATE_STORE).get("lastGame"),
    );

    return lastGame ? this.getGame<Metadata>(lastGame.identity) : null;
  }

  async updateGameSettings<Metadata = unknown>(
    identity: string,
    settings: GameSettings,
  ): Promise<CachedGame<Metadata>> {
    const database = await this.#database;
    const transaction = database.transaction(GAMES_STORE, "readwrite");
    const completed = transactionComplete(transaction);
    const store = transaction.objectStore(GAMES_STORE);
    const existing = await requestResult<CachedGame<Metadata> | undefined>(
      store.get(identity),
    );

    if (!existing) {
      await completed;
      throw new Error(`Cannot update unknown game: ${identity}`);
    }

    const updated = { ...existing, settings };
    store.put(updated);
    await completed;
    return { ...updated, jarBytes: copyBytes(updated.jarBytes) };
  }

  async writeNativeSave(
    identity: string,
    key: string,
    data: ArrayBuffer | ArrayBufferView,
  ): Promise<void> {
    const database = await this.#database;
    const transaction = database.transaction(
      NATIVE_SAVES_STORE,
      "readwrite",
    );
    const completed = transactionComplete(transaction);
    transaction.objectStore(NATIVE_SAVES_STORE).put({
      identity,
      key,
      data: copyBytes(data),
    } satisfies NativeSaveRecord);
    await completed;
  }

  async readNativeSave(
    identity: string,
    key: string,
  ): Promise<Uint8Array | null> {
    const database = await this.#database;
    const transaction = database.transaction(NATIVE_SAVES_STORE, "readonly");
    const record = await requestResult<NativeSaveRecord | undefined>(
      transaction.objectStore(NATIVE_SAVES_STORE).get([identity, key]),
    );

    return record ? copyBytes(record.data) : null;
  }

  async clearGameData(identity: string): Promise<void> {
    const database = await this.#database;
    const transaction = database.transaction(
      NATIVE_SAVES_STORE,
      "readwrite",
    );
    const completed = transactionComplete(transaction);
    await deleteNativeSaves(
      transaction.objectStore(NATIVE_SAVES_STORE),
      identity,
    );
    await completed;
  }

  async removeGame(identity: string): Promise<void> {
    const database = await this.#database;
    const transaction = database.transaction(
      [GAMES_STORE, NATIVE_SAVES_STORE, STATE_STORE],
      "readwrite",
    );
    const completed = transactionComplete(transaction);
    const stateStore = transaction.objectStore(STATE_STORE);
    const lastGameRequest = requestResult<LastGameRecord | undefined>(
      stateStore.get("lastGame"),
    );

    transaction.objectStore(GAMES_STORE).delete(identity);
    const savesDeleted = deleteNativeSaves(
      transaction.objectStore(NATIVE_SAVES_STORE),
      identity,
    );
    const lastGame = await lastGameRequest;
    if (lastGame?.identity === identity) {
      stateStore.delete("lastGame");
    }
    await savesDeleted;
    await completed;
  }

  close(): void {
    void this.#database.then((database) => database.close());
  }
}

export function createGameStorage(
  options: GameStorageOptions = {},
): GameStorage {
  return new IndexedDbGameStorage(options);
}

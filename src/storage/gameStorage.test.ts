import { IDBFactory } from "fake-indexeddb";
import { describe, expect, it } from "vitest";

import {
  createGameStorage,
  sha256JarIdentity,
  type CachedGameInput,
} from "./gameStorage";

const firstGame = {
  sourceFileName: "first.jar",
  jarBytes: new Uint8Array([97, 98, 99]),
  metadata: {
    name: "Fixture One",
    vendor: "Fixture Studio",
    version: "1.0",
  },
  selectedMidlet: {
    name: "Fixture One",
    className: "fixtures.FirstMidlet",
  },
  settings: {
    muted: false,
    resolution: { width: 240, height: 320 },
  },
} satisfies CachedGameInput<Record<string, string>>;

function bytes(value: Uint8Array): number[] {
  return Array.from(value);
}

describe("game storage", () => {
  it("derives the JAR identity from its bytes", async () => {
    await expect(sha256JarIdentity(firstGame.jarBytes)).resolves.toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );

    await expect(
      sha256JarIdentity({
        ...firstGame,
        sourceFileName: "a-different-name.jar",
      }.jarBytes),
    ).resolves.toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );

    const view = new Uint8Array([0, 97, 98, 99, 0]).subarray(1, 4);
    await expect(sha256JarIdentity(view)).resolves.toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });

  it("restores the last cached game and its player settings after reopening", async () => {
    const indexedDB = new IDBFactory();
    const firstSession = createGameStorage({
      databaseName: "restore-last-game",
      indexedDB,
    });

    const cached = await firstSession.cacheGame(firstGame);
    expect(cached.identity).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
    firstSession.close();

    const returningSession = createGameStorage({
      databaseName: "restore-last-game",
      indexedDB,
    });
    const restored = await returningSession.getLastGame();

    expect(restored).toMatchObject({
      identity:
        "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
      sourceFileName: "first.jar",
      metadata: firstGame.metadata,
      selectedMidlet: firstGame.selectedMidlet,
      settings: firstGame.settings,
    });
    expect(bytes(restored!.jarBytes)).toEqual([97, 98, 99]);
    returningSession.close();
  });

  it("shares native saves for identical bytes and isolates different JARs", async () => {
    const storage = createGameStorage({
      databaseName: "save-identity",
      indexedDB: new IDBFactory(),
    });
    const original = await storage.cacheGame(firstGame);
    await storage.writeNativeSave(
      original.identity,
      "rms/high-scores",
      new Uint8Array([10, 20, 30]),
    );

    const renamed = await storage.cacheGame({
      ...firstGame,
      sourceFileName: "renamed-copy.jar",
    });
    expect(renamed.identity).toBe(original.identity);
    await expect(
      storage.readNativeSave(renamed.identity, "rms/high-scores"),
    ).resolves.toEqual(new Uint8Array([10, 20, 30]));

    const different = await storage.cacheGame({
      ...firstGame,
      sourceFileName: "different.jar",
      jarBytes: new Uint8Array([97, 98, 100]),
      metadata: { ...firstGame.metadata, name: "Fixture Two" },
    });
    expect(different.identity).not.toBe(original.identity);
    await expect(
      storage.readNativeSave(different.identity, "rms/high-scores"),
    ).resolves.toBeNull();

    await storage.writeNativeSave(
      different.identity,
      "rms/high-scores",
      new Uint8Array([99]),
    );
    await expect(
      storage.readNativeSave(original.identity, "rms/high-scores"),
    ).resolves.toEqual(new Uint8Array([10, 20, 30]));
    await expect(
      storage.readNativeSave(different.identity, "rms/high-scores"),
    ).resolves.toEqual(new Uint8Array([99]));
    storage.close();
  });

  it("clears only one game's native data while retaining its cache and settings", async () => {
    const storage = createGameStorage({
      databaseName: "clear-native-data",
      indexedDB: new IDBFactory(),
    });
    const selected = await storage.cacheGame(firstGame);
    const other = await storage.cacheGame({
      ...firstGame,
      sourceFileName: "other.jar",
      jarBytes: new Uint8Array([1, 2, 3]),
    });
    await storage.writeNativeSave(
      selected.identity,
      "rms/progress",
      new Uint8Array([7]),
    );
    await storage.writeNativeSave(
      selected.identity,
      "rms/options",
      new Uint8Array([8]),
    );
    await storage.writeNativeSave(
      other.identity,
      "rms/progress",
      new Uint8Array([9]),
    );

    await storage.clearGameData(selected.identity);

    await expect(
      storage.readNativeSave(selected.identity, "rms/progress"),
    ).resolves.toBeNull();
    await expect(
      storage.readNativeSave(selected.identity, "rms/options"),
    ).resolves.toBeNull();
    await expect(
      storage.readNativeSave(other.identity, "rms/progress"),
    ).resolves.toEqual(new Uint8Array([9]));
    await expect(storage.getGame(selected.identity)).resolves.toMatchObject({
      sourceFileName: "first.jar",
      settings: firstGame.settings,
    });
    storage.close();
  });

  it("removes the cached game, settings, saves, and matching last-game reference", async () => {
    const storage = createGameStorage({
      databaseName: "remove-game",
      indexedDB: new IDBFactory(),
    });
    const earlier = await storage.cacheGame(firstGame);
    await storage.writeNativeSave(
      earlier.identity,
      "rms/progress",
      new Uint8Array([1]),
    );
    const latest = await storage.cacheGame({
      ...firstGame,
      sourceFileName: "latest.jar",
      jarBytes: new Uint8Array([4, 5, 6]),
    });
    await storage.writeNativeSave(
      latest.identity,
      "rms/progress",
      new Uint8Array([2]),
    );

    await storage.removeGame(earlier.identity);

    await expect(storage.getGame(earlier.identity)).resolves.toBeNull();
    await expect(
      storage.readNativeSave(earlier.identity, "rms/progress"),
    ).resolves.toBeNull();
    await expect(storage.getLastGame()).resolves.toMatchObject({
      identity: latest.identity,
    });

    await storage.removeGame(latest.identity);

    await expect(storage.getGame(latest.identity)).resolves.toBeNull();
    await expect(
      storage.readNativeSave(latest.identity, "rms/progress"),
    ).resolves.toBeNull();
    await expect(storage.getLastGame()).resolves.toBeNull();
    storage.close();
  });

  it("retains updated player settings and native saves across lifecycle restarts", async () => {
    const indexedDB = new IDBFactory();
    const beforeRestart = createGameStorage({
      databaseName: "settings-and-save-retention",
      indexedDB,
    });
    const cached = await beforeRestart.cacheGame(firstGame);
    await beforeRestart.writeNativeSave(
      cached.identity,
      "rms/progress",
      new Uint8Array([42]),
    );

    await beforeRestart.updateGameSettings(cached.identity, {
      muted: true,
      resolution: { width: 480, height: 800 },
    });
    beforeRestart.close();

    const afterRestart = createGameStorage({
      databaseName: "settings-and-save-retention",
      indexedDB,
    });
    await expect(afterRestart.getLastGame()).resolves.toMatchObject({
      identity: cached.identity,
      settings: {
        muted: true,
        resolution: { width: 480, height: 800 },
      },
    });
    await expect(
      afterRestart.readNativeSave(cached.identity, "rms/progress"),
    ).resolves.toEqual(new Uint8Array([42]));
    afterRestart.close();
  });
});

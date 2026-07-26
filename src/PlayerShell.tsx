import { useEffect, useRef, useState, type CSSProperties } from "react";

import {
  CheerpJFrameRuntimeAdapter,
  translatePhysicalKey,
  type GameRotation,
  type LogicalResolution,
  type MidletLaunch,
  type PlayerLifecycleState,
  type RuntimeLifecycleEvent,
} from "./runtime/runtimeAdapter";
import { observeGamepadInput } from "./runtime/gamepadInput";
import { readValidatedJarResource } from "./jar/validateJar";
import { GAME_CATALOG, type CatalogGame } from "./games/catalog";
import {
  DEFAULT_DISPLAY_RESOLUTION,
  SUPPORTED_DISPLAY_RESOLUTIONS,
} from "./jar/displayProfile";
import {
  createGameStorage,
  type CachedGame,
  type GameStorage,
  type MidletSelection,
  type ResolutionSource,
} from "./storage/gameStorage";
import { validateJar, type JarReview } from "./validation/validateJar";
import "./PlayerShell.css";

const fixture = { id: "smoke-fixture", name: "Redistributable audio fixture" };
const RESOLUTION_PRESETS = SUPPORTED_DISPLAY_RESOLUTIONS;
const DEFAULT_RESOLUTION: LogicalResolution = DEFAULT_DISPLAY_RESOLUTION;

interface PlayerView {
  state: PlayerLifecycleState;
  frameLabel: string;
  runtimeError: string | null;
}

interface SelectedGame {
  catalogId?: string;
  identity: string;
  sourceFileName: string;
  bytes: Uint8Array;
  review: JarReview;
  iconUrls: Map<number, string>;
  muted: boolean;
}

interface AudioView {
  status: "uninitialized" | "initializing" | "ready" | "unavailable";
  muted: boolean;
  notice: string | null;
}

interface ActiveInput {
  kind: "keyboard" | "gamepad";
  code: string;
}

type OpenTool =
  | "library"
  | "upload"
  | "saved"
  | "controls"
  | "resolution"
  | "details"
  | null;

interface PreparedGame {
  game: SelectedGame;
  resolution: LogicalResolution;
  rotation: GameRotation;
  resolutionSource: ResolutionSource;
}

function initialAudioView(muted: boolean): AudioView {
  return {
    status: "uninitialized",
    muted,
    notice: null,
  };
}

function isManualResolutionSource(source: ResolutionSource): boolean {
  return source === "manual";
}

function reduceAudioEvent(
  current: AudioView,
  event: RuntimeLifecycleEvent,
): AudioView {
  switch (event.type) {
    case "runtime-loading":
    case "restarting":
      return { ...current, status: "uninitialized", notice: null };
    case "audio-initializing":
      return {
        ...current,
        status: "initializing",
        notice: "Starting emulator audio…",
      };
    case "audio-ready":
      return {
        status: "ready",
        muted: event.muted,
        notice: event.muted
          ? "Emulator audio is ready and muted."
          : "Emulator audio is ready.",
      };
    case "media-warning":
      return { ...current, notice: event.message };
    default:
      return current;
  }
}

function reduceRuntimeEvent(
  current: PlayerView,
  event: RuntimeLifecycleEvent,
): PlayerView {
  switch (event.type) {
    case "runtime-ready":
      return current.state === "loading-runtime"
        ? { ...current, state: "empty", runtimeError: null }
        : current;
    case "runtime-loading":
      return current.state === "ready"
        ? {
            state: "loading-runtime",
            frameLabel: `Loading the runtime for ${event.fixtureName}…`,
            runtimeError: null,
          }
        : current;
    case "launching":
      return ["empty", "loading-runtime", "launching"].includes(current.state)
        ? {
            ...current,
            state: "launching",
            frameLabel: `Launching ${event.fixtureName}…`,
          }
        : current;
    case "running":
      return current.state === "launching" || current.state === "restarting"
        ? {
            state: "running",
            frameLabel: event.fixtureName,
            runtimeError: null,
          }
        : current;
    case "restarting":
      return current.state === "running" || current.state === "restarting"
        ? { ...current, state: "restarting", runtimeError: null }
        : current;
    case "failed":
      return ["empty", "loading-runtime", "launching", "running", "restarting"]
        .includes(current.state)
        ? {
            state: "failed",
            frameLabel: event.message,
            runtimeError: `${failureStageLabel(event.stage)}: ${event.message}`,
          }
        : current;
    case "audio-initializing":
    case "audio-ready":
    case "media-warning":
    case "runtime-resolution-suggested":
    case "diagnostics":
    case "teardown":
      return current;
  }
}

export function PlayerShell() {
  const frameContainer = useRef<HTMLDivElement>(null);
  const phone = useRef<HTMLDivElement>(null);
  const toolDialog = useRef<HTMLDialogElement>(null);
  const toolTrigger = useRef<HTMLElement | null>(null);
  const adapter = useRef<CheerpJFrameRuntimeAdapter | null>(null);
  const storage = useRef<GameStorage | null>(null);
  const pressedInputs = useRef(new Map<string, ActiveInput>());
  const validationAttempt = useRef(0);
  const resumeInProgress = useRef(false);
  const activeCatalogLaunch = useRef<string | null>(null);
  const catalogBusy = useRef<string | null>(null);
  const runtimeSuggestionHandler = useRef(
    (_event: RuntimeLifecycleEvent) => {},
  );
  const autoAdjustmentInProgress = useRef(new Set<string>());
  const resolutionSourceRef = useRef<ResolutionSource>("detected");
  const resolutionRef = useRef<LogicalResolution>(DEFAULT_RESOLUTION);
  const rotationRef = useRef<GameRotation>("none");
  const mutedRef = useRef(false);
  const [player, setPlayer] = useState<PlayerView>({
    state: "loading-runtime",
    frameLabel: "Loading runtime frame…",
    runtimeError: null,
  });
  const [selectedGame, setSelectedGame] = useState<SelectedGame | null>(null);
  const [lastGame, setLastGame] = useState<CachedGame<JarReview> | null>(null);
  const [lastGameLoading, setLastGameLoading] = useState(true);
  const [lastGameBusy, setLastGameBusy] = useState(false);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [storageNotice, setStorageNotice] = useState<string | null>(null);
  const [runtimeAvailable, setRuntimeAvailable] = useState(false);
  const [resolution, setResolution] =
    useState<LogicalResolution>(DEFAULT_RESOLUTION);
  const [rotation, setRotation] = useState<GameRotation>("none");
  const [resolutionSource, setResolutionSource] =
    useState<ResolutionSource>("detected");
  const [audio, setAudio] = useState<AudioView>(() => initialAudioView(false));
  const [openTool, setOpenTool] = useState<OpenTool>("library");
  const [catalogBusyId, setCatalogBusyId] = useState<string | null>(null);
  const [catalogErrors, setCatalogErrors] = useState<Record<string, string>>({});
  const activeGameIdentity = useRef<string | null>(null);
  activeGameIdentity.current = selectedGame?.identity ?? null;

  runtimeSuggestionHandler.current = (event) => {
    if (event.type === "runtime-resolution-suggested") {
      void applyRuntimeResolutionSuggestion(event);
    }
  };

  useEffect(() => {
    const gameStorage = createGameStorage();
    storage.current = gameStorage;
    let cancelled = false;

    void gameStorage
      .getLastGame<JarReview>()
      .then((cached) => {
        if (!cancelled) setLastGame(cached);
      })
      .catch(() => {
        if (!cancelled) {
          setValidationError(
            "Saved games could not be read from this browser.",
          );
        }
      })
      .finally(() => {
        if (!cancelled) setLastGameLoading(false);
      });

    return () => {
      cancelled = true;
      gameStorage.close();
      storage.current = null;
    };
  }, []);

  useEffect(() => {
    const dialog = toolDialog.current;
    if (!openTool || !dialog) return;

    if (!dialog.open) dialog.showModal();
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [openTool]);

  useEffect(() => {
    const runtime = new CheerpJFrameRuntimeAdapter();
    adapter.current = runtime;
    const unsubscribe = runtime.subscribe((event) => {
      if (event.type === "runtime-ready") setRuntimeAvailable(true);
      const catalogId = activeCatalogLaunch.current;
      if (catalogId && event.type === "running") {
        activeCatalogLaunch.current = null;
        catalogBusy.current = null;
        setCatalogBusyId(null);
        setCatalogErrors((current) => omitKey(current, catalogId));
        toolDialog.current?.close();
      } else if (catalogId && event.type === "failed") {
        activeCatalogLaunch.current = null;
        catalogBusy.current = null;
        setCatalogBusyId(null);
        setCatalogErrors((current) => ({
          ...current,
          [catalogId]: `${failureStageLabel(event.stage)}: ${event.message}`,
        }));
        setOpenTool("library");
      }
      runtimeSuggestionHandler.current(event);
      setAudio((current) => reduceAudioEvent(current, event));
      setPlayer((current) => reduceRuntimeEvent(current, event));
    });
    runtime.mount(frameContainer.current!);
    return () => {
      validationAttempt.current += 1;
      unsubscribe();
      runtime.destroy();
      adapter.current = null;
    };
  }, []);

  useEffect(
    () => () => releaseIconUrls(selectedGame?.iconUrls),
    [selectedGame],
  );

  useEffect(() => {
    if (
      runtimeAvailable
      && player.state === "ready"
      && selectedGame?.review.midlets.length === 1
      && !resumeInProgress.current
    ) {
      void launchMidlet(selectedGame, selectedGame.review.midlets[0]);
    }
  }, [player.state, runtimeAvailable, selectedGame]);

  useEffect(() => {
    if (player.state === "running") phone.current?.focus();
  }, [player.state]);

  useEffect(() => {
    if (player.state !== "running") return;

    return observeGamepadInput(({ source, code, pressed }) => {
      sendKey(code, pressed, source, "gamepad");
    });
  }, [player.state]);

  async function inspectSelectedJar(file: File | undefined): Promise<void> {
    if (!file) return;

    if (
      player.state === "running"
      && !window.confirm(
        "Switch games? Unsaved progress since the game's last save may be lost.",
      )
    ) {
      return;
    }

    const attempt = validationAttempt.current + 1;
    validationAttempt.current = attempt;
    setSelectedGame(null);
    setValidationError(null);
    setStorageNotice(null);
    setPlayer((current) => ({ ...current, state: "validating" }));

    const result = await validateJar(file);
    if (validationAttempt.current !== attempt) return;

    if (!result.ok) {
      setValidationError(result.error.message);
      setPlayer((current) => ({
        ...current,
        state: "failed",
        runtimeError: null,
      }));
      return;
    }

    let bytes: Uint8Array;
    try {
      bytes = new Uint8Array(await file.arrayBuffer());
    } catch {
      setValidationError("The selected JAR could not be prepared for launch.");
      setPlayer((current) => ({
        ...current,
        state: "failed",
        runtimeError: null,
      }));
      return;
    }
    if (validationAttempt.current !== attempt) return;

    await prepareGameSelection({
      identity: result.sha256,
      sourceFileName: file.name,
      bytes,
      review: result.metadata,
      defaults: {
        muted: false,
        resolution:
          result.metadata.detectedDisplayProfile?.resolution
          ?? DEFAULT_RESOLUTION,
        resolutionSource: "detected",
        rotation: "none",
      },
      attempt,
    });
    if (validationAttempt.current !== attempt) return;
    setPlayer((current) => ({
      ...current,
      state: "ready",
      runtimeError: null,
    }));
  }

  async function prepareGameSelection({
    identity,
    sourceFileName,
    bytes,
    review,
    catalogId,
    selectedMidlet,
    defaults,
    attempt,
    requireCache = false,
  }: {
    identity: string;
    sourceFileName: string;
    bytes: Uint8Array;
    review: JarReview;
    catalogId?: string;
    selectedMidlet?: JarReview["midlets"][number];
    defaults: {
      muted: boolean;
      resolution: LogicalResolution;
      resolutionSource: ResolutionSource;
      rotation: GameRotation;
    };
    attempt: number;
    requireCache?: boolean;
  }): Promise<PreparedGame | null> {
    let existing: CachedGame<JarReview> | null = null;
    try {
      existing = await storage.current?.getGame<JarReview>(identity) ?? null;
    } catch {
      // Caching below provides the actionable storage error if this persists.
    }
    if (validationAttempt.current !== attempt) return null;

    const game: SelectedGame = {
      ...(catalogId ? { catalogId } : {}),
      identity,
      sourceFileName,
      bytes,
      review,
      iconUrls: createMidletIconUrls(bytes, review),
      muted: existing?.settings.muted ?? defaults.muted,
    };
    const selectedResolution = existing
      ? supportedResolution(existing.settings.resolution)
      : supportedResolution(defaults.resolution);
    const selectedRotation = existing?.settings.rotation ?? defaults.rotation;
    const selectedResolutionSource = existing?.settings.resolutionSource
      ?? defaults.resolutionSource;

    try {
      const cached = await storage.current!.cacheGame({
        sourceFileName: game.sourceFileName,
        jarBytes: game.bytes,
        metadata: game.review,
        ...(selectedMidlet
          ? { selectedMidlet: midletSelection(selectedMidlet) }
          : existing?.selectedMidlet
            ? { selectedMidlet: existing.selectedMidlet }
            : {}),
        settings: {
          muted: game.muted,
          resolution: selectedResolution,
          resolutionSource: selectedResolutionSource,
          rotation: selectedRotation,
        },
      });
      if (validationAttempt.current !== attempt) {
        releaseIconUrls(game.iconUrls);
        return null;
      }
      setLastGame(cached);
    } catch {
      const message =
        "This game could not be remembered locally. Check browser storage and try again.";
      setValidationError(message);
      if (requireCache) {
        releaseIconUrls(game.iconUrls);
        throw new Error(message);
      }
    }

    setResolution(selectedResolution);
    setRotation(selectedRotation);
    resolutionRef.current = selectedResolution;
    rotationRef.current = selectedRotation;
    mutedRef.current = game.muted;
    resolutionSourceRef.current = selectedResolutionSource;
    setResolutionSource(selectedResolutionSource);
    setSelectedGame(game);
    setAudio(initialAudioView(game.muted));

    return {
      game,
      resolution: selectedResolution,
      rotation: selectedRotation,
      resolutionSource: selectedResolutionSource,
    };
  }

  async function launchCatalogGame(catalogGame: CatalogGame): Promise<void> {
    if (
      catalogBusy.current
      || (
        selectedGame?.catalogId === catalogGame.id
        && player.state === "running"
      )
    ) {
      return;
    }
    if (
      player.state === "running"
      && !window.confirm(
        `Switch to ${catalogGame.title}? Unsaved progress since the current game's last save may be lost.`,
      )
    ) {
      return;
    }

    const playerBeforeSwitch = player;
    const selectedGameBeforeSwitch = selectedGame;
    const resolutionBeforeSwitch = resolution;
    const rotationBeforeSwitch = rotation;
    const resolutionSourceBeforeSwitch = resolutionSource;
    const audioBeforeSwitch = audio;
    const lastGameBeforeSwitch = lastGame;
    let selectionWasReplaced = false;
    let preparedCatalogGame: SelectedGame | null = null;
    const attempt = validationAttempt.current + 1;
    validationAttempt.current = attempt;
    catalogBusy.current = catalogGame.id;
    setCatalogBusyId(catalogGame.id);
    setCatalogErrors((current) => omitKey(current, catalogGame.id));
    setValidationError(null);
    setStorageNotice(null);
    if (playerBeforeSwitch.state !== "running") {
      setPlayer((current) => ({
        ...current,
        state: "validating",
        frameLabel: `Downloading ${catalogGame.title}…`,
        runtimeError: null,
      }));
    }

    try {
      const response = await fetch(catalogGame.jarUrl);
      if (!response.ok) {
        throw new Error(
          response.status === 404
            ? "The bundled JAR is unavailable (404)."
            : `The bundled JAR could not be downloaded (HTTP ${response.status}).`,
        );
      }
      const bytes = new Uint8Array(await response.arrayBuffer());
      if (validationAttempt.current !== attempt) return;

      const result = await validateJar(bytes);
      if (validationAttempt.current !== attempt) return;
      if (!result.ok) throw new Error(`Invalid archive: ${result.error.message}`);

      const midlet = result.metadata.midlets.find(
        (candidate) => candidate.className === catalogGame.midletClass,
      );
      if (!midlet) {
        throw new Error(
          `Configured MIDlet ${catalogGame.midletClass} is not declared by this JAR.`,
        );
      }
      const classPath = `${catalogGame.midletClass.replaceAll(".", "/")}.class`;
      if (!readValidatedJarResource(bytes, classPath)) {
        throw new Error(
          `Configured MIDlet ${catalogGame.midletClass} is missing from this JAR.`,
        );
      }

      resumeInProgress.current = true;
      const prepared = await prepareGameSelection({
        identity: result.sha256,
        sourceFileName:
          catalogGame.jarUrl.split("/").pop() ?? `${catalogGame.id}.jar`,
        bytes,
        review: result.metadata,
        catalogId: catalogGame.id,
        selectedMidlet: midlet,
        defaults: {
          muted: catalogGame.muted,
          resolution: catalogGame.resolution,
          resolutionSource: "manual",
          rotation: catalogGame.rotation,
        },
        attempt,
        requireCache: true,
      });
      if (!prepared || validationAttempt.current !== attempt) return;
      selectionWasReplaced = true;
      preparedCatalogGame = prepared.game;

      setPlayer((current) => ({ ...current, state: "ready" }));
      activeCatalogLaunch.current = catalogGame.id;
      const launchError = await launchMidlet(
        prepared.game,
        midlet,
        prepared.resolution,
        prepared.rotation,
        prepared.resolutionSource,
        false,
        false,
      );
      if (launchError) {
        activeCatalogLaunch.current = null;
        throw new Error(launchError);
      }
    } catch (error) {
      if (validationAttempt.current !== attempt) return;
      activeCatalogLaunch.current = null;
      catalogBusy.current = null;
      setCatalogBusyId(null);
      setCatalogErrors((current) => ({
        ...current,
        [catalogGame.id]: error instanceof Error
          ? error.message
          : "The game could not be launched.",
      }));
      if (selectionWasReplaced) {
        releaseIconUrls(preparedCatalogGame?.iconUrls);
        setSelectedGame(
          selectedGameBeforeSwitch
            ? {
                ...selectedGameBeforeSwitch,
                iconUrls: createMidletIconUrls(
                  selectedGameBeforeSwitch.bytes,
                  selectedGameBeforeSwitch.review,
                ),
              }
            : null,
        );
        setResolution(resolutionBeforeSwitch);
        setRotation(rotationBeforeSwitch);
        resolutionRef.current = resolutionBeforeSwitch;
        rotationRef.current = rotationBeforeSwitch;
        resolutionSourceRef.current = resolutionSourceBeforeSwitch;
        mutedRef.current = selectedGameBeforeSwitch?.muted ?? false;
        setResolutionSource(resolutionSourceBeforeSwitch);
        setAudio(audioBeforeSwitch);
        setLastGame(lastGameBeforeSwitch);
        try {
          await storage.current!.setLastGame(
            lastGameBeforeSwitch?.identity ?? null,
          );
        } catch {
          setValidationError(
            "The previous saved-game selection could not be restored in browser storage.",
          );
        }
      }
      setPlayer(playerBeforeSwitch);
    } finally {
      resumeInProgress.current = false;
      if (
        validationAttempt.current !== attempt
        && catalogBusy.current === catalogGame.id
      ) {
        catalogBusy.current = null;
        setCatalogBusyId(null);
      }
    }
  }

  async function launchMidlet(
    game: SelectedGame,
    midlet: JarReview["midlets"][number],
    launchResolution: LogicalResolution = resolution,
    launchRotation: GameRotation = rotation,
    launchResolutionSource: ResolutionSource = resolutionSource,
    closeAfterDispatch = true,
    cacheBeforeLaunch = true,
  ): Promise<string | null> {
    setValidationError(null);
    if (cacheBeforeLaunch) {
      let cached: CachedGame<JarReview>;
      try {
        cached = await storage.current!.cacheGame({
          sourceFileName: game.sourceFileName,
          jarBytes: game.bytes,
          metadata: game.review,
          selectedMidlet: midletSelection(midlet),
          settings: {
            muted: game.muted,
            resolution: launchResolution,
            resolutionSource: launchResolutionSource,
            rotation: launchRotation,
          },
        });
      } catch {
        const message =
          "This game could not be saved locally. Check browser storage and try again.";
        setValidationError(message);
        return message;
      }
      setLastGame(cached);
    }
    const launch: MidletLaunch = {
      identity: game.identity,
      name: midlet.name,
      className: midlet.className,
      jarBytes: game.bytes,
      resolution: launchResolution,
      rotation: launchRotation,
      automaticSizing:
        launchResolutionSource !== "manual" && launchRotation === "none",
      supportedResolutions: RESOLUTION_PRESETS,
      muted: game.muted,
    };
    try {
      await adapter.current?.launchMidlet(launch);
    } catch {
      const message = "The runtime could not start this game. Try again.";
      setValidationError(message);
      return message;
    }
    if (closeAfterDispatch) closeToolDialog();
    return null;
  }

  async function resumeLastGame(): Promise<void> {
    if (!lastGame || lastGameBusy) return;

    setLastGameBusy(true);
    resumeInProgress.current = true;
    const restoredResolution = supportedResolution(lastGame.settings.resolution);
    const restoredRotation = lastGame.settings.rotation ?? "none";
    const restoredResolutionSource = lastGame.settings.resolutionSource
      ?? "detected";
    const restored: SelectedGame = {
      identity: lastGame.identity,
      sourceFileName: lastGame.sourceFileName,
      bytes: lastGame.jarBytes,
      review: lastGame.metadata,
      iconUrls: createMidletIconUrls(lastGame.jarBytes, lastGame.metadata),
      muted: lastGame.settings.muted,
    };
    const midlet = lastGame.selectedMidlet
      ? lastGame.metadata.midlets.find(
          (candidate) =>
            candidate.className === lastGame.selectedMidlet?.className,
        )
      : undefined;

    if (lastGame.selectedMidlet && !midlet) {
      resumeInProgress.current = false;
      setLastGameBusy(false);
      setValidationError(
        "The saved MIDlet is no longer present in this cached game.",
      );
      return;
    }

    setResolution(restoredResolution);
    setRotation(restoredRotation);
    resolutionRef.current = restoredResolution;
    rotationRef.current = restoredRotation;
    mutedRef.current = restored.muted;
    resolutionSourceRef.current = restoredResolutionSource;
    setResolutionSource(restoredResolutionSource);
    setSelectedGame(restored);
    setAudio(initialAudioView(restored.muted));
    if (!midlet) {
      setPlayer((current) => ({
        ...current,
        state: "ready",
        runtimeError: null,
      }));
      resumeInProgress.current = false;
      setLastGameBusy(false);
      return;
    }

    try {
      await launchMidlet(
        restored,
        midlet,
        restoredResolution,
        restoredRotation,
        restoredResolutionSource,
      );
    } finally {
      resumeInProgress.current = false;
      setLastGameBusy(false);
    }
  }

  async function removeLastGame(): Promise<void> {
    if (
      !lastGame
      || lastGameBusy
      || !window.confirm(
        `Remove ${displayGameName(lastGame)}? This deletes its cached JAR, `
          + "player settings, and saved game data from this browser.",
      )
    ) {
      return;
    }

    const identity = lastGame.identity;
    const removingSelectedGame = selectedGame?.identity === identity;
    beginGameDataOperation(identity, "Removing local game data…");
    validationAttempt.current += 1;

    try {
      await adapter.current!.removeGameData(identity);
      await storage.current!.removeGame(identity);
      setLastGame(null);
      setValidationError(null);
      setStorageNotice(null);
      if (removingSelectedGame) {
        setSelectedGame(null);
        setOpenTool("upload");
        setPlayer({
          state: "empty",
          frameLabel: "Choose a game to begin.",
          runtimeError: null,
        });
      } else {
        setPlayer((current) => ({
          ...current,
          state: selectedGame ? "ready" : "empty",
          runtimeError: null,
        }));
      }
    } catch {
      setValidationError(
        "The saved game could not be removed from this browser.",
      );
      setPlayer((current) => ({
        ...current,
        state: selectedGame ? "ready" : "empty",
      }));
    } finally {
      setLastGameBusy(false);
    }
  }

  async function clearLastGameData(): Promise<void> {
    if (
      !lastGame
      || lastGameBusy
      || !window.confirm(
        `Clear saved progress for ${displayGameName(lastGame)}? This deletes `
          + "only its Java ME save data. The cached game and player settings "
          + "will stay available.",
      )
    ) {
      return;
    }

    const identity = lastGame.identity;
    beginGameDataOperation(identity, "Clearing saved progress…");

    try {
      await adapter.current!.clearGameData(identity);
      await storage.current!.clearGameData(identity);
      setStorageNotice(
        `${displayGameName(lastGame)} saved progress was cleared. `
          + "The cached game and player settings are still available.",
      );
      setPlayer((current) => ({
        ...current,
        state: selectedGame ? "ready" : "empty",
        frameLabel: selectedGame
          ? displayGameName(lastGame)
          : "Choose a game to begin.",
        runtimeError: null,
      }));
    } catch {
      setValidationError(
        "This game's saved progress could not be cleared.",
      );
      setPlayer((current) => ({
        ...current,
        state: selectedGame ? "ready" : "empty",
      }));
    } finally {
      setLastGameBusy(false);
    }
  }

  function beginGameDataOperation(
    identity: string,
    frameLabel: string,
  ): void {
    setLastGameBusy(true);
    setValidationError(null);
    setStorageNotice(null);
    if (selectedGame?.identity === identity) {
      releasePressedKeys();
      setPlayer({
        state: "loading-runtime",
        frameLabel,
        runtimeError: null,
      });
    }
  }

  async function applyRuntimeResolutionSuggestion(
    event: Extract<
      RuntimeLifecycleEvent,
      { type: "runtime-resolution-suggested" }
    >,
  ): Promise<void> {
    if (
      !selectedGame
      || selectedGame.identity !== event.identity
      || isManualResolutionSource(resolutionSourceRef.current)
      || rotation !== "none"
      || player.state !== "running"
      || autoAdjustmentInProgress.current.has(event.identity)
      || !isSmallerSameOrientation(event.resolution, resolution)
    ) {
      return;
    }

    autoAdjustmentInProgress.current.add(event.identity);
    let updated: CachedGame<JarReview>;
    try {
      updated = await storage.current!.updateGameSettings<JarReview>(
        event.identity,
        {
          muted: selectedGame.muted,
          resolution: event.resolution,
          resolutionSource: "runtime-content",
          rotation,
        },
      );
    } catch {
      autoAdjustmentInProgress.current.delete(event.identity);
      setValidationError(
        "The automatically detected resolution could not be saved.",
      );
      return;
    }

    if (activeGameIdentity.current !== event.identity) return;
    if (
      isManualResolutionSource(resolutionSourceRef.current)
      || rotationRef.current !== rotation
      || mutedRef.current !== selectedGame.muted
      || resolutionRef.current.width !== resolution.width
      || resolutionRef.current.height !== resolution.height
    ) {
      try {
        const restored = await storage.current!.updateGameSettings<JarReview>(
          event.identity,
          {
            muted: mutedRef.current,
            resolution: resolutionRef.current,
            resolutionSource: resolutionSourceRef.current,
            rotation: rotationRef.current,
          },
        );
        if (activeGameIdentity.current === event.identity) setLastGame(restored);
      } catch {
        setValidationError("The latest display preference could not be saved.");
      }
      autoAdjustmentInProgress.current.delete(event.identity);
      return;
    }

    const adjusted = { ...event.resolution };
    setLastGame(updated);
    setResolution(adjusted);
    resolutionRef.current = adjusted;
    resolutionSourceRef.current = "runtime-content";
    setResolutionSource("runtime-content");
    setStorageNotice(
      `Auto-adjusted to ${adjusted.width}×${adjusted.height} from game output.`,
    );
    releasePressedKeys();
    await adapter.current?.restart({
      resolution: adjusted,
      rotation,
      automaticSizing: false,
    });
  }

  function changeAutomaticSizing(enabled: boolean): void {
    if (!selectedGame || enabled === (resolutionSource !== "manual")) return;

    const activeGame = player.state === "running";
    if (
      enabled
      && activeGame
      && !window.confirm(
        "Changing automatic fitting restarts the emulator. Unsaved progress since "
          + "the game's last save may be lost. Continue?",
      )
    ) {
      return;
    }

    const nextSource: ResolutionSource = enabled ? "detected" : "manual";
    resolutionSourceRef.current = nextSource;
    setResolutionSource(nextSource);
    if (lastGame?.identity === selectedGame.identity) {
      void storage.current
        ?.updateGameSettings<JarReview>(selectedGame.identity, {
          muted: selectedGame.muted,
          resolution,
          resolutionSource: nextSource,
          rotation,
        })
        .then((updated) => setLastGame(updated))
        .catch(() =>
          setValidationError(
            "The automatic fitting preference could not be saved for this game.",
          ),
        );
    }

    if (enabled && activeGame) {
      autoAdjustmentInProgress.current.delete(selectedGame.identity);
      releasePressedKeys();
      void adapter.current?.restart({
        resolution,
        rotation,
        automaticSizing: rotation === "none",
      });
    }
  }

  function changeResolution(value: string): void {
    const next = RESOLUTION_PRESETS.find(
      (preset) => resolutionValue(preset) === value,
    );
    if (!next || !selectedGame) return;

    const activeGame = player.state === "running";
    if (
      activeGame
      && !window.confirm(
        "Changing resolution restarts the emulator. Unsaved progress since "
          + "the game's last save may be lost. Continue?",
      )
    ) {
      return;
    }

    const selected = { ...next };
    setResolution(selected);
    resolutionRef.current = selected;
    resolutionSourceRef.current = "manual";
    setResolutionSource("manual");
    if (lastGame?.identity === selectedGame.identity) {
      void storage.current
        ?.updateGameSettings<JarReview>(selectedGame.identity, {
          muted: selectedGame.muted,
          resolution: selected,
          resolutionSource: "manual",
          rotation,
        })
        .then((updated) => setLastGame(updated))
        .catch(() =>
          setValidationError(
            "The new resolution could not be saved for this game.",
          ),
        );
    }

    if (activeGame) {
      releasePressedKeys();
      void adapter.current?.restart({
        resolution: selected,
        rotation,
        automaticSizing: false,
      });
    }
  }

  function changeRotation(rotateOutput: boolean): void {
    if (!selectedGame) return;
    const next: GameRotation = rotateOutput ? "counterclockwise" : "none";
    if (next === rotation) return;

    const activeGame = player.state === "running";
    if (
      activeGame
      && !window.confirm(
        "Changing output rotation restarts the emulator. Unsaved progress since "
          + "the game's last save may be lost. Continue?",
      )
    ) {
      return;
    }

    setRotation(next);
    rotationRef.current = next;
    if (lastGame?.identity === selectedGame.identity) {
      void storage.current
        ?.updateGameSettings<JarReview>(selectedGame.identity, {
          muted: selectedGame.muted,
          resolution,
          resolutionSource: resolutionSourceRef.current,
          rotation: next,
        })
        .then((updated) => setLastGame(updated))
        .catch(() =>
          setValidationError(
            "The output rotation could not be saved for this game.",
          ),
        );
    }

    if (activeGame) {
      releasePressedKeys();
      void adapter.current?.restart({
        resolution,
        rotation: next,
        automaticSizing:
          resolutionSourceRef.current !== "manual" && next === "none",
      });
    }
  }

  async function initializeAudio(): Promise<void> {
    try {
      await adapter.current?.initializeAudio();
    } catch (error) {
      setAudio((current) => ({
        ...current,
        status: "unavailable",
        notice: error instanceof Error
          ? error.message
          : "Emulator audio could not be started.",
      }));
    }
  }

  function changeMuted(muted: boolean): void {
    mutedRef.current = muted;
    if (selectedGame) {
      setSelectedGame({ ...selectedGame, muted });
    }
    setAudio((current) => ({
      ...current,
      muted,
      notice: muted ? "Emulator audio is muted." : "Emulator audio is on.",
    }));
    adapter.current?.setMuted(muted);

    if (selectedGame && lastGame?.identity === selectedGame.identity) {
      void storage.current
        ?.updateGameSettings<JarReview>(selectedGame.identity, {
          muted,
          resolution,
          resolutionSource: resolutionSourceRef.current,
          rotation,
        })
        .then((updated) => setLastGame(updated))
        .catch(() =>
          setAudio((current) => ({
            ...current,
            notice: "The mute preference could not be saved for this game.",
          })),
        );
    }
  }

  function sendKey(
    code: string,
    pressed: boolean,
    source = `keyboard:${code}`,
    kind: ActiveInput["kind"] = "keyboard",
  ): boolean {
    const translatedCode = translatePhysicalKey(code);
    if (!translatedCode) return false;

    if (pressed) {
      if (pressedInputs.current.has(source)) return true;
      const alreadyPressed = Array.from(pressedInputs.current.values())
        .some((input) => input.code === translatedCode);
      if (
        !alreadyPressed
        && !adapter.current?.inputCanonical(translatedCode, true)
      ) {
        return false;
      }
      pressedInputs.current.set(source, { kind, code: translatedCode });
    } else {
      const activeInput = pressedInputs.current.get(source);
      if (!activeInput) return false;
      pressedInputs.current.delete(source);
      const stillPressed = Array.from(pressedInputs.current.values())
        .some((input) => input.code === activeInput.code);
      if (!stillPressed) {
        adapter.current?.inputCanonical(activeInput.code, false);
      }
    }
    return true;
  }

  function releasePressedKeys(): void {
    new Set(
      Array.from(pressedInputs.current.values(), (input) => input.code),
    ).forEach((code) =>
      adapter.current?.inputCanonical(code, false));
    pressedInputs.current.clear();
  }

  function releaseKeyboardKeys(): void {
    Array.from(pressedInputs.current.entries())
      .filter(([, input]) => input.kind === "keyboard")
      .forEach(([source, input]) => {
        sendKey(input.code, false, source, input.kind);
      });
  }

  function toggleTool(tool: Exclude<OpenTool, null>): void {
    if (openTool === tool) {
      closeToolDialog();
      return;
    }

    if (document.activeElement instanceof HTMLElement) {
      toolTrigger.current = document.activeElement;
    }
    setOpenTool(tool);
  }

  function closeToolDialog(): void {
    if (toolDialog.current?.open) {
      toolDialog.current.close();
    } else {
      handleToolDialogClose();
    }
  }

  function handleToolDialogClose(): void {
    const closedTool = openTool;
    setOpenTool(null);
    const trigger = toolTrigger.current;
    toolTrigger.current = null;
    if (closedTool === "controls" && player.state === "running") {
      window.requestAnimationFrame(() => phone.current?.focus());
    } else if (trigger?.isConnected) {
      window.requestAnimationFrame(() => trigger.focus());
    }
  }

  const audioNeedsInitialization =
    audio.status === "uninitialized" || audio.status === "unavailable";
  const audioLabel = audio.status === "initializing"
    ? "Audio initializing"
    : audio.status === "unavailable"
      ? "Audio unavailable"
      : audioNeedsInitialization
        ? "Enable audio"
        : audio.muted
          ? "Unmute audio"
          : "Mute audio";
  const displayResolution = selectedGame
    ? rotation === "counterclockwise"
      ? { width: resolution.height, height: resolution.width }
      : resolution
    : { width: 16, height: 10 };
  const playerShellStyle = {
    "--display-width": displayResolution.width,
    "--display-height": displayResolution.height,
    "--display-aspect-ratio":
      displayResolution.width / displayResolution.height,
  } as CSSProperties;

  const gameStage = (
    <section className="phone-stage" aria-label="PocketByte game display">
      <div
        ref={phone}
        className="phone"
        role="application"
        aria-label="PocketByte Java ME game display. Focus to use keyboard controls."
        tabIndex={0}
        onPointerDown={(event) => {
          event.preventDefault();
          phone.current?.focus();
        }}
        onKeyDown={(event) => {
          if (sendKey(event.code, true)) event.preventDefault();
        }}
        onKeyUp={(event) => {
          if (sendKey(event.code, false)) event.preventDefault();
        }}
        onBlur={releaseKeyboardKeys}
      >
        <div className="screen-bezel">
          <div className="screen-status">
            <span
              className={`state-indicator state-${player.state}`}
              aria-hidden="true"
            />
            <span data-player-state={player.state} aria-live="polite">
              {player.state.replace("-", " ")}
            </span>
            <span className="screen-clock" aria-hidden="true">
              {resolution.width}×{resolution.height}
            </span>
          </div>
          <div className="runtime-viewport" ref={frameContainer}>
            <p className="runtime-label">{player.frameLabel}</p>
          </div>
        </div>
      </div>
      <div className="stage-footer">
        <span>{selectedGame?.review.suiteName ?? selectedGame?.sourceFileName ?? "No cartridge"}</span>
        <span aria-live="polite">
          {audio.notice ?? "Ready for local play"}
        </span>
      </div>
      {player.runtimeError && <p className="runtime-alert" role="alert">{player.runtimeError}</p>}
      {(storageNotice || validationError) && !openTool && (
        <div className="stage-messages">
          {storageNotice && <p className="storage-notice" role="status">{storageNotice}</p>}
          {validationError && <p className="alert" role="alert">{validationError}</p>}
        </div>
      )}
    </section>
  );

  return (
    <main className="player-shell" style={playerShellStyle}>
      {gameStage}
      <nav className="tool-rail" aria-label="PocketByte tools">
        <div className="device-mark" aria-label="PocketByte local Java ME player">
          <span>Pocket<wbr />Byte</span>
          <small>Local Java ME player</small>
        </div>
        <div className="tool-buttons">
          <ToolButton
            icon="library"
            label="Game library"
            active={openTool === "library"}
            onClick={() => toggleTool("library")}
          />
          <ToolButton
            icon="cartridge"
            label="Load game"
            active={openTool === "upload"}
            disabled={Boolean(catalogBusyId)}
            onClick={() => toggleTool("upload")}
          />
          <ToolButton
            icon="save"
            label="Saved game"
            active={openTool === "saved"}
            indicator={Boolean(lastGame)}
            disabled={Boolean(catalogBusyId)}
            onClick={() => toggleTool("saved")}
          />
          <ToolButton
            icon={
              audio.status === "unavailable"
                ? "audio-off"
                : audio.muted
                  ? "muted"
                  : audio.status === "ready"
                    ? "audio"
                    : "audio-idle"
            }
            label={audioLabel}
            state={audio.status}
            disabled={player.state !== "running" || audio.status === "initializing"}
            pressed={!audioNeedsInitialization ? audio.muted : undefined}
            onClick={() => {
              if (audioNeedsInitialization) void initializeAudio();
              else changeMuted(!audio.muted);
            }}
          />
          <ToolButton
            icon="controls"
            label="Controls"
            active={openTool === "controls"}
            disabled={Boolean(catalogBusyId)}
            onClick={() => toggleTool("controls")}
          />
          <ToolButton
            icon="resolution"
            label="Display size"
            active={openTool === "resolution"}
            disabled={!selectedGame || Boolean(catalogBusyId)}
            onClick={() => toggleTool("resolution")}
          />
          <ToolButton
            icon="info"
            label="Game details"
            active={openTool === "details"}
            disabled={!selectedGame || Boolean(catalogBusyId)}
            onClick={() => toggleTool("details")}
          />
        </div>
      </nav>

      {openTool && (
        <dialog
          id="tool-dialog"
          ref={toolDialog}
          className={`tool-panel${openTool === "library" ? " library-panel" : ""}`}
          aria-labelledby="tool-panel-title"
          onClick={(event) => {
            if (event.target === event.currentTarget) closeToolDialog();
          }}
          onClose={handleToolDialogClose}
        >
          <div className="panel-heading">
            <div>
              <p className="section-kicker">{toolKicker(openTool)}</p>
              <h2 id="tool-panel-title">{toolTitle(openTool)}</h2>
            </div>
            <button
              className="panel-close"
              type="button"
              aria-label="Close tool panel"
              autoFocus
              onClick={closeToolDialog}
            >
              <Icon name="close" />
            </button>
          </div>

          {openTool === "library" && (
            <div className="library-content">
              <p className="library-intro">
                Pick a cartridge to download it to this browser and play.
              </p>
              <div className="game-grid" aria-label="Bundled games">
                {GAME_CATALOG.map((catalogGame) => {
                  const busy = catalogBusyId === catalogGame.id;
                  const blockedByOtherLaunch = Boolean(catalogBusyId && !busy);
                  const isRunning =
                    selectedGame?.catalogId === catalogGame.id
                    && player.state === "running";
                  return (
                    <article className="game-card" key={catalogGame.id}>
                      <button
                        type="button"
                        disabled={
                          busy
                          || blockedByOtherLaunch
                          || isRunning
                          || !runtimeAvailable
                        }
                        aria-describedby={`catalog-description-${catalogGame.id}`}
                        onClick={() => void launchCatalogGame(catalogGame)}
                      >
                        <span className="game-art" aria-hidden="true">
                          {catalogGame.artworkUrl
                            ? <img src={catalogGame.artworkUrl} alt="" />
                            : <CartridgePlaceholder />}
                        </span>
                        <span className="game-card-copy">
                          <strong>{catalogGame.title}</strong>
                          <span id={`catalog-description-${catalogGame.id}`}>
                            {catalogGame.description ?? "A bundled Java ME game."}
                          </span>
                          <small>
                            {busy
                              ? "Downloading & checking…"
                              : isRunning
                                ? "Now playing"
                                : "Play game"}
                          </small>
                        </span>
                      </button>
                      {catalogErrors[catalogGame.id] && (
                        <p className="catalog-error" role="alert">
                          {catalogErrors[catalogGame.id]}
                        </p>
                      )}
                    </article>
                  );
                })}
              </div>
            </div>
          )}

          {openTool === "upload" && (
            <div className="panel-content">
              <label className="file-picker">
                <Icon name="cartridge" />
                <span>
                  <strong>{player.state === "validating" ? "Checking JAR…" : "Insert JAR"}</strong>
                  <small>.jar files</small>
                </span>
                <input
                  type="file"
                  accept=".jar,application/java-archive"
                  disabled={player.state === "validating"}
                  onChange={(event) =>
                    void inspectSelectedJar(event.currentTarget.files?.[0])}
                />
              </label>
              <p className="privacy-copy">
                On-device only. Your game is inspected and stored in this browser, never uploaded.
              </p>
              <button
                className="fixture-launch"
                type="button"
                disabled={player.state !== "empty"}
                onClick={() => {
                  closeToolDialog();
                  void adapter.current?.launch(fixture);
                }}
              >
                Open audio fixture
              </button>
            </div>
          )}

          {openTool === "saved" && (
            <div className="panel-content">
              {lastGameLoading && <p className="empty-panel">Reading local save…</p>}
              {!lastGameLoading && !lastGame && (
                <p className="empty-panel">No cartridge is saved yet.</p>
              )}
              {!lastGameLoading && lastGame && (
                <section className="saved-game" aria-labelledby="saved-game-heading">
                  <div className="saved-game-copy">
                    <p className="section-kicker">Last played</p>
                    <h3 id="saved-game-heading">{displayGameName(lastGame)}</h3>
                    <p>
                      {lastGame.selectedMidlet?.name ?? "MIDlet not selected"}
                      {" · "}{lastGame.settings.resolution.width}×{lastGame.settings.resolution.height}
                    </p>
                  </div>
                  <div className="saved-game-actions">
                    <button
                      type="button"
                      disabled={
                        !runtimeAvailable || lastGameBusy
                        || selectedGame?.identity === lastGame.identity
                        || ["validating", "loading-runtime", "launching", "running", "restarting"]
                          .includes(player.state)
                      }
                      onClick={() => void resumeLastGame()}
                    >
                      Resume
                    </button>
                    <button
                      className="clear-game-data"
                      type="button"
                      disabled={!runtimeAvailable || lastGameBusy || player.state === "validating"}
                      onClick={() => void clearLastGameData()}
                    >
                      Clear progress
                    </button>
                    <div className="danger-zone">
                      <p>Deletes the cartridge, settings, and save data.</p>
                      <button
                        className="remove-game"
                        type="button"
                        disabled={!runtimeAvailable || lastGameBusy || player.state === "validating"}
                        onClick={() => void removeLastGame()}
                      >
                        Remove game
                      </button>
                    </div>
                  </div>
                </section>
              )}
            </div>
          )}

          {openTool === "controls" && <ControlsGuide />}

          {openTool === "resolution" && selectedGame && (
            <ResolutionControl
              resolution={resolution}
              rotation={rotation}
              automaticSizing={resolutionSource !== "manual"}
              detectedProfile={selectedGame.review.detectedDisplayProfile}
              disabled={["loading-runtime", "launching", "restarting"].includes(player.state)}
              onChange={changeResolution}
              onAutomaticSizingChange={changeAutomaticSizing}
              onRotationChange={changeRotation}
            />
          )}

          {openTool === "details" && selectedGame && (
            <JarMetadataReview
              game={selectedGame}
              state={player.state}
              onLaunch={(midlet) => void launchMidlet(selectedGame, midlet)}
            />
          )}

          {storageNotice && <p className="storage-notice" role="status">{storageNotice}</p>}
          {validationError && <p className="alert" role="alert">{validationError}</p>}
        </dialog>
      )}

    </main>
  );
}

type IconName =
  | "audio"
  | "audio-idle"
  | "audio-off"
  | "cartridge"
  | "close"
  | "controls"
  | "info"
  | "library"
  | "muted"
  | "resolution"
  | "save";

function ToolButton({
  icon,
  label,
  active = false,
  indicator = false,
  disabled = false,
  pressed,
  state,
  onClick,
}: {
  icon: IconName;
  label: string;
  active?: boolean;
  indicator?: boolean;
  disabled?: boolean;
  pressed?: boolean;
  state?: AudioView["status"];
  onClick: () => void;
}) {
  return (
    <button
      className={`tool-button${active ? " is-active" : ""}`}
      type="button"
      aria-label={label}
      aria-expanded={active || undefined}
      aria-pressed={pressed}
      aria-disabled={disabled || undefined}
      data-tooltip={label}
      data-tool-state={state}
      onClick={() => {
        if (!disabled) onClick();
      }}
    >
      <Icon name={icon} />
      <span className="tool-label" aria-hidden="true">{shortToolLabel(icon)}</span>
      {indicator && <span className="tool-indicator" aria-hidden="true" />}
    </button>
  );
}

function Icon({ name }: { name: IconName }) {
  const common = {
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.75,
    strokeLinecap: "square" as const,
    strokeLinejoin: "miter" as const,
  };

  return (
    <svg className="tool-icon" viewBox="0 0 24 24" aria-hidden="true">
      {name === "cartridge" && <>
        <path {...common} d="M5 3.5h12l2 2V21H5z" />
        <path {...common} d="M8 3.5v4h7v-4M8 17.5h8M9 21v-3.5M12 21v-3.5M15 21v-3.5" />
      </>}
      {name === "save" && <>
        <path {...common} d="M4 4h13l3 3v13H4z" />
        <path {...common} d="M8 4v6h8V4M8 20v-6h8v6" />
      </>}
      {name === "library" && <>
        <path {...common} d="M4 5.5h6v13H4zM14 5.5h6v13h-6z" />
        <path {...common} d="M6.5 8.5h1M16.5 8.5h1M6.5 15.5h1M16.5 15.5h1" />
      </>}
      {name === "resolution" && <>
        <rect {...common} x="3.5" y="5" width="17" height="14" />
        <path {...common} d="M7 9V7h2M15 7h2v2M17 15v2h-2M9 17H7v-2" />
      </>}
      {name === "info" && <>
        <circle {...common} cx="12" cy="12" r="8.5" />
        <path {...common} d="M12 10.5V17M12 7v.5" />
      </>}
      {name === "controls" && <>
        <path {...common} d="M7.5 8h9a4 4 0 013.8 2.8l1.1 3.7a2.7 2.7 0 01-4.3 2.8l-2.2-1.8H9.1l-2.2 1.8a2.7 2.7 0 01-4.3-2.8l1.1-3.7A4 4 0 017.5 8z" />
        <path {...common} d="M7.5 11v4M5.5 13h4M16.5 11.5v.1M18.5 14v.1" />
      </>}
      {(name === "audio" || name === "audio-idle" || name === "muted" || name === "audio-off") && <>
        <path {...common} d="M4 10h4l4-4v12l-4-4H4z" />
        {name === "audio" && <path {...common} d="M15 9a4 4 0 010 6M17.5 6.5a7.5 7.5 0 010 11" />}
        {name === "muted" && <path {...common} d="M15 10l5 5M20 10l-5 5" />}
        {name === "audio-off" && <path {...common} d="M4 4l16 16" />}
      </>}
      {name === "close" && <path {...common} d="M5 5l14 14M19 5L5 19" />}
    </svg>
  );
}

function shortToolLabel(icon: IconName): string {
  return TOOL_LABELS[icon];
}

const TOOL_LABELS: Record<IconName, string> = {
  audio: "AUDIO",
  "audio-idle": "AUDIO",
  "audio-off": "AUDIO",
  cartridge: "JAR",
  close: "CLOSE",
  controls: "CTRL",
  info: "INFO",
  library: "GAMES",
  muted: "AUDIO",
  resolution: "SIZE",
  save: "SAVE",
};

function toolTitle(tool: Exclude<OpenTool, null>): string {
  if (tool === "library") return "Game library";
  if (tool === "upload") return "Load game";
  if (tool === "saved") return "Saved game";
  if (tool === "controls") return "Controls";
  if (tool === "resolution") return "Display size";
  return "Game details";
}

function toolKicker(tool: Exclude<OpenTool, null>): string {
  if (tool === "library") return "Ready to play";
  return tool === "controls" ? "Player guide" : "Cartridge bay";
}

function CartridgePlaceholder() {
  return (
    <svg viewBox="0 0 96 72" aria-hidden="true">
      <path d="M20 7h49l7 7v51H20z" />
      <path d="M29 7v18h38V7M29 47h38M34 65V51M45 65V51M56 65V51M67 65V51" />
      <path className="placeholder-label" d="M35 31h26v9H35z" />
    </svg>
  );
}

function ControlsGuide() {
  return (
    <div className="controls-guide">
      <section aria-labelledby="keyboard-controls-heading">
        <p className="section-kicker">Desktop</p>
        <h3 id="keyboard-controls-heading">Keyboard</h3>
        <dl className="control-map">
          <ControlMapping action="Move" keys={["WASD", "Arrow keys"]} />
          <ControlMapping action="Action / OK" keys={["Space", "Enter"]} />
          <ControlMapping action="Left / right soft key" keys={["Q", "E"]} />
          <ControlMapping action="Phone keypad" keys={["0–9"]} />
          <ControlMapping action="* / #" keys={["Z", "X"]} />
          <ControlMapping action="Emulator menu" keys={["Esc"]} />
        </dl>
      </section>
      <section aria-labelledby="gamepad-controls-heading">
        <p className="section-kicker">Standard controller</p>
        <h3 id="gamepad-controls-heading">Gamepad</h3>
        <dl className="control-map">
          <ControlMapping action="Move" keys={["D-pad", "Left stick"]} />
          <ControlMapping action="Action / OK" keys={["A / Cross"]} />
          <ControlMapping action="Left soft key" keys={["Left bumper"]} />
          <ControlMapping action="Right soft key" keys={["Right bumper"]} />
          <ControlMapping action="Emulator menu" keys={["Start"]} />
        </dl>
        <p className="controls-note">
          Use the keyboard when a game asks for phone keys 0–9, * or #.
        </p>
      </section>
    </div>
  );
}

function ControlMapping({ action, keys }: { action: string; keys: string[] }) {
  return (
    <div>
      <dt>{action}</dt>
      <dd>
        {keys.map((key) => <kbd key={key}>{key}</kbd>)}
      </dd>
    </div>
  );
}

function ResolutionControl({
  resolution,
  rotation,
  automaticSizing,
  detectedProfile,
  disabled,
  onChange,
  onAutomaticSizingChange,
  onRotationChange,
}: {
  resolution: LogicalResolution;
  rotation: GameRotation;
  automaticSizing: boolean;
  detectedProfile?: JarReview["detectedDisplayProfile"];
  disabled: boolean;
  onChange: (value: string) => void;
  onAutomaticSizingChange: (enabled: boolean) => void;
  onRotationChange: (rotateOutput: boolean) => void;
}) {
  return (
    <div className="resolution-control">
      <label htmlFor="game-resolution">Game resolution</label>
      <select
        id="game-resolution"
        value={resolutionValue(resolution)}
        disabled={disabled}
        onChange={(event) => onChange(event.currentTarget.value)}
      >
        {RESOLUTION_PRESETS.map((preset) => (
          <option key={resolutionValue(preset)} value={resolutionValue(preset)}>
            {preset.width}×{preset.height}
          </option>
        ))}
      </select>
      {detectedProfile && (
        <p className={detectedProfile.confidence === "low" ? "detection-warning" : undefined}>
          {detectedProfile.confidence === "low" ? "Best guess" : "Detected"}
          {" "}{detectedProfile.resolution.width}×{detectedProfile.resolution.height}
          {" from "}{detectedProfile.source}.
          {detectedProfile.confidence === "low"
            ? " Check the size and adjust it if the game does not fit."
            : ""}
        </p>
      )}
      <label className="rotation-control">
        <input
          type="checkbox"
          checked={automaticSizing}
          disabled={disabled}
          onChange={(event) =>
            onAutomaticSizingChange(event.currentTarget.checked)}
        />
        <span>Automatically fit game output</span>
      </label>
      <label className="rotation-control">
        <input
          type="checkbox"
          checked={rotation === "counterclockwise"}
          disabled={disabled}
          onChange={(event) => onRotationChange(event.currentTarget.checked)}
        />
        <span>Rotate game output</span>
      </label>
      {automaticSizing && rotation === "counterclockwise" && (
        <p>Automatic fitting is paused while output rotation is enabled.</p>
      )}
      <p>Logical pixels. Display scaling keeps the original proportions.</p>
    </div>
  );
}

function JarMetadataReview({
  game,
  state,
  onLaunch,
}: {
  game: SelectedGame;
  state: PlayerLifecycleState;
  onLaunch: (midlet: JarReview["midlets"][number]) => void;
}) {
  const { review } = game;
  const suiteFields = [
    ["Suite name", review.suiteName],
    ["Vendor", review.vendor],
    ["Version", review.version],
    ["Icon", review.icon],
    ["Profile", review.profile],
    ["Configuration", review.configuration],
  ] as const;

  return (
    <section className="jar-review" aria-labelledby="jar-review-heading">
      <h2 id="jar-review-heading">Game details</h2>
      <dl>
        {suiteFields.map(([label, value]) => value && (
          <div key={label}>
            <dt>{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
      <h3>MIDlets</h3>
      <ol>
        {review.midlets.map((midlet) => (
          <li key={midlet.index}>
            {game.iconUrls.get(midlet.index) && (
              <img
                src={game.iconUrls.get(midlet.index)}
                alt=""
                width="48"
                height="48"
              />
            )}
            <strong>{midlet.name}</strong>
            {midlet.icon && <> — {midlet.icon}</>}
            <span> — {midlet.className}</span>
            {review.midlets.length > 1 && (
              <button
                type="button"
                aria-label={`Launch ${midlet.name}`}
                disabled={state !== "ready"}
                onClick={() => onLaunch(midlet)}
              >
                Launch
              </button>
            )}
          </li>
        ))}
      </ol>
    </section>
  );
}

function createMidletIconUrls(
  bytes: Uint8Array,
  review: JarReview,
): Map<number, string> {
  const urls = new Map<number, string>();
  if (typeof URL.createObjectURL !== "function") return urls;

  for (const midlet of review.midlets) {
    const iconPath = midlet.icon ?? review.icon;
    if (!iconPath) continue;
    const iconBytes = readValidatedJarResource(bytes, iconPath);
    if (!iconBytes) continue;
    urls.set(
      midlet.index,
      URL.createObjectURL(
        new Blob([Uint8Array.from(iconBytes)], {
          type: iconMimeType(iconPath),
        }),
      ),
    );
  }
  return urls;
}

function releaseIconUrls(urls: Map<number, string> | undefined): void {
  if (typeof URL.revokeObjectURL !== "function") return;
  urls?.forEach((url) => URL.revokeObjectURL(url));
}

function iconMimeType(path: string): string {
  const extension = path.split(".").pop()?.toLowerCase();
  if (extension === "gif") return "image/gif";
  if (extension === "jpg" || extension === "jpeg") return "image/jpeg";
  return "image/png";
}

function resolutionValue(resolution: LogicalResolution): string {
  return `${resolution.width}x${resolution.height}`;
}

function supportedResolution(resolution: LogicalResolution): LogicalResolution {
  return RESOLUTION_PRESETS.find(
    (preset) =>
      preset.width === resolution.width && preset.height === resolution.height,
  ) ?? DEFAULT_RESOLUTION;
}

function isSmallerSameOrientation(
  candidate: LogicalResolution,
  current: LogicalResolution,
): boolean {
  return candidate.width <= current.width
    && candidate.height <= current.height
    && (
      candidate.width < current.width || candidate.height < current.height
    )
    && (candidate.width <= candidate.height)
      === (current.width <= current.height)
    && RESOLUTION_PRESETS.some(
      ({ width, height }) =>
        width === candidate.width && height === candidate.height,
    );
}

function displayGameName(game: CachedGame<JarReview>): string {
  return game.metadata.suiteName ?? game.sourceFileName;
}

function midletSelection(
  midlet: JarReview["midlets"][number],
): MidletSelection {
  return {
    name: midlet.name,
    className: midlet.className,
    ...(midlet.icon ? { iconPath: midlet.icon } : {}),
  };
}

function failureStageLabel(stage: string): string {
  switch (stage) {
    case "runtime-loading":
      return "Runtime loading failed";
    case "midlet-discovery":
      return "MIDlet discovery failed";
    case "execution":
      return "MIDlet execution failed";
    default:
      return "Launch failed";
  }
}

function omitKey(
  source: Record<string, string>,
  key: string,
): Record<string, string> {
  const { [key]: _removed, ...rest } = source;
  return rest;
}

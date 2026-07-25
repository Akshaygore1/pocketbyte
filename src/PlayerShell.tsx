import { useEffect, useRef, useState } from "react";

import {
  CheerpJFrameRuntimeAdapter,
  type LogicalResolution,
  type MidletLaunch,
  type PlayerLifecycleState,
  type RuntimeLifecycleEvent,
} from "./runtime/runtimeAdapter";
import { readValidatedJarResource } from "./jar/validateJar";
import {
  createGameStorage,
  type CachedGame,
  type GameStorage,
} from "./storage/gameStorage";
import { validateJar, type JarReview } from "./validation/validateJar";
import "./PlayerShell.css";

const fixture = { id: "smoke-fixture", name: "Redistributable audio fixture" };
const RESOLUTION_PRESETS = [
  { width: 128, height: 160 },
  { width: 176, height: 208 },
  { width: 240, height: 320 },
  { width: 320, height: 240 },
  { width: 360, height: 640 },
  { width: 480, height: 800 },
] as const satisfies readonly LogicalResolution[];
const DEFAULT_RESOLUTION: LogicalResolution = RESOLUTION_PRESETS[5];

interface PlayerView {
  state: PlayerLifecycleState;
  frameLabel: string;
  runtimeError: string | null;
}

interface SelectedGame {
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

type OpenTool = "upload" | "saved" | "resolution" | "details" | null;

function initialAudioView(muted: boolean): AudioView {
  return {
    status: "uninitialized",
    muted,
    notice: null,
  };
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
    case "diagnostics":
    case "teardown":
      return current;
  }
}

export function PlayerShell() {
  const frameContainer = useRef<HTMLDivElement>(null);
  const phone = useRef<HTMLDivElement>(null);
  const adapter = useRef<CheerpJFrameRuntimeAdapter | null>(null);
  const storage = useRef<GameStorage | null>(null);
  const pressedKeys = useRef(new Set<string>());
  const validationAttempt = useRef(0);
  const resumeInProgress = useRef(false);
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
  const [audio, setAudio] = useState<AudioView>(() => initialAudioView(false));
  const [openTool, setOpenTool] = useState<OpenTool>("upload");

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
    const runtime = new CheerpJFrameRuntimeAdapter();
    adapter.current = runtime;
    const unsubscribe = runtime.subscribe((event) => {
      if (event.type === "runtime-ready") setRuntimeAvailable(true);
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

  async function inspectSelectedJar(file: File | undefined): Promise<void> {
    if (!file) return;

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

    let existing: CachedGame<JarReview> | null = null;
    try {
      existing = await storage.current?.getGame<JarReview>(result.sha256) ?? null;
    } catch {
      // A storage read failure is surfaced when caching is attempted at launch.
    }
    if (validationAttempt.current !== attempt) return;

    const game = {
      identity: result.sha256,
      sourceFileName: file.name,
      bytes,
      review: result.metadata,
      iconUrls: createMidletIconUrls(bytes, result.metadata),
      muted: existing?.settings.muted ?? false,
    };
    const selectedResolution = existing
      ? supportedResolution(existing.settings.resolution)
      : DEFAULT_RESOLUTION;
    setResolution(selectedResolution);
    setSelectedGame(game);
    setAudio(initialAudioView(game.muted));

    try {
      const cached = await storage.current!.cacheGame({
        sourceFileName: game.sourceFileName,
        jarBytes: game.bytes,
        metadata: game.review,
        ...(existing?.selectedMidlet
          ? { selectedMidlet: existing.selectedMidlet }
          : {}),
        settings: {
          muted: game.muted,
          resolution: selectedResolution,
        },
      });
      if (validationAttempt.current !== attempt) return;
      setLastGame(cached);
    } catch {
      setValidationError(
        "This game could not be remembered locally. You can still review it and try again.",
      );
    }
    setPlayer((current) => ({
      ...current,
      state: "ready",
      runtimeError: null,
    }));

  }

  async function launchMidlet(
    game: SelectedGame,
    midlet: JarReview["midlets"][number],
    launchResolution: LogicalResolution = resolution,
  ): Promise<void> {
    setValidationError(null);
    let cached: CachedGame<JarReview>;
    try {
      cached = await storage.current!.cacheGame({
        sourceFileName: game.sourceFileName,
        jarBytes: game.bytes,
        metadata: game.review,
        selectedMidlet: {
          name: midlet.name,
          className: midlet.className,
          ...(midlet.icon ? { iconPath: midlet.icon } : {}),
        },
        settings: {
          muted: game.muted,
          resolution: launchResolution,
        },
      });
    } catch {
      setValidationError(
        "This game could not be saved locally. Check browser storage and try again.",
      );
      return;
    }

    setLastGame(cached);
    const launch: MidletLaunch = {
      identity: game.identity,
      name: midlet.name,
      className: midlet.className,
      jarBytes: game.bytes,
      resolution: launchResolution,
      muted: game.muted,
    };
    await adapter.current?.launchMidlet(launch);
    setOpenTool(null);
  }

  async function resumeLastGame(): Promise<void> {
    if (!lastGame || lastGameBusy) return;

    setLastGameBusy(true);
    resumeInProgress.current = true;
    const restoredResolution = supportedResolution(lastGame.settings.resolution);
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
      await launchMidlet(restored, midlet, restoredResolution);
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
    if (lastGame?.identity === selectedGame.identity) {
      void storage.current
        ?.updateGameSettings<JarReview>(selectedGame.identity, {
          muted: selectedGame.muted,
          resolution: selected,
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
      void adapter.current?.restart(selected);
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

  function sendKey(code: string, pressed: boolean): boolean {
    if (pressed) {
      if (pressedKeys.current.has(code)) return true;
      if (!adapter.current?.input(code, true)) return false;
      pressedKeys.current.add(code);
    } else {
      if (!pressedKeys.current.delete(code)) return false;
      adapter.current?.input(code, false);
    }
    return true;
  }

  function releasePressedKeys(): void {
    pressedKeys.current.forEach((code) => adapter.current?.input(code, false));
    pressedKeys.current.clear();
  }

  function toggleTool(tool: Exclude<OpenTool, null>): void {
    setOpenTool((current) => current === tool ? null : tool);
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

  const gameStage = (
    <section className="phone-stage" aria-label="Emulator display">
      <div
        ref={phone}
        className="phone"
        role="application"
        aria-label="Java ME game display. Focus to use keyboard controls."
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
        onBlur={releasePressedKeys}
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
          {audio.notice ?? "Focus display · Q/W soft keys · Arrows move · Enter select"}
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
    <main className={`player-shell${openTool ? " tool-is-open" : ""}`}>
      {gameStage}
      <nav className="tool-rail" aria-label="Player tools">
        <div className="device-mark" aria-label="J2ME local player">
          <span>J2ME</span>
          <small>Local player</small>
        </div>
        <div className="tool-buttons">
          <ToolButton
            icon="cartridge"
            label="Load game"
            active={openTool === "upload"}
            onClick={() => toggleTool("upload")}
          />
          <ToolButton
            icon="save"
            label="Saved game"
            active={openTool === "saved"}
            indicator={Boolean(lastGame)}
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
            icon="resolution"
            label="Display size"
            active={openTool === "resolution"}
            disabled={!selectedGame}
            onClick={() => toggleTool("resolution")}
          />
          <ToolButton
            icon="info"
            label="Game details"
            active={openTool === "details"}
            disabled={!selectedGame}
            onClick={() => toggleTool("details")}
          />
        </div>
      </nav>

      {openTool && (
        <aside className="tool-panel" aria-label={`${openTool} panel`}>
          <div className="panel-heading">
            <div>
              <p className="section-kicker">Cartridge bay</p>
              <h2>{toolTitle(openTool)}</h2>
            </div>
            <button
              className="panel-close"
              type="button"
              aria-label="Close tool panel"
              onClick={() => setOpenTool(null)}
            >
              <Icon name="close" />
            </button>
          </div>

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
                  setOpenTool(null);
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

          {openTool === "resolution" && selectedGame && (
            <ResolutionControl
              resolution={resolution}
              disabled={["loading-runtime", "launching", "restarting"].includes(player.state)}
              onChange={changeResolution}
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
        </aside>
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
  | "info"
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
      {name === "resolution" && <>
        <rect {...common} x="3.5" y="5" width="17" height="14" />
        <path {...common} d="M7 9V7h2M15 7h2v2M17 15v2h-2M9 17H7v-2" />
      </>}
      {name === "info" && <>
        <circle {...common} cx="12" cy="12" r="8.5" />
        <path {...common} d="M12 10.5V17M12 7v.5" />
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
  info: "INFO",
  muted: "AUDIO",
  resolution: "SIZE",
  save: "SAVE",
};

function toolTitle(tool: Exclude<OpenTool, null>): string {
  if (tool === "upload") return "Load game";
  if (tool === "saved") return "Saved game";
  if (tool === "resolution") return "Display size";
  return "Game details";
}

function ResolutionControl({
  resolution,
  disabled,
  onChange,
}: {
  resolution: LogicalResolution;
  disabled: boolean;
  onChange: (value: string) => void;
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

function displayGameName(game: CachedGame<JarReview>): string {
  return game.metadata.suiteName ?? game.sourceFileName;
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

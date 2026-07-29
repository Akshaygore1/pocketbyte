export type PlayerLifecycleState =
  | "empty"
  | "validating"
  | "ready"
  | "loading-runtime"
  | "launching"
  | "running"
  | "restarting"
  | "failed";

export interface FixtureLaunch {
  id: string;
  name: string;
}

const RUNTIME_FAILURE_STAGES = [
  "runtime-preparation",
  "runtime-loader",
  "cheerpj-initialization",
  "runtime-library-loading",
  "runtime-loading",
  "midlet-discovery",
  "launching",
  "execution",
  "game-data-operation",
] as const;

export type RuntimeFailureStage = typeof RUNTIME_FAILURE_STAGES[number];

const RUNTIME_FAILURE_STAGE_SET: ReadonlySet<string> = new Set(
  RUNTIME_FAILURE_STAGES,
);

export type RuntimeLifecycleEvent =
  | { type: "runtime-ready" }
  | { type: "runtime-loading"; fixtureName: string }
  | { type: "launching"; fixtureName: string }
  | { type: "running"; fixtureName: string }
  | { type: "restarting"; fixtureName: string }
  | { type: "audio-initializing" }
  | { type: "audio-ready"; muted: boolean }
  | { type: "media-warning"; message: string }
  | {
      type: "runtime-resolution-suggested";
      identity: string;
      resolution: LogicalResolution;
    }
  | { type: "failed"; stage: RuntimeFailureStage; message: string }
  | { type: "diagnostics"; message: string }
  | { type: "teardown" };

export interface RuntimeFrameFactory {
  create(): HTMLIFrameElement;
}

export interface MidletLaunch {
  identity: string;
  name: string;
  className: string;
  jarBytes: Uint8Array;
  resolution: LogicalResolution;
  rotation: GameRotation;
  automaticSizing: boolean;
  supportedResolutions: readonly LogicalResolution[];
  muted: boolean;
}

export type GameRotation = "none" | "counterclockwise";

export interface LogicalResolution {
  width: number;
  height: number;
}

export interface RuntimeAdapter {
  readonly session: string | null;
  mount(container: HTMLElement): void;
  launch(fixture: FixtureLaunch): Promise<void>;
  launchMidlet(midlet: MidletLaunch): Promise<void>;
  clearGameData(identity: string): Promise<void>;
  removeGameData(identity: string): Promise<void>;
  initializeAudio(): Promise<void>;
  setMuted(muted: boolean): void;
  focus(): void;
  input(code: string, pressed: boolean): boolean;
  restart(
    display?: Pick<MidletLaunch, "resolution" | "rotation">
      & Partial<Pick<MidletLaunch, "automaticSizing">>,
  ): Promise<void>;
  reset(): void;
  diagnostics(): void;
  destroy(): void;
  subscribe(listener: (event: RuntimeLifecycleEvent) => void): () => void;
}

const PHYSICAL_KEY_MAP = new Map<string, string>([
  ["ArrowUp", "ArrowUp"],
  ["ArrowDown", "ArrowDown"],
  ["ArrowLeft", "ArrowLeft"],
  ["ArrowRight", "ArrowRight"],
  ["KeyW", "ArrowUp"],
  ["KeyS", "ArrowDown"],
  ["KeyA", "ArrowLeft"],
  ["KeyD", "ArrowRight"],
  ["Enter", "Enter"],
  ["Space", "Enter"],
  ["Escape", "Escape"],
  ["KeyQ", "F1"],
  ["KeyE", "F2"],
  ["KeyZ", "NumpadMultiply"],
  ["KeyX", "NumpadDivide"],
  ["KeyR", "NumpadDivide"],
  ["F1", "F1"],
  ["F2", "F2"],
  ["NumpadMultiply", "NumpadMultiply"],
  ["NumpadDivide", "NumpadDivide"],
  ["Digit0", "Digit0"],
  ["Digit1", "Digit1"],
  ["Digit2", "Digit2"],
  ["Digit3", "Digit3"],
  ["Digit4", "Digit4"],
  ["Digit5", "Digit5"],
  ["Digit6", "Digit6"],
  ["Digit7", "Digit7"],
  ["Digit8", "Digit8"],
  ["Digit9", "Digit9"],
]);
const CANONICAL_KEY_CODES = new Set(PHYSICAL_KEY_MAP.values());

export function translatePhysicalKey(code: string): string | null {
  return PHYSICAL_KEY_MAP.get(code) ?? null;
}

const SHELL_SOURCE = "handset-shell";
const FRAME_SOURCE = "freej2me-runtime-frame";

type FrameCommandDetails =
  | { type: "initialize" }
  | { type: "launch"; fixture: FixtureLaunch }
  | { type: "launch-midlet"; midlet: MidletLaunch }
  | {
      type: "manage-game-data";
      action: "clear" | "remove";
      identity: string;
      requestId: string;
    }
  | { type: "focus" }
  | { type: "input"; code: string; pressed: boolean }
  | { type: "restart" }
  | { type: "diagnostics" }
  | { type: "teardown" };

type FrameCommand = FrameCommandDetails & {
  source: typeof SHELL_SOURCE;
  session: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function stringField(value: Record<string, unknown>, field: string): string | null {
  return typeof value[field] === "string" ? value[field] : null;
}

function isRuntimeFailureStage(value: string): value is RuntimeFailureStage {
  return RUNTIME_FAILURE_STAGE_SET.has(value);
}

function parseFrameEvent(value: unknown): RuntimeLifecycleEvent | null {
  if (!isRecord(value) || value.source !== FRAME_SOURCE || typeof value.type !== "string") {
    return null;
  }

  switch (value.type) {
    case "runtime-ready":
      return { type: "runtime-ready" };
    case "launching":
    case "running":
    case "restarting": {
      const fixtureName = stringField(value, "fixtureName");
      return fixtureName ? { type: value.type, fixtureName } : null;
    }
    case "runtime-loading": {
      const fixtureName = stringField(value, "fixtureName");
      return fixtureName ? { type: "runtime-loading", fixtureName } : null;
    }
    case "media-warning": {
      const message = stringField(value, "message");
      return message ? { type: "media-warning", message } : null;
    }
    case "runtime-resolution-suggested": {
      const identity = stringField(value, "identity");
      const resolution = value.resolution;
      return identity
        && /^[a-f0-9]{64}$/.test(identity)
        && isRecord(resolution)
        && typeof resolution.width === "number"
        && typeof resolution.height === "number"
        && Number.isInteger(resolution.width)
        && Number.isInteger(resolution.height)
        && Number(resolution.width) > 0
        && Number(resolution.height) > 0
        ? {
            type: "runtime-resolution-suggested",
            identity,
            resolution: {
              width: Number(resolution.width),
              height: Number(resolution.height),
            },
          }
        : null;
    }
    case "failed": {
      const stage = stringField(value, "stage");
      const message = stringField(value, "message");
      return stage && isRuntimeFailureStage(stage) && message
        ? { type: "failed", stage, message }
        : null;
    }
    case "diagnostics": {
      const message = stringField(value, "message");
      return message ? { type: "diagnostics", message } : null;
    }
    default:
      return null;
  }
}

export class CheerpJFrameRuntimeAdapter implements RuntimeAdapter {
  #frame: HTMLIFrameElement | null = null;
  #container: HTMLElement | null = null;
  #session: string | null = null;
  #destroyed = false;
  #listeners = new Set<(event: RuntimeLifecycleEvent) => void>();
  #lastFixture: FixtureLaunch | null = null;
  #lastMidlet: MidletLaunch | null = null;
  #restartPending = false;
  #pendingGameDataOperations = new Map<
    string,
    { resolve: () => void; reject: (error: Error) => void }
  >();
  readonly #frameFactory: RuntimeFrameFactory;
  readonly #onMessage = (message: MessageEvent) => this.receive(message);

  constructor(frameFactory: RuntimeFrameFactory = defaultFrameFactory) {
    this.#frameFactory = frameFactory;
  }

  get session(): string | null {
    return this.#session;
  }

  mount(container: HTMLElement): void {
    if (this.#frame || this.#destroyed) {
      throw new Error("A runtime adapter can only be mounted once");
    }

    this.#container = container;
    this.createFrame();
    window.addEventListener("message", this.#onMessage);
    this.emit({ type: "diagnostics", message: "Runtime frame mounted" });
  }

  private createFrame(): void {
    if (!this.#container || this.#destroyed) return;

    this.#session = crypto.randomUUID();
    const frame = this.#frameFactory.create();
    frame.title = "PocketByte game runtime";
    frame.setAttribute("data-runtime-frame", "");
    frame.addEventListener("load", () => this.command({ type: "initialize" }), {
      once: true,
    });
    this.#frame = frame;
    this.#container.append(frame);
  }

  async launch(fixture: FixtureLaunch): Promise<void> {
    this.#lastFixture = fixture;
    this.#lastMidlet = null;
    this.emit({ type: "launching", fixtureName: fixture.name });
    this.command({ type: "launch", fixture });
  }

  async launchMidlet(midlet: MidletLaunch): Promise<void> {
    this.#lastFixture = null;
    this.#lastMidlet = midlet;
    this.emit({ type: "runtime-loading", fixtureName: midlet.name });
    this.command({ type: "launch-midlet", midlet });
  }

  clearGameData(identity: string): Promise<void> {
    return this.manageGameData("clear", identity);
  }

  removeGameData(identity: string): Promise<void> {
    return this.manageGameData("remove", identity);
  }

  async initializeAudio(): Promise<void> {
    const controls = this.audioControls();
    if (!controls) {
      throw new Error("Audio is still loading. Try again in a moment.");
    }

    this.emit({ type: "audio-initializing" });
    const result = await controls.initialize();
    this.emit({ type: "audio-ready", muted: result.muted });
  }

  setMuted(muted: boolean): void {
    if (this.#lastMidlet) {
      this.#lastMidlet = { ...this.#lastMidlet, muted };
    }
    this.audioControls()?.setMuted(muted);
    this.emit({ type: "audio-ready", muted });
  }

  focus(): void {
    this.command({ type: "focus" });
  }

  input(code: string, pressed: boolean): boolean {
    const translatedCode = translatePhysicalKey(code);
    if (!translatedCode) return false;
    return this.inputCanonical(translatedCode, pressed);
  }

  inputCanonical(code: string, pressed: boolean): boolean {
    if (!CANONICAL_KEY_CODES.has(code)) return false;
    this.command({ type: "input", code, pressed });
    return true;
  }

  async restart(
    display?: Pick<MidletLaunch, "resolution" | "rotation">
      & Partial<Pick<MidletLaunch, "automaticSizing">>,
  ): Promise<void> {
    const launchName = this.#lastMidlet?.name ?? this.#lastFixture?.name;
    if (!launchName) return;

    if (this.#lastMidlet && display) {
      this.#lastMidlet = { ...this.#lastMidlet, ...display };
    }

    this.emit({ type: "restarting", fixtureName: launchName });
    this.#restartPending = true;
    this.removeFrame();
    this.createFrame();
  }

  reset(): void {
    this.#lastFixture = null;
    this.#lastMidlet = null;
    this.#restartPending = false;
    this.removeFrame();
    this.createFrame();
    this.emit({ type: "teardown" });
  }

  diagnostics(): void {
    this.command({ type: "diagnostics" });
  }

  destroy(): void {
    if (this.#destroyed) return;
    this.rejectPendingGameDataOperations(
      new Error("The runtime was closed before game data could be changed."),
    );
    this.removeFrame();
    this.#destroyed = true;
    window.removeEventListener("message", this.#onMessage);
    this.#container = null;
    this.#restartPending = false;
    this.emit({ type: "teardown" });
  }

  subscribe(listener: (event: RuntimeLifecycleEvent) => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  private receive(message: MessageEvent): void {
    if (
      this.#destroyed ||
      !this.#frame ||
      message.source !== this.#frame.contentWindow ||
      !isRecord(message.data) ||
      message.data.session !== this.#session
    ) {
      return;
    }

    if (
      message.data.type === "game-data-operation-complete"
      && typeof message.data.requestId === "string"
    ) {
      const pending = this.#pendingGameDataOperations.get(
        message.data.requestId,
      );
      if (pending) {
        this.#pendingGameDataOperations.delete(message.data.requestId);
        pending.resolve();
      }
      return;
    }

    if (
      message.data.type === "game-data-operation-failed"
      && typeof message.data.requestId === "string"
    ) {
      const pending = this.#pendingGameDataOperations.get(
        message.data.requestId,
      );
      if (pending) {
        this.#pendingGameDataOperations.delete(message.data.requestId);
        pending.reject(
          new Error(
            typeof message.data.message === "string"
              ? message.data.message
              : "The runtime could not change this game's data.",
          ),
        );
      }
      return;
    }

    const event = parseFrameEvent(message.data);
    if (!event) return;

    if (event.type === "runtime-resolution-suggested") {
      const current = this.#lastMidlet;
      const candidateIsSupported = current?.supportedResolutions.some(
        ({ width, height }) =>
          width === event.resolution.width && height === event.resolution.height,
      );
      const sameOrientation = current
        && (current.resolution.width <= current.resolution.height)
          === (event.resolution.width <= event.resolution.height);
      if (
        !current?.automaticSizing
        || current.rotation !== "none"
        || event.identity !== current.identity
        || !candidateIsSupported
        || !sameOrientation
        || event.resolution.width > current.resolution.width
        || event.resolution.height > current.resolution.height
        || (
          event.resolution.width === current.resolution.width
          && event.resolution.height === current.resolution.height
        )
      ) {
        return;
      }
    }

    this.emit(event);
    if (event.type === "runtime-ready" && this.#restartPending) {
      this.#restartPending = false;
      if (this.#lastMidlet) {
        this.command({ type: "launch-midlet", midlet: this.#lastMidlet });
      } else if (this.#lastFixture) {
        this.command({ type: "launch", fixture: this.#lastFixture });
      }
    }
  }

  private command(command: FrameCommandDetails): void {
    if (this.#destroyed || !this.#frame?.contentWindow || !this.#session) return;
    this.#frame.contentWindow.postMessage(
      { ...command, source: SHELL_SOURCE, session: this.#session } as FrameCommand,
      window.location.origin,
    );
  }

  private audioControls(): RuntimeFrameAudioControls | null {
    if (this.#destroyed || !this.#frame?.contentWindow) return null;
    return (
      this.#frame.contentWindow as Window & {
        handsetAudio?: RuntimeFrameAudioControls;
      }
    ).handsetAudio ?? null;
  }

  private manageGameData(
    action: "clear" | "remove",
    identity: string,
  ): Promise<void> {
    if (this.#destroyed || !this.#frame?.contentWindow || !this.#session) {
      return Promise.reject(new Error("The runtime is not available."));
    }

    this.#lastFixture = null;
    this.#lastMidlet = null;
    this.#restartPending = false;
    const requestId = crypto.randomUUID();

    return new Promise((resolve, reject) => {
      this.#pendingGameDataOperations.set(requestId, { resolve, reject });
      this.command({
        type: "manage-game-data",
        action,
        identity,
        requestId,
      });
    });
  }

  private rejectPendingGameDataOperations(error: Error): void {
    this.#pendingGameDataOperations.forEach(({ reject }) => reject(error));
    this.#pendingGameDataOperations.clear();
  }

  private removeFrame(): void {
    this.command({ type: "teardown" });
    this.#frame?.remove();
    this.#frame = null;
  }

  private emit(event: RuntimeLifecycleEvent): void {
    this.#listeners.forEach((listener) => listener(event));
  }
}

const defaultFrameFactory: RuntimeFrameFactory = {
  create() {
    const frame = document.createElement("iframe");
    frame.src = "/runtime-frame.html";
    return frame;
  },
};

interface RuntimeFrameAudioControls {
  initialize(): Promise<{ muted: boolean }>;
  setMuted(muted: boolean): void;
}

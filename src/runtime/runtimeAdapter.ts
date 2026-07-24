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

export type RuntimeLifecycleEvent =
  | { type: "runtime-ready" }
  | { type: "runtime-loading"; fixtureName: string }
  | { type: "launching"; fixtureName: string }
  | { type: "running"; fixtureName: string }
  | { type: "restarting"; fixtureName: string }
  | { type: "failed"; stage: string; message: string }
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
}

export interface LogicalResolution {
  width: number;
  height: number;
}

export interface RuntimeAdapter {
  readonly session: string | null;
  mount(container: HTMLElement): void;
  launch(fixture: FixtureLaunch): Promise<void>;
  launchMidlet(midlet: MidletLaunch): Promise<void>;
  focus(): void;
  input(code: string, pressed: boolean): boolean;
  restart(resolution?: LogicalResolution): Promise<void>;
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
  ["Enter", "Enter"],
  ["KeyQ", "KeyQ"],
  ["KeyW", "KeyW"],
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
  ["KeyE", "KeyE"],
  ["KeyR", "KeyR"],
]);

export function translatePhysicalKey(code: string): string | null {
  return PHYSICAL_KEY_MAP.get(code) ?? null;
}

const SHELL_SOURCE = "handset-shell";
const FRAME_SOURCE = "freej2me-runtime-frame";

type FrameCommandDetails =
  | { type: "initialize" }
  | { type: "launch"; fixture: FixtureLaunch }
  | { type: "launch-midlet"; midlet: MidletLaunch }
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
    case "failed": {
      const stage = stringField(value, "stage");
      const message = stringField(value, "message");
      return stage && message ? { type: "failed", stage, message } : null;
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
    frame.title = "Java ME runtime";
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

  focus(): void {
    this.command({ type: "focus" });
  }

  input(code: string, pressed: boolean): boolean {
    const translatedCode = translatePhysicalKey(code);
    if (!translatedCode) return false;
    this.command({ type: "input", code: translatedCode, pressed });
    return true;
  }

  async restart(resolution?: LogicalResolution): Promise<void> {
    const launchName = this.#lastMidlet?.name ?? this.#lastFixture?.name;
    if (!launchName) return;

    if (this.#lastMidlet && resolution) {
      this.#lastMidlet = { ...this.#lastMidlet, resolution };
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

    const event = parseFrameEvent(message.data);
    if (!event) return;

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

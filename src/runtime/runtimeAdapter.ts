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
}

export interface RuntimeAdapter {
  readonly session: string | null;
  mount(container: HTMLElement): void;
  launch(fixture: FixtureLaunch): Promise<void>;
  launchMidlet(midlet: MidletLaunch): Promise<void>;
  focus(): void;
  input(code: string, pressed: boolean): void;
  restart(): Promise<void>;
  diagnostics(): void;
  destroy(): void;
  subscribe(listener: (event: RuntimeLifecycleEvent) => void): () => void;
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
  #session: string | null = null;
  #destroyed = false;
  #listeners = new Set<(event: RuntimeLifecycleEvent) => void>();
  #lastFixture: FixtureLaunch | null = null;
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

    this.#session = crypto.randomUUID();
    const frame = this.#frameFactory.create();
    frame.title = "Java ME runtime";
    frame.setAttribute("data-runtime-frame", "");
    frame.addEventListener("load", () => this.command({ type: "initialize" }), {
      once: true,
    });
    this.#frame = frame;
    window.addEventListener("message", this.#onMessage);
    container.append(frame);
    this.emit({ type: "diagnostics", message: "Runtime frame mounted" });
  }

  async launch(fixture: FixtureLaunch): Promise<void> {
    this.#lastFixture = fixture;
    this.emit({ type: "launching", fixtureName: fixture.name });
    this.command({ type: "launch", fixture });
  }

  async launchMidlet(midlet: MidletLaunch): Promise<void> {
    this.#lastFixture = { id: midlet.identity, name: midlet.name };
    this.emit({ type: "runtime-loading", fixtureName: midlet.name });
    this.command({ type: "launch-midlet", midlet });
  }

  focus(): void {
    this.command({ type: "focus" });
  }

  input(code: string, pressed: boolean): void {
    this.command({ type: "input", code, pressed });
  }

  async restart(): Promise<void> {
    if (!this.#lastFixture) return;
    this.emit({ type: "restarting", fixtureName: this.#lastFixture.name });
    this.command({ type: "restart" });
  }

  diagnostics(): void {
    this.command({ type: "diagnostics" });
  }

  destroy(): void {
    if (this.#destroyed) return;
    this.command({ type: "teardown" });
    this.#destroyed = true;
    window.removeEventListener("message", this.#onMessage);
    this.#frame?.remove();
    this.#frame = null;
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
    if (event) this.emit(event);
  }

  private command(command: FrameCommandDetails): void {
    if (this.#destroyed || !this.#frame?.contentWindow || !this.#session) return;
    this.#frame.contentWindow.postMessage(
      { ...command, source: SHELL_SOURCE, session: this.#session } as FrameCommand,
      window.location.origin,
    );
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

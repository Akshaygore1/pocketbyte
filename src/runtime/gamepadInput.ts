export interface GamepadInputEvent {
  source: string;
  code: string;
  pressed: boolean;
}

const STICK_DEAD_ZONE = 0.5;

const BUTTON_CONTROLS = [
  ["action", 0, "Enter"],
  ["left-soft", 4, "F1"],
  ["right-soft", 5, "F2"],
  ["menu", 9, "Escape"],
] as const;

export function observeGamepadInput(
  onInput: (event: GamepadInputEvent) => void,
): () => void {
  if (typeof navigator.getGamepads !== "function") return () => {};

  let animationFrame = 0;
  let previousControls = new Map<string, string>();

  const emitChanges = (nextControls: Map<string, string>) => {
    previousControls.forEach((code, source) => {
      if (nextControls.get(source) !== code) {
        onInput({ source, code, pressed: false });
      }
    });
    nextControls.forEach((code, source) => {
      if (previousControls.get(source) !== code) {
        onInput({ source, code, pressed: true });
      }
    });
    previousControls = nextControls;
  };

  const poll = () => {
    const nextControls = new Map<string, string>();

    for (const gamepad of navigator.getGamepads()) {
      if (!gamepad?.connected) continue;

      const prefix = `gamepad-${gamepad.index}`;
      const horizontal = gamepad.axes[0] ?? 0;
      const vertical = gamepad.axes[1] ?? 0;
      const directions = [
        ["up", "ArrowUp", gamepad.buttons[12]?.pressed || vertical < -STICK_DEAD_ZONE],
        ["down", "ArrowDown", gamepad.buttons[13]?.pressed || vertical > STICK_DEAD_ZONE],
        ["left", "ArrowLeft", gamepad.buttons[14]?.pressed || horizontal < -STICK_DEAD_ZONE],
        ["right", "ArrowRight", gamepad.buttons[15]?.pressed || horizontal > STICK_DEAD_ZONE],
      ] as const;

      directions.forEach(([name, code, pressed]) => {
        if (pressed) nextControls.set(`${prefix}-${name}`, code);
      });
      BUTTON_CONTROLS.forEach(([name, button, code]) => {
        if (gamepad.buttons[button]?.pressed) {
          nextControls.set(`${prefix}-${name}`, code);
        }
      });
    }

    emitChanges(nextControls);
    animationFrame = window.requestAnimationFrame(poll);
  };

  animationFrame = window.requestAnimationFrame(poll);

  return () => {
    window.cancelAnimationFrame(animationFrame);
    emitChanges(new Map());
  };
}

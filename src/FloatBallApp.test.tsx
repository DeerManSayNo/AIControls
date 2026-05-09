import { act } from "react";
import { createRoot } from "react-dom/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

const eventApiMock = vi.hoisted(() => {
  type FloatBallHoverPayload =
    | boolean
    | {
        inside: boolean;
        x: number;
        y: number;
      };
  const listeners = new Map<
    string,
    (event: { payload: FloatBallHoverPayload }) => void
  >();
  return {
    listeners,
    listen: vi.fn(
      (
        event: string,
        handler: (event: { payload: FloatBallHoverPayload }) => void,
      ): Promise<() => void> => {
        listeners.set(event, handler);
        return Promise.resolve(() => {
          listeners.delete(event);
        });
      },
    ),
  };
});

const openProjectPath = vi.fn(() => Promise.resolve());

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("@tauri-apps/api/dpi", () => ({
  PhysicalPosition: class PhysicalPosition {
    constructor(
      public x: number,
      public y: number,
    ) {}
  },
  PhysicalSize: class PhysicalSize {
    constructor(
      public width: number,
      public height: number,
    ) {}
  },
}));

vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({
    startDragging: () => Promise.resolve(),
  }),
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: eventApiMock.listen,
}));

vi.mock("./api/openProject", () => ({
  openProjectPath,
}));

describe("FloatBallApp", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    eventApiMock.listeners.clear();
    localStorage.clear();
    localStorage.setItem(
      "aicontrols:projectPaths",
      JSON.stringify([
        "/tmp/ProjectOne",
        "/tmp/ProjectTwo",
        "/tmp/ProjectThree",
        "/tmp/ProjectFour",
        "/tmp/ProjectFive",
        "/tmp/ProjectSix",
      ]),
    );
  });

  it("expands to five project shortcuts and opens a shortcut once", async () => {
    const { default: FloatBallApp } = await import("./FloatBallApp");
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);

    await act(async () => {
      root.render(<FloatBallApp />);
    });

    const shell = host.querySelector(".float-ball-shell") as HTMLElement;
    expect(host.querySelectorAll(".float-ball-project")).toHaveLength(5);

    await Promise.resolve();

    await act(async () => {
      eventApiMock.listeners.get("float-ball-hover-state")?.({
        payload: { inside: true, x: 112, y: 263 },
      });
    });

    await Promise.resolve();
    expect(shell.classList.contains("float-ball-shell--expanded")).toBe(true);
    expect(shell.classList.contains("float-ball-shell--hovering")).toBe(true);
    expect(
      host.querySelector(".float-ball")?.classList.contains("float-ball--hovering"),
    ).toBe(true);

    await act(async () => {
      eventApiMock.listeners.get("float-ball-hover-state")?.({
        payload: { inside: true, x: 112, y: 213 },
      });
    });

    const projects = host.querySelectorAll(".float-ball-project");
    expect(projects[0]?.classList.contains("float-ball-project--hovering")).toBe(
      true,
    );
    expect(projects[1]?.classList.contains("float-ball-project--hovering")).toBe(
      false,
    );

    const firstProject = host.querySelector(".float-ball-project") as HTMLElement;
    await act(async () => {
      firstProject.dispatchEvent(new Event("pointerdown", { bubbles: true }));
      firstProject.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(openProjectPath).toHaveBeenCalledTimes(1);
    expect(openProjectPath).toHaveBeenCalledWith("/tmp/ProjectOne", {
      applicationPath: null,
      alertOnError: true,
    });
    expect(shell.classList.contains("float-ball-shell--expanded")).toBe(false);

    await act(async () => {
      shell.dispatchEvent(new MouseEvent("mouseout", { bubbles: true }));
    });
    expect(shell.classList.contains("float-ball-shell--expanded")).toBe(false);

    await act(async () => {
      eventApiMock.listeners.get("float-ball-hover-state")?.({
        payload: { inside: true, x: 112, y: 213 },
      });
    });
    expect(shell.classList.contains("float-ball-shell--expanded")).toBe(false);

    await act(async () => {
      eventApiMock.listeners.get("float-ball-hover-state")?.({
        payload: { inside: true, x: 112, y: 263 },
      });
    });
    expect(shell.classList.contains("float-ball-shell--expanded")).toBe(true);

    await act(async () => {
      eventApiMock.listeners.get("float-ball-hover-state")?.({
        payload: { inside: false, x: -1, y: -1 },
      });
    });
    await act(async () => {
      eventApiMock.listeners.get("float-ball-hover-state")?.({
        payload: { inside: true, x: 112, y: 263 },
      });
    });
    expect(shell.classList.contains("float-ball-shell--expanded")).toBe(true);

    await act(async () => {
      root.unmount();
    });
    host.remove();
  });
});

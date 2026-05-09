import type { CSSProperties, MouseEvent, PointerEvent } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { openProjectPath } from "./api/openProject";
import { getOpenAppForProject } from "./projectOpenAppStorage";
import { useProjectPaths } from "./projectPathsStorage";

const floatWindow = getCurrentWindow();
const FLOAT_BALL_HOVER_EVENT = "float-ball-hover-state";
const FLOAT_BALL_SHELL_WIDTH = 224;
const FLOAT_BALL_SHELL_HEIGHT = 286;
const FLOAT_BALL_SIZE = 34;
const FLOAT_BALL_PROJECT_GAP = 7;
const FLOAT_BALL_PROJECTS_BOTTOM = 56;
const FLOAT_BALL_MAIN_BOTTOM = 6;
const FLOAT_BALL_DRAG_THRESHOLD = 5;

type FloatBallHoverPayload =
  | boolean
  | {
      inside: boolean;
      x: number;
      y: number;
    };

type HoverTarget = "main" | `project-${number}` | null;

function folderBasename(path: string): string {
  return path.replace(/[/\\]+$/, "").split(/[/\\]/).pop() ?? "Project";
}

function projectInitial(name: string): string {
  return name.trim().slice(0, 1).toLocaleUpperCase() || "P";
}

function pointHitsBall(x: number, y: number, centerX: number, centerY: number) {
  const radius = FLOAT_BALL_SIZE / 2;
  return Math.hypot(x - centerX, y - centerY) <= radius;
}

function hoverTargetFromPayload(
  payload: FloatBallHoverPayload,
  projectCount: number,
): { hovering: boolean; target: HoverTarget } {
  if (typeof payload === "boolean") {
    return { hovering: payload, target: payload ? "main" : null };
  }

  if (!payload.inside) {
    return { hovering: false, target: null };
  }

  const centerX = FLOAT_BALL_SHELL_WIDTH / 2;
  const mainCenterY =
    FLOAT_BALL_SHELL_HEIGHT - FLOAT_BALL_MAIN_BOTTOM - FLOAT_BALL_SIZE / 2;
  if (pointHitsBall(payload.x, payload.y, centerX, mainCenterY)) {
    return { hovering: true, target: "main" };
  }

  const firstProjectCenterY =
    FLOAT_BALL_SHELL_HEIGHT -
    FLOAT_BALL_PROJECTS_BOTTOM -
    FLOAT_BALL_SIZE / 2;
  const projectStep = FLOAT_BALL_SIZE + FLOAT_BALL_PROJECT_GAP;
  for (let index = 0; index < projectCount; index += 1) {
    const centerY = firstProjectCenterY - index * projectStep;
    if (pointHitsBall(payload.x, payload.y, centerX, centerY)) {
      return { hovering: true, target: `project-${index}` };
    }
  }

  return { hovering: true, target: null };
}

export default function FloatBallApp() {
  const projectPaths = useProjectPaths();
  const projects = useMemo(() => projectPaths.slice(0, 5), [projectPaths]);
  const [expanded, setExpanded] = useState(false);
  const [hovering, setHovering] = useState(false);
  const [hoverTarget, setHoverTarget] = useState<HoverTarget>(null);
  const expandedRef = useRef(false);
  const collapseTimerRef = useRef<number | null>(null);
  const openingProjectRef = useRef(false);
  const suppressHoverExpansionRef = useRef(false);
  const dragStartRef = useRef<{
    pointerId: number;
    x: number;
    y: number;
  } | null>(null);
  const projectsCountRef = useRef(0);
  projectsCountRef.current = projects.length;

  const clearCollapseTimer = () => {
    if (collapseTimerRef.current !== null) {
      window.clearTimeout(collapseTimerRef.current);
      collapseTimerRef.current = null;
    }
  };

  const expandMenu = () => {
    clearCollapseTimer();
    if (expandedRef.current || projectsCountRef.current === 0) return;
    expandedRef.current = true;
    setExpanded(true);
  };

  const collapseMenu = () => {
    clearCollapseTimer();
    if (!expandedRef.current) return;
    expandedRef.current = false;
    setExpanded(false);
  };

  const scheduleCollapse = () => {
    clearCollapseTimer();
    collapseTimerRef.current = window.setTimeout(collapseMenu, 140);
  };

  const startDragging = () => {
    floatWindow.startDragging().catch(() => {
      // Dragging is a native-window affordance; ignore unsupported edge cases.
    });
  };

  const startPotentialDrag = (event: PointerEvent<HTMLButtonElement>) => {
    if (event.button !== 0) return;
    dragStartRef.current = {
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
    };
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      // Pointer capture can fail if the native window starts handling the drag.
    }
  };

  const maybeStartDragging = (event: PointerEvent<HTMLButtonElement>) => {
    const dragStart = dragStartRef.current;
    if (!dragStart || dragStart.pointerId !== event.pointerId) return;
    const distance = Math.hypot(
      event.clientX - dragStart.x,
      event.clientY - dragStart.y,
    );
    if (distance < FLOAT_BALL_DRAG_THRESHOLD) return;
    dragStartRef.current = null;
    startDragging();
  };

  const clearPotentialDrag = (event: PointerEvent<HTMLButtonElement>) => {
    if (dragStartRef.current?.pointerId === event.pointerId) {
      dragStartRef.current = null;
    }
    try {
      event.currentTarget.releasePointerCapture(event.pointerId);
    } catch {
      // It may already be released by the browser or native drag handling.
    }
  };

  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | null = null;

    void listen<FloatBallHoverPayload>(FLOAT_BALL_HOVER_EVENT, (event) => {
      if (disposed) return;
      const nextHover = hoverTargetFromPayload(
        event.payload,
        projectsCountRef.current,
      );
      if (!nextHover.hovering) {
        suppressHoverExpansionRef.current = false;
      }
      if (nextHover.hovering && suppressHoverExpansionRef.current) {
        if (nextHover.target === "main") {
          suppressHoverExpansionRef.current = false;
        } else {
          setHovering(false);
          setHoverTarget(null);
          return;
        }
      }
      setHovering(nextHover.hovering);
      setHoverTarget(nextHover.target);
      if (nextHover.hovering) {
        expandMenu();
      } else {
        scheduleCollapse();
      }
    })
      .then((nextUnlisten) => {
        if (disposed) {
          nextUnlisten();
          return;
        }
        unlisten = nextUnlisten;
      })
      .catch(() => {
        // DOM hover still works on platforms that deliver pointer events normally.
      });

    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);

  const openProject = (
    event: MouseEvent<HTMLButtonElement> | PointerEvent<HTMLButtonElement>,
    path: string,
  ) => {
    event.preventDefault();
    event.stopPropagation();
    if (openingProjectRef.current) return;
    openingProjectRef.current = true;
    const customApp = getOpenAppForProject(path);
    void openProjectPath(path, {
      applicationPath: customApp ?? null,
      alertOnError: true,
    }).finally(() => {
      window.setTimeout(() => {
        openingProjectRef.current = false;
      }, 600);
    });
    suppressHoverExpansionRef.current = true;
    setHovering(false);
    setHoverTarget(null);
    collapseMenu();
  };

  const handleEnter = () => {
    suppressHoverExpansionRef.current = false;
    setHovering(true);
    setHoverTarget("main");
    expandMenu();
  };

  const handleLeave = () => {
    setHovering(false);
    setHoverTarget(null);
    scheduleCollapse();
  };

  return (
    <div
      className={`float-ball-shell${expanded ? " float-ball-shell--expanded" : ""}${hovering ? " float-ball-shell--hovering" : ""}`}
      onPointerEnter={handleEnter}
      onMouseEnter={handleEnter}
      onMouseLeave={handleLeave}
    >
      <div className="float-ball-projects" aria-label="Project shortcuts">
        {projects.map((path, index) => {
          const name = folderBasename(path);
          return (
            <button
              key={path}
              type="button"
              className={`float-ball-project${hoverTarget === `project-${index}` ? " float-ball-project--hovering" : ""}`}
              style={{ "--float-project-index": index } as CSSProperties}
              title={`${name}\n${path}`}
              aria-label={`Open project ${name}`}
              onPointerEnter={() => setHoverTarget(`project-${index}`)}
              onMouseEnter={() => setHoverTarget(`project-${index}`)}
              onPointerDown={(event) => openProject(event, path)}
              onClick={(event) => openProject(event, path)}
            >
              <span className="float-ball-project__initial" aria-hidden>
                {projectInitial(name)}
              </span>
              <span className="float-ball-project__name">{name}</span>
            </button>
          );
        })}
      </div>

      <button
        type="button"
        className={`float-ball${hoverTarget === "main" ? " float-ball--hovering" : ""}`}
        aria-label="AIControls floating ball"
        aria-expanded={expanded}
        onPointerEnter={() => setHoverTarget("main")}
        onMouseEnter={() => setHoverTarget("main")}
        onPointerDown={startPotentialDrag}
        onPointerMove={maybeStartDragging}
        onPointerUp={clearPotentialDrag}
        onPointerCancel={clearPotentialDrag}
      >
        <span className="float-ball__core" aria-hidden />
        <span className="float-ball__logo" aria-hidden>
          <svg viewBox="0 0 32 32" role="presentation" focusable="false">
            <g transform="translate(0 -0.4)">
              <path
                d="M24.8 8.6 19.9 5.8 13.8 6.7 9.1 10.9 7 16.7 8.9 23 13.6 26.9 20.1 27.7 25.1 25 22.6 20.7 19.1 22.2 15.3 21.7 12.8 19.5 12 16.3 13.2 13.1 15.8 10.9 19.2 10.4 22.5 12 24.8 8.6Z"
                fill="currentColor"
              />
              <path
                d="M19.9 5.8 19.2 10.4 22.5 12 24.8 8.6 19.9 5.8Z"
                fill="rgba(255,255,255,0.28)"
              />
              <path
                d="M9.1 10.9 13.2 13.1 12 16.3 7 16.7 9.1 10.9Z"
                fill="rgba(255,255,255,0.22)"
              />
              <path
                d="M13.6 26.9 15.3 21.7 19.1 22.2 20.1 27.7 13.6 26.9Z"
                fill="rgba(0,0,0,0.18)"
              />
            </g>
          </svg>
        </span>
        <span className="float-ball__sheen" aria-hidden />
      </button>
    </div>
  );
}

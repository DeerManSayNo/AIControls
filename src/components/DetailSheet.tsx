import { createPortal } from "react-dom";
import type { ReactNode } from "react";

interface DetailSheetProps {
  open: boolean;
  title: ReactNode;
  description?: ReactNode;
  meta?: ReactNode;
  onClose: () => void;
  children: ReactNode;
}

export function DetailSheet({
  open,
  title,
  description,
  meta,
  onClose,
  children,
}: DetailSheetProps) {
  if (!open) return null;

  return createPortal(
    <div
      style={{
        position: "fixed",
        top: 0,
        right: 0,
        bottom: 0,
        left: "220px",
        zIndex: 40,
        display: "flex",
      }}
    >
      {/* 遮罩 */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          backgroundColor: "rgba(0,0,0,0.6)",
          backdropFilter: "blur(4px)",
        }}
        onClick={onClose}
      />

      {/* 面板 */}
      <div
        style={{
          position: "relative",
          display: "flex",
          flexDirection: "column",
          height: "100%",
          width: "100%",
          minHeight: 0,
          overflow: "hidden",
          borderLeft: "1px solid var(--border)",
          backgroundColor: "var(--bg)",
          boxShadow: "-8px 0 32px rgba(0,0,0,0.18)",
        }}
      >
        {/* 关闭按钮 */}
        <button
          onClick={onClose}
          style={{
            position: "absolute",
            top: 16,
            right: 20,
            zIndex: 10,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            width: 28,
            height: 28,
            borderRadius: 4,
            border: "none",
            background: "transparent",
            color: "var(--muted)",
            cursor: "pointer",
            fontSize: 16,
            lineHeight: 1,
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = "var(--nav-item-hover)";
            e.currentTarget.style.color = "var(--text)";
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = "transparent";
            e.currentTarget.style.color = "var(--muted)";
          }}
        >
          ✕
        </button>

        {/* 内容滚动区 */}
        <div
          style={{
            flex: 1,
            minHeight: 0,
            overflowY: "auto",
            padding: "24px 28px 28px",
          }}
        >
          <h2
            style={{
              margin: "0 0 12px",
              paddingRight: 40,
              fontSize: 28,
              fontWeight: 600,
              lineHeight: 1.2,
              letterSpacing: "-0.02em",
              color: "var(--text)",
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
          >
            {title}
          </h2>

          {description && (
            <div
              style={{
                fontSize: 15,
                lineHeight: 1.7,
                color: "var(--muted)",
              }}
            >
              {description}
            </div>
          )}

          {meta && <div style={{ marginTop: 16 }}>{meta}</div>}

          <div style={{ marginTop: 20 }}>{children}</div>
        </div>
      </div>
    </div>,
    document.body,
  );
}

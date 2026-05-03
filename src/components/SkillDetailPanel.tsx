import { useEffect, useRef, useState } from "react";
import { getSkillDocument } from "../api/agents";
import { DetailSheet } from "./DetailSheet";
import { SkillMarkdown } from "./SkillMarkdown";

/** 轻量接口，兼容 BrowseRow 和 AssetEntry 两种数据源 */
export interface DetailEntry {
  id: string;
  kind: string;
  title: string;
  description?: string;
  path?: string;
}

interface SkillDetailPanelProps {
  entry: DetailEntry | null;
  onClose: () => void;
}

type ContentState =
  | { status: "loading" }
  | { status: "loaded"; filename: string; content: string; fmDescription?: string }
  | { status: "error"; message: string }
  | { status: "nosupport" };

/** 从 YAML frontmatter 中提取 description 字段，并返回去掉 frontmatter 的 body */
function parseFrontmatter(content: string): { description?: string; body: string } {
  const trimmed = content.trimStart();
  if (!trimmed.startsWith("---")) {
    return { body: content };
  }

  const afterFirst = trimmed.slice(3);
  const endIdx = afterFirst.indexOf("\n---");
  if (endIdx === -1) {
    return { body: content };
  }

  const frontmatter = afterFirst.slice(0, endIdx);
  const body = afterFirst.slice(endIdx + 4).trimStart();

  // 从 frontmatter 中提取 description
  const descMatch = frontmatter.match(/^description:\s*(.+)$/m);
  const description = descMatch?.[1]?.trim();

  return { description, body };
}

export function SkillDetailPanel({ entry, onClose }: SkillDetailPanelProps) {
  if (!entry) return null;

  return <SkillDetailPanelContent key={entry.id} entry={entry} onClose={onClose} />;
}

const KIND_TAGS: Record<string, { label: string; color: string }> = {
  skill: { label: "Skill", color: "var(--accent)" },
  rule: { label: "Rule", color: "#22c55e" },
  mcp: { label: "MCP", color: "#e879f9" },
};

function SkillDetailPanelContent({
  entry,
  onClose,
}: {
  entry: DetailEntry;
  onClose: () => void;
}) {
  const [docState, setDocState] = useState<ContentState>({ status: "loading" });
  const requestIdRef = useRef(0);

  useEffect(() => {
    requestIdRef.current += 1;
    const reqId = requestIdRef.current;
    setDocState({ status: "loading" });

    // For MCP entries that don't have a local file, show an unsupported message
    if (entry.kind === "mcp") {
      setDocState({ status: "nosupport" });
      return;
    }

    const path = entry.path;
    if (!path) {
      setDocState({ status: "error", message: "无文件路径" });
      return;
    }

    getSkillDocument(path).then((doc) => {
      if (reqId !== requestIdRef.current) return;
      if (doc === null) {
        setDocState({
          status: "error",
          message: "无法读取文档文件",
        });
      } else {
        const { description: fmDescription } = parseFrontmatter(doc.content);
        setDocState({
          status: "loaded",
          filename: doc.filename,
          content: doc.content,
          fmDescription,
        });
      }
    });
  }, [entry.id, entry.path, entry.kind]);

  const kindTag = KIND_TAGS[entry.kind] ?? { label: entry.kind, color: "var(--muted)" };

  const meta = (
    <div
      style={{
        display: "flex",
        flexWrap: "wrap",
        alignItems: "center",
        gap: 8,
        fontSize: "12.5px",
      }}
    >
      {/* 类型标签 */}
      <span
        style={{
          display: "inline-flex",
          alignItems: "center",
          padding: "2px 10px",
          borderRadius: 999,
          fontSize: 11,
          fontWeight: 600,
          border: `1px solid ${kindTag.color}33`,
          color: kindTag.color,
          backgroundColor: `${kindTag.color}11`,
        }}
      >
        {kindTag.label}
      </span>

      {/* 文件路径 */}
      {entry.path && (
        <span
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 4,
            color: "var(--muted)",
            fontSize: 12,
            fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            maxWidth: "100%",
          }}
          title={entry.path}
        >
          📁 {entry.path}
        </span>
      )}
    </div>
  );

  return (
    <DetailSheet
      open={true}
      title={entry.title}
      description={
        docState.status === "loaded"
          ? docState.fmDescription
            ? <p style={{ margin: 0, lineClamp: 3 } as React.CSSProperties}>{docState.fmDescription}</p>
            : undefined
          : entry.description
            ? <p style={{ margin: 0, lineClamp: 3 } as React.CSSProperties}>{entry.description}</p>
            : undefined
      }
      meta={meta}
      onClose={onClose}
    >
      {docState.status === "loading" && (
        <div
          style={{
            marginTop: 48,
            textAlign: "center",
            fontSize: 13,
            color: "var(--muted)",
          }}
        >
          加载中…
        </div>
      )}

      {docState.status === "loaded" && (
        <SkillMarkdown content={docState.content} />
      )}

      {docState.status === "error" && (
        <div
          style={{
            marginTop: 48,
            textAlign: "center",
            fontSize: 13,
            color: "var(--danger)",
          }}
        >
          {docState.message}
        </div>
      )}

      {docState.status === "nosupport" && (
        <div
          style={{
            marginTop: 48,
            textAlign: "center",
            fontSize: 13,
            color: "var(--muted)",
          }}
        >
          <p>MCP 配置暂无可视化预览。</p>
          <p style={{ fontSize: 12, marginTop: 8, color: "var(--muted)" }}>
            如需编辑 MCP 服务，请直接修改对应的 JSON 配置文件。
          </p>
        </div>
      )}
    </DetailSheet>
  );
}

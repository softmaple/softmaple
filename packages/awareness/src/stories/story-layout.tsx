import type { CSSProperties, ReactNode } from "react";

const frameStyle: CSSProperties = {
  boxSizing: "border-box",
  display: "grid",
  width: "100%",
  minHeight: "100svh",
  alignItems: "start",
  justifyItems: "center",
  padding:
    "clamp(48px, 14svh, 88px) clamp(16px, 5vw, 24px) clamp(32px, 8svh, 64px)",
  background:
    "radial-gradient(circle at 18% 18%, color-mix(in srgb, #2563eb 10%, transparent), transparent 30%), radial-gradient(circle at 82% 24%, color-mix(in srgb, #16a34a 10%, transparent), transparent 28%), Canvas",
};

const surfaceStyle: CSSProperties = {
  boxSizing: "border-box",
  position: "relative",
  width: "min(520px, calc(100vw - 48px))",
  minHeight: 240,
  overflow: "visible",
  border: "1px solid color-mix(in srgb, CanvasText 14%, transparent)",
  borderRadius: 8,
  background:
    "linear-gradient(180deg, color-mix(in srgb, Canvas 96%, CanvasText 4%), Canvas)",
  color: "CanvasText",
  boxShadow: "0 18px 48px color-mix(in srgb, CanvasText 14%, transparent)",
};

const pageContentStyle: CSSProperties = {
  display: "grid",
  gap: 12,
  padding: "34px 36px",
  fontFamily:
    'ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
  fontSize: 14,
  lineHeight: 1.7,
};

const paragraphStyle: CSSProperties = {
  margin: 0,
};

export const StoryFrame = ({
  children,
}: {
  readonly children: ReactNode;
}): ReactNode => <div style={frameStyle}>{children}</div>;

export const CollaborationSurface = ({
  children,
}: {
  readonly children: ReactNode;
}): ReactNode => (
  <StoryFrame>
    <div style={surfaceStyle}>
      <div style={pageContentStyle}>
        <p style={paragraphStyle}>
          Collaborative editing keeps each participant visible without pulling
          focus from the document.
        </p>
        <p style={paragraphStyle}>
          Remote cursors and selections anchor activity to the text, while
          avatars summarize who is currently present.
        </p>
        <p style={paragraphStyle}>
          Presence state updates independently from document content so the UI
          can remain responsive during long editing sessions.
        </p>
      </div>
      {children}
    </div>
  </StoryFrame>
);

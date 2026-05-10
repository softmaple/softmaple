import type { CSSProperties, ReactNode } from "react";

const frameStyle: CSSProperties = {
  display: "grid",
  minHeight: 180,
  placeItems: "center",
  padding: 24,
};

const surfaceStyle: CSSProperties = {
  position: "relative",
  width: "min(520px, calc(100vw - 48px))",
  minHeight: 240,
  overflow: "hidden",
  border: "1px solid color-mix(in srgb, CanvasText 12%, transparent)",
  borderRadius: 8,
  background: "Canvas",
  color: "CanvasText",
  boxShadow: "0 12px 30px color-mix(in srgb, CanvasText 10%, transparent)",
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

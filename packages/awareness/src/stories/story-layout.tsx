import type { CSSProperties, ReactNode } from "react";

const pokeballSvg =
  "url(\"data:image/svg+xml;utf8,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 200 200' fill='none' stroke='%23ef4444' stroke-width='2'%3E%3Ccircle cx='100' cy='100' r='90'/%3E%3Cpath d='M10 100h70a20 20 0 0 1 40 0h70'/%3E%3Ccircle cx='100' cy='100' r='18'/%3E%3Ccircle cx='100' cy='100' r='10' fill='%23ef4444'/%3E%3C/svg%3E\")";

const frameStyle: CSSProperties = {
  boxSizing: "border-box",
  position: "relative",
  display: "grid",
  width: "100%",
  minHeight: "100svh",
  alignItems: "start",
  justifyItems: "center",
  padding:
    "clamp(40px, 12svh, 72px) clamp(16px, 5vw, 32px) clamp(48px, 10svh, 80px)",
  background: [
    "radial-gradient(circle at 12% 8%, color-mix(in srgb, #ef4444 14%, transparent), transparent 32%)",
    "radial-gradient(circle at 88% 12%, color-mix(in srgb, #2563eb 14%, transparent), transparent 30%)",
    "radial-gradient(circle at 50% 100%, color-mix(in srgb, #22c55e 10%, transparent), transparent 36%)",
    "Canvas",
  ].join(", "),
  isolation: "isolate",
  overflow: "hidden",
};

const frameDecorationStyle: CSSProperties = {
  position: "absolute",
  right: "-72px",
  bottom: "-72px",
  width: "320px",
  height: "320px",
  backgroundImage: pokeballSvg,
  backgroundRepeat: "no-repeat",
  backgroundSize: "contain",
  opacity: 0.06,
  pointerEvents: "none",
  zIndex: -1,
};

const frameContentStyle: CSSProperties = {
  display: "grid",
  gap: "clamp(20px, 4svh, 32px)",
  width: "min(560px, 100%)",
  justifyItems: "center",
};

const headerStyle: CSSProperties = {
  display: "grid",
  gap: 8,
  width: "100%",
  textAlign: "center",
  fontFamily:
    'ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
  color: "CanvasText",
};

const eyebrowStyle: CSSProperties = {
  justifySelf: "center",
  display: "inline-flex",
  alignItems: "center",
  gap: 6,
  padding: "4px 10px",
  borderRadius: 999,
  border: "1px solid color-mix(in srgb, #ef4444 32%, transparent)",
  background: "color-mix(in srgb, #ef4444 8%, Canvas)",
  color: "color-mix(in srgb, #b91c1c 80%, CanvasText)",
  fontSize: 11,
  fontWeight: 600,
  letterSpacing: "0.08em",
  textTransform: "uppercase",
};

const eyebrowDotStyle: CSSProperties = {
  width: 6,
  height: 6,
  borderRadius: 999,
  background: "#ef4444",
  boxShadow: "0 0 0 2px color-mix(in srgb, #ef4444 30%, transparent)",
};

const titleStyle: CSSProperties = {
  margin: 0,
  fontSize: "clamp(20px, 3vw, 24px)",
  fontWeight: 700,
  letterSpacing: "-0.01em",
  lineHeight: 1.2,
};

const subtitleStyle: CSSProperties = {
  margin: 0,
  fontSize: 13,
  lineHeight: 1.5,
  color: "color-mix(in srgb, CanvasText 64%, transparent)",
  maxWidth: 460,
  marginInline: "auto",
};

const surfaceStyle: CSSProperties = {
  boxSizing: "border-box",
  position: "relative",
  width: "min(560px, calc(100vw - 48px))",
  minHeight: 260,
  overflow: "visible",
  border: "1px solid color-mix(in srgb, CanvasText 12%, transparent)",
  borderRadius: 12,
  background:
    "linear-gradient(180deg, color-mix(in srgb, Canvas 96%, CanvasText 4%), Canvas)",
  color: "CanvasText",
  boxShadow:
    "0 1px 0 color-mix(in srgb, Canvas 80%, white) inset, 0 24px 56px color-mix(in srgb, CanvasText 16%, transparent)",
};

const surfaceChromeStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 10,
  padding: "10px 14px",
  borderBottom: "1px solid color-mix(in srgb, CanvasText 8%, transparent)",
  fontFamily:
    'ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
  fontSize: 11,
  fontWeight: 600,
  letterSpacing: "0.06em",
  textTransform: "uppercase",
  color: "color-mix(in srgb, CanvasText 56%, transparent)",
};

const trafficLightStyle: CSSProperties = {
  display: "inline-flex",
  gap: 6,
};

const dot = (color: string): CSSProperties => ({
  width: 10,
  height: 10,
  borderRadius: 999,
  background: color,
  boxShadow: "inset 0 0 0 1px color-mix(in srgb, black 14%, transparent)",
});

const pageContentStyle: CSSProperties = {
  display: "grid",
  gap: 12,
  padding: "26px 32px 32px",
  fontFamily:
    'ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
  fontSize: 14,
  lineHeight: 1.7,
};

const docHeadingStyle: CSSProperties = {
  margin: 0,
  fontSize: 16,
  fontWeight: 700,
  letterSpacing: "-0.01em",
  color: "CanvasText",
};

const docMetaStyle: CSSProperties = {
  margin: 0,
  fontSize: 11,
  fontWeight: 600,
  letterSpacing: "0.08em",
  textTransform: "uppercase",
  color: "color-mix(in srgb, CanvasText 50%, transparent)",
};

const paragraphStyle: CSSProperties = {
  margin: 0,
  color: "color-mix(in srgb, CanvasText 82%, transparent)",
};

export const StoryFrame = ({
  children,
}: {
  readonly children: ReactNode;
}): ReactNode => (
  <div style={frameStyle}>
    <div aria-hidden="true" style={frameDecorationStyle} />
    {children}
  </div>
);

export interface StoryShowcaseProps {
  readonly eyebrow?: string;
  readonly title?: string;
  readonly subtitle?: string;
  readonly children: ReactNode;
}

export const StoryShowcase = ({
  eyebrow,
  title,
  subtitle,
  children,
}: StoryShowcaseProps): ReactNode => (
  <StoryFrame>
    <div style={frameContentStyle}>
      {(eyebrow || title || subtitle) && (
        <header style={headerStyle}>
          {eyebrow ? (
            <span style={eyebrowStyle}>
              <span aria-hidden="true" style={eyebrowDotStyle} />
              {eyebrow}
            </span>
          ) : null}
          {title ? <h2 style={titleStyle}>{title}</h2> : null}
          {subtitle ? <p style={subtitleStyle}>{subtitle}</p> : null}
        </header>
      )}
      {children}
    </div>
  </StoryFrame>
);

export const CollaborationSurface = ({
  children,
}: {
  readonly children: ReactNode;
}): ReactNode => (
  <StoryShowcase
    eyebrow="Pokédex · Live Editing"
    subtitle="A shared Pokédex draft updated in real time. Cursors and selections show where each trainer is focused."
    title="Field Notes — collaborative draft"
  >
    <div style={surfaceStyle}>
      <div style={surfaceChromeStyle}>
        <span aria-hidden="true" style={trafficLightStyle}>
          <span style={dot("#ef4444")} />
          <span style={dot("#f59e0b")} />
          <span style={dot("#22c55e")} />
        </span>
        <span>Pokédex Draft · v0.3</span>
      </div>
      <div style={pageContentStyle}>
        <p style={docMetaStyle}>Entry · Genus · Habitat</p>
        <h3 style={docHeadingStyle}>Field guide: tracking wild encounters</h3>
        <p style={paragraphStyle}>
          Collaborative editing keeps each trainer visible without pulling focus
          from the page. Remote cursors anchor activity to the text.
        </p>
        <p style={paragraphStyle}>
          Selections highlight the passage a teammate is reviewing, while
          avatars summarize who is currently in the document.
        </p>
        <p style={paragraphStyle}>
          Presence updates independently from content, so the page stays
          responsive even during long research sessions in the tall grass.
        </p>
      </div>
      {children}
    </div>
  </StoryShowcase>
);

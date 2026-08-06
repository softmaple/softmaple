/**
 * AwarenessOverlay - wraps children with a PresenceProvider and surfaces
 * the standard awareness chrome (presence bar + connection indicator).
 */

import {
  type AdapterUserInfo,
  ConnectionIndicator,
  type PresenceAdapter,
  PresenceBar,
  PresenceProvider,
} from "@softmaple/awareness";
import "@softmaple/awareness/styles.css";
import type { ReactNode } from "react";

interface AwarenessOverlayProps {
  readonly adapter: PresenceAdapter;
  readonly userInfo: AdapterUserInfo;
  /**
   * Accent for local chrome (avatar tint, "You are X" label).
   * Falls back to `userInfo.color` when omitted.
   */
  readonly accentColor?: string;
  readonly children: ReactNode;
}

export function AwarenessOverlay({
  adapter,
  userInfo,
  accentColor,
  children,
}: AwarenessOverlayProps) {
  const chromeColor = accentColor ?? userInfo.color;
  return (
    <PresenceProvider adapter={adapter}>
      <div className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3 border border-[var(--pg-line)] bg-[var(--pg-surface)] px-4 py-3 text-[var(--pg-ink)]">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex shrink-0 items-center gap-2">
              <img
                src={userInfo.avatarUrl}
                alt={userInfo.name}
                className="h-8 w-8 [image-rendering:pixelated]"
                style={{
                  background: `color-mix(in srgb, ${chromeColor} 18%, transparent)`,
                }}
              />
              <div className="hidden sm:block">
                <p className="font-[family-name:var(--font-mono)] text-[10px] tracking-wider text-[var(--pg-ink-muted)] uppercase">
                  You are
                </p>
                <p
                  className="text-sm font-semibold"
                  style={{ color: chromeColor }}
                >
                  {userInfo.name}
                </p>
              </div>
            </div>
            <div className="mx-2 hidden h-8 w-px bg-[var(--pg-line)] sm:block" />
            <PresenceBar maxVisible={6} />
          </div>
          <ConnectionIndicator hideWhenConnected />
        </div>
        {children}
      </div>
    </PresenceProvider>
  );
}

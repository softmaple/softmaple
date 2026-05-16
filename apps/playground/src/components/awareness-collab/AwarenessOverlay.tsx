/**
 * AwarenessOverlay - wraps children with a PresenceProvider and surfaces
 * the standard awareness chrome (presence bar + connection indicator).
 *
 * Keeps the route component thin by isolating provider wiring here.
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
   * Bright accent color for local chrome (avatar tint, "You are X" label)
   * rendered on dark surfaces. Falls back to `userInfo.color`, which is
   * the contrast-safe value the awareness package uses for white-on-color
   * cursor/selection labels — that value is intentionally darker and can
   * be hard to read on dark backgrounds, so consumers should pass a
   * brighter accent when they have one.
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
      {/*
        Force the dark-theme awareness tokens regardless of the visitor's
        OS color scheme. The demo surface is dark slate, so the package's
        light-mode `mix-blend-mode: multiply` would paint selections to
        near-black and effectively erase them.
      */}
      <div className="space-y-4" data-awareness-theme="dark">
        <div className="flex items-center justify-between gap-3 flex-wrap rounded-xl bg-slate-800/60 border border-slate-700 px-4 py-3 text-slate-100">
          <div className="flex items-center gap-3 min-w-0">
            <div className="flex items-center gap-2 shrink-0">
              <img
                src={userInfo.avatarUrl}
                alt={userInfo.name}
                className="w-8 h-8 rounded-full [image-rendering:pixelated]"
                style={{
                  background: `color-mix(in srgb, ${chromeColor} 18%, transparent)`,
                }}
              />
              <div className="hidden sm:block">
                <p className="text-xs text-gray-500 uppercase tracking-wider">
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
            <div className="h-8 w-px bg-slate-700 mx-2 hidden sm:block" />
            <PresenceBar maxVisible={6} />
          </div>
          <ConnectionIndicator hideWhenConnected />
        </div>
        {children}
      </div>
    </PresenceProvider>
  );
}

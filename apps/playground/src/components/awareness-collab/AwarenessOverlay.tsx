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
  readonly children: ReactNode;
}

export function AwarenessOverlay({
  adapter,
  userInfo,
  children,
}: AwarenessOverlayProps) {
  return (
    <PresenceProvider adapter={adapter}>
      <div className="space-y-4">
        <div className="flex items-center justify-between gap-3 flex-wrap rounded-xl bg-slate-800/60 border border-slate-700 px-4 py-3">
          <div className="flex items-center gap-3 min-w-0">
            <div className="flex items-center gap-2 shrink-0">
              <img
                src={userInfo.avatarUrl}
                alt={userInfo.name}
                className="w-8 h-8 rounded-full [image-rendering:pixelated]"
                style={{
                  background: `color-mix(in srgb, ${userInfo.color} 18%, transparent)`,
                }}
              />
              <div className="hidden sm:block">
                <p className="text-xs text-gray-500 uppercase tracking-wider">
                  You are
                </p>
                <p
                  className="text-sm font-semibold"
                  style={{ color: userInfo.color }}
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

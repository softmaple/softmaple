/**
 * Thin wrapper around BlockActivityIndicator that uses the new
 * `usePeersInBlock` convenience hook to render a custom badge when peers
 * are present. Falls back to a "Just you" caption otherwise.
 */

import { usePeersInBlock } from "@softmaple/awareness";

interface BlockActivityBadgeProps {
  readonly blockId: string;
}

export function BlockActivityBadge({ blockId }: BlockActivityBadgeProps) {
  const peers = usePeersInBlock(blockId);

  if (peers.length === 0) {
    return (
      <span className="text-xs text-gray-500 italic">Just you in here</span>
    );
  }

  return (
    <span className="inline-flex items-center gap-2 text-xs text-gray-300">
      <span className="flex -space-x-2">
        {peers.slice(0, 3).map((peer) => (
          <span
            key={peer.userId}
            className="w-5 h-5 rounded-full ring-2 ring-slate-900 flex items-center justify-center text-[10px] font-semibold text-white"
            style={{
              background: peer.color,
            }}
            title={peer.name}
          >
            {peer.name[0]}
          </span>
        ))}
      </span>
      <span>
        {peers.length === 1
          ? `${peers[0]?.name} is editing here`
          : `${peers.length} trainers editing here`}
      </span>
    </span>
  );
}

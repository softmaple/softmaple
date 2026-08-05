import type { PresenceUser } from "@softmaple/awareness";
import type { LexicalBinding } from "@softmaple/binding-lexical";
import { type RefObject, useLayoutEffect, useRef, useState } from "react";
import { measurePeer, type PeerGeometry } from "./remote-selection-geometry";

export { resolvePeerSelection } from "./remote-selection-geometry";

export interface RemoteSelectionLayerProps {
  readonly binding: LexicalBinding | null;
  readonly hostRef: RefObject<HTMLDivElement | null>;
  readonly selfId: string;
  readonly users: ReadonlyArray<PresenceUser>;
}

export function RemoteSelectionLayer({
  binding,
  hostRef,
  selfId,
  users,
}: RemoteSelectionLayerProps) {
  const [geometry, setGeometry] = useState<ReadonlyArray<PeerGeometry>>([]);
  const usersRef = useRef(users);
  usersRef.current = users;
  const measureRef = useRef<(() => void) | null>(null);
  const previousUsersRef = useRef(users);

  useLayoutEffect(() => {
    const host = hostRef.current;
    if (binding === null || host === null) {
      setGeometry([]);
      measureRef.current = null;
      return;
    }
    let frame = 0;
    const measure = (): void => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        setGeometry(
          usersRef.current.flatMap((peer) => {
            if (peer.userId === selfId) return [];
            const measured = measurePeer(binding, host, peer);
            return measured === null ? [] : [measured];
          }),
        );
      });
    };
    measureRef.current = measure;
    measure();
    const resizeObserver = new ResizeObserver(measure);
    const mutationObserver = new MutationObserver(measure);
    resizeObserver.observe(host);
    mutationObserver.observe(host, {
      childList: true,
      characterData: true,
      subtree: true,
    });
    const unsubscribeReplica = binding.replica.subscribe(measure);
    window.addEventListener("resize", measure);
    window.addEventListener("scroll", measure, true);
    return () => {
      measureRef.current = null;
      cancelAnimationFrame(frame);
      resizeObserver.disconnect();
      mutationObserver.disconnect();
      unsubscribeReplica();
      window.removeEventListener("resize", measure);
      window.removeEventListener("scroll", measure, true);
    };
  }, [binding, hostRef, selfId]);

  useLayoutEffect(() => {
    if (previousUsersRef.current === users) return;
    previousUsersRef.current = users;
    measureRef.current?.();
  }, [users]);

  return (
    <div className="pointer-events-none absolute inset-0 z-10 overflow-hidden">
      {geometry.flatMap(({ peer, selection }) =>
        selection.map((rect) => (
          <span
            key={`${peer.userId}:selection:${rect.left}:${rect.top}:${rect.width}:${rect.height}`}
            data-testid={`remote-selection-${peer.userId}`}
            className="absolute rounded-[3px]"
            style={{
              backgroundColor: `${peer.color}2E`,
              boxShadow: `inset 0 -1px 0 ${peer.color}70`,
              height: rect.height,
              left: rect.left,
              top: rect.top,
              width: rect.width,
            }}
          />
        )),
      )}
      {geometry.map(({ backward, caret, peer }) =>
        caret === null ? null : (
          <span
            key={`${peer.userId}:caret`}
            data-testid={`remote-caret-${peer.userId}`}
            className="absolute rounded-full"
            style={{
              backgroundColor: peer.color,
              height: caret.height,
              left: caret.left,
              top: caret.top,
              width: 2,
            }}
          >
            <span
              className="absolute left-0 top-0 -translate-y-full whitespace-nowrap rounded-t-md rounded-br-md px-1.5 py-0.5 text-[9px] font-bold text-white"
              style={{ backgroundColor: peer.color }}
            >
              {peer.name} {backward ? "↖" : "↘"}
            </span>
          </span>
        ),
      )}
    </div>
  );
}

"use client";

import {
  Fragment,
  type FC,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useState,
} from "react";
import {
  CollaborationBar,
  LiveCursor,
  PresenceLayer,
  SelectionHighlight,
  createNoopAdapter,
  createWebSocketAdapter,
  PresenceProvider,
  useOthers,
  usePresence,
  useUpdateCursor,
  useUpdateSelection,
  type PresenceAdapter,
  type PresenceUser,
} from "@softmaple/awareness";
import type {
  LexicalBinding,
  StableBlockSelection,
} from "@softmaple/binding-lexical";
import { createClient } from "@/utils/supabase/client";
import { documentPresenceColor } from "@/modules/docs/document-presence-color";
import { DocEditor, type DocEditorProps } from "@/modules/docs/doc-editor";
import {
  domPointAtOffset,
  type DomPoint,
} from "@/modules/docs/document-presence-dom";
import {
  mapPresenceUsers,
  resolveRemotePresenceSelection,
} from "@/modules/docs/document-presence-geometry";

type ProfileIdentity = {
  readonly avatarUrl: string | null;
  readonly name: string;
  readonly userId: string;
};

type LiveAdapterState = {
  readonly adapter: PresenceAdapter;
  readonly avatarUrl: string | null;
  readonly documentId: string;
  readonly name: string;
  readonly presenceUrl: string;
  readonly userId: string;
} | null;

type RemoteGeometry = {
  readonly caret: {
    readonly height: number;
    readonly left: number;
    readonly top: number;
  };
  readonly user: PresenceUser;
  readonly selectionRects: ReadonlyArray<{
    readonly height: number;
    readonly left: number;
    readonly top: number;
    readonly width: number;
  }>;
};

const logicalDomPoint = (
  binding: LexicalBinding,
  logical: { readonly blockId: string; readonly offset: number },
): DomPoint | null => {
  const nodeKey = binding.getBlockIndex().blockIdToNodeKey.get(logical.blockId);
  if (nodeKey === undefined) return null;
  const element = binding.editor.getElementByKey(nodeKey);
  return element === null ? null : domPointAtOffset(element, logical.offset);
};

const collapsedRange = (point: DomPoint): Range => {
  const range = document.createRange();
  range.setStart(point.node, point.offset);
  range.collapse(true);
  return range;
};

const orderedRange = (first: DomPoint, second: DomPoint): Range => {
  const firstRange = collapsedRange(first);
  const secondRange = collapsedRange(second);
  const firstComesFirst =
    firstRange.compareBoundaryPoints(Range.START_TO_START, secondRange) <= 0;
  const range = document.createRange();
  const start = firstComesFirst ? first : second;
  const end = firstComesFirst ? second : first;
  range.setStart(start.node, start.offset);
  range.setEnd(end.node, end.offset);
  return range;
};

const geometryForUser = (
  binding: LexicalBinding,
  container: HTMLElement,
  user: PresenceUser,
): RemoteGeometry | null => {
  const logical = resolveRemotePresenceSelection(binding, user);
  if (logical === null) return null;
  const anchorPoint = logicalDomPoint(binding, logical.anchor);
  const focusPoint = logicalDomPoint(binding, logical.focus);
  if (anchorPoint === null || focusPoint === null) return null;

  const containerRect = container.getBoundingClientRect();
  const caretRect = collapsedRange(focusPoint).getBoundingClientRect();
  const selectionRange = orderedRange(anchorPoint, focusPoint);
  const selectionRects = selectionRange.collapsed
    ? []
    : [...selectionRange.getClientRects()]
        .filter((rect) => rect.width > 0 && rect.height > 0)
        .slice(0, 100)
        .map((rect) => ({
          height: rect.height,
          left: rect.left - containerRect.left,
          top: rect.top - containerRect.top,
          width: rect.width,
        }));
  return {
    caret: {
      height: Math.max(caretRect.height, 18),
      left: caretRect.left - containerRect.left,
      top: caretRect.top - containerRect.top,
    },
    user,
    selectionRects,
  };
};

const RemotePresenceOverlay: FC<{
  readonly binding: LexicalBinding | null;
  readonly container: HTMLElement | null;
}> = ({ binding, container }) => {
  const others = useOthers();
  const { connectionState } = usePresence();
  const host = useMemo(() => ({ current: container }), [container]);
  const [geometries, setGeometries] = useState<ReadonlyArray<RemoteGeometry>>(
    [],
  );

  useLayoutEffect(() => {
    if (binding === null || container === null) {
      setGeometries([]);
      return;
    }
    let frame: number | null = null;
    const refresh = (): void => {
      if (frame !== null) cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        setGeometries(
          mapPresenceUsers(others, (user) =>
            geometryForUser(binding, container, user),
          ),
        );
      });
    };
    refresh();
    // Lexical updates cover materialize(); replica.subscribe covers remote
    // integration even when a Lexical update is deferred (e.g. composition).
    const unregisterEditor = binding.editor.registerUpdateListener(refresh);
    const unsubscribeReplica = binding.replica.subscribe(refresh);
    const observer = new ResizeObserver(refresh);
    observer.observe(container);
    window.addEventListener("resize", refresh);
    window.addEventListener("scroll", refresh, true);
    return () => {
      observer.disconnect();
      unregisterEditor();
      unsubscribeReplica();
      window.removeEventListener("resize", refresh);
      window.removeEventListener("scroll", refresh, true);
      if (frame !== null) cancelAnimationFrame(frame);
    };
  }, [binding, container, others]);

  // Cached positions stop being trustworthy while the room is disconnected.
  if (connectionState !== "connected") return null;

  return (
    <div
      aria-hidden
      className="pointer-events-none absolute inset-0 z-30 overflow-hidden"
    >
      <PresenceLayer host={host}>
        {geometries.map(({ user, caret, selectionRects }) => (
          <Fragment key={user.connectionId}>
            {selectionRects.map((rect, index) => (
              <SelectionHighlight
                key={`${user.connectionId}-selection-${index}`}
                user={user}
                rect={{
                  x: rect.left,
                  y: rect.top,
                  width: rect.width,
                  height: rect.height,
                }}
              />
            ))}
            <LiveCursor
              user={user}
              point={{ x: caret.left, y: caret.top }}
              caretHeight={caret.height}
              viewport="none"
              focusable={false}
            />
          </Fragment>
        ))}
      </PresenceLayer>
    </div>
  );
};

const PresenceSelectionPublisher: FC<{
  readonly enabled: boolean;
  readonly selection: StableBlockSelection | null;
}> = ({ enabled, selection }) => {
  const updateCursor = useUpdateCursor(50);
  const updateSelection = useUpdateSelection(50);
  const { updatePresence } = usePresence();

  useEffect(() => {
    if (!enabled) return;
    const clearPosition = (): void => {
      updatePresence({ cursor: undefined, selection: undefined });
    };
    window.addEventListener("blur", clearPosition);
    return () => {
      window.removeEventListener("blur", clearPosition);
      clearPosition();
    };
  }, [enabled, updatePresence]);

  useLayoutEffect(() => {
    if (!enabled) return;
    if (selection === null) {
      updateCursor(null);
      updateSelection(null);
      return;
    }
    const collapsed =
      selection.anchor.blockId === selection.focus.blockId &&
      JSON.stringify(selection.anchor.anchor) ===
        JSON.stringify(selection.focus.anchor);
    updateCursor(selection.focus);
    updateSelection(collapsed ? null : selection);
  }, [enabled, selection, updateCursor, updateSelection]);

  return null;
};

export type DocumentPresenceProps = DocEditorProps &
  ProfileIdentity & {
    /** Presence WebSocket is only opened for shared/collaborative documents. */
    readonly presenceEnabled?: boolean;
  };

/**
 * Keeps DocEditor mounted across private→shared transitions by always wrapping
 * with PresenceProvider (noop adapter while private; WebSocket once shared).
 */
export const DocumentPresence: FC<DocumentPresenceProps> = ({
  avatarUrl,
  name,
  presenceEnabled = true,
  userId,
  onExternalBindingChange,
  onSelectionChange,
  ...editorProps
}) => {
  const supabase = useMemo(() => createClient(), []);
  const noopAdapter = useMemo(
    () =>
      createNoopAdapter({
        roomId: editorProps.documentId,
        userInfo: {
          userId,
          name,
          color: documentPresenceColor(userId),
          ...(avatarUrl === null ? {} : { avatarUrl }),
        },
      }),
    [avatarUrl, editorProps.documentId, name, userId],
  );
  const [liveAdapterState, setLiveAdapterState] =
    useState<LiveAdapterState>(null);
  const [cursorsVisible, setCursorsVisible] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [binding, setBinding] = useState<LexicalBinding | null>(null);
  const [container, setContainer] = useState<HTMLDivElement | null>(null);
  const [selection, setSelection] = useState<StableBlockSelection | null>(null);

  useEffect(() => {
    const documentId = editorProps.documentId;
    // The server-resolved presence endpoint: same runtime as the document
    // socket by construction, and never re-derived here.
    const presenceUrl = editorProps.collabTarget.presenceUrl;

    if (!presenceEnabled) {
      // Previous effect cleanup already disconnects the adapter it created.
      setLiveAdapterState(null);
      setError(null);
      return;
    }

    // Cleanup above disconnects the prior adapter without clearing this
    // state, so reset it up front — otherwise presenceLive briefly reads
    // true against an already-disconnected adapter during reconnect. The
    // identity tag on LiveAdapterState below (documentId, presenceUrl,
    // userId, name, avatarUrl — everything that feeds adapter construction)
    // is the structural guard: even if this reset were ever skipped, a
    // stale adapter tagged for different props can never be read as live.
    setLiveAdapterState(null);

    let cancelled = false;
    let created: PresenceAdapter | null = null;
    let authRevision = 0;
    const clearLivePresence = (message: string): void => {
      if (cancelled) return;
      void created?.disconnect();
      created = null;
      setLiveAdapterState(null);
      setError(message);
    };
    const configure = (token: string): void => {
      if (cancelled) return;
      const next = createWebSocketAdapter({
        authToken: token,
        roomId: documentId,
        url: presenceUrl,
        userInfo: {
          userId,
          name,
          color: documentPresenceColor(userId),
          ...(avatarUrl === null ? {} : { avatarUrl }),
        },
      });
      void created?.disconnect();
      created = next;
      setLiveAdapterState({
        adapter: next,
        avatarUrl,
        documentId,
        name,
        presenceUrl,
        userId,
      });
      setError(null);
    };
    const sessionRequestRevision = authRevision;
    void supabase.auth.getSession().then(({ data, error: sessionError }) => {
      // Ignore stale getSession results after a later auth-state change.
      if (cancelled || sessionRequestRevision !== authRevision) return;
      const token = data.session?.access_token;
      if (sessionError !== null || token === undefined) {
        clearLivePresence("Presence session is unavailable.");
        return;
      }
      configure(token);
    });
    const { data: listener } = supabase.auth.onAuthStateChange(
      (_event, session) => {
        authRevision += 1;
        if (session?.access_token !== undefined) {
          configure(session.access_token);
          return;
        }
        clearLivePresence("Presence session is unavailable.");
      },
    );
    return () => {
      cancelled = true;
      void created?.disconnect();
      created = null;
      listener.subscription.unsubscribe();
    };
  }, [
    avatarUrl,
    editorProps.collabTarget.presenceUrl,
    editorProps.documentId,
    name,
    presenceEnabled,
    supabase,
    userId,
  ]);

  const handleBindingChange = useCallback(
    (next: LexicalBinding | null) => {
      setBinding(next);
      onExternalBindingChange?.(next);
    },
    [onExternalBindingChange],
  );

  const handleSelectionChange = useCallback(
    (next: StableBlockSelection | null) => {
      setSelection(next);
      onSelectionChange?.(next);
    },
    [onSelectionChange],
  );

  // Only treat the stored adapter as live when it was built for the props
  // this render is currently showing — a stale adapter tagged for a prior
  // documentId/presenceUrl/userId/name/avatarUrl can never leak through
  // as "live" here (nor expose stale userInfo to the room), even if the
  // effect above raced with a prop change.
  const liveAdapter =
    liveAdapterState !== null &&
    liveAdapterState.documentId === editorProps.documentId &&
    liveAdapterState.presenceUrl === editorProps.collabTarget.presenceUrl &&
    liveAdapterState.userId === userId &&
    liveAdapterState.name === name &&
    liveAdapterState.avatarUrl === avatarUrl
      ? liveAdapterState.adapter
      : null;
  const adapter =
    presenceEnabled && liveAdapter !== null ? liveAdapter : noopAdapter;
  const presenceLive = presenceEnabled && liveAdapter !== null;

  return (
    <PresenceProvider adapter={adapter} statusSweepMs={5_000}>
      <div className="document-awareness flex min-h-full flex-col">
        {presenceEnabled ? (
          <CollaborationBar
            state={
              liveAdapter === null
                ? error === null
                  ? "connecting"
                  : "error"
                : undefined
            }
            selfUserId={userId}
            cursorsVisible={cursorsVisible}
            onCursorsVisibleChange={setCursorsVisible}
          />
        ) : null}
        <PresenceSelectionPublisher
          enabled={presenceLive}
          selection={selection}
        />
        <div className="relative min-h-0 flex-1" ref={setContainer}>
          <DocEditor
            {...editorProps}
            onExternalBindingChange={handleBindingChange}
            onSelectionChange={handleSelectionChange}
          />
          {presenceLive && cursorsVisible ? (
            <RemotePresenceOverlay binding={binding} container={container} />
          ) : null}
        </div>
      </div>
    </PresenceProvider>
  );
};

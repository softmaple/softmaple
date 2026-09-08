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
  useSelf,
  useUpdateCursor,
  useUpdateSelection,
  type PresenceAdapter,
  type PresenceUser,
} from "@softmaple/awareness";
import type {
  LexicalBinding,
  StableBlockSelection,
} from "@softmaple/binding-lexical";
import { useTheme } from "next-themes";
import { Button } from "@softmaple/ui/components/button";
import { usePreferences } from "@/components/shell/preferences";
import { createClient } from "@/utils/supabase/client";
import {
  collaboratorColor,
  documentPresenceColor,
} from "@/modules/docs/document-presence-color";
import { DocEditor, type DocEditorProps } from "@/modules/docs/doc-editor";
import {
  domPointAtOffset,
  type DomPoint,
} from "@/modules/docs/document-presence-dom";
import {
  mapPresenceUsers,
  resolveRemotePresenceSelection,
} from "@/modules/docs/document-presence-geometry";
import { ContextSlot } from "@/components/shell/context-slot";
import { PeopleAndActivity } from "@/modules/docs/people-and-activity";
import { rankPresence } from "@/modules/docs/presence-relevance";
import { useBlockDocument } from "@/modules/docs/use-block-document";

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
  readonly onOverflowChange?: (overflowCount: number) => void;
}> = ({ binding, container, onOverflowChange }) => {
  const remote = useOthers();
  const { resolvedTheme } = useTheme();
  const theme = resolvedTheme === "dark" ? "dark" : "light";
  // Colour arrives from the wire as the light-theme value, because the sender
  // has no idea which theme this client is in. Repaint each identity into the
  // local pair so a caret reads the same way on paper and on charcoal.
  const others = useMemo(
    () =>
      remote.map((user) => ({
        ...user,
        color: collaboratorColor(user.userId, theme).color,
      })),
    [remote, theme],
  );
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
        // Rank and cut *before* measuring: geometry costs a layout per peer,
        // so a busy room must never turn into a per-frame layout storm.
        const ranked = rankPresence(others, {
          now: Date.now(),
          visibleBlockIds: null,
        });
        onOverflowChange?.(ranked.overflowCount);
        setGeometries(
          mapPresenceUsers(ranked.detailed, (user) =>
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
  }, [binding, container, onOverflowChange, others]);

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

/**
 * One update per selection change, coalesced to at most 20 per second.
 *
 * 50ms is a deliberate ceiling rather than a tuning knob: it is the point at
 * which a remote caret still reads as continuous, and publishing faster costs
 * every peer in the room a re-render for motion nobody can perceive.
 */
const LOCATION_PUBLISH_INTERVAL_MS = 50;

const PresenceSelectionPublisher: FC<{
  /** Publish a precise caret and selection, not just presence. */
  readonly detailed: boolean;
  readonly enabled: boolean;
  readonly selection: StableBlockSelection | null;
}> = ({ detailed, enabled, selection }) => {
  const updateCursor = useUpdateCursor(LOCATION_PUBLISH_INTERVAL_MS);
  const updateSelection = useUpdateSelection(LOCATION_PUBLISH_INTERVAL_MS);
  const { updatePresence } = usePresence();
  const [foreground, setForeground] = useState(
    () => typeof document === "undefined" || !document.hidden,
  );

  useEffect(() => {
    if (!enabled) return;
    const clearPosition = (): void => {
      updatePresence({ cursor: undefined, selection: undefined });
    };
    // A backgrounded tab keeps its membership — the person has not left — but
    // its caret is stale the moment they look away, and a stale caret is worse
    // than none. Liveness is the transport's job; position is ours.
    const syncForeground = (): void => {
      const visible = !document.hidden;
      setForeground(visible);
      if (!visible) clearPosition();
    };
    document.addEventListener("visibilitychange", syncForeground);
    window.addEventListener("blur", clearPosition);
    syncForeground();
    return () => {
      document.removeEventListener("visibilitychange", syncForeground);
      window.removeEventListener("blur", clearPosition);
      clearPosition();
    };
  }, [enabled, updatePresence]);

  const publishing = enabled && detailed && foreground;

  useLayoutEffect(() => {
    if (!publishing) {
      // Withdraw a position that is no longer being kept up to date, rather
      // than leaving the last one behind to go quietly wrong.
      updateCursor(null);
      updateSelection(null);
      return;
    }
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
  }, [publishing, selection, updateCursor, updateSelection]);

  return null;
};

/**
 * The complete roster, for the context slot.
 *
 * The overlay is capped at five carets because the page can only carry so
 * many; this list is uncapped because "who is here" has one correct answer.
 */
const PeoplePanel: FC<{
  readonly binding: LexicalBinding | null;
}> = ({ binding }) => {
  const others = useOthers();
  const self = useSelf();
  const document = useBlockDocument(binding);
  return (
    <PeopleAndActivity
      document={document}
      people={self === null ? others : [self, ...others]}
      selfConnectionId={self?.connectionId ?? null}
    />
  );
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
  const { preferences } = usePreferences();
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
  const [peopleOpen, setPeopleOpen] = useState(false);
  // Peers present but past the overlay cap. Counted, never hidden.
  const [overflowCount, setOverflowCount] = useState(0);
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
          <div className="flex items-center gap-2">
            <div className="min-w-0 flex-1">
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
            </div>
            <Button
              aria-expanded={peopleOpen}
              className="mr-2 shrink-0"
              onClick={() => setPeopleOpen((open) => !open)}
              size="sm"
              variant="ghost"
            >
              People
              {overflowCount > 0 ? (
                <span className="text-content-secondary">
                  {` +${overflowCount}`}
                </span>
              ) : null}
            </Button>
          </div>
        ) : null}
        <PresenceSelectionPublisher
          detailed={preferences.detailedLocation}
          enabled={presenceLive}
          selection={selection}
        />
        {/*
          The context slot is a sibling of the editor, never a wrapper around
          it: opening or closing it must not touch the editor's DOM.
        */}
        <div className="flex min-h-0 flex-1">
          <div className="relative min-h-0 flex-1" ref={setContainer}>
            <DocEditor
              {...editorProps}
              onExternalBindingChange={handleBindingChange}
              onSelectionChange={handleSelectionChange}
            />
            {presenceLive && cursorsVisible ? (
              <RemotePresenceOverlay
                binding={binding}
                container={container}
                onOverflowChange={setOverflowCount}
              />
            ) : null}
          </div>
          {presenceEnabled ? (
            <ContextSlot
              onClose={() => setPeopleOpen(false)}
              open={peopleOpen}
              title="People and activity"
            >
              <PeoplePanel binding={binding} />
            </ContextSlot>
          ) : null}
        </div>
      </div>
    </PresenceProvider>
  );
};

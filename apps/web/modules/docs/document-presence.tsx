"use client";

import {
  Fragment,
  type FC,
  type ComponentProps,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
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
  type PresenceAdapter,
  type PresenceUser,
} from "@softmaple/awareness";
import type {
  LexicalBinding,
  StableBlockSelection,
} from "@softmaple/binding-lexical";
import { createClient } from "@/utils/supabase/client";
import {
  documentPresenceColor,
  documentPresenceThemeColor,
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

import { useRedesignFlags } from "@/components/redesign-provider";
import { useCollaborationPreferences } from "@/lib/collaboration-preferences";
import { SharedAttention } from "./shared-attention";
import { relevantParticipants } from "./presence-relevance";

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
  if (caretRect.width === 0 && caretRect.height === 0) return null;
  if (caretRect.bottom < 0 || caretRect.top > window.innerHeight) return null;
  const selectionRange = orderedRange(anchorPoint, focusPoint);
  const selectionRects = selectionRange.collapsed
    ? []
    : [...selectionRange.getClientRects()]
        .filter(
          (rect) =>
            rect.width > 0 &&
            rect.height > 0 &&
            rect.bottom >= 0 &&
            rect.top <= window.innerHeight,
        )
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
    user: { ...user, color: documentPresenceThemeColor(user.userId) },
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
        const started = performance.now();
        setGeometries(
          mapPresenceUsers(
            relevantParticipants(
              others,
              binding.replica.getDocument().blocks.map((block) => block.id),
              binding.captureSelection()?.focus.blockId,
            ),
            (user) => geometryForUser(binding, container, user),
          ),
        );
        if (typeof performance.measure === "function") {
          performance.measure("softmaple.presence.geometry", {
            start: started,
            end: performance.now(),
          });
          // Observers receive the measure; the page does not retain an activity log.
          performance.clearMeasures("softmaple.presence.geometry");
        }
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
        {geometries.map(({ user, caret, selectionRects }, participantIndex) => (
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
              showLabel={participantIndex < 3}
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
  readonly binding: LexicalBinding | null;
}> = ({ enabled, selection, binding }) => {
  const { updatePresence } = usePresence();
  const latest = useRef(selection);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const editing = useRef(false);
  const publish = useCallback(() => {
    timer.current = null;
    const visible =
      enabled && document.visibilityState === "visible" && document.hasFocus();
    const position = visible ? latest.current : null;
    updatePresence({
      cursor: position?.focus,
      selection: position ?? undefined,
      meta: {
        foreground: visible,
        activity: visible && editing.current ? "editing" : "viewing",
      },
    });
  }, [enabled, updatePresence]);
  useLayoutEffect(() => {
    latest.current = selection;
    if (timer.current === null) timer.current = setTimeout(publish, 50);
  }, [selection, publish]);
  useEffect(() => {
    let idle: ReturnType<typeof setTimeout> | null = null;
    const input = () => {
      editing.current = true;
      if (timer.current === null) timer.current = setTimeout(publish, 50);
      if (idle !== null) clearTimeout(idle);
      idle = setTimeout(() => {
        editing.current = false;
        publish();
      }, 2_000);
    };
    const visibility = () => {
      if (timer.current !== null) clearTimeout(timer.current);
      timer.current = null;
      publish();
    };
    const unregister = binding?.editor.registerRootListener(
      (root, previous) => {
        previous?.removeEventListener("input", input);
        root?.addEventListener("input", input);
      },
    );
    document.addEventListener("visibilitychange", visibility);
    window.addEventListener("blur", visibility);
    window.addEventListener("focus", visibility);
    return () => {
      unregister?.();
      if (timer.current !== null) clearTimeout(timer.current);
      timer.current = null;
      if (idle !== null) clearTimeout(idle);
      document.removeEventListener("visibilitychange", visibility);
      window.removeEventListener("blur", visibility);
      window.removeEventListener("focus", visibility);
      updatePresence({
        cursor: undefined,
        selection: undefined,
        meta: { foreground: false, activity: "viewing" },
      });
    };
  }, [binding, publish, updatePresence]);
  return null;
};

export type DocumentPresenceProps = DocEditorProps &
  ProfileIdentity & {
    /** Presence WebSocket is only opened for shared/collaborative documents. */
    readonly presenceEnabled?: boolean;
    readonly surfaceActive?: boolean;
  };

const ThemedCollaborationBar: FC<ComponentProps<typeof CollaborationBar>> = (
  props,
) => {
  const { presence } = usePresence();
  return (
    <CollaborationBar
      {...props}
      users={[...presence.values()].map((user) => ({
        ...user,
        color: documentPresenceThemeColor(user.userId),
      }))}
    />
  );
};

/**
 * Keeps DocEditor mounted across private→shared transitions by always wrapping
 * with PresenceProvider (noop adapter while private; WebSocket once shared).
 */
export const DocumentPresence: FC<DocumentPresenceProps> = ({
  avatarUrl,
  name,
  presenceEnabled = true,
  surfaceActive = true,
  userId,
  onExternalBindingChange,
  onSelectionChange,
  ...editorProps
}) => {
  const flags = useRedesignFlags();
  const preferences = useCollaborationPreferences();
  const sessionId = useRef<string | null>(null);
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
      sessionId.current ??= crypto.randomUUID();
      const next = createWebSocketAdapter({
        sessionId: sessionId.current,
        sharedAttention: flags.attention,
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
    flags.attention,
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
          <ThemedCollaborationBar
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
          enabled={presenceLive && surfaceActive && preferences.shareLocation}
          binding={binding}
          selection={selection}
        />
        <SharedAttention
          accountId={userId}
          documentId={editorProps.documentId}
          enabled={presenceLive && flags.attention}
          binding={binding}
          selection={selection}
          surfaceActive={surfaceActive}
        >
          <div className="relative min-h-0 flex-1" ref={setContainer}>
            <DocEditor
              {...editorProps}
              onExternalBindingChange={handleBindingChange}
              onSelectionChange={handleSelectionChange}
            />
            {presenceLive &&
            flags.presence &&
            surfaceActive &&
            cursorsVisible &&
            !preferences.focusMode ? (
              <RemotePresenceOverlay binding={binding} container={container} />
            ) : null}
          </div>
        </SharedAttention>
      </div>
    </PresenceProvider>
  );
};

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
  createNoopAdapter,
  createWebSocketAdapter,
  isDirectionalSelectionRange,
  isStableCursorPosition,
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
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
} from "@softmaple/ui/components/avatar";
import { Radio } from "lucide-react";
import { createClient } from "@/utils/supabase/client";
import { DocEditor, type DocEditorProps } from "@/modules/docs/doc-editor";
import {
  domPointAtOffset,
  type DomPoint,
} from "@/modules/docs/document-presence-dom";

type ProfileIdentity = {
  readonly avatarUrl: string | null;
  readonly name: string;
  readonly userId: string;
};

type RemoteGeometry = {
  readonly caret: {
    readonly height: number;
    readonly left: number;
    readonly top: number;
  };
  readonly color: string;
  readonly connectionId: string;
  readonly name: string;
  readonly selectionRects: ReadonlyArray<{
    readonly height: number;
    readonly left: number;
    readonly top: number;
    readonly width: number;
  }>;
};

const resolvePresenceUrl = (): string => {
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${protocol}//${window.location.host}/collab/presence`;
};

const initials = (name: string): string =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");

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
  const selection = isDirectionalSelectionRange(user.selection)
    ? user.selection
    : null;
  const cursor = isStableCursorPosition(user.cursor) ? user.cursor : null;
  if (selection === null && cursor === null) return null;

  const stableSelection: StableBlockSelection =
    selection === null
      ? { anchor: cursor!, focus: cursor! }
      : { anchor: selection.anchor, focus: selection.focus };
  const logical = binding.resolveSelection(stableSelection);
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
    color: user.color,
    connectionId: user.connectionId,
    name: user.name,
    selectionRects,
  };
};

const RemotePresenceOverlay: FC<{
  readonly binding: LexicalBinding | null;
  readonly container: HTMLElement | null;
}> = ({ binding, container }) => {
  const others = useOthers();
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
          others.flatMap((user) => {
            const geometry = geometryForUser(binding, container, user);
            return geometry === null ? [] : [geometry];
          }),
        );
      });
    };
    refresh();
    const unregisterEditor = binding.editor.registerUpdateListener(refresh);
    window.addEventListener("resize", refresh);
    window.addEventListener("scroll", refresh, true);
    return () => {
      unregisterEditor();
      window.removeEventListener("resize", refresh);
      window.removeEventListener("scroll", refresh, true);
      if (frame !== null) cancelAnimationFrame(frame);
    };
  }, [binding, container, others]);

  return (
    <div
      aria-hidden
      className="pointer-events-none absolute inset-0 z-30 overflow-hidden"
    >
      {geometries.map((geometry) => (
        <Fragment key={geometry.connectionId}>
          {geometry.selectionRects.map((rect, index) => (
            <span
              className="absolute opacity-20"
              key={`${geometry.connectionId}-selection-${index}`}
              style={{ ...rect, backgroundColor: geometry.color }}
            />
          ))}
          <span
            className="absolute w-0.5"
            style={{
              backgroundColor: geometry.color,
              height: geometry.caret.height,
              left: geometry.caret.left,
              top: geometry.caret.top,
            }}
          >
            <span
              className="absolute left-0 top-0 -translate-y-full whitespace-nowrap px-1.5 py-0.5 font-mono text-[9px] text-white"
              style={{ backgroundColor: geometry.color }}
            >
              {geometry.name}
            </span>
          </span>
        </Fragment>
      ))}
    </div>
  );
};

const WorkspacePresenceBar = () => {
  const { connectionState, presence } = usePresence();
  const users = [...presence.values()];
  const grouped = [
    ...users
      .reduce((groups, user) => {
        const current = groups.get(user.userId);
        const sessions = current?.sessions ?? 0;
        groups.set(user.userId, { user, sessions: sessions + 1 });
        return groups;
      }, new Map<
        string,
        { readonly sessions: number; readonly user: PresenceUser }
      >())
      .values(),
  ];

  return (
    <div className="flex min-h-10 items-center gap-3 border-b bg-muted/35 px-3 sm:px-5">
      <span className="flex items-center gap-1.5 font-mono text-[10px] text-muted-foreground">
        <Radio className="size-3 text-primary" />
        Presence {connectionState}
      </span>
      <div
        className="ml-auto flex -space-x-2"
        aria-label="Active collaborators"
      >
        {grouped.slice(0, 5).map(({ sessions, user }) => (
          <div
            className="relative"
            key={user.userId}
            title={`${user.name} · ${sessions} tab${sessions === 1 ? "" : "s"}`}
          >
            <Avatar className="size-7 border-2 border-background">
              <AvatarImage alt="" src={user.avatarUrl} />
              <AvatarFallback className="text-[9px]">
                {initials(user.name)}
              </AvatarFallback>
            </Avatar>
            {sessions > 1 ? (
              <span className="absolute -bottom-1 -right-1 grid size-3.5 place-items-center rounded-full bg-primary font-mono text-[8px] text-primary-foreground">
                {sessions}
              </span>
            ) : null}
          </div>
        ))}
        {grouped.length > 5 ? (
          <span className="grid size-7 place-items-center rounded-full border-2 border-background bg-secondary font-mono text-[9px]">
            +{grouped.length - 5}
          </span>
        ) : null}
      </div>
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
          color: "#c9184a",
          ...(avatarUrl === null ? {} : { avatarUrl }),
        },
      }),
    [avatarUrl, editorProps.documentId, name, userId],
  );
  const [liveAdapter, setLiveAdapter] = useState<PresenceAdapter | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [binding, setBinding] = useState<LexicalBinding | null>(null);
  const [container, setContainer] = useState<HTMLDivElement | null>(null);
  const [selection, setSelection] = useState<StableBlockSelection | null>(null);

  useEffect(() => {
    if (!presenceEnabled) {
      // Previous effect cleanup already disconnects the adapter it created.
      setLiveAdapter(null);
      setError(null);
      return;
    }

    let cancelled = false;
    let created: PresenceAdapter | null = null;
    const clearLivePresence = (message: string): void => {
      if (cancelled) return;
      void created?.disconnect();
      created = null;
      setLiveAdapter(null);
      setError(message);
    };
    const configure = (token: string): void => {
      if (cancelled) return;
      const next = createWebSocketAdapter({
        authToken: token,
        roomId: editorProps.documentId,
        url: resolvePresenceUrl(),
        userInfo: {
          userId,
          name,
          color: "#c9184a",
          ...(avatarUrl === null ? {} : { avatarUrl }),
        },
      });
      void created?.disconnect();
      created = next;
      setLiveAdapter(next);
      setError(null);
    };
    void supabase.auth.getSession().then(({ data, error: sessionError }) => {
      const token = data.session?.access_token;
      if (sessionError !== null || token === undefined) {
        clearLivePresence("Presence session is unavailable.");
        return;
      }
      configure(token);
    });
    const { data: listener } = supabase.auth.onAuthStateChange(
      (_event, session) => {
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

  const adapter =
    presenceEnabled && liveAdapter !== null ? liveAdapter : noopAdapter;
  const presenceLive = presenceEnabled && liveAdapter !== null;

  return (
    <PresenceProvider adapter={adapter} statusSweepMs={5_000}>
      <div className="flex min-h-full flex-col">
        {presenceEnabled && liveAdapter === null ? (
          <div className="border-b px-3 py-2 font-mono text-[11px] text-muted-foreground sm:px-5">
            {error ?? "Connecting presence…"}
          </div>
        ) : null}
        {presenceLive ? <WorkspacePresenceBar /> : null}
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
          {presenceLive ? (
            <RemotePresenceOverlay binding={binding} container={container} />
          ) : null}
        </div>
      </div>
    </PresenceProvider>
  );
};

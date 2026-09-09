"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  AttentionInvitation,
  usePresence,
  isDirectionalSelectionRange,
  isStableCursorPosition,
} from "@softmaple/awareness";
import type { AttentionAction } from "@softmaple/awareness/protocol";
import type {
  LexicalBinding,
  StableBlockSelection,
} from "@softmaple/binding-lexical";
import { Button } from "@softmaple/ui/components/button";
import {
  useCollaborationPreferences,
  updateCollaborationPreferences,
} from "@/lib/collaboration-preferences";
import {
  capturePlace,
  resolvePlace,
  revealAnchor,
  type ReturnPlace,
} from "./document-anchors";
import { DocumentOutline } from "./document-outline";
import { SharedDocumentProjection } from "./shared-document-projection";
import { sectionForParticipant } from "./presence-relevance";
import { readRememberedPlace, rememberPlace } from "./remembered-place";

type SharedView = {
  readonly sessionId: string;
  readonly name: string;
  readonly anchor: StableBlockSelection;
};

export function SharedAttention({
  binding,
  selection,
  enabled,
  surfaceActive,
  accountId,
  documentId,
  children,
}: {
  readonly binding: LexicalBinding | null;
  readonly selection: StableBlockSelection | null;
  readonly enabled: boolean;
  readonly surfaceActive: boolean;
  readonly accountId: string;
  readonly documentId: string;
  readonly children: ReactNode;
}) {
  const { adapter, self, others, connectionState } = usePresence();
  const preferences = useCollaborationPreferences();
  const [peopleOpen, setPeopleOpen] = useState(false);
  const [recipients, setRecipients] = useState<readonly string[]>([]);
  const [view, setView] = useState<SharedView | null>(null);
  const [mobileView, setMobileView] = useState<"mine" | "shared">("shared");
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [now, setNow] = useState(Date.now());
  const [suspended, setSuspended] = useState(false);
  const returnPlace = useRef<ReturnPlace | null>(null);
  const ownPane = useRef<HTMLDivElement>(null);
  const interrupted = useRef(false);
  const cancelTransfer = useRef<(() => void) | null>(null);
  useEffect(() => {
    if (binding === null) return;
    const remembered = readRememberedPlace(accountId, documentId);
    if (remembered === null) return;
    const frame = requestAnimationFrame(() => {
      if (
        ownPane.current !== null &&
        binding.replica
          .getDocument()
          .blocks.some((block) => block.id === remembered.focus.blockId)
      )
        revealAnchor(binding, remembered, ownPane.current);
    });
    return () => cancelAnimationFrame(frame);
  }, [accountId, documentId, binding]);
  useEffect(() => {
    if (selection === null || !surfaceActive) return;
    const timer = setTimeout(
      () => rememberPlace(accountId, documentId, selection),
      500,
    );
    return () => clearTimeout(timer);
  }, [accountId, documentId, selection, surfaceActive]);
  const supported = enabled && adapter?.supportsAttention?.() === true;
  const available = others.filter(
    (person) =>
      person.status !== "offline" &&
      person.sessionId !== undefined &&
      person.collaboration !== undefined,
  );
  const invitationSender = available.find((person) => {
    const invitation = person.collaboration?.invitation;
    return (
      invitation != null &&
      invitation.expiresAt > now &&
      self?.sessionId !== undefined &&
      invitation.recipients.includes(self.sessionId) &&
      self.collaboration?.response?.invitationId !== invitation.id
    );
  });
  const presenter =
    view === null
      ? undefined
      : available.find((person) => person.sessionId === view.sessionId);
  const relationship = self?.collaboration?.following;
  const following =
    enabled &&
    relationship?.status === "following" &&
    !suspended &&
    !interrupted.current &&
    connectionState === "connected";

  const send = useCallback(
    async (action: AttentionAction): Promise<boolean> => {
      if (adapter?.sendAttention === undefined) return false;
      setPending(true);
      try {
        const result = await adapter.sendAttention(action);
        if (!result.ok)
          setNotice(
            result.message ?? "The action could not be delivered. Try again.",
          );
        return result.ok;
      } finally {
        setPending(false);
      }
    },
    [adapter],
  );

  useEffect(() => {
    const timer = setInterval(
      () => setNow(adapter?.getServerTime?.() ?? Date.now()),
      1_000,
    );
    return () => clearInterval(timer);
  }, [adapter]);

  const suspend = useCallback(() => {
    if (!following) return;
    setSuspended(true);
    void send({ type: "suspend" });
  }, [following, send]);

  // Browser connectivity never implicitly re-establishes a follow relationship.
  const hasView = view !== null;
  const presenterConnection = presenter?.connectionId;
  const presenterEnabled = presenter?.collaboration?.presenting;
  const relationshipSession = relationship?.sessionId;
  useEffect(() => {
    if (!hasView) return;
    if (!enabled) {
      interrupted.current = true;
      setSuspended(true);
      setNotice("Shared attention ended. Your place is still available.");
    } else if (connectionState !== "connected") {
      interrupted.current = true;
      setSuspended(true);
      setNotice(
        "Connection interrupted. Resume explicitly when the presenter returns.",
      );
    } else if (
      relationshipSession !== undefined &&
      (presenterConnection === undefined || !presenterEnabled)
    ) {
      setSuspended(true);
      if (relationshipSession !== undefined) void send({ type: "stop" });
      setNotice("Presentation ended. Your place is still available.");
    }
  }, [
    connectionState,
    presenterConnection,
    presenterEnabled,
    relationshipSession,
    send,
    hasView,
    enabled,
  ]);

  useEffect(
    () => () => {
      cancelTransfer.current?.();
      cancelTransfer.current = null;
    },
    [binding],
  );

  useEffect(() => {
    if (!surfaceActive) suspend();
  }, [surfaceActive, suspend]);
  useEffect(() => {
    if (binding === null) return;
    return binding.replica.subscribe((change) => {
      if (change.origin === "local") suspend();
    });
  }, [binding, suspend]);

  useEffect(() => {
    if (!following || presenter === undefined) return;
    const anchor = isDirectionalSelectionRange(presenter.selection)
      ? presenter.selection
      : isStableCursorPosition(presenter.cursor)
        ? { anchor: presenter.cursor, focus: presenter.cursor }
        : null;
    if (anchor !== null)
      setView((current) => (current === null ? null : { ...current, anchor }));
  }, [following, presenter]);

  const transfer = (anchor: StableBlockSelection) => {
    if (binding === null) return;
    cancelTransfer.current?.();
    suspend();
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let frame: number | undefined;
    const root = binding.editor.getRootElement();
    const apply = () => {
      if (cancelled) return;
      if (binding.restoreSelection(anchor)) {
        setMobileView("mine");
        frame = requestAnimationFrame(() => {
          if (cancelled) return;
          if (ownPane.current !== null)
            revealAnchor(binding, anchor, ownPane.current);
          binding.editor.getRootElement()?.focus({ preventScroll: true });
        });
      } else
        setNotice(
          "This passage cannot be opened yet. Your place is preserved.",
        );
    };
    const onCompositionEnd = () => {
      timer = setTimeout(apply, 0);
    };
    cancelTransfer.current = () => {
      cancelled = true;
      clearTimeout(timer);
      if (frame !== undefined) cancelAnimationFrame(frame);
      root?.removeEventListener("compositionend", onCompositionEnd);
    };
    if (binding.editor.isComposing()) {
      setNotice("Your composition will finish before changing places.");
      root?.addEventListener("compositionend", onCompositionEnd, {
        once: true,
      });
    } else apply();
  };

  const returnToPlace = () => {
    if (binding !== null && returnPlace.current !== null) {
      const resolved = resolvePlace(binding, returnPlace.current);
      if (resolved !== null) {
        transfer(resolved.selection);
        setNotice(resolved.explanation);
      }
    }
    void send({ type: "stop" });
    setView(null);
    returnPlace.current = null;
    setSuspended(false);
    interrupted.current = false;
  };

  const invitation = invitationSender?.collaboration?.invitation;
  const inviteCard =
    enabled && invitationSender !== undefined && invitation != null ? (
      <AttentionInvitation
        senderName={invitationSender.name}
        remainingSeconds={Math.max(
          0,
          Math.ceil((invitation.expiresAt - now) / 1_000),
        )}
        pending={pending || binding === null}
        onAccept={async () => {
          if (binding === null || invitationSender.sessionId === undefined)
            return;
          const place = capturePlace(binding);
          if (
            await send({
              type: "respond",
              senderSessionId: invitationSender.sessionId,
              invitationId: invitation.id,
              outcome: "accepted",
            })
          ) {
            if (returnPlace.current === null) returnPlace.current = place;
            setView({
              sessionId: invitationSender.sessionId,
              name: invitationSender.name,
              anchor: invitation.anchor,
            });
            setMobileView("shared");
            setNotice(null);
          }
        }}
        onDismiss={() => {
          void send({
            type: "respond",
            senderSessionId: invitationSender.sessionId!,
            invitationId: invitation.id,
            outcome: "dismissed",
          });
        }}
      />
    ) : null;

  return (
    <div className="shared-session flex min-h-0 flex-1 flex-col">
      {enabled ? (
        <div className="flex flex-wrap items-center gap-2 border-b px-4 py-0 sm:py-2">
          <Button
            variant="ghost"
            size="sm"
            aria-expanded={peopleOpen}
            aria-label="People and activity"
            onClick={() => setPeopleOpen(!peopleOpen)}
          >
            <span className="hidden sm:inline">People and activity</span>
            <span className="sm:hidden">People</span>{" "}
            <span className="font-mono text-muted-foreground">
              {others.length + (self === null ? 0 : 1)}
            </span>
          </Button>
          <span className="mr-auto hidden text-xs text-muted-foreground sm:inline">
            {connectionState === "connected"
              ? "Together in this document"
              : "Live presence reconnecting"}
          </span>
          <Button
            variant="ghost"
            size="sm"
            aria-pressed={preferences.focusMode}
            aria-label={
              preferences.focusMode ? "Leave focus mode" : "Focus mode"
            }
            onClick={() =>
              updateCollaborationPreferences({
                focusMode: !preferences.focusMode,
              })
            }
          >
            <span className="hidden sm:inline">
              {preferences.focusMode ? "Leave focus mode" : "Focus mode"}
            </span>
            <span className="sm:hidden">
              {preferences.focusMode ? "Leave focus" : "Focus"}
            </span>
          </Button>
          {supported ? (
            <Button
              variant="outline"
              size="sm"
              disabled={pending}
              aria-pressed={self?.collaboration?.presenting === true}
              aria-label={
                self?.collaboration?.presenting
                  ? "Stop presenting"
                  : "Present my place"
              }
              onClick={() =>
                void send({
                  type: "present",
                  enabled: !self?.collaboration?.presenting,
                })
              }
            >
              <span className="hidden sm:inline">
                {self?.collaboration?.presenting
                  ? "Stop presenting"
                  : "Present my place"}
              </span>
              <span className="sm:hidden">
                {self?.collaboration?.presenting
                  ? "Stop presenting"
                  : "Present"}
              </span>
            </Button>
          ) : null}
        </div>
      ) : null}
      {peopleOpen && enabled ? (
        <section
          className="border-b bg-raised p-4"
          aria-label="People and activity"
        >
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm font-medium">Choose who should look here</p>
            <span className="text-xs text-muted-foreground">
              Focus mode keeps you visible to others.
            </span>
          </div>
          <div className="flex flex-wrap gap-3">
            {available.map((person) => (
              <label
                key={person.connectionId}
                className="flex min-h-11 items-center gap-2 rounded-lg border px-3 text-sm"
              >
                <input
                  type="checkbox"
                  checked={recipients.includes(person.sessionId!)}
                  onChange={(event) =>
                    setRecipients((current) =>
                      event.target.checked
                        ? [...current, person.sessionId!]
                        : current.filter((id) => id !== person.sessionId),
                    )
                  }
                />
                <span>{person.name}</span>
                <span className="text-xs text-muted-foreground">
                  {person.collaboration?.presenting
                    ? "Presenting"
                    : person.meta?.activity === "editing"
                      ? "Editing"
                      : "Viewing"}
                  {binding !== null &&
                  sectionForParticipant(
                    person,
                    binding.replica.getDocument().blocks,
                  ) !== null
                    ? ` · ${sectionForParticipant(person, binding.replica.getDocument().blocks)}`
                    : ""}
                </span>
              </label>
            ))}
          </div>
          {available.length === 0 ? (
            <p className="py-2 text-sm text-muted-foreground">
              No other supported sessions are available. Share this document to
              work together.
            </p>
          ) : null}
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <Button
              size="sm"
              disabled={
                !supported ||
                selection === null ||
                recipients.length === 0 ||
                pending
              }
              onClick={async () => {
                if (
                  selection !== null &&
                  (await send({
                    type: "invite",
                    anchor: selection,
                    recipients,
                  }))
                )
                  setNotice("Invitation sent. It expires in 30 seconds.");
              }}
            >
              Look here
            </Button>
            <span className="text-xs text-muted-foreground">
              {recipients.length} selected session
              {recipients.length === 1 ? "" : "s"} · invitation only
            </span>
            {self?.collaboration?.invitation != null &&
            self.collaboration.invitation.expiresAt > now ? (
              <Button
                variant="ghost"
                size="sm"
                onClick={() =>
                  void send({
                    type: "cancel",
                    invitationId: self.collaboration!.invitation!.id,
                  })
                }
              >
                Cancel invitation
              </Button>
            ) : null}
          </div>
          {preferences.focusMode ? inviteCard : null}
        </section>
      ) : null}
      {!preferences.focusMode && inviteCard !== null ? (
        <div className="p-3">{inviteCard}</div>
      ) : null}
      {notice !== null ? (
        <div
          className="flex items-center gap-3 border-b px-4 py-2 text-xs"
          role="status"
        >
          <span className="flex-1">{notice}</span>
          <button aria-label="Dismiss status" onClick={() => setNotice(null)}>
            Dismiss
          </button>
        </div>
      ) : null}
      {view !== null ? (
        <div className="flex flex-wrap items-center gap-x-2 gap-y-0 border-b px-4 py-2 text-xs">
          <span className="mr-auto basis-full sm:basis-auto">
            {following
              ? `Following ${view.name}`
              : `Shared context · ${view.name}`}
          </span>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              suspend();
              setMobileView("mine");
            }}
          >
            My place
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setMobileView("shared")}
          >
            Shared view
          </Button>
          <Button
            size="sm"
            variant="outline"
            aria-label="Return to my place"
            onClick={returnToPlace}
          >
            <span className="sm:hidden">Return</span>
            <span className="hidden sm:inline">Return to my place</span>
          </Button>
        </div>
      ) : null}
      <DocumentOutline binding={binding} onNavigate={transfer} />
      <div
        className="attention-layout"
        data-context={view !== null}
        data-mobile-view={mobileView}
      >
        <div
          className="attention-editor"
          ref={ownPane}
          onWheel={suspend}
          onTouchMove={suspend}
          onKeyDown={(event) => {
            if (
              [
                "PageDown",
                "PageUp",
                "Home",
                "End",
                "ArrowDown",
                "ArrowUp",
              ].includes(event.key)
            )
              suspend();
          }}
        >
          {children}
        </div>
        {view !== null && binding !== null ? (
          <aside
            className="attention-context attention-seam"
            aria-label="Shared context"
          >
            <div className="flex flex-wrap items-center gap-2 border-b p-3">
              <span className="mr-auto text-xs text-muted-foreground">
                Read-only shared view
              </span>
              {presenter?.collaboration?.presenting ? (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={pending || !supported}
                  onClick={async () => {
                    if (following) suspend();
                    else if (
                      await send(
                        relationship == null
                          ? { type: "follow", sessionId: view.sessionId }
                          : { type: "resume" },
                      )
                    ) {
                      interrupted.current = false;
                      setSuspended(false);
                    }
                  }}
                >
                  {following
                    ? "Pause following"
                    : relationship != null || suspended
                      ? "Resume"
                      : "Follow presenter"}
                </Button>
              ) : null}
              <Button
                size="sm"
                disabled={!binding.editor.isEditable()}
                onClick={() => transfer(view.anchor)}
              >
                Edit here
              </Button>
            </div>
            <SharedDocumentProjection source={binding} anchor={view.anchor} />
          </aside>
        ) : null}
      </div>
    </div>
  );
}

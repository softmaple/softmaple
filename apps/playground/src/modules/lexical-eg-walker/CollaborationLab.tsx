import type { AdapterConnectionState } from "@softmaple/awareness";
import { PanelRightClose, PanelRightOpen } from "lucide-react";
import { toast } from "sonner";
import { copyText } from "./roomLink";
import {
  connectionDetailLabel,
  formatStorageSize,
  type PersistenceDisplayState,
} from "./syncStatus";

export interface CollaborationLabProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly roomId: string;
  readonly replicaId: string;
  readonly connectionState: AdapterConnectionState;
  readonly transportMode: "websocket" | "broadcast";
  readonly persistenceState: PersistenceDisplayState;
  readonly pendingCount: number;
  readonly durableBatchCount: number;
  readonly storageBytes: number;
}

const LabRow = ({ label, value }: { label: string; value: string }) => (
  <div className="flex items-baseline justify-between gap-3 py-1 text-xs">
    <span className="text-[var(--pg-ink-muted)]">{label}</span>
    <span className="font-[family-name:var(--font-mono)] text-[var(--pg-ink)]">
      {value}
    </span>
  </div>
);

export function CollaborationLab({
  open,
  onOpenChange,
  roomId,
  replicaId,
  connectionState,
  transportMode,
  persistenceState,
  pendingCount,
  durableBatchCount,
  storageBytes,
}: CollaborationLabProps) {
  const transportLabel =
    transportMode === "websocket" ? "WebSocket" : "BroadcastChannel";
  const connected = connectionState === "connected";

  const exportTrace = async () => {
    const trace = JSON.stringify(
      {
        roomId,
        replicaId,
        transport: transportLabel,
        connectionState,
        persistenceState,
        pendingCount,
        durableBatchCount,
        storageBytes,
        exportedAt: new Date().toISOString(),
      },
      null,
      2,
    );
    const copied = await copyText(trace);
    toast[copied ? "success" : "error"](
      copied ? "Debug trace copied" : "Failed to copy debug trace",
    );
  };

  if (!open) {
    return (
      <button
        type="button"
        className="absolute top-3 right-3 z-10 inline-flex items-center gap-1.5 border border-[var(--pg-line)] bg-[var(--pg-surface)]/95 px-2.5 py-1.5 text-[11px] font-semibold text-[var(--pg-ink-muted)] backdrop-blur outline-none transition-colors hover:border-[var(--pg-ink)] hover:text-[var(--pg-ink)] focus-visible:ring-2 focus-visible:ring-[var(--pg-accent)]"
        onClick={() => onOpenChange(true)}
        data-testid="collaboration-lab-open"
      >
        <PanelRightOpen className="size-3.5" aria-hidden />
        Lab
      </button>
    );
  }

  return (
    <aside
      className="flex w-full shrink-0 flex-col border-t border-[var(--pg-line)] bg-[var(--pg-surface)] md:w-[280px] md:border-t-0 md:border-l"
      data-testid="collaboration-lab"
      aria-label="Collaboration Lab"
    >
      <div className="flex items-center justify-between border-b border-[var(--pg-line)] px-3 py-2">
        <h2 className="font-[family-name:var(--font-display)] text-sm font-semibold tracking-[-0.02em]">
          Collaboration Lab
        </h2>
        <button
          type="button"
          className="inline-flex size-7 items-center justify-center text-[var(--pg-ink-muted)] outline-none hover:text-[var(--pg-ink)] focus-visible:ring-2 focus-visible:ring-[var(--pg-accent)]"
          onClick={() => onOpenChange(false)}
          aria-label="Hide Collaboration Lab"
          data-testid="collaboration-lab-close"
        >
          <PanelRightClose className="size-4" aria-hidden />
        </button>
      </div>

      <div className="flex flex-1 flex-col gap-5 overflow-y-auto p-3">
        <section>
          <h3 className="mb-1 font-[family-name:var(--font-mono)] text-[10px] font-semibold tracking-[0.14em] text-[var(--pg-ink-muted)] uppercase">
            Network
          </h3>
          <LabRow
            label="Status"
            value={
              connected
                ? "● Connected"
                : `○ ${connectionDetailLabel(connectionState)}`
            }
          />
          <LabRow label="Transport" value={transportLabel} />
          <LabRow label="Latency" value={connected ? "— ms" : "n/a"} />
        </section>

        <section>
          <h3 className="mb-1 font-[family-name:var(--font-mono)] text-[10px] font-semibold tracking-[0.14em] text-[var(--pg-ink-muted)] uppercase">
            Replica
          </h3>
          <LabRow label="Peer" value={replicaId.slice(0, 10)} />
          <LabRow label="Durable batches" value={String(durableBatchCount)} />
          <LabRow label="Pending" value={String(pendingCount)} />
          <LabRow
            label="Local storage"
            value={formatStorageSize(storageBytes)}
          />
          <LabRow label="Protocol" value="v1 · EG-walker" />
        </section>

        <section className="mt-auto flex flex-col gap-2">
          <p className="text-[11px] leading-relaxed text-[var(--pg-ink-muted)]">
            Offline, latency, and drop-message simulators land next. Export a
            trace to inspect room state now.
          </p>
          <button
            type="button"
            className="border border-[var(--pg-line)] bg-[var(--pg-paper)] px-3 py-2 text-left text-xs font-semibold outline-none transition-colors hover:border-[var(--pg-ink)] focus-visible:ring-2 focus-visible:ring-[var(--pg-accent)]"
            onClick={() => {
              void exportTrace();
            }}
            data-testid="lab-export-trace"
          >
            Export debug trace
          </button>
        </section>
      </div>
    </aside>
  );
}

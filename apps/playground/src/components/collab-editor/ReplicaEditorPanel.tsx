import type { RefObject } from "react";

export type ReplicaEditorPanelProps = {
  readonly editorRef: RefObject<HTMLTextAreaElement | null>;
  readonly label: string;
  readonly labelId: string;
  readonly testId: string;
  readonly placeholder: string;
  readonly focusRingClassName: string;
};

export function ReplicaEditorPanel({
  editorRef,
  label,
  labelId,
  testId,
  placeholder,
  focusRingClassName,
}: ReplicaEditorPanelProps) {
  return (
    <section className="pg-panel flex h-full flex-col overflow-hidden">
      <div className="pg-panel-header px-4 py-3">
        <h2
          id={labelId}
          className="font-[family-name:var(--font-display)] text-lg font-semibold tracking-[-0.02em] text-[var(--pg-ink)]"
        >
          {label}
        </h2>
      </div>
      {/* Native textarea: the collaboration adapter attaches listeners to
       *  this ref and owns `value` imperatively. Avoid controlled wrappers
       *  that can remount or swallow input events. */}
      <textarea
        ref={editorRef}
        data-testid={testId}
        placeholder={placeholder}
        aria-labelledby={labelId}
        className={`h-full min-h-[400px] w-full flex-1 resize-none bg-transparent p-4 text-[var(--pg-ink)] placeholder:text-[var(--pg-ink-muted)] outline-none focus-visible:ring-2 lg:min-h-[600px] ${focusRingClassName}`}
      />
    </section>
  );
}

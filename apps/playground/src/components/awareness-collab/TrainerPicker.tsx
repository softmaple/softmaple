import { DemoPageShell } from "@/components/demo/DemoPageShell";
import { TRAINERS } from "@/modules/awareness-collab/trainers";

interface TrainerPickerProps {
  readonly onSelect: (trainerId: string) => void;
}

export function TrainerPicker({ onSelect }: TrainerPickerProps) {
  return (
    <DemoPageShell
      eyebrow="03 · Awareness lab"
      title="Choose your trainer"
      description="Pick a Pokémon persona for this tab. Open the demo in another tab with a different trainer to see live cursors, selections, and presence sync."
      contentClassName="max-w-3xl"
    >
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4">
        {TRAINERS.map((trainer) => (
          <button
            key={trainer.id}
            type="button"
            onClick={() => onSelect(trainer.id)}
            className="group relative flex flex-col items-center gap-3 border border-[var(--pg-line)] bg-[var(--pg-surface)] p-4 transition-colors hover:border-[var(--pg-ink)]"
            style={
              {
                "--trainer-color": trainer.color,
              } as React.CSSProperties
            }
          >
            <div
              className="pointer-events-none absolute inset-0 opacity-0 transition-opacity group-hover:opacity-15"
              style={{
                background:
                  "radial-gradient(circle at 50% 0%, var(--trainer-color), transparent 60%)",
              }}
            />
            <div
              className="flex h-16 w-16 items-center justify-center sm:h-20 sm:w-20"
              style={{
                background: `color-mix(in srgb, ${trainer.color} 14%, transparent)`,
                boxShadow: `inset 0 0 0 1px color-mix(in srgb, ${trainer.color} 45%, transparent)`,
              }}
            >
              <img
                src={trainer.avatarUrl}
                alt={trainer.name}
                className="h-12 w-12 [image-rendering:pixelated] sm:h-16 sm:w-16"
              />
            </div>
            <div className="text-center">
              <p className="text-sm font-semibold text-[var(--pg-ink)] sm:text-base">
                {trainer.name}
              </p>
              <p
                className="font-[family-name:var(--font-mono)] text-[10px] tracking-wide uppercase"
                style={{ color: trainer.color }}
              >
                {trainer.type}
              </p>
            </div>
          </button>
        ))}
      </div>

      <p className="mt-8 text-center font-[family-name:var(--font-mono)] text-xs text-[var(--pg-ink-muted)]">
        Tip — open this URL in a second browser tab to start collaborating.
      </p>
    </DemoPageShell>
  );
}

"use client";
import { useState } from "react";
import { ArrowUpRight, Check, CornerUpLeft, MousePointer2 } from "lucide-react";
import { Button } from "@softmaple/ui/components/button";

const steps = ["Notice", "Invite", "Work together", "Return"];
export function CollaborationDemo() {
  const [step, setStep] = useState(0);
  return (
    <section
      className="overflow-hidden rounded-xl border bg-surface"
      aria-label="Interactive simulated collaboration demonstration"
    >
      <div className="flex flex-wrap items-center justify-between gap-3 border-b px-5 py-4">
        <span className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
          Interactive demo · simulated people
        </span>
        <div className="flex items-center gap-2 text-xs">
          <span className="grid size-6 place-items-center rounded-full bg-[color-mix(in_srgb,var(--person-blue)_15%,transparent)] text-[var(--person-blue)]">
            L
          </span>
          <span>Lina is here</span>
          <span className="presence-dot" />
        </div>
      </div>
      <div className="grid min-h-80 md:grid-cols-[1fr_0.8fr]">
        <div className="p-6 sm:p-9">
          <p className="mb-8 font-mono text-[10px] text-muted-foreground">
            FIELD NOTES / 001
          </p>
          <h2 className="text-2xl font-medium tracking-tight">
            A thought worth sharing.
          </h2>
          <p className="mt-5 text-sm leading-7 text-muted-foreground">
            A useful idea rarely arrives finished. It needs room, a little
            attention, and another point of view.
          </p>
          <p className="mt-4 text-sm leading-7">
            <span
              className={
                step > 0 && step < 3
                  ? "bg-[color-mix(in_srgb,var(--person-blue)_14%,transparent)]"
                  : ""
              }
            >
              What could we discover together?
            </span>
            <span className="relative ml-1 border-l-2 border-[var(--person-blue)]">
              <span className="absolute left-0 top-5 whitespace-nowrap rounded-r-md rounded-bl-md bg-[var(--person-blue)] px-2 py-0.5 text-[10px] text-surface">
                Lina
              </span>
            </span>
          </p>
          <p className="mt-16 flex items-center gap-1.5 text-xs text-muted-foreground">
            <Check size={13} />
            Your place is saved
          </p>
        </div>
        <div
          className={`flex flex-col justify-center border-t p-6 md:border-l md:border-t sm:p-8 ${step === 2 ? "attention-seam bg-raised" : "bg-workspace"}`}
          aria-live="polite"
        >
          <span className="mb-5 flex size-10 items-center justify-center rounded-xl border bg-surface text-emphasis">
            {step === 3 ? (
              <CornerUpLeft size={18} />
            ) : (
              <MousePointer2 size={18} />
            )}
          </span>
          <p className="text-lg font-medium">
            {
              [
                "Same page. A shared signal.",
                "An invitation, on your terms.",
                "A shared view beside yours.",
                "Back to your own thread.",
              ][step]
            }
          </p>
          <p className="mt-3 text-sm leading-6 text-muted-foreground">
            {
              [
                "See who's working with you. Invite Lina to the passage that matters.",
                "An invitation arrives quietly. Opening it is always your choice.",
                "Keep your writing place while you explore someone else's. Follow only when you're ready.",
                "Your original place is waiting. Keep writing, with a little more perspective.",
              ][step]
            }
          </p>
          <Button
            className="mt-7 self-start"
            onClick={() => setStep((step + 1) % 4)}
          >
            {
              [
                "Try ‘Look here’",
                "Open here",
                "Return to my place",
                "Try it again",
              ][step]
            }
            <ArrowUpRight size={15} />
          </Button>
        </div>
      </div>
      <div className="grid grid-cols-4 border-t">
        {steps.map((label, index) => (
          <button
            key={label}
            onClick={() => setStep(index)}
            aria-current={step === index ? "step" : undefined}
            className={`min-h-14 border-r px-2 text-xs last:border-r-0 ${step === index ? "bg-attention text-emphasis" : "text-muted-foreground hover:bg-accent"}`}
          >
            <span className="mr-2 hidden font-mono sm:inline">
              0{index + 1}
            </span>
            {label}
          </button>
        ))}
      </div>
    </section>
  );
}

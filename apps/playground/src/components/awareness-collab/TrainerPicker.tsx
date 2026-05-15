import { TRAINERS } from "@/modules/awareness-collab/trainers";

interface TrainerPickerProps {
  readonly onSelect: (trainerId: string) => void;
}

export function TrainerPicker({ onSelect }: TrainerPickerProps) {
  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-900 via-slate-800 to-slate-900 flex items-center justify-center p-4">
      <div className="w-full max-w-2xl space-y-8">
        <div className="text-center space-y-3">
          <p className="text-xs uppercase tracking-widest text-cyan-400 font-semibold">
            Pokédex · Trainer Select
          </p>
          <h1 className="text-3xl md:text-4xl font-bold text-white">
            Choose your trainer
          </h1>
          <p className="text-gray-400 max-w-md mx-auto">
            Pick a Pokémon persona for this tab. Open the demo in another tab
            with a different trainer to see live cursors, selections, and
            presence sync.
          </p>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 sm:gap-4">
          {TRAINERS.map((trainer) => (
            <button
              key={trainer.id}
              type="button"
              onClick={() => onSelect(trainer.id)}
              className="group relative flex flex-col items-center gap-3 p-4 rounded-xl bg-slate-800/60 border border-slate-700 hover:border-cyan-500/60 hover:bg-slate-800 transition-all"
              style={
                {
                  "--trainer-color": trainer.color,
                } as React.CSSProperties
              }
            >
              <div
                className="absolute inset-0 rounded-xl opacity-0 group-hover:opacity-20 transition-opacity pointer-events-none"
                style={{
                  background:
                    "radial-gradient(circle at 50% 0%, var(--trainer-color), transparent 60%)",
                }}
              />
              <div
                className="w-16 h-16 sm:w-20 sm:h-20 rounded-full flex items-center justify-center"
                style={{
                  background: `color-mix(in srgb, ${trainer.color} 18%, transparent)`,
                  boxShadow: `0 0 0 2px color-mix(in srgb, ${trainer.color} 40%, transparent)`,
                }}
              >
                <img
                  src={trainer.avatarUrl}
                  alt={trainer.name}
                  className="w-12 h-12 sm:w-16 sm:h-16 [image-rendering:pixelated]"
                />
              </div>
              <div className="text-center">
                <p className="font-semibold text-white text-sm sm:text-base">
                  {trainer.name}
                </p>
                <p
                  className="text-xs uppercase tracking-wide font-medium"
                  style={{ color: trainer.color }}
                >
                  {trainer.type}
                </p>
              </div>
            </button>
          ))}
        </div>

        <p className="text-center text-xs text-gray-500">
          Tip — open this URL in a second browser tab to start collaborating.
        </p>
      </div>
    </div>
  );
}

import type { Message } from "@/db-collections";

export const getAvatarColor = (username: string) => {
  const colors = [
    "bg-[var(--pg-accent)]",
    "bg-teal-700",
    "bg-orange-700",
    "bg-indigo-700",
    "bg-sky-700",
    "bg-rose-700",
    "bg-amber-700",
    "bg-emerald-700",
  ];
  const index = username
    .split("")
    .reduce((acc, char) => acc + char.charCodeAt(0), 0);
  return colors[index % colors.length];
};

export default function Messages({
  messages,
  user,
}: {
  messages: Message[];
  user: string;
}) {
  return (
    <>
      {messages.map((msg: Message) => (
        <div
          key={msg.id}
          className={`flex ${
            msg.user === user ? "justify-end" : "justify-start"
          }`}
        >
          <div
            className={`flex items-start space-x-3 max-w-xs lg:max-w-md ${
              msg.user === user ? "flex-row-reverse space-x-reverse" : ""
            }`}
          >
            <div
              className={`flex h-8 w-8 items-center justify-center rounded-full text-sm font-medium text-white ${getAvatarColor(
                msg.user,
              )}`}
            >
              {msg.user.charAt(0).toUpperCase()}
            </div>

            <div
              className={`rounded-2xl px-4 py-2 ${
                msg.user === user
                  ? "rounded-br-md bg-[var(--pg-accent)] text-white"
                  : "rounded-bl-md border border-[var(--pg-line)] bg-[var(--pg-elevated)] text-[var(--pg-ink)]"
              }`}
            >
              {msg.user !== user && (
                <p className="mb-1 text-xs font-medium text-[var(--pg-ink-muted)]">
                  {msg.user}
                </p>
              )}
              <p className="text-sm">{msg.text}</p>
            </div>
          </div>
        </div>
      ))}
    </>
  );
}

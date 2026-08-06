import type { Message } from "@/db-collections";

export const getAvatarColor = (username: string) => {
  const colors = [
    "bg-[var(--pg-accent)]",
    "bg-teal-500",
    "bg-orange-400",
    "bg-indigo-400",
    "bg-sky-500",
    "bg-rose-400",
    "bg-amber-400",
    "bg-emerald-500",
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

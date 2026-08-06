import { useState } from "react";

import Messages from "@/components/demo.messages";
import { useChat, useMessages } from "@/hooks/demo.useChat";

export default function ChatArea() {
  const { sendMessage } = useChat();

  const messages = useMessages();

  const [message, setMessage] = useState("");
  const [user, setUser] = useState("Alice");

  const postMessage = () => {
    if (message.trim().length) {
      sendMessage(message, user);
      setMessage("");
    }
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      postMessage();
    }
  };

  return (
    <>
      <div className="space-y-4 px-4 py-6">
        <Messages messages={messages} user={user} />
      </div>

      <div className="border-t border-[var(--pg-line)] bg-[var(--pg-surface)] px-4 py-4">
        <div className="flex items-center space-x-3">
          <select
            value={user}
            onChange={(e) => setUser(e.target.value)}
            className="pg-input rounded-md px-3 py-2 text-sm focus:outline-none"
          >
            <option value="Alice">Alice</option>
            <option value="Bob">Bob</option>
          </select>

          <div className="relative flex-1">
            <input
              type="text"
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              onKeyDown={handleKeyPress}
              placeholder="Type a message..."
              className="pg-input w-full rounded-md px-4 py-2 focus:outline-none"
            />
          </div>

          <button
            type="button"
            onClick={postMessage}
            disabled={message.trim() === ""}
            className="pg-btn-primary rounded-md px-6 py-2 transition-opacity focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--pg-accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--pg-paper)] disabled:cursor-not-allowed disabled:opacity-50"
          >
            Send
          </button>
        </div>
      </div>
    </>
  );
}

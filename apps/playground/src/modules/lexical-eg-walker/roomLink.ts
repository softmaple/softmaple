import { toast } from "sonner";

export const buildRoomUrl = (
  roomId: string,
  href = window.location.href,
): string => {
  const url = new URL(href);
  url.searchParams.set("room", roomId);
  return url.toString();
};

export const copyText = async (text: string): Promise<boolean> => {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Fall through to execCommand.
  }

  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.style.position = "fixed";
  textarea.style.top = "-9999px";
  document.body.appendChild(textarea);
  textarea.select();
  const successful = document.execCommand("copy");
  document.body.removeChild(textarea);
  return successful;
};

export const copyRoomLink = async (roomId: string): Promise<boolean> => {
  const link = buildRoomUrl(roomId);
  const copied = await copyText(link);
  if (copied) {
    toast.success("Room link copied");
  } else {
    toast.error("Failed to copy room link", {
      description: `Please copy manually: ${link}`,
    });
  }
  return copied;
};

export const openAnotherWindow = (roomId: string): Window | null =>
  window.open(buildRoomUrl(roomId), "_blank", "noopener,noreferrer");

export const clearRoomLocalData = (roomId: string): number => {
  const encoded = encodeURIComponent(roomId);
  const keys = Object.keys(localStorage).filter(
    (key) => key.includes(roomId) || key.includes(encoded),
  );
  for (const key of keys) {
    localStorage.removeItem(key);
  }
  return keys.length;
};

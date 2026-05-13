const SAFE_PROTOCOLS = new Set(["http:", "https:", "mailto:", "tel:"]);

export const isSafeUrl = (raw: string): boolean => {
  try {
    const base =
      typeof window === "undefined" ? "http://localhost" : window.location.href;
    const { protocol } = new URL(raw, base);
    return SAFE_PROTOCOLS.has(protocol);
  } catch {
    return false;
  }
};

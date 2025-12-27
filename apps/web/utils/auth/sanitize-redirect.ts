/**
 * Sanitizes a redirect URL to prevent open redirect attacks.
 * Only allows relative paths that start with a single "/".
 * Rejects protocol-relative URLs (//), absolute URLs, and URLs with protocols.
 *
 * @param url - The URL to sanitize
 * @returns A safe internal path or "/" as fallback
 */
export function sanitizeRedirectUrl(url: string | null): string {
  // Default to home if no URL provided
  if (!url || url === "") {
    return "/";
  }

  // Remove any whitespace
  const trimmed = url.trim();

  // Reject protocol-relative URLs (start with //)
  if (trimmed.startsWith("//")) {
    return "/";
  }

  // Reject URLs with protocol indicators (contains ://)
  if (trimmed.includes("://") || trimmed.includes(":\\\\")) {
    return "/";
  }

  // Reject URLs with @ character (can be used for auth bypasses)
  if (trimmed.includes("@")) {
    return "/";
  }

  // Reject URLs with backslashes (can be used for path traversal)
  if (trimmed.includes("\\")) {
    return "/";
  }

  // Ensure the URL starts with a single slash
  if (!trimmed.startsWith("/")) {
    return "/";
  }

  // Additional safety: URL decode and check again for malicious patterns
  try {
    const decoded = decodeURIComponent(trimmed);
    if (
      decoded.startsWith("//") ||
      decoded.includes("://") ||
      decoded.includes("@") ||
      decoded.includes("\\")
    ) {
      return "/";
    }
  } catch {
    // If decoding fails, reject the URL
    return "/";
  }

  return trimmed;
}

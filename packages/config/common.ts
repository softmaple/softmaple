/**
 * Central configuration for SoftMaple URLs and constants
 */

export const SOFTMAPLE_URLS = {
  PLAYGROUND: "https://playground.softmaple.ink",
  CONTACT_EMAIL: "mailto:hello@softmaple.ink",
} as const;

export type SoftmapleUrls = typeof SOFTMAPLE_URLS;

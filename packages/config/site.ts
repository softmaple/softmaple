/**
 * Central configuration for SoftMaple URLs and constants
 */

export const SITE = {
  PLAYGROUND: "https://playground.softmaple.ink",
  CONTACT_EMAIL: "hello@softmaple.ink",
  GITHUB_REPO: "https://github.com/softmaple/softmaple",
  TWITTER: "https://twitter.com/shadcn",
} as const;

export const NETLIFY_URLS = {
  WEBSITE: "https://www.netlify.com",
  BADGE_IMAGE:
    "https://www.netlify.com/assets/badges/netlify-badge-color-accent.svg",
} as const;

export const OPENGRAPH_IMAGE =
  "https://opengraph.b-cdn.net/production/images/81042fbb-a0bb-4798-9182-3136b7577860.png?token=bZ-vFnt2m-OhFa-a0fowx1U6zcej1aVmJrA8shpnZts&height=800&width=1200&expires=33284239252";

export type Site = typeof SITE;
export type NetlifyUrls = typeof NETLIFY_URLS;

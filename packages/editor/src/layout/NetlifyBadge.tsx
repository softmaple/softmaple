import type { FC } from "react";
import { NETLIFY_URLS } from "@softmaple/config";

// https://www.netlify.com/about/#badges
export const NetlifyBadge: FC = () => {
  return (
    <a
      href={NETLIFY_URLS.WEBSITE}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-block"
    >
      <img
        loading="lazy"
        src={NETLIFY_URLS.BADGE_IMAGE}
        alt="Deploys by Netlify"
        className="h-8 w-auto max-w-[120px]"
      />
    </a>
  );
};

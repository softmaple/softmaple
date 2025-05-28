import type { FC } from "react";

// https://www.netlify.com/about/#badges
export const NetlifyBadge: FC = () => {
  return (
    <a
      href="https://www.netlify.com"
      target="_blank"
      rel="noopener noreferrer"
      className="inline-block"
    >
      <img
        loading="lazy"
        src="https://www.netlify.com/assets/badges/netlify-badge-color-accent.svg"
        alt="Deploys by Netlify"
      />
    </a>
  );
};

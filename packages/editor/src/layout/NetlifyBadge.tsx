import type { FC } from "react";

export const NetlifyBadge: FC = () => {
  return (
    <a
      href="https://www.netlify.com"
      target="_blank"
      rel="noopener noreferrer"
      className="inline-block"
    >
      <img
        src="https://www.netlify.com/v3/img/components/netlify-color-accent.svg"
        alt="Deploys by Netlify"
        className="h-8"
      />
    </a>
  );
};

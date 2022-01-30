import React, { FC, useEffect } from "react";
import useThemeContext from "@theme/hooks/useThemeContext";

type TwitterEmbeddedProps = {
  children: React.ReactNode;
};

/**
 * Embeds a twitter post.
 *
 * click `Embed Twitter` on the tweet and it will be generated from here: https://publish.twitter.com/
 */
export const TwitterEmbedded: FC<TwitterEmbeddedProps> = ({ children }) => {
  const { isDarkTheme } = useThemeContext();

  useEffect(() => {
    const script = document.createElement("script");
    script.src = "https://platform.twitter.com/widgets.js";
    script.async = true;
    document.body.appendChild(script);

    return () => {
      document.body.removeChild(script);
    };
  }, []);

  return (
    <blockquote
      className="twitter-tweet"
      data-theme={isDarkTheme ? "dark" : "light"}
      // TODO: Remount the DOM when color changes
      // key={isDarkTheme}
    >
      {children}
    </blockquote>
  );
};

import { css, Global } from "@emotion/react";

export const globalStyles = (
  <Global
    styles={css`
      :root {
        height: 100%;
      }

      #__next {
        width: fit-content;
        height: 100%;
      }
    `}
  />
);

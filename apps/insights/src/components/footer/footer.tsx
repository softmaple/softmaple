import React, { FC } from "react";
import type { PaletteMode } from "@mui/material";
import Image from "next/image";
import { FooterContainer, VercelBanner } from "./footer.style";

type FooterProps = {
  mode: PaletteMode;
};

const banners = {
  dark: "/assets/vercel/dark/powered-by-vercel.svg",
  light: "/assets/vercel/light/powered-by-vercel.svg",
};

export const Footer: FC<FooterProps> = ({ mode }) => {
  const bannerSrc = banners[mode];

  return (
    <FooterContainer>
      <VercelBanner>
        <a
          target="_blank"
          rel="noopener noreferrer"
          href="https://vercel.com?utm_source=SoftMaple&utm_campaign=oss"
          style={{ marginLeft: "1.125rem" }}
        >
          <Image
            src={bannerSrc}
            alt="Powered by Vercel"
            width="212"
            height="32"
          />
        </a>
      </VercelBanner>
    </FooterContainer>
  );
};

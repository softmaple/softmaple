import React, { FC } from "react";
import Image from "next/image";
import type { PaletteMode } from "@mui/material";
import { FooterContainer, VercelBanner } from "./footer.style";
import LightVercelBanner from "../../../public/assets/vercel/light/powered-by-vercel.svg";
import DarkVercelBanner from "../../../public/assets/vercel/dark/powered-by-vercel.svg";

type FooterProps = {
  mode: PaletteMode;
};

export const Footer: FC<FooterProps> = ({ mode }) => {
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
            src={mode === "light" ? LightVercelBanner : DarkVercelBanner}
            alt="Powered by Vercel"
            height="32"
          />
        </a>
      </VercelBanner>
    </FooterContainer>
  );
};

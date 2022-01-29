import React, { FC } from "react";
import Image from "next/image";
import { FooterContainer, VercelBanner } from "./footer.style";
import LightVercelBanner from "../../../public/assets/vercel/light/powered-by-vercel.svg";
import DarkVercelBanner from "../../../public/assets/vercel/dark/powered-by-vercel.svg";

type FooterProps = {
  isDarkMode: boolean;
};

export const Footer: FC<FooterProps> = ({ isDarkMode }) => {
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
            src={isDarkMode ? DarkVercelBanner : LightVercelBanner}
            alt="Powered by Vercel"
            height="32"
          />
        </a>
      </VercelBanner>
    </FooterContainer>
  );
};

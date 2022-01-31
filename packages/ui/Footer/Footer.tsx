import React, { FC } from "react";
import { FooterContainer } from "./footer.style";

type FooterProps = {
  children: React.ReactNode;
};

export const Footer: FC<FooterProps> = ({ children }) => {
  return <FooterContainer>{children}</FooterContainer>;
};

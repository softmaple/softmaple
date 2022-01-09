import React, { FC } from "react";
import styled from "@emotion/styled";
import GitHubIcon from "@mui/icons-material/GitHub";
import Link from "@mui/material/Link";

const StyledHeader = styled.div`
  display: flex;
  justify-content: flex-end;
  align-items: center;
  gap: 1rem;
`;

type HeaderProps = {
  children: React.ReactNode;
};

export const Header: FC<HeaderProps> = ({ children }) => {
  return (
    <StyledHeader>
      <Link
        href="https://website.softmaple.xyz/"
        underline="none"
        target="_blank"
        rel="noreferrer"
        style={{ marginLeft: "1rem", marginRight: "auto" }}
      >
        Homepage
      </Link>
      <Link
        href="https://github.com/SoftMaple/github-insights-view"
        underline="none"
        target="_blank"
        rel="noreferrer"
      >
        <GitHubIcon
          fontSize="large"
          color="action"
          style={{ display: "block" }}
        />
      </Link>
      {children}
    </StyledHeader>
  );
};

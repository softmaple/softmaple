import React, { FC } from "react";
import styled from "@emotion/styled";
import Link from "@mui/material/Link";
import GitHubIcon from "@mui/icons-material/GitHub";

const StyledHeader = styled.div`
  display: flex;
  justify-content: flex-end;
  align-items: center;
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
        sx={{ marginLeft: "1rem", marginRight: "auto" }}
      >
        SoftMaple
      </Link>
      <Link
        href="https://github.com/SoftMaple/Editor"
        underline="none"
        target="_blank"
        rel="noreferrer"
        aria-label="GitHub"
      >
        <GitHubIcon
          fontSize="large"
          color="inherit"
          style={{ display: "block" }}
        />
      </Link>
      {children}
    </StyledHeader>
  );
};

import React, { FC } from "react";
import styled from "@emotion/styled";
import GitHubIcon from "@mui/icons-material/GitHub";
import Link from "@mui/material/Link";

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
        href="https://docs.softmaple.xyz/"
        underline="none"
        target="_blank"
        rel="noreferrer"
        sx={{ marginLeft: "1rem", marginRight: "auto" }}
      >
        SoftMaple
      </Link>
      <Link
        href="https://app.splitbee.io/public/softmaple.xyz"
        underline="none"
        target="_blank"
        rel="noreferrer"
        sx={{ marginRight: "1rem" }}
      >
        Splitbee
      </Link>
      <Link
        href="https://github.com/softmaple/softmaple"
        underline="none"
        target="_blank"
        rel="noreferrer"
        aria-label="Github"
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

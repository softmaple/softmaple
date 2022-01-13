import React, { FC } from "react";
import styled from "@emotion/styled";
import { SourceCodeWrapper } from "./latex-container.style";

const Wrapper = styled(SourceCodeWrapper)``;

type LightWrapperProps = {
  children: React.ReactNode;
};

export const LightWrapper: FC<LightWrapperProps> = ({ children }) => (
  <Wrapper>{children}</Wrapper>
);

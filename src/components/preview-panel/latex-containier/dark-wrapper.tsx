import React, { FC } from "react";
import styled from "@emotion/styled";
import { SourceCodeWrapper } from "./latex-container.style";

const Wrapper = styled(SourceCodeWrapper)`
  /*!
  Theme: GitHub Dark Dimmed
  Description: Dark dimmed theme as seen on github.com
  Author: github.com
  Maintainer: @Hirse
  Updated: 2021-05-15

  Colors taken from GitHub's CSS

  highlight.js/styles/github-dark-dimmed.css
*/

  .hljs {
    color: #adbac7;
    background: #22272e;
  }

  .hljs-doctag,
  .hljs-keyword,
  .hljs-meta .hljs-keyword,
  .hljs-template-tag,
  .hljs-template-variable,
  .hljs-type,
  .hljs-variable.language_ {
    /* prettylights-syntax-keyword */
    color: #f47067;
  }

  .hljs-title,
  .hljs-title.class_,
  .hljs-title.class_.inherited__,
  .hljs-title.function_ {
    /* prettylights-syntax-entity */
    color: #dcbdfb;
  }

  .hljs-attr,
  .hljs-attribute,
  .hljs-literal,
  .hljs-meta,
  .hljs-number,
  .hljs-operator,
  .hljs-variable,
  .hljs-selector-attr,
  .hljs-selector-class,
  .hljs-selector-id {
    /* prettylights-syntax-constant */
    color: #6cb6ff;
  }

  .hljs-regexp,
  .hljs-string,
  .hljs-meta .hljs-string {
    /* prettylights-syntax-string */
    color: #96d0ff;
  }

  .hljs-built_in,
  .hljs-symbol {
    /* prettylights-syntax-variable */
    color: #f69d50;
  }

  .hljs-comment,
  .hljs-code,
  .hljs-formula {
    /* prettylights-syntax-comment */
    color: #768390;
  }

  .hljs-name,
  .hljs-quote,
  .hljs-selector-tag,
  .hljs-selector-pseudo {
    /* prettylights-syntax-entity-tag */
    color: #8ddb8c;
  }

  .hljs-subst {
    /* prettylights-syntax-storage-modifier-import */
    color: #adbac7;
  }

  .hljs-section {
    /* prettylights-syntax-markup-heading */
    color: #316dca;
    font-weight: bold;
  }

  .hljs-bullet {
    /* prettylights-syntax-markup-list */
    color: #eac55f;
  }

  .hljs-emphasis {
    /* prettylights-syntax-markup-italic */
    color: #adbac7;
    font-style: italic;
  }

  .hljs-strong {
    /* prettylights-syntax-markup-bold */
    color: #adbac7;
    font-weight: bold;
  }

  .hljs-addition {
    /* prettylights-syntax-markup-inserted */
    color: #b4f1b4;
    background-color: #1b4721;
  }

  .hljs-deletion {
    /* prettylights-syntax-markup-deleted */
    color: #ffd8d3;
    background-color: #78191b;
  }

  .hljs-char.escape_,
  .hljs-link,
  .hljs-params,
  .hljs-property,
  .hljs-punctuation,
  .hljs-tag {
    /* purposely ignored */
  }
`;

type DarkWrapperProps = {
  children: React.ReactNode;
};

export const DarkWrapper: FC<DarkWrapperProps> = ({ children }) => (
  <Wrapper>{children}</Wrapper>
);

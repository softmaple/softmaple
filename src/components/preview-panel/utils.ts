import { ContentState, convertToRaw, RawDraftContentBlock } from "draft-js";

const texMap: any = {
  "header-one": "\\section",
  "header-two": "\\subsection",
  "header-three": "\\subsubsection",
  "ordered-list-item": "\\item",
  "unordered-list-item": "\\item",
  BOLD: "\\textbf",
  ITALIC: "\\textit",
  UNDERLINE: "\\underline",
  CODE: "\\texttt",
};

/**
 * Scanner for the content of all blocks.
 *
 * @param contentState ContentState
 * @returns string
 */
export function scan(contentState: ContentState) {
  let allTeX: string = "";
  const editorContentRaw = convertToRaw(contentState);

  // console.log(editorContentRaw);

  const { blocks, entityMap } = editorContentRaw;

  blocks.forEach((block: RawDraftContentBlock, index: number) => {
    const { type, text, inlineStyleRanges, entityRanges } = block;
    let tex = "";

    switch (type) {
      // inline style
      case "unstyled":
        if (inlineStyleRanges.length) {
          inlineStyleRanges.forEach(
            (inlineStyleRange, index, rawInlineStyleRanges) => {
              const { offset, length, style } = inlineStyleRange;

              // edge case 1: the first unstyled text
              if (index === 0 && offset !== 0) {
                const sourceCode = text.substring(
                  0,
                  inlineStyleRanges[0].offset
                );
                tex += sourceCode;
              }

              //  normal case
              if (index > 0) {
                // the gap between two styled text
                const gap =
                  rawInlineStyleRanges[index - 1].offset +
                  rawInlineStyleRanges[index - 1].length;

                if (offset > gap) {
                  const sourceCode = text.substring(gap, offset);
                  tex += sourceCode;
                }
              }

              const content = text.substring(offset, offset + length);
              const sourceCode = `${texMap[style]}{${content}}`;

              tex += sourceCode;

              // edge case 2: the last unstyled text
              if (
                index === inlineStyleRanges.length - 1 &&
                offset + length !== inlineStyleRanges.length - 1
              ) {
                const sourceCode = text.substring(offset + length);

                tex += sourceCode;
              }
            }
          );
        } else if (entityRanges.length) {
          // TODO
        } else {
          tex += text;
        }
        break;
      case "atomic":
        entityRanges.forEach((entityRange) => {
          const { key } = entityRange;
          if (entityMap[key].type === "MATH") {
            const { content } = entityMap[key].data;

            const beginning = `\\begin{equation}`;
            const ending = `\\end{equation}`;

            const sourceCode = `${beginning}\n${content}\n${ending}`;

            tex += sourceCode;
          } else {
            // TODO
          }
        });
        break;
      case "code-block":
        // TODO
        break;
      case "ordered-list-item":
      case "unordered-list-item":
        if (
          !blocks[index - 1] ||
          blocks[index - 1].type !== type ||
          (blocks[index - 1].type === type &&
            blocks[index - 1].depth < block.depth)
        ) {
          const beginning =
            type === "ordered-list-item"
              ? "\\begin{enumerate}\n"
              : "\\begin{itemize}\n";

          tex += beginning;
        }
        const sourceCode = `${texMap[type]} ${text}\n`;

        tex += sourceCode;
        if (
          !blocks[index + 1] ||
          blocks[index + 1].type !== type ||
          (blocks[index + 1].type === type &&
            blocks[index + 1].depth < block.depth)
        ) {
          const ending =
            type === "ordered-list-item"
              ? "\\end{enumerate}\n"
              : "\\end{itemize}\n";

          tex += ending;
        }
        break;
      default:
        const defaultSourceCode = `${texMap[type]}{${text}}`;
        tex += defaultSourceCode;
    }

    allTeX += tex;
    allTeX += "\n";
  });

  return allTeX;
}

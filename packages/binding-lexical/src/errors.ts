export class UnsupportedLexicalNodeError extends Error {
  readonly nodeType: string;

  constructor(nodeType: string, detail?: string) {
    super(
      `Unsupported Lexical node "${nodeType}"${detail === undefined ? "" : `: ${detail}`}`,
    );
    this.name = "UnsupportedLexicalNodeError";
    this.nodeType = nodeType;
  }
}

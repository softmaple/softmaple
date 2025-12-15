import DOMPurify, { type Config as DomPurifyConfig } from "dompurify";

// Conservative HTML preview: allow plain HTML only, block forms/embeds/SVG/MathML/styles.
const DOMPURIFY_CONFIG: DomPurifyConfig = {
  FORBID_TAGS: [
    "form",
    "input",
    "textarea",
    "button",
    "select",
    "option",
    "style",
    "iframe",
    "object",
    "embed",
    "svg",
    "math",
    "script",
    "noscript",
    "template",
    "base",
    "link",
    "meta",
  ],
  ALLOW_DATA_ATTR: false,
  FORBID_ATTR: ["style"],
  KEEP_CONTENT: false,
  SAFE_FOR_TEMPLATES: true,
};

/**
 * Sanitizes HTML content to prevent XSS attacks.
 * Converts newlines to <br> tags for proper display.
 *
 * @param content - The raw HTML/text content to sanitize
 * @returns Sanitized HTML string safe for dangerouslySetInnerHTML
 */
export function sanitizeHtml(content: string): string {
  return DOMPurify.sanitize(content.replace(/\n/g, "<br>"), DOMPURIFY_CONFIG);
}

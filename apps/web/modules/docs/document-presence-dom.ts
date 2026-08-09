export type DomPoint = { readonly node: Node; readonly offset: number };

export const domPointAtOffset = (
  element: HTMLElement,
  requestedOffset: number,
): DomPoint => {
  const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
  let remaining = Math.max(0, requestedOffset);
  let lastText: Text | null = null;
  let node = walker.nextNode();

  while (node !== null) {
    if (node instanceof Text) {
      lastText = node;
      const length = node.data.length;
      if (remaining <= length) return { node, offset: remaining };
      remaining -= length;
    }
    node = walker.nextNode();
  }

  return lastText === null
    ? { node: element, offset: 0 }
    : { node: lastText, offset: lastText.data.length };
};

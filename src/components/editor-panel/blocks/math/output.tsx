import { FC, useRef, useEffect } from "react";
import katex from "katex";

type OutputProps = {
  content: string;
  onClick: (e: React.MouseEvent<HTMLSpanElement>) => void;
};

export const Output: FC<OutputProps> = ({ content, onClick }) => {
  const containerRef = useRef<HTMLSpanElement | null>(null);

  function usePrevious(value: unknown) {
    const ref = useRef<unknown>(null);

    useEffect(() => {
      ref.current = value;
    });

    return ref.current;
  }

  const prevContent = usePrevious(content);

  useEffect(() => {
    if (prevContent !== content) {
      // update output rendering
      katex.render(content, containerRef.current, { displayMode: true });
    }
  }, [content, prevContent]);

  return <span ref={containerRef} onClick={onClick} />;
};

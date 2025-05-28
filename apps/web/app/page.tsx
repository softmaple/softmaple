import { Button } from "@softmaple/ui/components/button";
import { Editor } from "@/components/editor/core-editor";

export default function Page() {
  return (
    <div className="flex items-center justify-center min-h-svh">
      <div className="flex flex-col items-center justify-center gap-4">
        <Editor />
      </div>
    </div>
  );
}

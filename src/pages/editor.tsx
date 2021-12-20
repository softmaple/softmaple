import { SoftMapleEditor } from "@/components/soft-maple-editor";
import { isMobile } from "react-device-detect";

export default function Editor() {
  if (isMobile) {
    return <div>Sorry, this editor is not supported on mobile devices.</div>;
  }

  return <SoftMapleEditor />;
}

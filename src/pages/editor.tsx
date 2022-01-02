import { MobileView } from "@/components/mobile-view";
import { SoftMapleEditor } from "@/components/soft-maple-editor";
import type { GetServerSideProps } from "next";

export default function Editor({ isMobile }) {
  return isMobile ? <MobileView /> : <SoftMapleEditor />;
}

/**
 * @see https://stackoverflow.com/a/60146925/8537000
 */
export const getServerSideProps: GetServerSideProps = async (context) => {
  const UA = context.req.headers["user-agent"];
  const isMobile = Boolean(
    UA.match(
      /Android|BlackBerry|iPhone|iPad|iPod|Opera Mini|IEMobile|WPDesktop/i
    )
  );

  return {
    props: {
      isMobile,
    },
  };
};

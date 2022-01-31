import { useState } from "react";
import type { GetServerSideProps } from "next";
import Image from "next/image";
import type { PaletteMode } from "@mui/material";
import styled from "@emotion/styled";
import type { Clone, View } from "@/types";
import { Layout, Header, Palette, Footer } from "ui";
import { DashboardTabs } from "@/components/dashboard-tabs";

const banners = {
  dark: "/assets/vercel/dark/powered-by-vercel.svg",
  light: "/assets/vercel/light/powered-by-vercel.svg",
};

const VercelBanner = styled.div`
  display: flex;
  justify-content: flex-start;
`;

type Data = {
  clones: Clone[];
  views: View[];
};

type DashboardProps = {
  data: Data;
  error: null | {};
};

export default function Dashboard({ data, error }: DashboardProps) {
  const [mode, setMode] = useState<PaletteMode>("light");

  const bannerSrc = banners[mode];

  if (error) {
    return <div>Something wrong when fetching data...</div>;
  }

  const { clones, views } = data;

  return (
    <Layout mode={mode}>
      <Header showAnalytics={true}>
        <Palette mode={mode} setMode={setMode} />
      </Header>
      <DashboardTabs clones={clones} views={views} mode={mode} />
      <Footer>
        <VercelBanner>
          <a
            target="_blank"
            rel="noopener noreferrer"
            href="https://vercel.com?utm_source=SoftMaple&utm_campaign=oss"
            style={{ marginLeft: "1.125rem" }}
          >
            <Image
              src={bannerSrc}
              alt="Powered by Vercel"
              width="212"
              height="32"
            />
          </a>
        </VercelBanner>
      </Footer>
    </Layout>
  );
}

export const getServerSideProps: GetServerSideProps = async (context) => {
  let data: Partial<Data> = {},
    error = null;

  const { host } = context.req.headers;

  const origin =
    process.env.NODE_ENV === "development"
      ? "http://localhost:3000"
      : `https://${host}`;

  try {
    await fetch(`${origin}/api/clones`)
      .then((res) => res.json())
      .then((res) => (data.clones = res.clones));

    await fetch(`${origin}/api/views`)
      .then((res) => res.json())
      .then((res) => (data.views = res.views));
  } catch (err) {
    error = err.message;
  }

  return {
    props: {
      data,
      error,
    },
  };
};

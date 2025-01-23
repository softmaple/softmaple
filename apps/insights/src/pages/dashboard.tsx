import { useState } from "react";
import type { GetServerSideProps } from "next";
import type { PaletteMode } from "@mui/material";
import styled from "@emotion/styled";
import type { Clone, View } from "@/types";
import { Layout, Header, Palette, Footer } from "ui";
import { DashboardTabs } from "@/components/dashboard-tabs";

const NetlifyBanner = styled.div`
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

  if (error) {
    return <div>Something wrong when fetching data...</div>;
  }

  const { clones, views } = data;

  return (
    <Layout mode={mode}>
      <Header showAnalytics={true}>
        <Palette mode={mode} setMode={setMode} />
      </Header>

      <div>
        <b>Deprecated</b>
      </div>

      <DashboardTabs clones={clones} views={views} mode={mode} />
      <Footer>
        <NetlifyBanner>
          <a href="https://www.netlify.com">
            {" "}
            <img
              src="https://www.netlify.com/v3/img/components/netlify-color-accent.svg"
              alt="Deploys by Netlify"
            />{" "}
          </a>
        </NetlifyBanner>
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
    // await fetch(`${origin}/api/clones`)
    //   .then((res) => res.json())
    //   .then((res) => (data.clones = res.clones));
    // await fetch(`${origin}/api/views`)
    //   .then((res) => res.json())
    //   .then((res) => (data.views = res.views));
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

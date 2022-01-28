import { useState } from "react";
import type { GetServerSideProps } from "next";
import type { Clone, View } from "@/types";
import { Layout } from "@/components/layout";
import { Header } from "@/components/header";
import { SwitchUIButton } from "@/components/switch-ui-button";
import { DashboardTabs } from "@/components/dashboard-tabs";
import { Footer } from "@/components/footer";

type Data = {
  clones: Clone[];
  views: View[];
};

type DashboardProps = {
  data: Data;
  error: null | {};
};

export default function Dashboard({ data, error }: DashboardProps) {
  const [isDarkMode, setIsDarkMode] = useState<boolean>(false);

  if (error) {
    return <div>Something wrong when fetching data...</div>;
  }

  const { clones, views } = data;

  return (
    <Layout isDarkMode={isDarkMode}>
      <Header>
        <SwitchUIButton isDarkMode={isDarkMode} setIsDarkMode={setIsDarkMode} />
      </Header>
      <DashboardTabs clones={clones} views={views} isDarkMode={isDarkMode} />
      <Footer isDarkMode={isDarkMode} />
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

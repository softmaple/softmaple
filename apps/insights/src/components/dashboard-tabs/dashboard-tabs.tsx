import dynamic from "next/dynamic";
import { useState, SyntheticEvent, FC } from "react";
import type { PaletteMode } from "@mui/material";
import Skeleton from "@mui/material/Skeleton";
import Box from "@mui/material/Box";
import Tab from "@mui/material/Tab";
import TabContext from "@mui/lab/TabContext";
import TabList from "@mui/lab/TabList";
import TabPanel from "@mui/lab/TabPanel";
import type { Clone, View } from "@/types";
import { ClonesPanel } from "./clones-panel";

const ViewsPanel = dynamic(
  () => import("./views-panel").then((mod) => mod.ViewsPanel),
  {
    loading: () => (
      <Skeleton variant="rectangular" width="600px" height="300px" />
    ),
  }
);

enum TAB {
  CLONES = "clones",
  VIEWS = "views",
}

type DashboardTabsProps = {
  clones: Clone[];
  views: View[];
  mode: PaletteMode;
};

export const DashboardTabs: FC<DashboardTabsProps> = ({
  clones,
  views,
  mode,
}) => {
  const [activeTab, setActiveTab] = useState<TAB>(TAB.CLONES);

  const handleChange = (event: SyntheticEvent, newTab: TAB) => {
    setActiveTab(newTab);
  };

  return (
    <Box sx={{ width: "100%", typography: "body1" }}>
      <TabContext value={activeTab}>
        <Box sx={{ borderBottom: 1, borderColor: "divider" }}>
          <TabList onChange={handleChange} aria-label="dashboard tabs">
            <Tab label="Clones" value={TAB.CLONES} />
            <Tab label="Views" value={TAB.VIEWS} />
          </TabList>
        </Box>
        <TabPanel value={TAB.CLONES}>
          <ClonesPanel clones={clones} mode={mode} />
        </TabPanel>
        <TabPanel value={TAB.VIEWS}>
          <ViewsPanel views={views} mode={mode} />
        </TabPanel>
      </TabContext>
    </Box>
  );
};

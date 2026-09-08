"use client";

import type { FC, ReactNode } from "react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { FileText, Home, Settings, Users } from "lucide-react";
import { SoftmapleWordmark } from "@/components/BrandMark";
import { AppNavigator } from "@/components/shell/app-navigator";
import { AppRail, type RailItem } from "@/components/shell/app-rail";
import { usePreferences } from "@/components/shell/preferences";
import { WorkspaceDocsList } from "@/modules/workspaces/workspace-docs-list";
import type { DocsType } from "@/types/model";

/**
 * The desktop workspace chrome: a fixed rail of destinations and an optional
 * navigator beside it.
 *
 * The split exists so that navigation can give way before content does. The
 * rail is 64px and never moves; the navigator is the first thing to collapse
 * when width runs short, and collapsing it is a disclosure rather than a
 * navigation, so nothing to its right remounts.
 */

export type WorkspaceShellProps = {
  readonly canEdit: boolean;
  readonly documents: ReadonlyArray<DocsType["Row"]>;
  /** The workspace switcher, shown at the top of the navigator. */
  readonly switcher?: ReactNode;
  readonly initialCursor?: string | null;
  readonly workspaceId: number;
  readonly workspaceSlug: string;
};

export const WorkspaceShell: FC<WorkspaceShellProps> = ({
  canEdit,
  documents,
  initialCursor = null,
  switcher,
  workspaceId,
  workspaceSlug,
}) => {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { preferences, setPreference } = usePreferences();

  const home = `/workspace/${workspaceSlug}`;
  const settings = `${home}/settings`;
  const onSettings = pathname === settings;
  const membersTab = searchParams.get("tab") === "members";

  const items: ReadonlyArray<RailItem> = [
    {
      current: pathname === home,
      href: home,
      icon: <Home className="size-5" />,
      label: "Workspace home",
    },
    {
      current: onSettings && membersTab,
      href: `${settings}?tab=members`,
      icon: <Users className="size-5" />,
      label: "People",
      // Membership-sensitive: speculative prefetch can race session refresh.
      prefetch: false,
    },
    {
      current: onSettings && !membersTab,
      href: settings,
      icon: <Settings className="size-5" />,
      label: "Workspace settings",
      prefetch: false,
    },
  ];

  return (
    <>
      <AppRail
        brand={
          <Link
            aria-label="All workspaces"
            className="inline-flex rounded-sm"
            href="/dashboard"
          >
            <FileText className="size-5 text-emphasis" />
          </Link>
        }
        items={items}
      />
      <AppNavigator
        expanded={preferences.navigatorExpanded}
        header={switcher ?? <SoftmapleWordmark className="text-base" />}
        onExpandedChange={(expanded) =>
          setPreference("navigatorExpanded", expanded)
        }
      >
        <WorkspaceDocsList
          canEdit={canEdit}
          documents={documents}
          initialCursor={initialCursor}
          workspaceId={workspaceId}
          workspaceSlug={workspaceSlug}
        />
      </AppNavigator>
    </>
  );
};

import type { HomeProps } from "./home-types";

/** Dev preview only: never imported by the authenticated Workspace route. */
const members = [
  {
    member_id: "mia",
    user_id: "mia",
    full_name: "Mia",
    avatar_src: "/workspace/mia.jpg",
    role: "OWNER" as const,
    joined_at: "2026-09-22",
    email: "mia@example.test",
  },
  {
    member_id: "leo",
    user_id: "leo",
    full_name: "Leo",
    avatar_src: "/workspace/leo.jpg",
    role: "EDITOR" as const,
    joined_at: "2026-09-22",
    email: "leo@example.test",
  },
  {
    member_id: "sarah",
    user_id: "sarah",
    full_name: "Sarah",
    avatar_src: "/workspace/sarah.jpg",
    role: "VIEWER" as const,
    joined_at: "2026-09-22",
    email: "sarah@example.test",
  },
];
const titles = [
  "A brighter tomorrow",
  "A place for ideas",
  "Small things, big possibilities",
  "Notes from Friday",
  "Product strategy notes",
  "Personal reflection",
];
const previews = [
  "",
  "We believe great ideas happen in the open. Not in isolation, but in conversation....",
  "It’s often the small steps that lead to meaningful change. A kinder internet, perhaps....",
  "Some thoughts from our conversation today. There’s a real opportunity here to...",
];
const writingAt = (lastWrittenAt: string, index: number) => ({
  avatarSrc: members[index]?.avatar_src ?? null,
  fullName: members[index]?.full_name ?? "Member",
  isViewer: false,
  lastWrittenAt,
  userId: members[index]?.user_id ?? `member-${index}`,
});
export const homeFixture: HomeProps = {
  canEdit: true,
  visualFixture: true,
  documentCount: 3,
  workspaceId: 1,
  workspaceSlug: "design-review",
  members,
  activity: {
    observedAt: "2026-09-22T08:03:00Z",
    documents: [
      {
        id: "fixture-0",
        slug: "note-0",
        title: titles[0] ?? "",
        lastWrittenAt: "2026-09-22T08:02:40Z",
        writers: [
          writingAt("2026-09-22T08:02:40Z", 0),
          writingAt("2026-09-22T08:02:15Z", 1),
          writingAt("2026-09-22T08:00:05Z", 2),
        ],
      },
    ],
  },
  profile: {
    id: "adam",
    full_name: "Adam",
    email: "adam@softmaple.com",
    avatar_src: "/workspace/adam.jpg",
  },
  workspaces: [
    {
      id: 1,
      slug: "design-review",
      title: "Adam’s workspace",
      description: "",
      owner_id: "adam",
      avatar_src: null,
      avatar_alt: null,
      created_at: "2026-09-22",
      updated_at: null,
      created_by: null,
      updated_by: null,
      documentCount: 6,
      memberCount: 3,
      lastEditedAt: null,
    },
  ],
  documents: titles.map((title, index) => ({
    id: `fixture-${index}`,
    slug: `note-${index}`,
    title,
    author_id: index === 5 ? "mia" : "adam",
    created_at: "2026-09-22",
    created_by: null,
    is_public: index === 0,
    updated_at: "2026-09-22T08:00:00Z",
    updated_by: null,
    workspace_id: 1,
    preview: previews[index],
    displayTime: ["3m ago", "2h ago", "5h ago", "1d ago", "2h ago", "1d ago"][
      index
    ],
    space: index === 4 ? "Ideas" : index === 5 ? "Personal" : "Product",
    people:
      index === 5 ? members.slice(2) : index === 4 ? members.slice(1) : members,
  })),
};

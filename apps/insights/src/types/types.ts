export enum RepoType {
  "EDITOR" = "Editor",
}

export type Clone = {
  _id: string;
  name: RepoType;
  timestamp: string;
  count: number;
  uniques: number;
};

export type View = {
  _id: string;
  name: RepoType;
  timestamp: string;
  count: number;
  uniques: number;
};

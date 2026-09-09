export type RedesignFlags = {
  readonly shell: boolean;
  readonly presence: boolean;
  readonly attention: boolean;
  readonly field: boolean;
};

/** Server-owned rollout switches; no authorization decisions depend on these. */
export const getRedesignFlags = (): RedesignFlags => ({
  shell: process.env.SOFTMAPLE_REDESIGN_SHELL !== "false",
  presence: process.env.SOFTMAPLE_REDESIGN_PRESENCE !== "false",
  attention: process.env.SOFTMAPLE_REDESIGN_ATTENTION !== "false",
  field: process.env.SOFTMAPLE_REDESIGN_FIELD !== "false",
});

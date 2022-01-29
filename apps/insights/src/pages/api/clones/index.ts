import type { NextApiRequest, NextApiResponse } from "next";
import { advancedResults } from "../index";
import CloneModel from "@/models/clone";

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  try {
    // filter: exclude the data that `count` field is 0
    const clones = await advancedResults(CloneModel, req, {
      count: { $gt: 0 },
    });

    return res.status(200).json({ clones });
  } catch (err) {
    throw new Error(err.message);
  }
}

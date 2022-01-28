import type { NextApiRequest, NextApiResponse } from "next";
import { advancedResults } from "../index";
import ViewModel from "@/models/view";

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  try {
    const views = await advancedResults(ViewModel, req);

    return res.status(200).json({ views });
  } catch (err) {
    throw new Error(err.message);
  }
}

import type { NextApiRequest, NextApiResponse } from "next";
import { FilterQuery, Model } from "mongoose";
import dbConnect from "@/lib/db-connect";

export const advancedResults = async (
  model: Model<any>,
  req: NextApiRequest,
  filter: FilterQuery<any> = {}
) => {
  try {
    await dbConnect();

    switch (req.method) {
      case "GET":
        const data = await model
          .find(
            { ...filter },
            // just return the following fields
            "_id name timestamp count uniques"
          )
          .sort({ timestamp: 1 });

        const results = data.map((doc) => {
          const result = doc.toObject();
          result._id = result._id.toString();
          return result;
        });

        return results;

      default:
        throw new Error("unknown api call");
    }
  } catch (err) {
    throw new Error(err);
  }
};

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  return res.status(400).json({ error: "unknown api call" });
}

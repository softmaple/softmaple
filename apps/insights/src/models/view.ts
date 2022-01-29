import { Schema, models, model } from "mongoose";

const viewSchema = new Schema(
  {
    name: {
      required: true,
      type: String,
    },
    timestamp: {
      type: String,
      default: new Date().toISOString(),
    },
    count: {
      type: Number,
      default: 0,
    },
    uniques: {
      type: Number,
      default: 0,
    },
  },
  { timestamps: true }
);

export default models.View || model("View", viewSchema);

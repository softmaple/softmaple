import { Schema, models, model } from "mongoose";

const cloneSchema = new Schema(
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

export default models.Clone || model("Clone", cloneSchema);

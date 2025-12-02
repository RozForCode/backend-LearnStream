const mongoose = require("mongoose");

const resourceLinkSchema = new mongoose.Schema({
  title: {
    type: String,
    required: true,
  },
  url: {
    type: String,
    required: true,
  },
  type: {
    type: String,
    enum: [
      "documentation",
      "tutorial",
      "video",
      "course",
      "article",
      "github",
      "tool",
      "other",
    ],
    default: "other",
  },
});

const learningStepSchema = new mongoose.Schema(
  {
    title: {
      type: String,
      required: true,
    },
    completed: {
      type: Boolean,
      default: false,
    },
    description: {
      type: String,
      default: "",
    },
    estimatedTime: {
      type: String,
      default: "",
    },
    resources: {
      type: [resourceLinkSchema],
      default: [],
    },
    resourcesStatus: {
      type: String,
      enum: ["pending", "loading", "ready", "failed"],
      default: "pending",
    },
  },
  { _id: true }
);

const resourceSchema = new mongoose.Schema({
  title: {
    type: String,
    required: true,
  },
  category: {
    type: String,
    required: true,
  },
  description: {
    type: String,
  },
  currentSkillLevel: {
    type: String,
  },
  learningGoal: {
    type: String,
  },
  targetSkillLevel: {
    type: String,
  },
  learningPath: {
    type: [learningStepSchema],
    default: [],
  },
  resourcesStatus: {
    type: String,
    enum: ["pending", "loading", "ready", "failed"],
    default: "pending",
  },
  createdAt: {
    type: Date,
    default: Date.now,
  },
});

module.exports = mongoose.model("Resource", resourceSchema);

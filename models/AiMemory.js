const mongoose = require("mongoose");

const messageSchema = new mongoose.Schema({
  role: {
    type: String,
    enum: ["user", "ai"],
    required: true,
  },
  content: {
    type: String,
    required: true,
  },
  timestamp: {
    type: Date,
    default: Date.now,
  },
});

const roadmapContextSchema = new mongoose.Schema(
  {
    id: String,
    title: String,
    category: String,
    currentSkillLevel: String,
    learningGoal: String,
    targetSkillLevel: String,
    totalSteps: Number,
    completedSteps: Number,
    progressPercent: Number,
  },
  { _id: false }
);

const aiMemorySchema = new mongoose.Schema({
  sessionId: {
    type: String,
    required: true,
    unique: true,
    index: true,
  },
  messages: {
    type: [messageSchema],
    default: [],
  },
  context: {
    roadmaps: {
      type: [roadmapContextSchema],
      default: [],
    },
    lastUpdated: {
      type: Date,
      default: Date.now,
    },
  },
  createdAt: {
    type: Date,
    default: Date.now,
  },
  updatedAt: {
    type: Date,
    default: Date.now,
  },
});

// Update the updatedAt timestamp before saving
aiMemorySchema.pre("save", function (next) {
  this.updatedAt = new Date();
  next();
});

// Index for cleanup of old sessions
aiMemorySchema.index({ updatedAt: 1 }, { expireAfterSeconds: 7 * 24 * 60 * 60 }); // 7 days TTL

module.exports = mongoose.model("AiMemory", aiMemorySchema);


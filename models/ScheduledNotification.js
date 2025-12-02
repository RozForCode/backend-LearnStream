const mongoose = require("mongoose");

const scheduledNotificationSchema = new mongoose.Schema({
  // Type of notification
  type: {
    type: String,
    enum: ["streak_reminder", "skill_added", "achievement", "daily_reminder", "custom"],
    required: true,
  },
  // Title for the notification
  title: {
    type: String,
    required: true,
  },
  // Message body
  message: {
    type: String,
    required: true,
  },
  // When to trigger the notification
  scheduledFor: {
    type: Date,
    required: true,
    index: true,
  },
  // Status of the notification
  status: {
    type: String,
    enum: ["pending", "sent", "cancelled"],
    default: "pending",
  },
  // Related data (roadmap ID, etc.)
  metadata: {
    roadmapId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Resource",
    },
    roadmapTitle: String,
    category: String,
    streakCount: Number,
  },
  // When it was actually sent
  sentAt: {
    type: Date,
  },
  // Created timestamp
  createdAt: {
    type: Date,
    default: Date.now,
  },
});

// Index for efficient querying of pending notifications
scheduledNotificationSchema.index({ status: 1, scheduledFor: 1 });

module.exports = mongoose.model("ScheduledNotification", scheduledNotificationSchema);


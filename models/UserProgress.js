const mongoose = require("mongoose");

const activitySchema = new mongoose.Schema({
  date: {
    type: Date,
    required: true,
  },
  type: {
    type: String,
    enum: [
      "step_completed",
      "resource_viewed",
      "note_added",
      "roadmap_created",
    ],
    required: true,
  },
  roadmapId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Resource",
  },
  stepId: {
    type: mongoose.Schema.Types.ObjectId,
  },
  details: {
    type: String,
  },
});

const reminderSchema = new mongoose.Schema({
  enabled: {
    type: Boolean,
    default: false,
  },
  time: {
    type: String, // HH:MM format
    default: "09:00",
  },
  days: {
    type: [String], // ["monday", "tuesday", etc.]
    default: ["monday", "tuesday", "wednesday", "thursday", "friday"],
  },
  lastSent: {
    type: Date,
  },
});

const userProgressSchema = new mongoose.Schema({
  oderId: {
    type: String,
    default: "default", // For now, single user
    unique: true,
  },
  // Streak tracking
  currentStreak: {
    type: Number,
    default: 0,
  },
  longestStreak: {
    type: Number,
    default: 0,
  },
  lastActivityDate: {
    type: Date,
  },
  // Total stats
  totalStepsCompleted: {
    type: Number,
    default: 0,
  },
  totalRoadmapsCreated: {
    type: Number,
    default: 0,
  },
  totalNotesAdded: {
    type: Number,
    default: 0,
  },
  // Activity history (last 90 days for heatmap)
  activities: {
    type: [activitySchema],
    default: [],
  },
  // Reminder settings
  reminder: {
    type: reminderSchema,
    default: () => ({}),
  },
  // Achievements unlocked
  achievements: {
    type: [String],
    default: [],
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

// Method to check and update streak
userProgressSchema.methods.updateStreak = function () {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  if (!this.lastActivityDate) {
    this.currentStreak = 1;
    this.lastActivityDate = today;
    return;
  }

  const lastActivity = new Date(this.lastActivityDate);
  lastActivity.setHours(0, 0, 0, 0);

  const diffDays = Math.floor((today - lastActivity) / (1000 * 60 * 60 * 24));

  if (diffDays === 0) {
    // Same day, no change to streak
    return;
  } else if (diffDays === 1) {
    // Consecutive day, increment streak
    this.currentStreak += 1;
    this.lastActivityDate = today;
  } else {
    // Streak broken, reset to 1
    this.currentStreak = 1;
    this.lastActivityDate = today;
  }

  // Update longest streak if needed
  if (this.currentStreak > this.longestStreak) {
    this.longestStreak = this.currentStreak;
  }
};

// Method to add activity
userProgressSchema.methods.addActivity = function (
  type,
  roadmapId,
  stepId,
  details
) {
  const activity = {
    date: new Date(),
    type,
    roadmapId,
    stepId,
    details,
  };

  this.activities.push(activity);

  // Keep only last 90 days of activities
  const ninetyDaysAgo = new Date();
  ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);
  this.activities = this.activities.filter((a) => a.date >= ninetyDaysAgo);

  // Update stats
  switch (type) {
    case "step_completed":
      this.totalStepsCompleted += 1;
      break;
    case "roadmap_created":
      this.totalRoadmapsCreated += 1;
      break;
    case "note_added":
      this.totalNotesAdded += 1;
      break;
  }

  // Update streak
  this.updateStreak();
  this.updatedAt = new Date();
};

// Check for achievements
userProgressSchema.methods.checkAchievements = function () {
  const newAchievements = [];

  // Streak achievements
  if (this.currentStreak >= 3 && !this.achievements.includes("streak_3")) {
    newAchievements.push("streak_3");
  }
  if (this.currentStreak >= 7 && !this.achievements.includes("streak_7")) {
    newAchievements.push("streak_7");
  }
  if (this.currentStreak >= 30 && !this.achievements.includes("streak_30")) {
    newAchievements.push("streak_30");
  }

  // Completion achievements
  if (
    this.totalStepsCompleted >= 10 &&
    !this.achievements.includes("steps_10")
  ) {
    newAchievements.push("steps_10");
  }
  if (
    this.totalStepsCompleted >= 50 &&
    !this.achievements.includes("steps_50")
  ) {
    newAchievements.push("steps_50");
  }
  if (
    this.totalStepsCompleted >= 100 &&
    !this.achievements.includes("steps_100")
  ) {
    newAchievements.push("steps_100");
  }

  // Roadmap achievements
  if (
    this.totalRoadmapsCreated >= 3 &&
    !this.achievements.includes("roadmaps_3")
  ) {
    newAchievements.push("roadmaps_3");
  }
  if (
    this.totalRoadmapsCreated >= 10 &&
    !this.achievements.includes("roadmaps_10")
  ) {
    newAchievements.push("roadmaps_10");
  }

  // Note achievements
  if (this.totalNotesAdded >= 10 && !this.achievements.includes("notes_10")) {
    newAchievements.push("notes_10");
  }

  this.achievements.push(...newAchievements);
  return newAchievements;
};

module.exports = mongoose.model("UserProgress", userProgressSchema);

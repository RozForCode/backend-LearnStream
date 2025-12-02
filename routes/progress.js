const express = require("express");
const router = express.Router();
const UserProgress = require("../models/UserProgress");

/**
 * GET /api/progress
 * Get user progress, streaks, and stats
 */
router.get("/", async (req, res) => {
  try {
    let progress = await UserProgress.findOne({ oderId: "default" });

    if (!progress) {
      progress = new UserProgress({ oderId: "default" });
      await progress.save();
    }

    // Get activity data for heatmap (last 90 days)
    const ninetyDaysAgo = new Date();
    ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);

    const activityByDate = {};
    progress.activities
      .filter((a) => a.date >= ninetyDaysAgo)
      .forEach((activity) => {
        const dateKey = activity.date.toISOString().split("T")[0];
        activityByDate[dateKey] = (activityByDate[dateKey] || 0) + 1;
      });

    res.json({
      currentStreak: progress.currentStreak,
      longestStreak: progress.longestStreak,
      lastActivityDate: progress.lastActivityDate,
      totalStepsCompleted: progress.totalStepsCompleted,
      totalRoadmapsCreated: progress.totalRoadmapsCreated,
      totalNotesAdded: progress.totalNotesAdded,
      achievements: progress.achievements,
      activityHeatmap: activityByDate,
      reminder: progress.reminder,
    });
  } catch (error) {
    console.error("Error fetching progress:", error);
    res.status(500).json({ error: "Failed to fetch progress" });
  }
});

/**
 * POST /api/progress/activity
 * Log an activity (called internally when user does something)
 */
router.post("/activity", async (req, res) => {
  try {
    const { type, roadmapId, stepId, details } = req.body;

    let progress = await UserProgress.findOne({ oderId: "default" });

    if (!progress) {
      progress = new UserProgress({ oderId: "default" });
    }

    progress.addActivity(type, roadmapId, stepId, details);
    const newAchievements = progress.checkAchievements();
    await progress.save();

    res.json({
      success: true,
      currentStreak: progress.currentStreak,
      newAchievements,
    });
  } catch (error) {
    console.error("Error logging activity:", error);
    res.status(500).json({ error: "Failed to log activity" });
  }
});

/**
 * PUT /api/progress/reminder
 * Update reminder settings
 */
router.put("/reminder", async (req, res) => {
  try {
    const { enabled, time, days } = req.body;

    let progress = await UserProgress.findOne({ oderId: "default" });

    if (!progress) {
      progress = new UserProgress({ oderId: "default" });
    }

    progress.reminder = {
      enabled: enabled ?? progress.reminder.enabled,
      time: time ?? progress.reminder.time,
      days: days ?? progress.reminder.days,
      lastSent: progress.reminder.lastSent,
    };

    await progress.save();

    res.json({
      success: true,
      reminder: progress.reminder,
    });
  } catch (error) {
    console.error("Error updating reminder:", error);
    res.status(500).json({ error: "Failed to update reminder" });
  }
});

/**
 * GET /api/progress/achievements
 * Get all achievements with their status
 */
router.get("/achievements", async (req, res) => {
  try {
    let progress = await UserProgress.findOne({ oderId: "default" });

    const allAchievements = [
      {
        id: "streak_3",
        name: "Getting Started",
        description: "Maintain a 3-day learning streak",
        icon: "🔥",
        requirement: 3,
        type: "streak",
      },
      {
        id: "streak_7",
        name: "Week Warrior",
        description: "Maintain a 7-day learning streak",
        icon: "⚡",
        requirement: 7,
        type: "streak",
      },
      {
        id: "streak_30",
        name: "Monthly Master",
        description: "Maintain a 30-day learning streak",
        icon: "🏆",
        requirement: 30,
        type: "streak",
      },
      {
        id: "steps_10",
        name: "First Steps",
        description: "Complete 10 learning steps",
        icon: "👣",
        requirement: 10,
        type: "steps",
      },
      {
        id: "steps_50",
        name: "Milestone Maker",
        description: "Complete 50 learning steps",
        icon: "🎯",
        requirement: 50,
        type: "steps",
      },
      {
        id: "steps_100",
        name: "Century Club",
        description: "Complete 100 learning steps",
        icon: "💯",
        requirement: 100,
        type: "steps",
      },
      {
        id: "roadmaps_3",
        name: "Path Finder",
        description: "Create 3 learning roadmaps",
        icon: "🗺️",
        requirement: 3,
        type: "roadmaps",
      },
      {
        id: "roadmaps_10",
        name: "Explorer",
        description: "Create 10 learning roadmaps",
        icon: "🧭",
        requirement: 10,
        type: "roadmaps",
      },
      {
        id: "notes_10",
        name: "Note Taker",
        description: "Add 10 personal notes",
        icon: "📝",
        requirement: 10,
        type: "notes",
      },
    ];

    const unlockedIds = progress?.achievements || [];

    const achievementsWithStatus = allAchievements.map((achievement) => ({
      ...achievement,
      unlocked: unlockedIds.includes(achievement.id),
      unlockedAt: unlockedIds.includes(achievement.id)
        ? progress.activities.find(
            (a) => a.details?.includes(achievement.id)
          )?.date
        : null,
    }));

    res.json({ achievements: achievementsWithStatus });
  } catch (error) {
    console.error("Error fetching achievements:", error);
    res.status(500).json({ error: "Failed to fetch achievements" });
  }
});

module.exports = router;


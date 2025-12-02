const express = require("express");
const router = express.Router();
const ScheduledNotification = require("../models/ScheduledNotification");
const UserProgress = require("../models/UserProgress");

// In-memory store for active timers (for demo purposes)
const activeTimers = new Map();

/**
 * GET /api/notifications
 * Get all notifications (with optional status filter)
 */
router.get("/", async (req, res) => {
  try {
    const { status } = req.query;
    const query = status ? { status } : {};
    
    const notifications = await ScheduledNotification.find(query)
      .sort({ scheduledFor: -1 })
      .limit(50);
    
    res.json({ notifications });
  } catch (error) {
    console.error("Error fetching notifications:", error);
    res.status(500).json({ error: "Failed to fetch notifications" });
  }
});

/**
 * GET /api/notifications/pending
 * Get pending notifications that are ready to be sent
 */
router.get("/pending", async (req, res) => {
  try {
    const now = new Date();
    
    const pendingNotifications = await ScheduledNotification.find({
      status: "pending",
      scheduledFor: { $lte: now },
    }).sort({ scheduledFor: 1 });
    
    res.json({ notifications: pendingNotifications });
  } catch (error) {
    console.error("Error fetching pending notifications:", error);
    res.status(500).json({ error: "Failed to fetch pending notifications" });
  }
});

/**
 * GET /api/notifications/next
 * Get the next scheduled notification (for demo countdown)
 */
router.get("/next", async (req, res) => {
  try {
    const now = new Date();
    
    const nextNotification = await ScheduledNotification.findOne({
      status: "pending",
      scheduledFor: { $gt: now },
    }).sort({ scheduledFor: 1 });
    
    if (!nextNotification) {
      return res.json({ notification: null, timeUntil: null });
    }
    
    const timeUntil = nextNotification.scheduledFor.getTime() - now.getTime();
    
    res.json({
      notification: nextNotification,
      timeUntil: Math.max(0, timeUntil),
      timeUntilFormatted: formatTimeUntil(timeUntil),
    });
  } catch (error) {
    console.error("Error fetching next notification:", error);
    res.status(500).json({ error: "Failed to fetch next notification" });
  }
});

/**
 * POST /api/notifications/schedule
 * Schedule a new notification
 */
router.post("/schedule", async (req, res) => {
  try {
    const { type, title, message, delayMinutes, metadata } = req.body;
    
    if (!type || !title || !message) {
      return res.status(400).json({ error: "type, title, and message are required" });
    }
    
    const delay = (delayMinutes || 2) * 60 * 1000; // Default 2 minutes
    const scheduledFor = new Date(Date.now() + delay);
    
    const notification = new ScheduledNotification({
      type,
      title,
      message,
      scheduledFor,
      metadata: metadata || {},
    });
    
    await notification.save();
    
    // Set up in-memory timer for this notification
    scheduleNotificationTimer(notification);
    
    console.log(`📅 Notification scheduled for ${scheduledFor.toLocaleTimeString()}`);
    
    res.json({
      success: true,
      notification,
      scheduledFor,
      timeUntil: delay,
      timeUntilFormatted: formatTimeUntil(delay),
    });
  } catch (error) {
    console.error("Error scheduling notification:", error);
    res.status(500).json({ error: "Failed to schedule notification" });
  }
});

/**
 * POST /api/notifications/:id/trigger
 * Manually trigger a notification (mark as sent)
 */
router.post("/:id/trigger", async (req, res) => {
  try {
    const notification = await ScheduledNotification.findById(req.params.id);
    
    if (!notification) {
      return res.status(404).json({ error: "Notification not found" });
    }
    
    if (notification.status === "sent") {
      return res.status(400).json({ error: "Notification already sent" });
    }
    
    notification.status = "sent";
    notification.sentAt = new Date();
    await notification.save();
    
    // Clear any existing timer
    if (activeTimers.has(notification._id.toString())) {
      clearTimeout(activeTimers.get(notification._id.toString()));
      activeTimers.delete(notification._id.toString());
    }
    
    console.log(`🔔 Notification triggered: ${notification.title}`);
    
    res.json({
      success: true,
      notification,
    });
  } catch (error) {
    console.error("Error triggering notification:", error);
    res.status(500).json({ error: "Failed to trigger notification" });
  }
});

/**
 * DELETE /api/notifications/:id
 * Cancel a scheduled notification
 */
router.delete("/:id", async (req, res) => {
  try {
    const notification = await ScheduledNotification.findById(req.params.id);
    
    if (!notification) {
      return res.status(404).json({ error: "Notification not found" });
    }
    
    notification.status = "cancelled";
    await notification.save();
    
    // Clear any existing timer
    if (activeTimers.has(notification._id.toString())) {
      clearTimeout(activeTimers.get(notification._id.toString()));
      activeTimers.delete(notification._id.toString());
    }
    
    res.json({ success: true, message: "Notification cancelled" });
  } catch (error) {
    console.error("Error cancelling notification:", error);
    res.status(500).json({ error: "Failed to cancel notification" });
  }
});

/**
 * POST /api/notifications/schedule-skill-reminder
 * Schedule a reminder notification after adding a skill (called from resources route)
 */
router.post("/schedule-skill-reminder", async (req, res) => {
  try {
    const { roadmapId, roadmapTitle, category, delayMinutes = 2 } = req.body;
    
    // Get current streak info
    let progress = await UserProgress.findOne({ oderId: "default" });
    if (!progress) {
      progress = new UserProgress({ oderId: "default" });
      await progress.save();
    }
    
    const streakCount = progress.currentStreak || 0;
    
    // Create motivational message based on streak
    let title, message;
    
    if (streakCount === 0) {
      title = "🚀 Start Your Learning Journey!";
      message = `Your "${roadmapTitle}" roadmap is ready! Complete your first step to start building your streak.`;
    } else if (streakCount < 3) {
      title = "🔥 Keep the Momentum Going!";
      message = `You're on a ${streakCount}-day streak! Your new "${roadmapTitle}" roadmap awaits. Don't break the chain!`;
    } else if (streakCount < 7) {
      title = "⚡ You're on Fire!";
      message = `Amazing ${streakCount}-day streak! Check out your new "${roadmapTitle}" roadmap and keep crushing it!`;
    } else {
      title = "🏆 Streak Champion!";
      message = `Incredible ${streakCount}-day streak! Your "${roadmapTitle}" roadmap is ready. You're unstoppable!`;
    }
    
    const delay = delayMinutes * 60 * 1000;
    const scheduledFor = new Date(Date.now() + delay);
    
    const notification = new ScheduledNotification({
      type: "skill_added",
      title,
      message,
      scheduledFor,
      metadata: {
        roadmapId,
        roadmapTitle,
        category,
        streakCount,
      },
    });
    
    await notification.save();
    
    // Set up in-memory timer
    scheduleNotificationTimer(notification);
    
    console.log(`📅 Skill reminder scheduled for ${scheduledFor.toLocaleTimeString()} (in ${delayMinutes} min)`);
    
    res.json({
      success: true,
      notification,
      scheduledFor,
    });
  } catch (error) {
    console.error("Error scheduling skill reminder:", error);
    res.status(500).json({ error: "Failed to schedule skill reminder" });
  }
});

// ============================================
// HELPER FUNCTIONS
// ============================================

/**
 * Set up an in-memory timer for a notification
 */
function scheduleNotificationTimer(notification) {
  const now = Date.now();
  const triggerTime = new Date(notification.scheduledFor).getTime();
  const delay = Math.max(0, triggerTime - now);
  
  // Clear any existing timer for this notification
  const notifId = notification._id.toString();
  if (activeTimers.has(notifId)) {
    clearTimeout(activeTimers.get(notifId));
  }
  
  // Set new timer
  const timer = setTimeout(async () => {
    try {
      // Mark as sent in database
      await ScheduledNotification.findByIdAndUpdate(notification._id, {
        status: "sent",
        sentAt: new Date(),
      });
      
      console.log(`\n🔔 ========================================`);
      console.log(`🔔 NOTIFICATION TRIGGERED!`);
      console.log(`🔔 Title: ${notification.title}`);
      console.log(`🔔 Message: ${notification.message}`);
      console.log(`🔔 ========================================\n`);
      
      activeTimers.delete(notifId);
    } catch (error) {
      console.error("Error triggering scheduled notification:", error);
    }
  }, delay);
  
  activeTimers.set(notifId, timer);
  
  console.log(`⏰ Timer set for notification ${notifId} (${formatTimeUntil(delay)})`);
}

/**
 * Format milliseconds into a human-readable string
 */
function formatTimeUntil(ms) {
  if (ms <= 0) return "now";
  
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  
  if (minutes > 0) {
    return `${minutes}m ${remainingSeconds}s`;
  }
  return `${seconds}s`;
}

/**
 * Initialize timers for all pending notifications on server start
 */
async function initializePendingNotifications() {
  try {
    const pendingNotifications = await ScheduledNotification.find({
      status: "pending",
    });
    
    console.log(`📅 Found ${pendingNotifications.length} pending notifications`);
    
    for (const notification of pendingNotifications) {
      const now = Date.now();
      const triggerTime = new Date(notification.scheduledFor).getTime();
      
      if (triggerTime <= now) {
        // Already past due, trigger immediately
        notification.status = "sent";
        notification.sentAt = new Date();
        await notification.save();
        console.log(`🔔 Triggered overdue notification: ${notification.title}`);
      } else {
        // Schedule for future
        scheduleNotificationTimer(notification);
      }
    }
  } catch (error) {
    console.error("Error initializing pending notifications:", error);
  }
}

// Export the router and initialization function
module.exports = router;
module.exports.initializePendingNotifications = initializePendingNotifications;


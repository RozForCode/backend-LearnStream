const express = require("express");
const router = express.Router();
const crypto = require("crypto");
const Resource = require("../models/Resource");
const UserProgress = require("../models/UserProgress");
const ScheduledNotification = require("../models/ScheduledNotification");
const { GoogleGenerativeAI } = require("@google/generative-ai");
const { validateResourcesInParallel } = require("../utils/urlValidation");

// Initialize Gemini AI
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// fallback resources (if AI fails to find resources)
const curatedResources = {
  mobile: [
    {
      title: "React Native Documentation",
      url: "https://reactnative.dev/docs/getting-started",
      type: "documentation",
    },
    {
      title: "Flutter Documentation",
      url: "https://docs.flutter.dev",
      type: "documentation",
    },
    {
      title: "Ionic Framework Docs",
      url: "https://ionicframework.com/docs",
      type: "documentation",
    },
    {
      title: "Android Developers",
      url: "https://developer.android.com",
      type: "documentation",
    },
    {
      title: "Apple Developer",
      url: "https://developer.apple.com/documentation",
      type: "documentation",
    },
  ],
  frontend: [
    {
      title: "MDN Web Docs",
      url: "https://developer.mozilla.org",
      type: "documentation",
    },
    {
      title: "React Documentation",
      url: "https://react.dev",
      type: "documentation",
    },
    {
      title: "Vue.js Guide",
      url: "https://vuejs.org/guide/introduction.html",
      type: "documentation",
    },
    {
      title: "Angular Documentation",
      url: "https://angular.io/docs",
      type: "documentation",
    },
    {
      title: "freeCodeCamp",
      url: "https://www.freecodecamp.org",
      type: "course",
    },
    {
      title: "CSS-Tricks",
      url: "https://css-tricks.com",
      type: "article",
    },
  ],
  backend: [
    {
      title: "Node.js Documentation",
      url: "https://nodejs.org/docs/latest/api/",
      type: "documentation",
    },
    {
      title: "Express.js Guide",
      url: "https://expressjs.com/en/guide/routing.html",
      type: "documentation",
    },
    {
      title: "Django Documentation",
      url: "https://docs.djangoproject.com",
      type: "documentation",
    },
    {
      title: "PostgreSQL Tutorial",
      url: "https://www.postgresqltutorial.com",
      type: "tutorial",
    },
    {
      title: "MongoDB University",
      url: "https://learn.mongodb.com",
      type: "course",
    },
  ],
  design: [
    {
      title: "Figma Learn",
      url: "https://help.figma.com",
      type: "documentation",
    },
    {
      title: "Material Design",
      url: "https://m3.material.io",
      type: "documentation",
    },
    {
      title: "Tailwind CSS Docs",
      url: "https://tailwindcss.com/docs",
      type: "documentation",
    },
    {
      title: "Dribbble",
      url: "https://dribbble.com",
      type: "tool",
    },
    {
      title: "Smashing Magazine",
      url: "https://www.smashingmagazine.com",
      type: "article",
    },
  ],
  ai: [
    {
      title: "TensorFlow Tutorials",
      url: "https://www.tensorflow.org/tutorials",
      type: "tutorial",
    },
    {
      title: "PyTorch Documentation",
      url: "https://pytorch.org/docs/stable/index.html",
      type: "documentation",
    },
    {
      title: "Hugging Face",
      url: "https://huggingface.co/docs",
      type: "documentation",
    },
    {
      title: "OpenAI Documentation",
      url: "https://platform.openai.com/docs",
      type: "documentation",
    },
    {
      title: "Fast.ai",
      url: "https://www.fast.ai",
      type: "course",
    },
    {
      title: "Kaggle Learn",
      url: "https://www.kaggle.com/learn",
      type: "course",
    },
  ],
};

// Generate Learning path (exlucing resources)
async function generateLearningPath(skillData) {
  const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });

  const levelSteps = {
    beginner: { min: 12, max: 15 },
    intermediate: { min: 10, max: 12 },
    advanced: { min: 8, max: 10 },
  };

  const goalContext = {
    fundamentals: "Focus on core concepts, theory, and foundational knowledge",
    "hands-on":
      "Emphasize practical projects, coding exercises, and real-world applications",
    career:
      "Include industry best practices, interview prep, and professional skills",
    hobby:
      "Keep it fun, project-based, and engaging without overwhelming depth",
  };

  const currentLevel = skillData.currentSkillLevel || "beginner";
  const stepRange = levelSteps[currentLevel] || levelSteps.beginner;
  const goalFocus =
    goalContext[skillData.learningGoal] || goalContext.fundamentals;

  const prompt = `You are an expert learning path designer like roadmap.sh. Create a comprehensive, structured learning roadmap for "${
    skillData.title
  }" in the "${skillData.category}" category.

USER CONTEXT:
- Current Skill Level: ${currentLevel}
- Learning Goal: ${skillData.learningGoal || "fundamentals"} - ${goalFocus}
- Target Level: ${skillData.targetSkillLevel || "proficient"}
- Additional Notes: ${skillData.description || "None"}

REQUIREMENTS:
1. Generate ${stepRange.min}-${stepRange.max} progressive learning steps
2. Each step should build upon previous knowledge
3. DO NOT include any resources or URLs - resources will be added separately
4. Estimate realistic time for each step IN HOURS ONLY (e.g., "2-3 hours", "4-6 hours", "8-10 hours")
5. NEVER use "days" or "weeks" - always convert to hours

IMPORTANT: Respond ONLY with a valid JSON array. No markdown, no code blocks, no explanations.

FORMAT:
[
  {
    "title": "Step title - clear and specific",
    "description": "Detailed description of what to learn, key concepts to understand, and why this step matters",
    "estimatedTime": "X-Y hours (ALWAYS in hours, e.g., '2-3 hours', '6-8 hours', '10-12 hours')"
  }
]`;

  try {
    const result = await model.generateContent(prompt);
    const response = await result.response;
    let text = response.text();

    // Clean up the response
    text = text
      .replace(/```json\n?/g, "")
      .replace(/```\n?/g, "")
      .trim();

    const learningPath = JSON.parse(text);
    return learningPath.map((step) => ({
      title: step.title,
      description: step.description || "",
      estimatedTime: step.estimatedTime || "2-3 hours",
      resources: [],
      resourcesStatus: "pending",
      completed: false,
    }));
  } catch (error) {
    console.error("Error generating learning path:", error);
    // Return a default learning path if AI fails
    return [
      {
        title: `Introduction to ${skillData.title}`,
        description:
          "Start with the basics and understand core concepts. This foundation is essential for everything that follows.",
        estimatedTime: "2-3 hours",
        resources: [],
        resourcesStatus: "pending",
        completed: false,
      },
      {
        title: "Core Concepts Deep Dive",
        description:
          "Explore the fundamental concepts in depth and understand how they work together.",
        estimatedTime: "4-6 hours",
        resources: [],
        resourcesStatus: "pending",
        completed: false,
      },
      {
        title: "Hands-on Practice",
        description:
          "Apply what you learned with practical exercises and small projects.",
        estimatedTime: "6-8 hours",
        resources: [],
        resourcesStatus: "pending",
        completed: false,
      },
      {
        title: "Build a Project",
        description: "Create a real project to solidify your understanding.",
        estimatedTime: "10-15 hours",
        resources: [],
        resourcesStatus: "pending",
        completed: false,
      },
    ];
  }
}

//  Find and Validate (in bBackground)
async function generateResourcesForStep(stepTitle, stepDescription, skillData) {
  const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });

  const prompt = `You are a resource curator. Find 5-7 REAL learning resources for this specific learning step.

STEP: "${stepTitle}"
DESCRIPTION: "${stepDescription}"
SKILL: "${skillData.title}" (${skillData.category})

REQUIREMENTS:
1. Suggest resources from WELL-KNOWN sources:
   - Official documentation sites (react.dev, angular.io, nodejs.org, developer.mozilla.org, etc.)
   - freeCodeCamp (freecodecamp.org)
   - W3Schools (w3schools.com)
   - GeeksforGeeks (geeksforgeeks.org)
   - DigitalOcean tutorials
   - GitHub repos and awesome lists
   - Dev.to, Medium articles

2. FOR YOUTUBE VIDEOS:
   - Include 2-3 actual YouTube video links (not channel links)
   - Search for popular, well-viewed tutorial videos on this topic
   - Use the full YouTube video URL format: https://www.youtube.com/watch?v=VIDEO_ID
   - Look for videos from ANY educational channel - not limited to specific channels
   - Prefer videos with high view counts and good ratings
   - Include the actual video title in the resource title

3. Mix different resource types: documentation, YouTube videos, tutorials, GitHub repos, articles
4. Prioritize free resources
5. Make sure URLs are real and complete

IMPORTANT: Respond ONLY with a valid JSON array. No markdown, no code blocks.

FORMAT:
[
  {
    "title": "Resource title",
    "url": "https://exact-working-url.com/path",
    "type": "documentation|tutorial|video|course|article|github|tool"
  }
]`;

  try {
    const result = await model.generateContent(prompt);
    const response = await result.response;
    let text = response.text();

    text = text
      .replace(/```json\n?/g, "")
      .replace(/```\n?/g, "")
      .trim();

    const resources = JSON.parse(text);
    return resources.map((r) => ({
      title: r.title,
      url: r.url,
      type: r.type || "other",
    }));
  } catch (error) {
    console.error("Error generating resources for step:", error);
    return [];
  }
}

async function gatherAndValidateResources(resourceId) {
  try {
    const resource = await Resource.findById(resourceId);
    if (!resource) {
      console.error("Resource not found:", resourceId);
      return;
    }

    // Update overall status to loading
    resource.resourcesStatus = "loading";
    await resource.save();

    const skillData = {
      title: resource.title,
      category: resource.category,
      description: resource.description,
    };

    // Process each step
    for (let i = 0; i < resource.learningPath.length; i++) {
      const step = resource.learningPath[i];

      try {
        // Update step status to loading
        step.resourcesStatus = "loading";
        await resource.save();

        // Generate resources for this step
        let generatedResources = await generateResourcesForStep(
          step.title,
          step.description,
          skillData
        );

        // Validate URLs
        let validatedResources = await validateResourcesInParallel(
          generatedResources,
          5
        );

        // If we don't have enough valid resources, add curated fallbacks
        if (validatedResources.length < 3) {
          const fallbacks = curatedResources[resource.category] || [];
          const additionalResources = fallbacks.slice(
            0,
            5 - validatedResources.length
          );

          // Validate fallbacks too
          const validatedFallbacks = await validateResourcesInParallel(
            additionalResources
          );
          validatedResources = [...validatedResources, ...validatedFallbacks];
        }

        // Update step with validated resources
        step.resources = validatedResources.slice(0, 5); // Max 5 resources per step
        step.resourcesStatus =
          validatedResources.length > 0 ? "ready" : "failed";
        await resource.save();

        console.log(
          `Step ${i + 1}/${resource.learningPath.length}: ${
            validatedResources.length
          } valid resources`
        );
      } catch (stepError) {
        console.error(`Error processing step ${i}:`, stepError);
        step.resourcesStatus = "failed";

        // Add fallback resources
        const fallbacks = curatedResources[resource.category] || [];
        step.resources = fallbacks.slice(0, 3);
        await resource.save();
      }
    }

    // Update overall status
    const allReady = resource.learningPath.every(
      (s) => s.resourcesStatus === "ready"
    );
    const anyFailed = resource.learningPath.some(
      (s) => s.resourcesStatus === "failed"
    );

    resource.resourcesStatus = allReady
      ? "ready"
      : anyFailed
      ? "ready"
      : "ready";
    await resource.save();

    console.log(`Resource gathering complete for: ${resource.title}`);
  } catch (error) {
    console.error("Error in gatherAndValidateResources:", error);

    // Try to update status to failed
    try {
      const resource = await Resource.findById(resourceId);
      if (resource) {
        resource.resourcesStatus = "failed";
        await resource.save();
      }
    } catch (e) {
      console.error("Failed to update resource status:", e);
    }
  }
}

// --- api routes start here ---
// GET all resources
router.get("/", async (req, res) => {
  try {
    const resources = await Resource.find().sort({ createdAt: -1 });
    res.json(resources);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// GET single resource status (for polling)
router.get("/:id/status", async (req, res) => {
  try {
    const resource = await Resource.findById(req.params.id);
    if (!resource) {
      return res.status(404).json({ message: "Resource not found" });
    }

    res.json({
      resourcesStatus: resource.resourcesStatus,
      steps: resource.learningPath.map((step) => ({
        _id: step._id,
        resourcesStatus: step.resourcesStatus,
        resourceCount: step.resources.length,
      })),
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// GET single resource
router.get("/:id", async (req, res) => {
  try {
    const resource = await Resource.findById(req.params.id);
    if (!resource) {
      return res.status(404).json({ message: "Resource not found" });
    }
    res.json(resource);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// POST a new resource
router.post("/", async (req, res) => {
  try {
    // Phase 1: Generate learning path (steps only, no resources)
    const learningPath = await generateLearningPath({
      title: req.body.title,
      category: req.body.category,
      description: req.body.description,
      currentSkillLevel: req.body.currentSkillLevel,
      learningGoal: req.body.learningGoal,
      targetSkillLevel: req.body.targetSkillLevel,
    });

    const resource = new Resource({
      title: req.body.title,
      category: req.body.category,
      description: req.body.description,
      currentSkillLevel: req.body.currentSkillLevel,
      learningGoal: req.body.learningGoal,
      targetSkillLevel: req.body.targetSkillLevel,
      learningPath: learningPath,
      resourcesStatus: "pending",
    });

    const newResource = await resource.save();

    // Phase 2: Start background resource gathering
    // Don't await - let it run in background (async function) then we will wait for it to finish (await gatherAndValidateResources(newResource._id))
    gatherAndValidateResources(newResource._id).catch((err) => {
      console.error("Background resource gathering failed:", err);
    });

    // Phase 3: Schedule a notification reminder (2 minutes after skill creation)
    scheduleSkillNotification(newResource).catch((err) => {
      console.error("Failed to schedule notification:", err);
    });

    // Track activity for roadmap creation
    try {
      let progress = await UserProgress.findOne({ oderId: "default" });
      if (!progress) {
        progress = new UserProgress({ oderId: "default" });
      }
      progress.addActivity(
        "roadmap_created",
        newResource._id,
        null,
        `Created roadmap: ${newResource.title}`
      );
      progress.checkAchievements();
      await progress.save();
    } catch (e) {
      console.error("Failed to track roadmap creation activity:", e);
    }

    res.status(201).json(newResource);
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

/**
 * Schedule a notification reminder after adding a skill
 */
async function scheduleSkillNotification(resource) {
  try {
    // Get current streak info
    let progress = await UserProgress.findOne({ oderId: "default" });
    const streakCount = progress?.currentStreak || 0;

    // Create motivational message based on streak
    let title, message;

    if (streakCount === 0) {
      title = "🚀 Start Your Learning Journey!";
      message = `Your "${resource.title}" roadmap is ready with ${resource.learningPath.length} steps! Complete your first step to start building your streak.`;
    } else if (streakCount < 3) {
      title = "🔥 Keep the Momentum Going!";
      message = `You're on a ${streakCount}-day streak! Your new "${resource.title}" roadmap awaits with ${resource.learningPath.length} steps. Don't break the chain!`;
    } else if (streakCount < 7) {
      title = "⚡ You're on Fire!";
      message = `Amazing ${streakCount}-day streak! Check out your new "${resource.title}" roadmap and keep crushing it!`;
    } else {
      title = "🏆 Streak Champion!";
      message = `Incredible ${streakCount}-day streak! Your "${resource.title}" roadmap is ready. You're unstoppable!`;
    }

    // Schedule for 25 seconds from now (for demo purposes)
    const DELAY_SECONDS = 25;
    const scheduledFor = new Date(Date.now() + DELAY_SECONDS * 1000);

    const notification = new ScheduledNotification({
      type: "skill_added",
      title,
      message,
      scheduledFor,
      metadata: {
        roadmapId: resource._id,
        roadmapTitle: resource.title,
        category: resource.category,
        streakCount,
      },
    });

    await notification.save();

    // Set up in-memory timer for this notification
    const delay = DELAY_SECONDS * 1000;
    setTimeout(async () => {
      try {
        const notif = await ScheduledNotification.findById(notification._id);
        if (notif && notif.status === "pending") {
          notif.status = "sent";
          notif.sentAt = new Date();
          await notif.save();

          console.log(`\n🔔 ========================================`);
          console.log(`🔔 PUSH NOTIFICATION!`);
          console.log(`🔔 Title: ${notif.title}`);
          console.log(`🔔 Message: ${notif.message}`);
          console.log(`🔔 Roadmap: ${notif.metadata.roadmapTitle}`);
          console.log(`🔔 ========================================\n`);
        }
      } catch (error) {
        console.error("Error triggering scheduled notification:", error);
      }
    }, delay);

    console.log(
      `📅 Notification scheduled for ${scheduledFor.toLocaleTimeString()} (in ${DELAY_SECONDS} seconds)`
    );
  } catch (error) {
    console.error("Error scheduling skill notification:", error);
  }
}

// PATCH update a step's completion status
router.patch("/:id/steps/:stepId", async (req, res) => {
  try {
    const resource = await Resource.findById(req.params.id);
    if (!resource) {
      return res.status(404).json({ message: "Resource not found" });
    }

    const step = resource.learningPath.id(req.params.stepId);
    if (!step) {
      return res.status(404).json({ message: "Step not found" });
    }

    if (req.body.completed !== undefined) {
      step.completed = req.body.completed;
    }
    if (req.body.notes !== undefined) {
      step.notes = req.body.notes;
    }

    await resource.save();
    res.json(resource);
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

// POST retry resource gathering for a specific resource
router.post("/:id/retry-resources", async (req, res) => {
  try {
    const resource = await Resource.findById(req.params.id);
    if (!resource) {
      return res.status(404).json({ message: "Resource not found" });
    }

    // Reset statuses
    resource.resourcesStatus = "pending";
    resource.learningPath.forEach((step) => {
      step.resourcesStatus = "pending";
      step.resources = [];
    });
    await resource.save();

    // Start background gathering
    gatherAndValidateResources(resource._id).catch((err) => {
      console.error("Retry resource gathering failed:", err);
    });

    res.json({ message: "Resource gathering restarted" });
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

// DELETE a resource (roadmap)
router.delete("/:id", async (req, res) => {
  try {
    const resource = await Resource.findById(req.params.id);
    if (!resource) {
      return res.status(404).json({ message: "Resource not found" });
    }

    await Resource.findByIdAndDelete(req.params.id);
    res.json({ message: "Roadmap deleted successfully" });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// POST extend roadmap with additional steps
router.post("/:id/extend", async (req, res) => {
  try {
    const resource = await Resource.findById(req.params.id);
    if (!resource) {
      return res.status(404).json({ message: "Resource not found" });
    }

    const { additionalSteps = 3 } = req.body;
    const currentStepCount = resource.learningPath.length;

    // Generate additional steps using AI
    const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });

    const existingTopics = resource.learningPath.map((s) => s.title).join(", ");

    const prompt = `You are an expert learning path designer. Extend this existing learning roadmap for "${
      resource.title
    }" with ${additionalSteps} MORE advanced steps.

EXISTING STEPS (already covered):
${existingTopics}

USER CONTEXT:
- Current Skill Level: ${resource.currentSkillLevel || "intermediate"}
- Learning Goal: ${resource.learningGoal || "mastery"}
- Target Level: ${resource.targetSkillLevel || "expert"}

REQUIREMENTS:
1. Generate exactly ${additionalSteps} NEW steps that build upon the existing knowledge
2. Focus on advanced topics, real-world applications, and expert-level skills
3. DO NOT repeat any existing topics
4. Estimate realistic time for each step IN HOURS ONLY (e.g., "4-6 hours", "8-10 hours")

IMPORTANT: Respond ONLY with a valid JSON array. No markdown, no code blocks.

FORMAT:
[
  {
    "title": "Advanced step title",
    "description": "Detailed description of what to learn",
    "estimatedTime": "X-Y hours"
  }
]`;

    const result = await model.generateContent(prompt);
    const response = await result.response;
    let text = response.text();

    text = text
      .replace(/```json\n?/g, "")
      .replace(/```\n?/g, "")
      .trim();

    const newSteps = JSON.parse(text);
    const formattedSteps = newSteps.map((step) => ({
      title: step.title,
      description: step.description || "",
      estimatedTime: step.estimatedTime || "4-6 hours",
      resources: [],
      resourcesStatus: "pending",
      completed: false,
    }));

    // Add new steps to the learning path
    resource.learningPath.push(...formattedSteps);
    resource.resourcesStatus = "pending";
    await resource.save();

    // Start background resource gathering for new steps
    gatherAndValidateResources(resource._id).catch((err) => {
      console.error("Resource gathering for extended steps failed:", err);
    });

    res.json({
      message: `Added ${formattedSteps.length} new steps`,
      resource,
    });
  } catch (err) {
    console.error("Error extending roadmap:", err);
    res.status(400).json({ message: err.message });
  }
});

// ============================================
// NOTES ENDPOINTS
// ============================================

/**
 * POST /api/resources/:id/steps/:stepId/notes
 * Add a note to a specific step
 */
router.post("/:id/steps/:stepId/notes", async (req, res) => {
  try {
    const { content } = req.body;

    if (!content || content.trim().length === 0) {
      return res.status(400).json({ message: "Note content is required" });
    }

    const resource = await Resource.findById(req.params.id);
    if (!resource) {
      return res.status(404).json({ message: "Resource not found" });
    }

    const step = resource.learningPath.id(req.params.stepId);
    if (!step) {
      return res.status(404).json({ message: "Step not found" });
    }

    const newNote = {
      content: content.trim(),
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    step.notes.push(newNote);
    await resource.save();

    // Track activity
    try {
      let progress = await UserProgress.findOne({ oderId: "default" });
      if (!progress) {
        progress = new UserProgress({ oderId: "default" });
      }
      progress.addActivity(
        "note_added",
        resource._id,
        step._id,
        `Note added to "${step.title}"`
      );
      progress.checkAchievements();
      await progress.save();
    } catch (e) {
      console.error("Failed to track note activity:", e);
    }

    res.json({
      message: "Note added successfully",
      note: step.notes[step.notes.length - 1],
    });
  } catch (err) {
    console.error("Error adding note:", err);
    res.status(500).json({ message: err.message });
  }
});

/**
 * PUT /api/resources/:id/steps/:stepId/notes/:noteId
 * Update a note
 */
router.put("/:id/steps/:stepId/notes/:noteId", async (req, res) => {
  try {
    const { content } = req.body;

    if (!content || content.trim().length === 0) {
      return res.status(400).json({ message: "Note content is required" });
    }

    const resource = await Resource.findById(req.params.id);
    if (!resource) {
      return res.status(404).json({ message: "Resource not found" });
    }

    const step = resource.learningPath.id(req.params.stepId);
    if (!step) {
      return res.status(404).json({ message: "Step not found" });
    }

    const note = step.notes.id(req.params.noteId);
    if (!note) {
      return res.status(404).json({ message: "Note not found" });
    }

    note.content = content.trim();
    note.updatedAt = new Date();
    await resource.save();

    res.json({
      message: "Note updated successfully",
      note,
    });
  } catch (err) {
    console.error("Error updating note:", err);
    res.status(500).json({ message: err.message });
  }
});

/**
 * DELETE /api/resources/:id/steps/:stepId/notes/:noteId
 * Delete a note
 */
router.delete("/:id/steps/:stepId/notes/:noteId", async (req, res) => {
  try {
    const resource = await Resource.findById(req.params.id);
    if (!resource) {
      return res.status(404).json({ message: "Resource not found" });
    }

    const step = resource.learningPath.id(req.params.stepId);
    if (!step) {
      return res.status(404).json({ message: "Step not found" });
    }

    const noteIndex = step.notes.findIndex(
      (n) => n._id.toString() === req.params.noteId
    );
    if (noteIndex === -1) {
      return res.status(404).json({ message: "Note not found" });
    }

    step.notes.splice(noteIndex, 1);
    await resource.save();

    res.json({ message: "Note deleted successfully" });
  } catch (err) {
    console.error("Error deleting note:", err);
    res.status(500).json({ message: err.message });
  }
});

// ============================================
// BOOKMARK ENDPOINTS
// ============================================

/**
 * PATCH /api/resources/:id/steps/:stepId/bookmark
 * Toggle bookmark status for a step
 */
router.patch("/:id/steps/:stepId/bookmark", async (req, res) => {
  try {
    const resource = await Resource.findById(req.params.id);
    if (!resource) {
      return res.status(404).json({ message: "Resource not found" });
    }

    const step = resource.learningPath.id(req.params.stepId);
    if (!step) {
      return res.status(404).json({ message: "Step not found" });
    }

    step.bookmarked = !step.bookmarked;
    await resource.save();

    res.json({
      message: step.bookmarked ? "Step bookmarked" : "Bookmark removed",
      bookmarked: step.bookmarked,
    });
  } catch (err) {
    console.error("Error toggling bookmark:", err);
    res.status(500).json({ message: err.message });
  }
});

/**
 * GET /api/resources/bookmarks
 * Get all bookmarked steps across all roadmaps
 */
router.get("/bookmarks", async (req, res) => {
  try {
    const resources = await Resource.find({
      "learningPath.bookmarked": true,
    });

    const bookmarks = [];
    resources.forEach((resource) => {
      resource.learningPath
        .filter((step) => step.bookmarked)
        .forEach((step) => {
          bookmarks.push({
            roadmapId: resource._id,
            roadmapTitle: resource.title,
            stepId: step._id,
            stepTitle: step.title,
            stepDescription: step.description,
            notes: step.notes,
          });
        });
    });

    res.json({ bookmarks });
  } catch (err) {
    console.error("Error fetching bookmarks:", err);
    res.status(500).json({ message: err.message });
  }
});

// ============================================
// SHARING ENDPOINTS
// ============================================

/**
 * POST /api/resources/:id/share
 * Generate a shareable link for a roadmap
 */
router.post("/:id/share", async (req, res) => {
  try {
    const resource = await Resource.findById(req.params.id);
    if (!resource) {
      return res.status(404).json({ message: "Resource not found" });
    }

    // Generate share ID if not exists
    if (!resource.shareId) {
      resource.shareId = crypto.randomBytes(8).toString("hex");
    }
    resource.isPublic = true;
    await resource.save();

    const shareUrl = `${req.protocol}://${req.get(
      "host"
    )}/api/resources/shared/${resource.shareId}`;

    res.json({
      shareId: resource.shareId,
      shareUrl,
      message: "Roadmap is now shareable",
    });
  } catch (err) {
    console.error("Error generating share link:", err);
    res.status(500).json({ message: err.message });
  }
});

/**
 * DELETE /api/resources/:id/share
 * Remove sharing for a roadmap
 */
router.delete("/:id/share", async (req, res) => {
  try {
    const resource = await Resource.findById(req.params.id);
    if (!resource) {
      return res.status(404).json({ message: "Resource not found" });
    }

    resource.isPublic = false;
    await resource.save();

    res.json({ message: "Sharing disabled" });
  } catch (err) {
    console.error("Error disabling sharing:", err);
    res.status(500).json({ message: err.message });
  }
});

/**
 * GET /api/resources/shared/:shareId
 * Get a shared roadmap (public access)
 */
router.get("/shared/:shareId", async (req, res) => {
  try {
    const resource = await Resource.findOne({
      shareId: req.params.shareId,
      isPublic: true,
    });

    if (!resource) {
      return res
        .status(404)
        .json({ message: "Shared roadmap not found or no longer public" });
    }

    // Return sanitized version (no personal notes)
    const publicRoadmap = {
      title: resource.title,
      category: resource.category,
      description: resource.description,
      currentSkillLevel: resource.currentSkillLevel,
      learningGoal: resource.learningGoal,
      targetSkillLevel: resource.targetSkillLevel,
      learningPath: resource.learningPath.map((step) => ({
        title: step.title,
        description: step.description,
        estimatedTime: step.estimatedTime,
        resources: step.resources,
        completed: step.completed,
        // Exclude personal notes from shared view
      })),
      totalSteps: resource.learningPath.length,
      completedSteps: resource.learningPath.filter((s) => s.completed).length,
      createdAt: resource.createdAt,
    };

    res.json(publicRoadmap);
  } catch (err) {
    console.error("Error fetching shared roadmap:", err);
    res.status(500).json({ message: err.message });
  }
});

// Export both the router and the gatherAndValidateResources function
module.exports = router;
module.exports.gatherAndValidateResources = gatherAndValidateResources;

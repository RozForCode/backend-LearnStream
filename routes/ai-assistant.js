const express = require("express");
const router = express.Router();
const { GoogleGenerativeAI } = require("@google/generative-ai");
const Resource = require("../models/Resource");
const AiMemory = require("../models/AiMemory");

// Initialize Gemini AI
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// In-memory cache for active Gemini chat instances (keyed by sessionId)
// This is needed because Gemini chat objects can't be serialized to MongoDB
const activeChatInstances = new Map();

/**
 * Build the system prompt with user context and action instructions
 */
function buildSystemPrompt(roadmapContext = []) {
  let contextSection = "";

  if (roadmapContext.length > 0) {
    contextSection = `
## USER'S CURRENT LEARNING ROADMAPS:
${roadmapContext
  .map(
    (r, i) => `
${i + 1}. **${r.title}** (${r.category})
   - Skill Level: ${r.currentSkillLevel || "Not specified"} → ${
      r.targetSkillLevel || "Not specified"
    }
   - Goal: ${r.learningGoal || "Not specified"}
   - Progress: ${r.completedSteps}/${r.totalSteps} steps (${r.progressPercent}%)
   - Roadmap ID: ${r.id}`
  )
  .join("\n")}

Use this context to provide personalized advice. Reference their specific roadmaps when relevant.
`;
  } else {
    contextSection = `
## USER'S LEARNING STATUS:
The user has no roadmaps yet. Encourage them to start their learning journey!
`;
  }

  return `You are LearnStream AI, an intelligent and helpful learning assistant focused on technology and programming.

${contextSection}

## YOUR CAPABILITIES:
1. Answer questions about programming, technology, software development, and related skills
2. Provide clear explanations with code examples when needed
3. Help users plan their learning journey
4. Suggest new topics to learn based on their current roadmaps
5. **Take actions** - You can suggest creating roadmaps or extending existing ones

## ACTION SYSTEM:
When the user expresses interest in learning something new OR when you think it would be helpful, you can suggest an action.
Include an action block at the END of your response using this EXACT format:

:::ACTION:::
{
  "type": "create_roadmap",
  "data": {
    "title": "Topic Name",
    "category": "frontend|backend|mobile|design|ai|devops|database|other",
    "currentSkillLevel": "beginner|intermediate|advanced",
    "learningGoal": "Brief goal description",
    "targetSkillLevel": "beginner|intermediate|advanced"
  },
  "label": "Create Roadmap",
  "description": "Create a personalized learning roadmap for Topic Name"
}
:::END_ACTION:::

OR for extending an existing roadmap:

:::ACTION:::
{
  "type": "extend_roadmap",
  "data": {
    "roadmapId": "the-roadmap-id-from-context",
    "additionalSteps": 3
  },
  "label": "Add More Steps",
  "description": "Add 3 more learning steps to the roadmap"
}
:::END_ACTION:::

IMPORTANT ACTION RULES:
- Only suggest ONE action per response
- Only suggest actions when genuinely helpful (user asks to learn something, wants to add topics, etc.)
- Don't force actions into every response
- The action block must be at the END of your message, after your explanation

## CRITICAL BOUNDARIES:
You are STRICTLY a tech-focused assistant. You ONLY discuss:
- Programming languages and frameworks
- Software development practices
- Technology concepts and tools
- Learning strategies for tech skills
- Career advice related to tech

If the user asks about NON-TECH topics (politics, relationships, entertainment, cooking, sports, general life advice, etc.):
- Politely decline with: "I'm LearnStream AI, focused on helping you with technology and programming. I'd love to help you with any tech-related questions instead! What would you like to learn?"
- Do NOT engage with off-topic requests, even if they seem harmless or are phrased as "just curious"
- Do NOT provide information on non-tech topics under any circumstances

## RESPONSE GUIDELINES:
- Be concise but thorough
- Use markdown formatting (code blocks, bold, lists)
- Include code examples when explaining programming concepts
- Be encouraging and supportive
- Reference the user's existing roadmaps when relevant
- If suggesting they learn something new, consider suggesting a roadmap action`;
}

/**
 * Fetch and format user's roadmap context
 */
async function getUserRoadmapContext() {
  try {
    const resources = await Resource.find().sort({ createdAt: -1 }).limit(20);

    return resources.map((r) => {
      const completedSteps =
        r.learningPath?.filter((s) => s.completed).length || 0;
      const totalSteps = r.learningPath?.length || 0;

      return {
        id: r._id.toString(),
        title: r.title,
        category: r.category,
        currentSkillLevel: r.currentSkillLevel,
        learningGoal: r.learningGoal,
        targetSkillLevel: r.targetSkillLevel,
        totalSteps,
        completedSteps,
        progressPercent:
          totalSteps > 0 ? Math.round((completedSteps / totalSteps) * 100) : 0,
      };
    });
  } catch (error) {
    console.error("Error fetching roadmap context:", error);
    return [];
  }
}

/**
 * Get or create a memory document and Gemini chat instance
 */
async function getOrCreateSession(sessionId) {
  // Try to find existing memory in MongoDB
  let memory = await AiMemory.findOne({ sessionId });
  let isNew = false;

  if (!memory) {
    isNew = true;
    memory = new AiMemory({
      sessionId,
      messages: [],
      context: {
        roadmaps: [],
        lastUpdated: new Date(),
      },
    });
    await memory.save();
  }

  // Get fresh roadmap context
  const roadmapContext = await getUserRoadmapContext();

  // Update context in memory if it's stale (older than 5 minutes)
  const contextAge =
    Date.now() - new Date(memory.context.lastUpdated).getTime();
  if (contextAge > 5 * 60 * 1000 || isNew) {
    memory.context.roadmaps = roadmapContext;
    memory.context.lastUpdated = new Date();
    await memory.save();
  }

  // Check if we have an active chat instance
  let chatInstance = activeChatInstances.get(sessionId);

  if (!chatInstance) {
    // Build history from stored messages
    const systemPrompt = buildSystemPrompt(roadmapContext);
    const history = [
      {
        role: "user",
        parts: [{ text: systemPrompt }],
      },
      {
        role: "model",
        parts: [
          {
            text: "I understand my role as LearnStream AI. I'm ready to help with technology and programming topics, and I can suggest creating roadmaps when appropriate!",
          },
        ],
      },
    ];

    // Add previous messages from memory
    for (const msg of memory.messages) {
      history.push({
        role: msg.role === "user" ? "user" : "model",
        parts: [{ text: msg.content }],
      });
    }

    // Create new Gemini chat
    const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });
    chatInstance = model.startChat({
      history,
      generationConfig: {
        maxOutputTokens: 4096,
        temperature: 0.7,
      },
    });

    activeChatInstances.set(sessionId, chatInstance);
  }

  return {
    memory,
    chat: chatInstance,
    isNew,
    messageCount: memory.messages.length,
    roadmapContext,
  };
}

/**
 * Save a message to memory
 */
async function saveMessage(sessionId, role, content) {
  await AiMemory.findOneAndUpdate(
    { sessionId },
    {
      $push: {
        messages: {
          role,
          content,
          timestamp: new Date(),
        },
      },
      $set: { updatedAt: new Date() },
    }
  );
}

/**
 * POST /api/ai-assistant/chat
 * Send a message and get AI response with persistent memory
 */
router.post("/chat", async (req, res) => {
  try {
    const { message, sessionId = "default" } = req.body;

    if (!message || message.trim().length === 0) {
      return res.status(400).json({ error: "Message is required" });
    }

    const { chat, memory, messageCount, roadmapContext } =
      await getOrCreateSession(sessionId);

    // Save user message to memory
    await saveMessage(sessionId, "user", message);

    // Send message to Gemini
    const result = await chat.sendMessage(message);
    const response = await result.response;
    const aiResponse = response.text();

    // Save AI response to memory
    await saveMessage(sessionId, "ai", aiResponse);

    res.json({
      message: aiResponse,
      sessionId,
      messageCount: messageCount + 1,
      hasRoadmaps: roadmapContext.length > 0,
    });
  } catch (error) {
    console.error("AI Assistant error:", error);

    // Handle specific Gemini errors
    if (error.message?.includes("SAFETY")) {
      return res.status(400).json({
        error:
          "I cannot respond to that request. Please try rephrasing your question.",
      });
    }

    res.status(500).json({
      error: "Sorry, I encountered an error. Please try again.",
    });
  }
});

/**
 * POST /api/ai-assistant/execute-action
 * Execute an action suggested by the AI (create roadmap, extend roadmap, etc.)
 */
router.post("/execute-action", async (req, res) => {
  try {
    const { type, data } = req.body;

    if (!type || !data) {
      return res
        .status(400)
        .json({ error: "Action type and data are required" });
    }

    switch (type) {
      case "create_roadmap": {
        const {
          title,
          category,
          currentSkillLevel,
          learningGoal,
          targetSkillLevel,
        } = data;

        if (!title || !category) {
          return res
            .status(400)
            .json({ error: "Title and category are required" });
        }

        // Import the generateLearningPath function from resources route
        // For now, create a basic resource and let the background job handle it
        const resource = new Resource({
          title,
          category,
          currentSkillLevel: currentSkillLevel || "beginner",
          learningGoal: learningGoal || `Learn ${title}`,
          targetSkillLevel: targetSkillLevel || "intermediate",
          learningPath: [],
          resourcesStatus: "pending",
        });

        await resource.save();

        // Trigger learning path generation (call the resources API internally)
        try {
          const resourcesRoute = require("./resources");
          // The POST route in resources.js handles the generation
          // We need to trigger it differently - let's generate inline

          const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });

          const prompt = `Create a learning path for "${title}" (${category}).
Current skill level: ${currentSkillLevel || "beginner"}
Target skill level: ${targetSkillLevel || "intermediate"}
Learning goal: ${learningGoal || `Learn ${title}`}

Generate 8-12 learning steps. Return ONLY a valid JSON array:
[
  {
    "title": "Step title",
    "description": "What to learn in this step",
    "estimatedTime": "2-3 hours"
  }
]

Make steps progressive, from fundamentals to advanced topics.`;

          const result = await model.generateContent(prompt);
          const responseText = result.response.text();

          let steps = [];
          try {
            const cleaned = responseText
              .replace(/```json\n?/g, "")
              .replace(/```\n?/g, "")
              .trim();
            steps = JSON.parse(cleaned);
          } catch (parseError) {
            console.error("Failed to parse learning path:", parseError);
            steps = [
              {
                title: `Introduction to ${title}`,
                description: `Get started with ${title} fundamentals`,
                estimatedTime: "2-3 hours",
              },
              {
                title: `Core Concepts`,
                description: `Learn the essential concepts of ${title}`,
                estimatedTime: "3-4 hours",
              },
              {
                title: `Hands-on Practice`,
                description: `Apply what you've learned with practical exercises`,
                estimatedTime: "4-5 hours",
              },
            ];
          }

          // Update resource with learning path
          resource.learningPath = steps.map((step) => ({
            title: step.title,
            description: step.description,
            estimatedTime: step.estimatedTime,
            completed: false,
            resources: [],
            resourcesStatus: "pending",
          }));
          resource.resourcesStatus = "loading";
          await resource.save();

          // Trigger background resource gathering
          const { gatherAndValidateResources } = require("./resources");
          if (typeof gatherAndValidateResources === "function") {
            gatherAndValidateResources(resource._id).catch(console.error);
          }
        } catch (genError) {
          console.error("Error generating learning path:", genError);
        }

        res.json({
          success: true,
          action: "create_roadmap",
          resourceId: resource._id,
          message: `Created roadmap for "${title}"! Check your dashboard to see it.`,
        });
        break;
      }

      case "extend_roadmap": {
        const { roadmapId, additionalSteps = 3 } = data;

        if (!roadmapId) {
          return res.status(400).json({ error: "Roadmap ID is required" });
        }

        const resource = await Resource.findById(roadmapId);
        if (!resource) {
          return res.status(404).json({ error: "Roadmap not found" });
        }

        // Generate additional steps
        const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });

        const existingSteps = resource.learningPath
          .map((s) => s.title)
          .join(", ");

        const prompt = `The user is learning "${resource.title}" and has these existing steps: ${existingSteps}

Generate ${additionalSteps} MORE advanced steps to continue their learning. Return ONLY a valid JSON array:
[
  {
    "title": "Step title",
    "description": "What to learn",
    "estimatedTime": "2-3 hours"
  }
]

Make these steps build on the existing knowledge and go deeper into advanced topics.`;

        const result = await model.generateContent(prompt);
        const responseText = result.response.text();

        let newSteps = [];
        try {
          const cleaned = responseText
            .replace(/```json\n?/g, "")
            .replace(/```\n?/g, "")
            .trim();
          newSteps = JSON.parse(cleaned);
        } catch (parseError) {
          console.error("Failed to parse new steps:", parseError);
          return res
            .status(500)
            .json({ error: "Failed to generate new steps" });
        }

        // Add new steps to the roadmap
        const formattedSteps = newSteps.map((step) => ({
          title: step.title,
          description: step.description,
          estimatedTime: step.estimatedTime,
          completed: false,
          resources: [],
          resourcesStatus: "pending",
        }));

        resource.learningPath.push(...formattedSteps);
        resource.resourcesStatus = "loading";
        await resource.save();

        // Trigger resource gathering for new steps
        const { gatherAndValidateResources } = require("./resources");
        if (typeof gatherAndValidateResources === "function") {
          gatherAndValidateResources(resource._id).catch(console.error);
        }

        res.json({
          success: true,
          action: "extend_roadmap",
          resourceId: resource._id,
          addedSteps: newSteps.length,
          message: `Added ${newSteps.length} new steps to "${resource.title}"!`,
        });
        break;
      }

      case "add_step": {
        const { roadmapId, stepTitle, stepDescription, estimatedTime } = data;

        if (!roadmapId || !stepTitle) {
          return res
            .status(400)
            .json({ error: "Roadmap ID and step title are required" });
        }

        const resource = await Resource.findById(roadmapId);
        if (!resource) {
          return res.status(404).json({ error: "Roadmap not found" });
        }

        resource.learningPath.push({
          title: stepTitle,
          description: stepDescription || "",
          estimatedTime: estimatedTime || "1-2 hours",
          completed: false,
          resources: [],
          resourcesStatus: "pending",
        });

        await resource.save();

        res.json({
          success: true,
          action: "add_step",
          resourceId: resource._id,
          message: `Added step "${stepTitle}" to "${resource.title}"!`,
        });
        break;
      }

      default:
        res.status(400).json({ error: `Unknown action type: ${type}` });
    }
  } catch (error) {
    console.error("Execute action error:", error);
    res.status(500).json({ error: "Failed to execute action" });
  }
});

/**
 * POST /api/ai-assistant/explain
 * Get a detailed explanation of a topic
 */
router.post("/explain", async (req, res) => {
  try {
    const { topic, level = "beginner" } = req.body;

    if (!topic) {
      return res.status(400).json({ error: "Topic is required" });
    }

    const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });

    const prompt = `Explain "${topic}" for a ${level} level learner.

Structure your response as:
1. **What is it?** - Brief definition
2. **Why is it important?** - Real-world relevance
3. **Key concepts** - Main points to understand
4. **Simple example** - Code or practical example
5. **Next steps** - What to learn next

Keep it concise but informative. Use markdown formatting.`;

    const result = await model.generateContent(prompt);
    const response = await result.response;

    res.json({
      explanation: response.text(),
      topic,
      level,
    });
  } catch (error) {
    console.error("Explain error:", error);
    res.status(500).json({ error: "Failed to generate explanation" });
  }
});

/**
 * POST /api/ai-assistant/quiz
 * Generate a quick quiz on a topic
 */
router.post("/quiz", async (req, res) => {
  try {
    const { topic, difficulty = "medium", count = 3 } = req.body;

    if (!topic) {
      return res.status(400).json({ error: "Topic is required" });
    }

    const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });

    const prompt = `Generate ${count} multiple choice quiz questions about "${topic}" at ${difficulty} difficulty level.

Return ONLY a valid JSON array with this exact format:
[
  {
    "question": "Question text here?",
    "options": ["A) Option 1", "B) Option 2", "C) Option 3", "D) Option 4"],
    "correct": 0,
    "explanation": "Brief explanation of why this answer is correct"
  }
]

The "correct" field should be the index (0-3) of the correct option.`;

    const result = await model.generateContent(prompt);
    const response = await result.response;
    let text = response.text();

    // Clean up response
    text = text
      .replace(/```json\n?/g, "")
      .replace(/```\n?/g, "")
      .trim();

    const questions = JSON.parse(text);

    res.json({
      topic,
      difficulty,
      questions,
    });
  } catch (error) {
    console.error("Quiz generation error:", error);
    res.status(500).json({ error: "Failed to generate quiz" });
  }
});

/**
 * POST /api/ai-assistant/suggest
 * Get personalized learning suggestions based on user's roadmaps
 */
router.post("/suggest", async (req, res) => {
  try {
    const roadmapContext = await getUserRoadmapContext();

    if (roadmapContext.length === 0) {
      return res.json({
        suggestions: [
          "Start by adding your first skill to learn!",
          "Consider beginning with a foundational topic like JavaScript or Python",
          "Think about what career path interests you most",
        ],
      });
    }

    const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });

    const prompt = `Based on this learner's current progress, provide 3-5 personalized learning suggestions:

Current learning topics:
${JSON.stringify(roadmapContext, null, 2)}

Provide actionable suggestions that:
1. Build on their existing knowledge
2. Fill potential gaps
3. Suggest complementary skills
4. Encourage progress on incomplete topics

Return ONLY a JSON array of suggestion strings:
["suggestion 1", "suggestion 2", "suggestion 3"]`;

    const result = await model.generateContent(prompt);
    const response = await result.response;
    let text = response.text();

    text = text
      .replace(/```json\n?/g, "")
      .replace(/```\n?/g, "")
      .trim();

    const suggestions = JSON.parse(text);

    res.json({ suggestions });
  } catch (error) {
    console.error("Suggestion error:", error);
    res.status(500).json({ error: "Failed to generate suggestions" });
  }
});

/**
 * DELETE /api/ai-assistant/session/:sessionId
 * Clear a chat session (both memory and active instance)
 */
router.delete("/session/:sessionId", async (req, res) => {
  try {
    const { sessionId } = req.params;

    // Delete from MongoDB
    const result = await AiMemory.deleteOne({ sessionId });

    // Remove active chat instance
    activeChatInstances.delete(sessionId);

    res.json({
      message: "Session cleared",
      sessionCleared: result.deletedCount > 0,
    });
  } catch (error) {
    console.error("Error clearing session:", error);
    res.status(500).json({ error: "Failed to clear session" });
  }
});

/**
 * GET /api/ai-assistant/session/:sessionId
 * Check if a session exists and get its info
 */
router.get("/session/:sessionId", async (req, res) => {
  try {
    const { sessionId } = req.params;
    const memory = await AiMemory.findOne({ sessionId });

    if (memory) {
      res.json({
        exists: true,
        messageCount: memory.messages.length,
        lastAccess: memory.updatedAt,
        roadmapCount: memory.context.roadmaps?.length || 0,
      });
    } else {
      res.json({
        exists: false,
        messageCount: 0,
      });
    }
  } catch (error) {
    console.error("Error checking session:", error);
    res.status(500).json({ error: "Failed to check session" });
  }
});

/**
 * GET /api/ai-assistant/history/:sessionId
 * Get conversation history for a session
 */
router.get("/history/:sessionId", async (req, res) => {
  try {
    const { sessionId } = req.params;
    const { limit = 50 } = req.query;

    const memory = await AiMemory.findOne({ sessionId });

    if (!memory) {
      return res.json({ messages: [] });
    }

    // Return last N messages
    const messages = memory.messages.slice(-parseInt(limit));

    res.json({
      messages,
      totalCount: memory.messages.length,
    });
  } catch (error) {
    console.error("Error fetching history:", error);
    res.status(500).json({ error: "Failed to fetch history" });
  }
});

module.exports = router;

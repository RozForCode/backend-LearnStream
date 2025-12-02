const express = require("express");
const router = express.Router();
const { GoogleGenerativeAI } = require("@google/generative-ai");
const Resource = require("../models/Resource");

// Initialize Gemini AI
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// Store chat sessions in memory (for simplicity - in production use Redis/DB)
const chatSessions = new Map();

// System prompt for the AI assistant
const SYSTEM_PROMPT = `You are LearnStream AI, a friendly and knowledgeable learning assistant. Your role is to:

1. Help users with their learning journey
2. Answer questions about programming, technology, and various skills
3. Provide clear explanations with examples when needed
4. Suggest learning resources and best practices
5. Motivate and encourage learners
6. Break down complex topics into simple, understandable parts

Guidelines:
- Be concise but thorough
- Use code examples when explaining programming concepts (wrap in markdown code blocks)
- Be encouraging and supportive
- If you don't know something, admit it honestly
- Tailor your responses to the user's skill level when mentioned
- Use emojis sparingly to keep the conversation friendly

Remember: You're helping people learn and grow their skills!`;

/**
 * Get or create a chat session for a user
 * Returns { chat, isNew } where isNew indicates if this is a fresh session
 */
function getOrCreateSession(sessionId) {
  let isNew = false;
  
  if (!chatSessions.has(sessionId)) {
    isNew = true;
    const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });
    const chat = model.startChat({
      history: [
        {
          role: "user",
          parts: [{ text: SYSTEM_PROMPT }],
        },
        {
          role: "model",
          parts: [
            {
              text: "I understand my role as LearnStream AI. I'm ready to help with learning!",
            },
          ],
        },
      ],
      generationConfig: {
        maxOutputTokens: 2048,
        temperature: 0.7,
      },
    });
    chatSessions.set(sessionId, {
      chat,
      lastAccess: Date.now(),
      messageCount: 0,
    });
  }

  const session = chatSessions.get(sessionId);
  session.lastAccess = Date.now();
  session.messageCount++;
  
  return { chat: session.chat, isNew, messageCount: session.messageCount };
}

/**
 * Clean up old sessions (older than 1 hour)
 */
function cleanupOldSessions() {
  const oneHourAgo = Date.now() - 60 * 60 * 1000;
  for (const [sessionId, session] of chatSessions.entries()) {
    if (session.lastAccess < oneHourAgo) {
      chatSessions.delete(sessionId);
    }
  }
}

// Run cleanup every 30 minutes
setInterval(cleanupOldSessions, 30 * 60 * 1000);

/**
 * POST /api/ai-assistant/chat
 * Send a message and get AI response
 * Maintains conversation history for true chat experience
 */
router.post("/chat", async (req, res) => {
  try {
    const { message, sessionId = "default" } = req.body;

    if (!message || message.trim().length === 0) {
      return res.status(400).json({ error: "Message is required" });
    }

    const { chat, isNew, messageCount } = getOrCreateSession(sessionId);

    // Only add context on first message of a session
    let messageToSend = message;
    if (isNew || messageCount === 1) {
      try {
        const resources = await Resource.find().select("title category").limit(5);
        if (resources.length > 0) {
          const topics = resources.map((r) => `${r.title} (${r.category})`).join(", ");
          messageToSend = `[Context: User is learning ${topics}]\n\n${message}`;
        }
      } catch (err) {
        // Ignore context errors
      }
    }

    // Send message to Gemini - chat history is automatically maintained
    const result = await chat.sendMessage(messageToSend);
    const response = await result.response;
    const aiResponse = response.text();

    res.json({
      message: aiResponse,
      sessionId,
      messageCount,
    });
  } catch (error) {
    console.error("AI Assistant error:", error);

    // Handle specific Gemini errors
    if (error.message?.includes("SAFETY")) {
      return res.status(400).json({
        error: "I cannot respond to that request. Please try rephrasing your question.",
      });
    }

    res.status(500).json({
      error: "Sorry, I encountered an error. Please try again.",
    });
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
    // Get user's current learning paths
    const resources = await Resource.find().sort({ createdAt: -1 }).limit(10);

    if (resources.length === 0) {
      return res.json({
        suggestions: [
          "Start by adding your first skill to learn!",
          "Consider beginning with a foundational topic like JavaScript or Python",
          "Think about what career path interests you most",
        ],
      });
    }

    const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });

    const userTopics = resources.map((r) => ({
      title: r.title,
      category: r.category,
      progress: r.learningPath?.filter((s) => s.completed).length || 0,
      total: r.learningPath?.length || 0,
    }));

    const prompt = `Based on this learner's current progress, provide 3-5 personalized learning suggestions:

Current learning topics:
${JSON.stringify(userTopics, null, 2)}

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
 * Clear a chat session to start fresh
 */
router.delete("/session/:sessionId", (req, res) => {
  const { sessionId } = req.params;
  const existed = chatSessions.has(sessionId);
  chatSessions.delete(sessionId);
  res.json({ 
    message: "Session cleared",
    sessionCleared: existed 
  });
});

/**
 * GET /api/ai-assistant/session/:sessionId
 * Check if a session exists and get its info
 */
router.get("/session/:sessionId", (req, res) => {
  const { sessionId } = req.params;
  const session = chatSessions.get(sessionId);
  
  if (session) {
    res.json({
      exists: true,
      messageCount: session.messageCount || 0,
      lastAccess: session.lastAccess,
    });
  } else {
    res.json({
      exists: false,
      messageCount: 0,
    });
  }
});

module.exports = router;


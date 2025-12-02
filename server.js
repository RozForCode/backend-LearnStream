const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");
require("dotenv").config();

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());

// Database Connection
mongoose
  .connect(process.env.MONGODB_URI)
  .then(async () => {
    console.log("Connected to MongoDB");
    // Initialize pending notifications on server start
    const {
      initializePendingNotifications,
    } = require("./routes/notifications");
    await initializePendingNotifications();
  })
  .catch((err) => console.error("Could not connect to MongoDB", err));

// Routes
const topicsRouter = require("./routes/topics");
const resourcesRouter = require("./routes/resources");
const aiAssistantRouter = require("./routes/ai-assistant");
const progressRouter = require("./routes/progress");
const notificationsRouter = require("./routes/notifications");

app.use("/api/topics", topicsRouter);
app.use("/api/resources", resourcesRouter);
app.use("/api/ai-assistant", aiAssistantRouter);
app.use("/api/progress", progressRouter);
app.use("/api/notifications", notificationsRouter);

app.get("/", (req, res) => {
  res.send("LearnStream API is running");
});

app.get("/ping", (req, res) => {
  res.send("pong");
});

app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});

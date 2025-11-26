const express = require('express');
const router = express.Router();
const Topic = require('../models/Topic');

// GET all topics
router.get('/', async (req, res) => {
    try {
        const topics = await Topic.find();
        res.json(topics);
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

// POST a new topic
router.post('/', async (req, res) => {
    const topic = new Topic({
        title: req.body.title,
        category: req.body.category,
        progress: req.body.progress,
        status: req.body.status
    });

    try {
        const newTopic = await topic.save();
        res.status(201).json(newTopic);
    } catch (err) {
        res.status(400).json({ message: err.message });
    }
});

module.exports = router;

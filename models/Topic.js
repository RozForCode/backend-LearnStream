const mongoose = require('mongoose');

const topicSchema = new mongoose.Schema({
    title: {
        type: String,
        required: true
    },
    category: {
        type: String,
        required: true
    },
    progress: {
        type: Number,
        default: 0
    },
    status: {
        type: String,
        default: 'In Progress'
    }
});

module.exports = mongoose.model('Topic', topicSchema);

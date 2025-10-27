const mongoose = require('mongoose');

const BriefingLogSchema = new mongoose.Schema({
    userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    type: {
        type: String,
        required: true,
        enum: ['weekly', 'daily', 'analysis']
    },
    generatedDate: {
        type: String,
        required: true // YYYY-MM-DD 형식
    },
    briefingData: {
        type: mongoose.Schema.Types.Mixed,
        required: true
    },
    createdAt: {
        type: Date,
        default: Date.now
    }
}, {
    timestamps: true
});

// 중복 방지 인덱스
BriefingLogSchema.index({ userId: 1, type: 1, generatedDate: 1 }, { unique: true });

module.exports = mongoose.model('BriefingLog', BriefingLogSchema);


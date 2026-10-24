import mongoose from 'mongoose';

// Same shape for every AI step (workflow section 4), plus review state for the officer.
const flagSchema = new mongoose.Schema(
  {
    application: { type: mongoose.Schema.Types.ObjectId, ref: 'Application', required: true, index: true },
    run: { type: Number, required: true },
    document: { type: mongoose.Schema.Types.ObjectId, ref: 'Document' },
    stage: { type: String, enum: ['ai1', 'ai2', 'ai3', 'ai4', 'ai5'] },
    type: { type: String, required: true },
    severity: { type: String, enum: ['low', 'medium', 'high'], required: true },
    reason: { type: String, required: true },
    evidence: {
      document: String,
      page: Number,
      bbox: [Number],
    },
    confidence: { type: Number, min: 0, max: 1 },
    needsHumanReview: { type: Boolean, default: true },
    review: {
      status: { type: String, enum: ['open', 'acknowledged', 'resolved', 'dismissed'], default: 'open', index: true },
      note: String,
      by: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
      at: Date,
    },
  },
  { timestamps: true }
);

export const Flag = mongoose.model('Flag', flagSchema);

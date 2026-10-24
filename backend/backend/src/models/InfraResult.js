import mongoose from 'mongoose';

const infraResultSchema = new mongoose.Schema(
  {
    application: { type: mongoose.Schema.Types.ObjectId, ref: 'Application', required: true, index: true },
    run: { type: Number, required: true },
    document: { type: mongoose.Schema.Types.ObjectId, ref: 'Document' },
    requirementKey: String,
    requirement: String,
    visible: String, // what the model says it can see
    appearsToMeet: Boolean,
    result: { type: String, enum: ['ok', 'needs_more_evidence', 'needs_inspection'], required: true },
    confidence: Number,
  },
  { timestamps: true }
);

export const InfraResult = mongoose.model('InfraResult', infraResultSchema);

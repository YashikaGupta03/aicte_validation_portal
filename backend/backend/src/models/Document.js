import mongoose from 'mongoose';

const fieldSchema = new mongoose.Schema(
  {
    name: String,
    value: String,
    page: Number,
    bbox: [Number], // [x0, y0, x1, y1] in page-image pixels
  },
  { _id: false }
);

const documentSchema = new mongoose.Schema(
  {
    application: { type: mongoose.Schema.Types.ObjectId, ref: 'Application', required: true, index: true },
    kind: { type: String, enum: ['checklist', 'infrastructure'], required: true },
    key: { type: String, required: true }, // checklist doc key or infrastructure requirement key
    filename: { type: String, required: true },
    mime: String,
    size: Number,
    gridfsId: { type: mongoose.Schema.Types.ObjectId, required: true },
    sha256: { type: String, index: true },
    phash: { type: String, index: true }, // hex perceptual hash of page 1, filled in by the AI service
    active: { type: Boolean, default: true }, // replaced files stay stored but become inactive
    uploadedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    extracted: {
      docType: String,
      confidence: Number,
      ocrEngine: String,
      fields: [fieldSchema],
      pageCount: Number,
    },
  },
  { timestamps: true }
);

documentSchema.index({ application: 1, kind: 1, key: 1, active: 1 });

export const DocumentModel = mongoose.model('Document', documentSchema);

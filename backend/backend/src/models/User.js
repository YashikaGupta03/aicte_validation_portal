import mongoose from 'mongoose';

const userSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    institution: { type: String, trim: true, default: '' },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    passwordHash: { type: String, required: true, select: false },
    role: { type: String, enum: ['college', 'officer', 'admin'], required: true },
    status: { type: String, enum: ['pending', 'active', 'disabled'], default: 'pending' },
    designation: { type: String, default: '' }, // e.g. "Scrutiny officer"
    lastLoginAt: Date,
  },
  { timestamps: true }
);

userSchema.methods.toPublic = function () {
  return {
    id: this._id,
    name: this.name,
    institution: this.institution,
    email: this.email,
    role: this.role,
    status: this.status,
    designation: this.designation,
    createdAt: this.createdAt,
  };
};

export const User = mongoose.model('User', userSchema);

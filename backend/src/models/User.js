import mongoose from 'mongoose';
import { ROLES } from '../config/constants.js';

const { Schema } = mongoose;

const userSchema = new Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 120 },
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
      maxlength: 200,
    },
    phone: { type: String, trim: true, default: null },
    passwordHash: { type: String, required: true, select: false },
    role: { type: String, enum: ROLES, default: 'citizen', required: true },
    organizationName: { type: String, trim: true, default: null, maxlength: 200 },
    isSuspended: { type: Boolean, default: false },
    createdAt: { type: Date, default: Date.now },
  },
  { versionKey: false },
);

export const User = mongoose.model('User', userSchema);

import mongoose from 'mongoose';
import { ROLES, NEED_TYPES } from '../config/constants.js';

const { Schema } = mongoose;

/**
 * Users come in three roles:
 *   - citizen    : self-registers with a phone number. Login uses phone.
 *   - ngo        : provisioned by government. Login uses email.
 *   - government : created once by the bootstrap flow. Login uses email.
 *
 * `phone` and `email` are unique-sparse, so the field must be OMITTED (never
 * set to null) when absent — a stored null still occupies a sparse unique slot.
 */
const userSchema = new Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 120 },

    // Stored as +91XXXXXXXXXX. Unique-sparse: only present when set.
    phone: {
      type: String,
      trim: true,
      match: [/^\+91[6-9]\d{9}$/, 'phone must be +91 followed by a 10-digit number starting 6-9'],
    },

    // Optional for citizens, required (by service rules) for NGO/government.
    email: {
      type: String,
      lowercase: true,
      trim: true,
      maxlength: 200,
    },

    passwordHash: { type: String, required: true, select: false },
    role: { type: String, enum: ROLES, default: 'citizen', required: true, index: true },

    // NGO capabilities: a subset of NEED_TYPES.
    capabilities: {
      type: [{ type: String, enum: NEED_TYPES }],
      default: [],
    },

    organizationName: { type: String, trim: true, maxlength: 200 },

    // ─── Identity verification (never stores an Aadhaar number) ─────────────
    identityVerified: { type: Boolean, default: false },
    verifiedName: { type: String, trim: true, maxlength: 120 },
    identityRefHash: { type: String }, // sha256 of the DigiLocker reference

    // Consent is required at citizen registration.
    consentAt: { type: Date },

    mustChangePassword: { type: Boolean, default: false },
    isSuspended: { type: Boolean, default: false },
    createdAt: { type: Date, default: Date.now },
  },
  {
    versionKey: false,
    // Strip undefined so omitted optional fields never become null (see above).
    minimize: true,
  },
);

// Explicit index declarations (sparse uniqueness also declared on the paths).
userSchema.index({ phone: 1 }, { unique: true, sparse: true });
userSchema.index({ email: 1 }, { unique: true, sparse: true });

export const User = mongoose.model('User', userSchema);

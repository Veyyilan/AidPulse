import mongoose from 'mongoose';
import { NEED_TYPES, NEED_STATUSES } from '../config/constants.js';

const { Schema } = mongoose;

const pointSchema = new Schema(
  {
    type: { type: String, enum: ['Point'], default: 'Point' },
    coordinates: {
      type: [Number], // [lng, lat]
      required: true,
      validate: {
        validator: (v) => Array.isArray(v) && v.length === 2,
        message: 'coordinates must be [lng, lat]',
      },
    },
  },
  { _id: false },
);

/**
 * A single requested need on a report. `updatedAt` tracks the last status
 * change so the stale-claim sweeper can find claims with "no update".
 */
const needSchema = new Schema(
  {
    type: { type: String, enum: NEED_TYPES, required: true },
    status: { type: String, enum: NEED_STATUSES, default: 'pending', required: true },
    claimedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    claimedAt: { type: Date, default: null },
    resolvedAt: { type: Date, default: null },
    updatedAt: { type: Date, default: Date.now },
  },
  { _id: false },
);

const reportSchema = new Schema(
  {
    reportedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },

    // Client-generated idempotency key. Optional. Unique per reporter.
    clientId: { type: String, trim: true, maxlength: 100 },

    location: { type: pointSchema, required: true },
    accuracyMeters: { type: Number, default: null, min: 0 },

    // Non-empty set of unique need types (validated in the service layer too).
    needs: {
      type: [needSchema],
      required: true,
      validate: {
        validator: (v) => Array.isArray(v) && v.length > 0,
        message: 'needs must be a non-empty list',
      },
    },

    // Points at the primary report this one was merged into. Depth is always 1.
    mergedInto: { type: Schema.Types.ObjectId, ref: 'Report', default: null },

    // 1 for a lone report; +1 for every report merged into it.
    reporterCount: { type: Number, default: 1, min: 1 },

    // e.g. 'low_accuracy', 'excessive_merges' — for government review.
    flags: { type: [String], default: [] },

    createdAt: { type: Date, default: Date.now },
  },
  { versionKey: false },
);

// Geospatial index powering $geoNear / $near (merge detection).
reportSchema.index({ location: '2dsphere' });
// Feed + merge-target queries: open primaries ordered by age.
reportSchema.index({ mergedInto: 1, createdAt: -1 });
// Idempotency: at most one report per (user, client id). Partial so reports
// without a clientId (allowed) are never indexed and never collide.
reportSchema.index(
  { reportedBy: 1, clientId: 1 },
  { unique: true, partialFilterExpression: { clientId: { $exists: true } } },
);

export const Report = mongoose.model('Report', reportSchema);

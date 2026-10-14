import mongoose from 'mongoose';
import { NEED_TYPES, REPORT_STATUSES, REPORT_SOURCES } from '../config/constants.js';

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

const reportSchema = new Schema(
  {
    reportedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    // Client-generated idempotency key so a retried (offline) submission never
    // creates a second report. Absent for operator/SMS-sourced reports.
    clientId: { type: String, default: undefined, trim: true, maxlength: 100 },
    needType: { type: String, enum: NEED_TYPES, required: true },
    description: { type: String, required: true, trim: true, minlength: 10, maxlength: 500 },
    location: { type: pointSchema, required: true },
    accuracyMeters: { type: Number, default: null, min: 0 },
    status: {
      type: String,
      enum: REPORT_STATUSES,
      default: 'pending',
      required: true,
      index: true,
    },
    claimedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null, index: true },
    claimedAt: { type: Date, default: null },
    resolvedAt: { type: Date, default: null },
    duplicateOf: { type: Schema.Types.ObjectId, ref: 'Report', default: null, index: true },
    duplicateCount: { type: Number, default: 0, min: 0 },
    source: { type: String, enum: REPORT_SOURCES, default: 'app' },
    createdAt: { type: Date, default: Date.now },
  },
  { versionKey: false },
);

// Geospatial index powering $near / $geoNear (nearby + duplicate detection).
reportSchema.index({ location: '2dsphere' });
// Compound index for the live feed filters.
reportSchema.index({ status: 1, needType: 1, createdAt: -1 });
// Idempotency: at most one report per (user, client-generated id). Scoped to the
// reporting user so two different users may reuse the same clientId without
// either ever receiving the other's report. Partial index so reports without a
// clientId (SMS/operator) are not indexed and never collide.
reportSchema.index(
  { reportedBy: 1, clientId: 1 },
  { unique: true, partialFilterExpression: { clientId: { $exists: true } } },
);

export const Report = mongoose.model('Report', reportSchema);

import mongoose from 'mongoose';
import { AUDIT_ACTIONS } from '../config/constants.js';

const { Schema } = mongoose;

/**
 * Append-only claim audit log. There is no route that updates or deletes these
 * documents, and the model hooks below reject any mutation attempt outright.
 */
const claimAuditSchema = new Schema(
  {
    reportId: { type: Schema.Types.ObjectId, ref: 'Report', required: true, index: true },
    actorId: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    action: { type: String, enum: AUDIT_ACTIONS, required: true },
    timestamp: { type: Date, default: Date.now, immutable: true },
  },
  { versionKey: false },
);

claimAuditSchema.index({ reportId: 1, timestamp: 1 });

function blockMutation() {
  throw new Error('claimaudits is append-only: update and delete are not permitted');
}

claimAuditSchema.pre('findOneAndUpdate', blockMutation);
claimAuditSchema.pre('updateOne', blockMutation);
claimAuditSchema.pre('updateMany', blockMutation);
claimAuditSchema.pre('deleteOne', blockMutation);
claimAuditSchema.pre('deleteMany', blockMutation);
claimAuditSchema.pre('findOneAndDelete', blockMutation);
claimAuditSchema.pre('remove', blockMutation);

export const ClaimAudit = mongoose.model('ClaimAudit', claimAuditSchema);

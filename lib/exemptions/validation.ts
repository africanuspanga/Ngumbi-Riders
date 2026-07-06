import { z } from 'zod';

// Rider exemption request (spec §16.2).
export const exemptionRequestSchema = z.object({
  obligationId: z.string().uuid(),
  reason: z.string().trim().min(5, 'Eleza sababu').max(1000),
});
export type ExemptionRequestInput = z.infer<typeof exemptionRequestSchema>;

export const EXEMPTION_STATUS_LABELS: Record<string, string> = {
  submitted: 'Imewasilishwa',
  under_review: 'Inakaguliwa',
  approved_waived: 'Imesamehewa',
  approved_postponed: 'Imeahirishwa',
  rejected: 'Imekataliwa',
  cancelled: 'Imeghairiwa',
};

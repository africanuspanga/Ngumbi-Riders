import { z } from 'zod';

// Incident report (spec §16.1). Rider-submitted.
export const INCIDENT_CATEGORIES = [
  'breakdown',
  'accident',
  'theft',
  'police_issue',
  'maintenance_request',
  'personal_emergency',
] as const;

export const INCIDENT_LABELS: Record<(typeof INCIDENT_CATEGORIES)[number], string> = {
  breakdown: 'Pikipiki imeharibika',
  accident: 'Ajali',
  theft: 'Wizi',
  police_issue: 'Suala la polisi',
  maintenance_request: 'Ombi la matengenezo',
  personal_emergency: 'Dharura binafsi',
};

// Rider-facing Swahili labels for incident status (spec §36.11); the value set
// is enforced in lib/incidents/actions.ts (INCIDENT_STATUSES).
export const INCIDENT_STATUS_LABELS_SW: Record<string, string> = {
  open: 'Limepokelewa',
  in_progress: 'Linashughulikiwa',
  resolved: 'Limetatuliwa',
};

export const incidentSchema = z.object({
  category: z.enum(INCIDENT_CATEGORIES),
  occurredAt: z.string().refine((v) => !Number.isNaN(Date.parse(v)), { message: 'Tarehe si sahihi' }),
  description: z.string().trim().min(5, 'Eleza tukio').max(2000),
  locationText: z.string().trim().max(300).optional().or(z.literal('')),
});

export type IncidentInput = z.infer<typeof incidentSchema>;

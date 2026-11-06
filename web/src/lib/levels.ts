/** Must match api/src/arkiv/schemas.ts LEVELS. */
export const LEVELS = [
  { id: 'dry', label: 'Dry', hint: 'No water on the road', color: '#3fae6a' },
  { id: 'ankle', label: 'Ankle', hint: 'Walkable, bikes slow down', color: '#e8c547' },
  { id: 'knee', label: 'Knee', hint: 'Two-wheelers stall', color: '#f08a3c' },
  { id: 'waist', label: 'Waist', hint: 'Cars stall', color: '#d9453b' },
  { id: 'closed', label: 'Road closed', hint: 'Blocked or barricaded', color: '#6b2fa3' },
] as const;

export type Level = (typeof LEVELS)[number]['id'];

export const MUMBAI_CENTER: [number, number] = [19.076, 72.8777];

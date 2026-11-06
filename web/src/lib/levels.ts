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

/** Dev mode only: known flood spots, so the flow can be tested from anywhere without faking GPS. */
export const DEMO_SPOTS = [
  { name: 'Andheri subway', lat: 19.1197, lng: 72.8464 },
  { name: 'Milan subway', lat: 19.0833, lng: 72.8427 },
  { name: 'Khar subway', lat: 19.0717, lng: 72.8406 },
  { name: 'Hindmata', lat: 19.0035, lng: 72.8423 },
] as const;

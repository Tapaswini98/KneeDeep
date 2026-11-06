import { PLACES } from '../lib/places';
import { setTestLocation, useTestLocation } from '../lib/testLocation';

/** Top-bar control, outside production only: stand at a known spot instead of using GPS. */
export function TestLocationPicker() {
  const { allowed, location } = useTestLocation();
  if (!allowed) return null;
  return (
    <label
      className={`test-location ${location ? 'on' : ''}`}
      title="Testing only: report and vote as if you were standing here. Production always uses real GPS."
    >
      <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
        <path
          fill="currentColor"
          d="M12 2a7 7 0 0 0-7 7c0 5.2 7 13 7 13s7-7.8 7-13a7 7 0 0 0-7-7Zm0 9.5A2.5 2.5 0 1 1 12 6.5a2.5 2.5 0 0 1 0 5Z"
        />
      </svg>
      <span className="test-location-label">{location ? 'Test location' : 'Location'}</span>
      <select
        value={location?.name ?? ''}
        onChange={(e) => setTestLocation(PLACES.find((p) => p.name === e.target.value) ?? null)}
      >
        <option value="">Real GPS</option>
        {PLACES.map((p) => (
          <option key={p.name} value={p.name}>
            {p.name}
          </option>
        ))}
      </select>
    </label>
  );
}

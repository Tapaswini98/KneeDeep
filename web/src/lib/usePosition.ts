import { useEffect, useState } from 'react';
import { currentPosition, errorText, type Position } from './actions';
import { useTestLocation } from './testLocation';

/**
 * Where the user stands: GPS on request, or the test location from the top bar (applied
 * immediately, and followed when it changes).
 */
export function usePosition() {
  const { location: test } = useTestLocation();
  const [position, setPosition] = useState<Position | null>(null);
  const [locating, setLocating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (test) setPosition({ lat: test.lat, lng: test.lng, accuracy: 0, label: test.name });
    else setPosition((p) => (p?.label ? null : p)); // back to GPS: forget the test spot
  }, [test]);

  const locate = async () => {
    setLocating(true);
    setError(null);
    try {
      setPosition(await currentPosition());
    } catch (err) {
      setError(errorText(err));
    } finally {
      setLocating(false);
    }
  };

  return { position, locate, locating, error, isTest: Boolean(test) };
}

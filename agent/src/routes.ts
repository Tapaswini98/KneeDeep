/**
 * The demo trip: a delivery from Bandra to Andheri with two candidate routes.
 * Waypoints are the points the agent asks KneeDeep about; the low-lying ones
 * (subways, underpasses) are where Mumbai floods first.
 */
export interface Waypoint {
  name: string;
  lat: number;
  lng: number;
}

export interface Route {
  id: string;
  name: string;
  distanceKm: number;
  waypoints: Waypoint[];
}

export const TRIP = {
  from: { name: 'Bandra station (W)', lat: 19.0544, lng: 72.8406 },
  to: { name: 'Andheri station (W)', lat: 19.1197, lng: 72.8464 },
};

export const ROUTES: Route[] = [
  {
    id: 'sv-road',
    name: 'S.V. Road via Andheri subway',
    distanceKm: 8.1,
    waypoints: [
      { name: 'Khar subway', lat: 19.0717, lng: 72.8406 },
      { name: 'Milan subway', lat: 19.0833, lng: 72.8427 },
      { name: 'Andheri subway', lat: 19.1197, lng: 72.8464 },
    ],
  },
  {
    id: 'weh',
    name: 'Western Express Highway',
    distanceKm: 9.4,
    waypoints: [
      { name: 'Kalanagar junction', lat: 19.0606, lng: 72.8484 },
      { name: 'Vile Parle flyover', lat: 19.0996, lng: 72.8526 },
      { name: 'Andheri flyover (E)', lat: 19.1155, lng: 72.8551 },
    ],
  },
];

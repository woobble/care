export interface RouteLocation {
  latitude: number;
  longitude: number;
}

export interface RouteStopInput {
  visitId: string;
  location: RouteLocation | null;
}

export interface RouteLegEstimate {
  fromVisitId: string | null;
  toVisitId: string;
  distanceMeters: number;
  durationSeconds: number;
}

export interface RouteEstimate {
  status: 'available' | 'unavailable' | 'unresolved';
  legs: RouteLegEstimate[];
}

export interface RouteOrderSuggestion {
  status: 'available' | 'unavailable' | 'unresolved';
  visitIds: string[];
}

export interface RouteProvider {
  estimate(stops: RouteStopInput[], startLocation?: RouteLocation | null): Promise<RouteEstimate>;
  suggestOrder(
    stops: RouteStopInput[],
    startLocation?: RouteLocation | null,
  ): Promise<RouteOrderSuggestion>;
}

export class UnavailableRouteProvider implements RouteProvider {
  async estimate(): Promise<RouteEstimate> {
    return { status: 'unavailable', legs: [] };
  }

  async suggestOrder(stops: RouteStopInput[]): Promise<RouteOrderSuggestion> {
    return { status: 'unavailable', visitIds: stops.map((stop) => stop.visitId) };
  }
}

export class OsrmRouteProvider implements RouteProvider {
  constructor(private readonly baseUrl: string) {}

  async estimate(
    stops: RouteStopInput[],
    startLocation?: RouteLocation | null,
  ): Promise<RouteEstimate> {
    if (stops.length < 2 && !startLocation) return { status: 'available', legs: [] };
    if (stops.length === 0) return { status: 'available', legs: [] };
    if (stops.some((stop) => stop.location === null)) return { status: 'unresolved', legs: [] };
    const coordinates = coordinatePath(stops, startLocation);
    try {
      const url = new URL(`/route/v1/driving/${coordinates}`, this.baseUrl);
      url.searchParams.set('overview', 'false');
      url.searchParams.set('steps', 'false');
      url.searchParams.set('annotations', 'duration,distance');
      const response = await fetch(url, { signal: AbortSignal.timeout(5_000) });
      if (!response.ok) return { status: 'unavailable', legs: [] };
      const result = (await response.json()) as {
        code?: string;
        legs?: Array<{ distance?: number; duration?: number }>;
      };
      const expectedLegCount = stops.length - 1 + (startLocation ? 1 : 0);
      if (result.code !== 'Ok' || result.legs?.length !== expectedLegCount) {
        return { status: 'unavailable', legs: [] };
      }
      return {
        status: 'available',
        legs: result.legs.map((leg, index) => ({
          fromVisitId:
            startLocation && index === 0 ? null : stops[index - (startLocation ? 1 : 0)]!.visitId,
          toVisitId: stops[index + 1 - (startLocation ? 1 : 0)]!.visitId,
          distanceMeters: Math.max(0, Math.round(leg.distance ?? 0)),
          durationSeconds: Math.max(0, Math.round(leg.duration ?? 0)),
        })),
      };
    } catch {
      return { status: 'unavailable', legs: [] };
    }
  }

  async suggestOrder(
    stops: RouteStopInput[],
    startLocation?: RouteLocation | null,
  ): Promise<RouteOrderSuggestion> {
    if (stops.length < (startLocation ? 2 : 3)) {
      return { status: 'available', visitIds: stops.map((stop) => stop.visitId) };
    }
    if (stops.some((stop) => stop.location === null)) {
      return { status: 'unresolved', visitIds: stops.map((stop) => stop.visitId) };
    }
    try {
      const url = new URL(`/trip/v1/driving/${coordinatePath(stops, startLocation)}`, this.baseUrl);
      url.searchParams.set('roundtrip', 'false');
      url.searchParams.set('source', 'first');
      url.searchParams.set('destination', startLocation ? 'any' : 'last');
      url.searchParams.set('overview', 'false');
      const response = await fetch(url, { signal: AbortSignal.timeout(5_000) });
      if (!response.ok)
        return { status: 'unavailable', visitIds: stops.map((stop) => stop.visitId) };
      const result = (await response.json()) as {
        code?: string;
        waypoints?: Array<{ waypoint_index?: number; trips_index?: number }>;
      };
      const startOffset = startLocation ? 1 : 0;
      if (result.code !== 'Ok' || result.waypoints?.length !== stops.length + startOffset) {
        return { status: 'unavailable', visitIds: stops.map((stop) => stop.visitId) };
      }
      const order = result.waypoints
        .map((waypoint, inputIndex) => ({
          visitId: inputIndex < startOffset ? null : stops[inputIndex - startOffset]!.visitId,
          index: waypoint.waypoint_index,
        }))
        .filter(
          (waypoint): waypoint is { visitId: string; index: number | undefined } =>
            waypoint.visitId !== null,
        )
        .sort((left, right) => (left.index ?? 0) - (right.index ?? 0));
      return { status: 'available', visitIds: order.map((item) => item.visitId) };
    } catch {
      return { status: 'unavailable', visitIds: stops.map((stop) => stop.visitId) };
    }
  }
}

function coordinatePath(stops: RouteStopInput[], startLocation?: RouteLocation | null): string {
  const coordinates = [
    ...(startLocation ? [`${startLocation.longitude},${startLocation.latitude}`] : []),
    ...stops.map((stop) => `${stop.location!.longitude},${stop.location!.latitude}`),
  ];
  return coordinates.join(';');
}

type ReportTimingRecord = {
  type?: string | null;
  severity?: string | null;
  created_at?: string | null;
  accepted_at?: string | null;
  arrived_at?: string | null;
  resolved_at?: string | null;
  travel_distance_m?: number | string | null;
};

function elapsedSeconds(start?: string | null, end?: string | null): number | null {
  if (!start || !end) return null;
  const startMs = new Date(start).getTime();
  const endMs = new Date(end).getTime();
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs < startMs) return null;
  return (endMs - startMs) / 1000;
}

function mean(values: number[]): number | null {
  return values.length ? values.reduce((total, value) => total + value, 0) / values.length : null;
}

function median(values: number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

export function reportStageDurations(report: ReportTimingRecord) {
  return {
    responseSeconds: elapsedSeconds(report.created_at, report.accepted_at),
    arrivalSeconds: elapsedSeconds(report.accepted_at, report.arrived_at),
    resolutionSeconds: elapsedSeconds(report.arrived_at, report.resolved_at),
  };
}

export function summarizeReportTimings(reports: ReportTimingRecord[]) {
  const response: number[] = [];
  const arrival: number[] = [];
  const resolution: number[] = [];

  for (const report of reports) {
    const durations = reportStageDurations(report);
    if (durations.responseSeconds !== null) response.push(durations.responseSeconds);
    if (durations.arrivalSeconds !== null) arrival.push(durations.arrivalSeconds);
    if (durations.resolutionSeconds !== null) resolution.push(durations.resolutionSeconds);
  }

  const stage = (values: number[]) => {
    const average = mean(values);
    return {
      average_seconds: average === null ? null : Math.round(average * 10) / 10,
      sample_count: values.length,
    };
  };

  return {
    response: stage(response),
    arrival: stage(arrival),
    resolution: stage(resolution),
  };
}

function predictArrivalFromDistance(history: ReportTimingRecord[], targetDistanceM: number): {
  seconds: number | null;
  method: 'distance_regression' | 'nearby_distance_median' | 'historical_average';
  sampleCount: number;
} {
  const samples = history.flatMap((report) => {
    const distance = Number(report.travel_distance_m);
    const duration = reportStageDurations(report).arrivalSeconds;
    return Number.isFinite(distance) && distance > 0 && duration !== null && duration >= 0
      ? [{ distanceKm: distance / 1000, duration }]
      : [];
  });

  if (samples.length >= 5) {
    const meanDistance = mean(samples.map((sample) => sample.distanceKm))!;
    const meanDuration = mean(samples.map((sample) => sample.duration))!;
    const variance = samples.reduce((sum, sample) => sum + (sample.distanceKm - meanDistance) ** 2, 0);
    if (variance > 0.0001) {
      const covariance = samples.reduce(
        (sum, sample) => sum + (sample.distanceKm - meanDistance) * (sample.duration - meanDuration),
        0,
      );
      const secondsPerKm = Math.min(7200, Math.max(0, covariance / variance));
      const baselineSeconds = Math.max(0, meanDuration - secondsPerKm * meanDistance);
      const predicted = Math.min(8 * 60 * 60, Math.max(0, baselineSeconds + secondsPerKm * (targetDistanceM / 1000)));
      return { seconds: Math.round(predicted), method: 'distance_regression', sampleCount: samples.length };
    }
  }

  const nearbyDistanceBandM = Math.max(500, targetDistanceM * 0.35);
  const nearby = samples.filter((sample) => Math.abs(sample.distanceKm * 1000 - targetDistanceM) <= nearbyDistanceBandM);
  if (nearby.length >= 2) {
    return {
      seconds: Math.round(median(nearby.map((sample) => sample.duration))!),
      method: 'nearby_distance_median',
      sampleCount: nearby.length,
    };
  }

  const allArrivalDurations = history
    .map((report) => reportStageDurations(report).arrivalSeconds)
    .filter((value): value is number => value !== null);
  const historicalAverage = mean(allArrivalDurations);
  return {
    seconds: historicalAverage === null ? null : Math.round(historicalAverage),
    method: 'historical_average',
    sampleCount: allArrivalDurations.length,
  };
}

export function estimateReportTimings(report: ReportTimingRecord & { barangay_id?: string | null }, history: ReportTimingRecord[]) {
  const sameType = history.filter((sample) => sample.type === report.type);
  const sameSeverity = sameType.filter((sample) => sample.severity === report.severity);
  const relevant = sameSeverity.length >= 3 ? sameSeverity : sameType.length >= 3 ? sameType : history;
  const summary = summarizeReportTimings(relevant);
  const targetDistance = Number(report.travel_distance_m);
  const distanceEstimate = Number.isFinite(targetDistance) && targetDistance > 0
    ? predictArrivalFromDistance(relevant, targetDistance)
    : null;

  return {
    response_seconds: summary.response.average_seconds,
    arrival_seconds: distanceEstimate?.seconds ?? summary.arrival.average_seconds,
    resolution_seconds: summary.resolution.average_seconds,
    sample_counts: {
      response: summary.response.sample_count,
      arrival: distanceEstimate?.sampleCount ?? summary.arrival.sample_count,
      resolution: summary.resolution.sample_count,
    },
    arrival_method: distanceEstimate?.method ?? 'historical_average',
  };
}

export function isReportResolved(report: {
  status?: string | null;
  barangay_response_status?: string | null;
  mdrrmo_response_status?: string | null;
  resolved_at?: string | null;
}): boolean {
  return Boolean(report.resolved_at) ||
    [report.status, report.barangay_response_status, report.mdrrmo_response_status]
      .some((value) => value?.toLowerCase() === 'resolved');
}

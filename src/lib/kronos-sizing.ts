export type SizingCurve = "linear" | "log" | "power";

export interface KronosSizingConfig {
  kronosMinSignalPct: number;   // dead zone gate (e.g. 1.0)
  kronosMinTradePct: number;    // trade size at min signal (e.g. 20)
  kronosMaxTradePct: number;    // trade size at saturation (e.g. 80)
  kronosSaturationPct: number;  // signal level where max size kicks in (e.g. 5.0)
  kronosSizingCurve: SizingCurve;
}

/**
 * Compute trade size as a % of position (for SELL) or % of deployable cash (for BUY).
 *
 * Returns null if signal magnitude is below the min signal threshold (no trade).
 * Returns a value clamped between kronosMinTradePct and kronosMaxTradePct.
 *
 * Curve shapes:
 *   linear — t grows linearly from 0→1 as signal goes from minSignal→saturation
 *   log    — t grows fast early, then tapers (good if signals cluster near threshold)
 *   power  — t grows slowly then accelerates (conservative until high conviction)
 */
export function computeKronosTradePct(
  signalMagnitude: number,  // |predictedReturnPct|, always positive
  config: KronosSizingConfig
): number | null {
  const {
    kronosMinSignalPct,
    kronosMinTradePct,
    kronosMaxTradePct,
    kronosSaturationPct,
    kronosSizingCurve,
  } = config;

  if (signalMagnitude < kronosMinSignalPct) return null;  // below dead zone

  const range = kronosSaturationPct - kronosMinSignalPct;
  if (range <= 0) return kronosMaxTradePct; // degenerate config, go max

  const raw = (signalMagnitude - kronosMinSignalPct) / range;
  const tRaw = Math.min(1, Math.max(0, raw));

  let t: number;
  switch (kronosSizingCurve) {
    case "log":
      // log(1 + 9t) / log(10) → maps 0→0, 1→1 with fast early growth
      t = Math.log1p(9 * tRaw) / Math.log(10);
      break;
    case "power":
      // t^2 → slow start, fast finish
      t = tRaw * tRaw;
      break;
    case "linear":
    default:
      t = tRaw;
  }

  return Math.round(kronosMinTradePct + t * (kronosMaxTradePct - kronosMinTradePct));
}

/**
 * Generate N sample points for the curve preview chart.
 * Returns array of { signal: number, tradePct: number } from minSignal to saturation+2%.
 */
export function generateCurvePoints(
  config: KronosSizingConfig,
  nPoints = 50
): Array<{ signal: number; tradePct: number }> {
  const maxSignal = config.kronosSaturationPct + 2;
  const points: Array<{ signal: number; tradePct: number }> = [];

  for (let i = 0; i <= nPoints; i++) {
    const signal = (i / nPoints) * maxSignal;
    const tradePct = computeKronosTradePct(signal, config);
    points.push({ signal: parseFloat(signal.toFixed(2)), tradePct: tradePct ?? 0 });
  }

  return points;
}

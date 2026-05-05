import { useEffect, useState } from "react";
import type { DeliberationPole } from "./types";

/**
 * Boardroom — circular arrangement of 15 pole nodes around a central table.
 * When `running` is true, poles cycle through an "activating" pulse so the
 * recruiter sees motion while the deliberation is in flight. When a result is
 * supplied each pole shows its verdict colour + signal strength.
 *
 * The visualisation gracefully renders fewer than 15 poles (Council always
 * returns 15, but partial responses from older builds shouldn't crash the UI).
 */
export interface BoardroomProps {
  running?: boolean;
  poles?: DeliberationPole[];
  /** Defaults to 15 placeholder poles when no real data has arrived. */
  poleCount?: number;
}

const DEFAULT_POLE_COUNT = 15;

function verdictColor(verdict: string): string {
  const v = verdict.toLowerCase();
  if (v.includes("strong yes") || v === "yes" || v.includes("hire")) return "#10b981"; // green
  if (v.includes("lean yes") || v.includes("maybe yes")) return "#34d399";
  if (v.includes("no") || v.includes("reject")) return "#ef4444"; // red
  if (v.includes("lean no")) return "#f97316";
  if (v.includes("abstain") || v.includes("unsure")) return "#94a3b8";
  return "#6366f1"; // indigo default
}

export function Boardroom({ running = false, poles = [], poleCount = DEFAULT_POLE_COUNT }: BoardroomProps) {
  const count = Math.max(poleCount, poles.length, DEFAULT_POLE_COUNT);
  const [pulseIdx, setPulseIdx] = useState(0);

  useEffect(() => {
    if (!running) return;
    const id = setInterval(() => setPulseIdx((i) => (i + 1) % count), 200);
    return () => clearInterval(id);
  }, [running, count]);

  // Geometry
  const size = 360;
  const cx = size / 2;
  const cy = size / 2;
  const tableR = 80;
  const ringR = 150;

  return (
    <div className="flex justify-center">
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label="Council boardroom visualisation">
        {/* Table */}
        <circle cx={cx} cy={cy} r={tableR} fill="hsl(var(--muted))" stroke="hsl(var(--border))" strokeWidth={1} />
        <text x={cx} y={cy - 4} textAnchor="middle" className="text-xs" fill="hsl(var(--muted-foreground))">
          Council
        </text>
        <text x={cx} y={cy + 12} textAnchor="middle" className="text-[10px]" fill="hsl(var(--muted-foreground))">
          {poles.length > 0 ? `${poles.length} poles` : running ? "Deliberating…" : "Idle"}
        </text>

        {Array.from({ length: count }).map((_, i) => {
          const angle = (i / count) * 2 * Math.PI - Math.PI / 2;
          const x = cx + ringR * Math.cos(angle);
          const y = cy + ringR * Math.sin(angle);
          const pole = poles[i];
          const fill = pole ? verdictColor(pole.verdict) : "hsl(var(--muted))";
          const stroke = pole ? verdictColor(pole.verdict) : "hsl(var(--border))";
          const radius = pole ? 8 + Math.min(6, Math.max(0, (pole.signal ?? 0) * 6)) : 8;
          const isPulsing = running && i === pulseIdx;

          return (
            <g key={i}>
              {isPulsing && (
                <circle cx={x} cy={y} r={radius + 6} fill={fill} opacity={0.25}>
                  <animate attributeName="r" from={radius} to={radius + 12} dur="0.6s" repeatCount="indefinite" />
                  <animate attributeName="opacity" from="0.4" to="0" dur="0.6s" repeatCount="indefinite" />
                </circle>
              )}
              <circle
                cx={x}
                cy={y}
                r={radius}
                fill={pole ? fill : "transparent"}
                fillOpacity={pole ? 0.85 : 1}
                stroke={stroke}
                strokeWidth={1.5}
              >
                {pole && <title>{`${pole.name}: ${pole.verdict}\n${pole.reasoning}`}</title>}
              </circle>
              {pole && (
                <text
                  x={x}
                  y={y + radius + 12}
                  textAnchor="middle"
                  fontSize="9"
                  fill="hsl(var(--muted-foreground))"
                  className="pointer-events-none"
                >
                  {pole.name.length > 14 ? pole.name.slice(0, 13) + "…" : pole.name}
                </text>
              )}
            </g>
          );
        })}
      </svg>
    </div>
  );
}

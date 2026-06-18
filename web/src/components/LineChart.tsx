// Kevyt SVG-viivakuvaaja (ei ulkoista kirjastoa, mobiilioptimointi: pieni bundle).
// viewBox-pohjainen, skaalautuu kontainerin leveyteen.

export interface ChartPoint {
  t: number; // millisekuntia (epoch)
  v: number | null;
}

interface Props {
  points: ChartPoint[];
  color?: string;
  height?: number;
  /** Lyhyt arvomuotoilu y-akselille (esim. 12 → "12", 30 → "30 %"). */
  formatAxis: (v: number) => string;
  /** Aikaleima → akselin teksti (esim. tunti tai viikonpäivä). */
  formatTimeLabel: (t: number) => string;
}

const W = 320;
const PAD_L = 40;
const PAD_R = 10;
const PAD_T = 12;
const PAD_B = 22;

export function LineChart({
  points,
  color = "var(--green)",
  height = 180,
  formatAxis,
  formatTimeLabel,
}: Props) {
  const H = height;
  const valid = points.filter((p): p is { t: number; v: number } => p.v != null);
  if (valid.length < 2) {
    return <div className="center-msg">Ei riittävästi dataa kuvaajaan.</div>;
  }

  const ts = valid.map((p) => p.t);
  const vs = valid.map((p) => p.v);
  const tMin = Math.min(...ts);
  const tMax = Math.max(...ts);
  let vMin = Math.min(...vs);
  let vMax = Math.max(...vs);
  if (vMin === vMax) {
    vMin -= 1;
    vMax += 1;
  }
  const pad = (vMax - vMin) * 0.12;
  vMin = Math.max(0, vMin - pad);
  vMax = vMax + pad;

  const x = (t: number) =>
    PAD_L + ((t - tMin) / (tMax - tMin || 1)) * (W - PAD_L - PAD_R);
  const y = (v: number) =>
    PAD_T + (1 - (v - vMin) / (vMax - vMin || 1)) * (H - PAD_T - PAD_B);

  const line = valid
    .map((p, i) => `${i ? "L" : "M"}${x(p.t).toFixed(1)} ${y(p.v).toFixed(1)}`)
    .join(" ");
  const baseY = (H - PAD_B).toFixed(1);
  const area = `${line} L${x(tMax).toFixed(1)} ${baseY} L${x(tMin).toFixed(1)} ${baseY} Z`;

  // y-akselin viivat: 4 tasaväliä
  const yTicks = Array.from({ length: 5 }, (_, i) => vMin + ((vMax - vMin) * i) / 4);
  // x-akselin tekstit: 4 tasaväliä aikajanalla
  const xTicks = Array.from({ length: 5 }, (_, i) => tMin + ((tMax - tMin) * i) / 4);

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      width="100%"
      height="auto"
      role="img"
      style={{ display: "block" }}
    >
      {yTicks.map((tv, i) => (
        <g key={i}>
          <line
            x1={PAD_L}
            x2={W - PAD_R}
            y1={y(tv)}
            y2={y(tv)}
            stroke="var(--border)"
            strokeWidth={0.5}
          />
          <text
            x={PAD_L - 5}
            y={y(tv) + 3}
            textAnchor="end"
            fontSize={9}
            fill="var(--text-dim)"
          >
            {formatAxis(tv)}
          </text>
        </g>
      ))}

      <path d={area} fill={color} fillOpacity={0.14} />
      <path
        d={line}
        fill="none"
        stroke={color}
        strokeWidth={1.6}
        strokeLinejoin="round"
        strokeLinecap="round"
        vectorEffect="non-scaling-stroke"
      />

      {xTicks.map((tt, i) => (
        <text
          key={i}
          x={x(tt)}
          y={H - 6}
          textAnchor={i === 0 ? "start" : i === 4 ? "end" : "middle"}
          fontSize={9}
          fill="var(--text-dim)"
        >
          {formatTimeLabel(tt)}
        </text>
      ))}
    </svg>
  );
}

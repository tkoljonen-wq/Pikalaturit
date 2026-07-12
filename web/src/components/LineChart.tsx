// Kevyt SVG-viivakuvaaja (ei ulkoista kirjastoa, mobiilioptimointi: pieni bundle).
// viewBox-pohjainen, skaalautuu kontainerin leveyteen.
// Interaktio: hiiren osoitus tai sormella veto näyttää lähimmän pisteen
// arvon ja aikaleiman tooltipissa.

import { useRef, useState } from "react";

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
  /** Tooltipin arvomuotoilu (oletus: formatAxis). */
  formatValue?: (v: number) => string;
  /** Tooltipin aikaleima, pvm + kellonaika (oletus: formatTimeLabel). */
  formatTooltipTime?: (t: number) => string;
  /** Pakota y-akselin tikit kokonaisluvuiksi (lukumäärämittarit). */
  integerAxis?: boolean;
  /**
   * Porrasviiva: arvo pysyy edellisen mittauksen korkeudella seuraavaan
   * mittaukseen asti. Lukumäärämittareille — suora viiva piirtäisi vinoja
   * välikorkeuksia, joita ei koskaan mitattu.
   */
  step?: boolean;
}

/**
 * Siistit y-akselin tikit: askel 1/2/5 × 10^k niin, että väli [min, max]
 * peittyy ~4 askeleella. Tikit ovat tarkkoja arvoja, joten viiva osuu
 * täsmälleen akselin lukemiin (ei pyöristettyjä välejä).
 */
function niceTicks(min: number, max: number, integer: boolean): number[] {
  if (min === max) {
    min = Math.max(0, min - 1);
    max = max + 1;
  }
  const raw = (max - min) / 4;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const norm = raw / mag;
  // kynnykset 1.5/3/7: antaa 4–7 tikkiä eikä harvenna akselia turhaan
  let step = (norm <= 1.5 ? 1 : norm <= 3 ? 2 : norm <= 7 ? 5 : 10) * mag;
  if (integer && step < 1) step = 1;
  const start = Math.floor(min / step) * step;
  const end = Math.ceil(max / step) * step;
  const n = Math.round((end - start) / step);
  return Array.from({ length: n + 1 }, (_, i) => start + i * step);
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
  formatValue,
  formatTooltipTime,
  integerAxis = false,
  step = false,
}: Props) {
  const H = height;
  const svgRef = useRef<SVGSVGElement>(null);
  const [activeIdx, setActiveIdx] = useState<number | null>(null);

  const valid = points.filter((p): p is { t: number; v: number } => p.v != null);
  if (valid.length < 2) {
    return <div className="center-msg">Ei riittävästi dataa kuvaajaan.</div>;
  }

  const ts = valid.map((p) => p.t);
  const vs = valid.map((p) => p.v);
  const tMin = Math.min(...ts);
  const tMax = Math.max(...ts);
  // Akselin ala- ja yläraja tulevat suoraan siisteistä tikeistä, jotta
  // arvot piirtyvät täsmälleen akselin lukemien kohdalle.
  const yTicks = niceTicks(Math.min(...vs), Math.max(...vs), integerAxis);
  const vMin = yTicks[0]!;
  const vMax = yTicks[yTicks.length - 1]!;

  const x = (t: number) =>
    PAD_L + ((t - tMin) / (tMax - tMin || 1)) * (W - PAD_L - PAD_R);
  const y = (v: number) =>
    PAD_T + (1 - (v - vMin) / (vMax - vMin || 1)) * (H - PAD_T - PAD_B);

  const line = valid
    .map((p, i) => {
      const px = x(p.t).toFixed(1);
      const py = y(p.v).toFixed(1);
      if (i === 0) return `M${px} ${py}`;
      // Porras: vaakasuora edellisen arvon tasolla + pystyhyppy uuteen arvoon.
      if (step) {
        const prevY = y(valid[i - 1]!.v).toFixed(1);
        return prevY === py ? `L${px} ${py}` : `L${px} ${prevY} L${px} ${py}`;
      }
      return `L${px} ${py}`;
    })
    .join(" ");
  const baseY = (H - PAD_B).toFixed(1);
  const area = `${line} L${x(tMax).toFixed(1)} ${baseY} L${x(tMin).toFixed(1)} ${baseY} Z`;

  // x-akselin tekstit: 4 tasaväliä aikajanalla
  const xTicks = Array.from({ length: 5 }, (_, i) => tMin + ((tMax - tMin) * i) / 4);

  // Osoittimen sijainti → lähin datapiste (viewBox-koordinaateissa).
  function handlePointer(e: React.PointerEvent<SVGSVGElement>) {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0) return;
    const xv = ((e.clientX - rect.left) / rect.width) * W;
    let best = 0;
    let bestD = Infinity;
    for (let i = 0; i < valid.length; i++) {
      const d = Math.abs(x(valid[i]!.t) - xv);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    setActiveIdx(best);
  }

  const active = activeIdx != null ? valid[activeIdx] ?? null : null;
  const fmtVal = formatValue ?? formatAxis;
  const fmtTime = formatTooltipTime ?? formatTimeLabel;

  // Tooltipin mitat (SVG-teksti ei rivity → arvioidaan leveys merkkimäärästä).
  let tip: { x: number; y: number; w: number; timeStr: string; valStr: string } | null =
    null;
  if (active) {
    const timeStr = fmtTime(active.t);
    const valStr = fmtVal(active.v);
    const w = Math.max(timeStr.length, valStr.length) * 5.2 + 12;
    const px = x(active.t);
    const boxX = px + 8 + w > W - PAD_R ? px - 8 - w : px + 8;
    tip = { x: boxX, y: PAD_T, w, timeStr, valStr };
  }

  return (
    <svg
      ref={svgRef}
      viewBox={`0 0 ${W} ${H}`}
      width="100%"
      height="auto"
      role="img"
      // pan-y: pystysuuntainen sivun vieritys toimii sormella, vaakaveto ohjaa kohdistinta
      style={{ display: "block", touchAction: "pan-y" }}
      onPointerMove={handlePointer}
      onPointerDown={handlePointer}
      onPointerLeave={(e) => {
        // Kosketuksella tooltip jää näkyviin napautuksen jälkeen
        if (e.pointerType !== "touch") setActiveIdx(null);
      }}
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

      {active && tip && (
        <g pointerEvents="none">
          <line
            x1={x(active.t)}
            x2={x(active.t)}
            y1={PAD_T}
            y2={H - PAD_B}
            stroke="var(--text-dim)"
            strokeWidth={0.6}
            strokeDasharray="3 3"
          />
          <circle
            cx={x(active.t)}
            cy={y(active.v)}
            r={3.2}
            fill={color}
            stroke="var(--bg-card)"
            strokeWidth={1.4}
          />
          <rect
            x={tip.x}
            y={tip.y}
            width={tip.w}
            height={32}
            rx={4}
            fill="var(--bg-card)"
            stroke="var(--border)"
            strokeWidth={0.6}
          />
          <text x={tip.x + 6} y={tip.y + 12} fontSize={9} fill="var(--text-dim)">
            {tip.timeStr}
          </text>
          <text
            x={tip.x + 6}
            y={tip.y + 25}
            fontSize={10}
            fontWeight={600}
            fill="var(--text)"
          >
            {tip.valStr}
          </text>
        </g>
      )}
    </svg>
  );
}

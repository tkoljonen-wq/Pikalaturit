// Kevyt SVG-pylväskuvaaja (ei ulkoista kirjastoa, sama tyyli kuin LineChart).
// Käytetään kuukausitrendiin: harvoja, tasavälisiä arvoja aikajärjestyksessä.
//
// Miksi pylväät eikä viiva: kuukausiarvo on yhden jakson kooste, ei jatkuvasti
// mitattu sarja. Viiva vihjaisi arvon liukuvan kuukausien välillä. Pylväs
// alkaa aina nollasta, jotta korkeuksien suhde vastaa lukujen suhdetta.

import { useRef, useState } from "react";
import { niceTicks } from "../lib/ticks";

export interface Bar {
  key: string;
  /** Lyhyt teksti x-akselille (esim. "elo"). */
  label: string;
  value: number | null;
  /** Vaaleampi pylväs: jakso on vielä kesken (kuluva kuukausi). */
  faded?: boolean;
  /** Tooltipin rivit: [otsikko, pääarvo, ...lisärivit]. */
  tip: string[];
}

interface Props {
  bars: Bar[];
  color?: string;
  height?: number;
  /** Arvo → y-akselin teksti. */
  formatAxis: (v: number) => string;
  /** Pakota akselin tikit kokonaisluvuiksi (lukumäärämittarit). */
  integerAxis?: boolean;
  /** Ruudunlukijalle: mitä kuvaaja esittää. */
  ariaLabel?: string;
}

const W = 320;
const PAD_L = 40;
const PAD_R = 10;
const PAD_T = 12;
const PAD_B = 22;
const MAX_BAR_W = 34;

export function BarChart({
  bars,
  color = "var(--green)",
  height = 190,
  formatAxis,
  integerAxis = false,
  ariaLabel,
}: Props) {
  const H = height;
  const svgRef = useRef<SVGSVGElement>(null);
  const [activeIdx, setActiveIdx] = useState<number | null>(null);

  const values = bars
    .map((b) => b.value)
    .filter((v): v is number => v != null);
  if (values.length === 0) {
    return <div className="center-msg">Ei riittävästi dataa kuvaajaan.</div>;
  }

  // Pylväät alkavat nollasta — muuten korkeuksien suhde valehtelee.
  const yTicks = niceTicks(0, Math.max(...values), integerAxis);
  const vMax = yTicks[yTicks.length - 1]!;

  const plotW = W - PAD_L - PAD_R;
  const band = plotW / bars.length;
  const barW = Math.min(band * 0.68, MAX_BAR_W);
  const bandX = (i: number) => PAD_L + band * i + band / 2;
  const y = (v: number) => PAD_T + (1 - v / (vMax || 1)) * (H - PAD_T - PAD_B);
  const baseY = H - PAD_B;

  // Akselitekstit harvennetaan mahtumaan: ankkurina viimeisin (tuorein)
  // pylväs, jotta se on aina nimetty. Tilantarve arvioidaan pisimmästä
  // tekstistä (esim. "tammi 27" vie yli kaksi kertaa "elo":n tilan).
  const labelW = Math.max(...bars.map((b) => b.label.length)) * 5 + 8;
  const labelStep = Math.max(1, Math.ceil(bars.length / Math.max(1, Math.floor(plotW / labelW))));
  const showLabel = (i: number) => (bars.length - 1 - i) % labelStep === 0;
  // Reunimmaiset tekstit kohdistetaan sisäänpäin, ettei teksti leikkaudu.
  const labelAnchor = (px: number) =>
    px + labelW / 2 > W ? "end" : px - labelW / 2 < 0 ? "start" : "middle";

  function handlePointer(e: React.PointerEvent<SVGSVGElement>) {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0) return;
    const xv = ((e.clientX - rect.left) / rect.width) * W;
    const i = Math.floor((xv - PAD_L) / band);
    setActiveIdx(i >= 0 && i < bars.length ? i : null);
  }

  const active = activeIdx != null ? bars[activeIdx] ?? null : null;

  // Tooltipin mitat: SVG-teksti ei rivity → leveys arvioidaan merkkimäärästä.
  let tip: { x: number; y: number; w: number; h: number; lines: string[] } | null = null;
  if (active && active.value != null) {
    const lines = active.tip;
    const w = Math.max(...lines.map((s) => s.length)) * 5.2 + 12;
    const h = 20 + lines.length * 11;
    const px = bandX(activeIdx!);
    const boxX = px + 8 + w > W - PAD_R ? Math.max(PAD_L, px - 8 - w) : px + 8;
    tip = { x: boxX, y: PAD_T, w, h, lines };
  }

  return (
    <svg
      ref={svgRef}
      viewBox={`0 0 ${W} ${H}`}
      width="100%"
      role="img"
      aria-label={ariaLabel}
      // Korkeus CSS:stä (ei height="auto"-attribuuttia, joka ei ole kelvollinen
      // SVG-pituus): leveys 100 % + viewBox pitää kuvasuhteen.
      // pan-y: pystyvieritys sormella säilyy, vaakaveto selaa pylväitä
      style={{ display: "block", height: "auto", touchAction: "pan-y" }}
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

      {bars.map((b, i) => {
        if (b.value == null) return null;
        const top = y(b.value);
        return (
          <rect
            key={b.key}
            x={bandX(i) - barW / 2}
            y={top}
            width={barW}
            height={Math.max(1, baseY - top)}
            rx={2}
            fill={color}
            fillOpacity={b.faded ? 0.35 : activeIdx === i ? 1 : 0.82}
            stroke={b.faded ? color : "none"}
            strokeWidth={b.faded ? 0.8 : 0}
            strokeDasharray={b.faded ? "2 2" : undefined}
          />
        );
      })}

      {bars.map((b, i) =>
        showLabel(i) ? (
          <text
            key={b.key}
            x={bandX(i)}
            y={H - 6}
            textAnchor={labelAnchor(bandX(i))}
            fontSize={9}
            fill={activeIdx === i ? "var(--text)" : "var(--text-dim)"}
          >
            {b.label}
          </text>
        ) : null
      )}

      {tip && (
        <g pointerEvents="none">
          <rect
            x={tip.x}
            y={tip.y}
            width={tip.w}
            height={tip.h}
            rx={4}
            fill="var(--bg-card)"
            stroke="var(--border)"
            strokeWidth={0.6}
          />
          {tip.lines.map((line, i) => (
            <text
              key={i}
              x={tip!.x + 6}
              y={tip!.y + 14 + i * 11}
              fontSize={i === 1 ? 10 : 9}
              fontWeight={i === 1 ? 600 : 400}
              fill={i === 1 ? "var(--text)" : "var(--text-dim)"}
            >
              {line}
            </text>
          ))}
        </g>
      )}
    </svg>
  );
}

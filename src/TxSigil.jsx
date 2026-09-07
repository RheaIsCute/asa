import { useMemo } from 'react';

const SIZE = 116;
const CENTER = SIZE / 2;

/** Reads `count` hex characters starting at `at`, wrapping around the string. */
const nibbles = (hex, at, count) => {
  let value = 0;
  for (let i = 0; i < count; i += 1) {
    value = value * 16 + parseInt(hex[(at + i) % hex.length] || '0', 16);
  }
  return value;
};

const polar = (radius, degrees) => [
  CENTER + radius * Math.cos((degrees - 90) * (Math.PI / 180)),
  CENTER + radius * Math.sin((degrees - 90) * (Math.PI / 180)),
];

const arc = (radius, from, sweep) => {
  const [x1, y1] = polar(radius, from);
  const [x2, y2] = polar(radius, from + sweep);
  return `M${x1.toFixed(2)},${y1.toFixed(2)} A${radius},${radius} 0 ${sweep > 180 ? 1 : 0} 1 ${x2.toFixed(2)},${y2.toFixed(2)}`;
};

/**
 * A deterministic visual fingerprint of a txid — same hash always draws the
 * same sigil, and any two transactions look obviously different at a glance.
 */
export default function TxSigil({ txid = '', tone = '#c98aff' }) {
  const shape = useMemo(() => {
    const hex = (txid || '0').toLowerCase().replace(/[^0-9a-f]/g, '') || '0';

    const rings = [0, 1, 2].map((index) => {
      const radius = 52 - index * 13;
      const segments = 3 + (nibbles(hex, index * 5, 1) % 4);
      return {
        radius,
        paths: Array.from({ length: segments }, (_, s) => {
          const from = (nibbles(hex, index * 7 + s * 3, 2) / 255) * 360;
          const sweep = 24 + (nibbles(hex, index * 11 + s * 2, 1) / 15) * 96;
          return arc(radius, from, sweep);
        }),
      };
    });

    const ticks = Array.from({ length: 24 }, (_, i) => {
      const on = nibbles(hex, i, 1) % 3 !== 0;
      const [x1, y1] = polar(on ? 56 : 58, i * 15);
      const [x2, y2] = polar(on ? 46 : 54, i * 15);
      return { x1, y1, x2, y2, on };
    });

    const sides = 3 + (nibbles(hex, 3, 1) % 5);
    const spin = (nibbles(hex, 9, 2) / 255) * 360;
    const core = Array.from({ length: sides }, (_, i) =>
      polar(9 + (nibbles(hex, 13 + i, 1) / 15) * 11, spin + (i * 360) / sides).map((n) => n.toFixed(1)).join(','),
    ).join(' ');

    return { rings, ticks, core };
  }, [txid]);

  return (
    <div className="tx-sigil" aria-hidden="true">
      <svg width={SIZE} height={SIZE} viewBox={`0 0 ${SIZE} ${SIZE}`}>
        <defs>
          <radialGradient id="tx-sigil-core">
            <stop offset="0%" stopColor="#fff" stopOpacity=".9" />
            <stop offset="100%" stopColor={tone} stopOpacity=".25" />
          </radialGradient>
        </defs>

        <circle cx={CENTER} cy={CENTER} r="54" fill="none" stroke={tone} strokeOpacity=".1" />

        {shape.ticks.map((tick, i) => (
          <line
            key={i}
            x1={tick.x1}
            y1={tick.y1}
            x2={tick.x2}
            y2={tick.y2}
            stroke={tone}
            strokeOpacity={tick.on ? 0.45 : 0.15}
            strokeWidth={tick.on ? 1.4 : 1}
          />
        ))}

        {shape.rings.map((ring, index) => (
          <g key={ring.radius} className={['ring-a', 'ring-b', 'ring-c'][index]}>
            {ring.paths.map((d, i) => (
              <path
                key={i}
                d={d}
                fill="none"
                stroke={index === 1 ? '#bdff66' : tone}
                strokeOpacity={0.75 - index * 0.16}
                strokeWidth={2.2 - index * 0.4}
                strokeLinecap="round"
              />
            ))}
          </g>
        ))}

        <polygon points={shape.core} fill="url(#tx-sigil-core)" stroke={tone} strokeWidth="1" strokeOpacity=".6">
          <animateTransform
            attributeName="transform"
            type="rotate"
            from={`0 ${CENTER} ${CENTER}`}
            to={`360 ${CENTER} ${CENTER}`}
            dur="22s"
            repeatCount="indefinite"
          />
        </polygon>
      </svg>
    </div>
  );
}

'use client';

const R  = 20;
const C  = 2 * Math.PI * R;
const TOTAL = 30;

interface Props { seconds: number }

export function TimerRing({ seconds }: Props) {
  const progress = Math.max(0, seconds) / TOTAL;
  const offset   = C * (1 - progress);

  const color = seconds > 10 ? '#4ade80'
    : seconds > 3  ? '#f59e0b'
    : '#ef4444';

  return (
    <div className="relative flex h-14 w-14 items-center justify-center">
      <svg className="absolute inset-0 -rotate-90" viewBox="0 0 48 48">
        {/* Track */}
        <circle cx="24" cy="24" r={R} fill="none" stroke="#2a5a3a" strokeWidth="4" />
        {/* Progress */}
        <circle
          cx="24" cy="24" r={R}
          fill="none"
          stroke={color}
          strokeWidth="4"
          strokeLinecap="round"
          strokeDasharray={C}
          strokeDashoffset={offset}
          className="transition-all duration-1000 ease-linear"
        />
      </svg>
      <span
        className={`relative z-10 text-sm font-bold tabular-nums ${seconds <= 3 ? 'animate-pulse' : ''}`}
        style={{ color }}
      >
        {seconds}
      </span>
    </div>
  );
}

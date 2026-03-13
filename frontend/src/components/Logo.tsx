import { useId } from "react";

interface LogoProps {
  size?: number;
}

export function Logo({ size = 48 }: LogoProps) {
  const id = useId();
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 260 260"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <defs>
        <linearGradient id={`${id}-ring`} x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#FF6B35" />
          <stop offset="100%" stopColor="#E83F6F" />
        </linearGradient>
        <linearGradient id={`${id}-outer`} x1="100%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stopColor="#00D4AA" />
          <stop offset="100%" stopColor="#00B4D8" />
        </linearGradient>
        <linearGradient id={`${id}-swoosh`} x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stopColor="#00D4AA" stopOpacity="0" />
          <stop offset="30%" stopColor="#00D4AA" stopOpacity="0.9" />
          <stop offset="70%" stopColor="#00B4D8" stopOpacity="0.9" />
          <stop offset="100%" stopColor="#00B4D8" stopOpacity="0" />
        </linearGradient>
        <linearGradient id={`${id}-diamond`} x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#FF6B35" stopOpacity="0.4" />
          <stop offset="50%" stopColor="#E83F6F" stopOpacity="0.25" />
          <stop offset="100%" stopColor="#00D4AA" stopOpacity="0.3" />
        </linearGradient>
        <linearGradient id={`${id}-inner`} x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#141425" />
          <stop offset="100%" stopColor="#0A0A18" />
        </linearGradient>
        <filter id={`${id}-glow`}>
          <feGaussianBlur stdDeviation="3" result="blur" />
          <feComposite in="SourceGraphic" in2="blur" operator="over" />
        </filter>
        <filter id={`${id}-softglow`}>
          <feGaussianBlur stdDeviation="6" />
        </filter>
        <clipPath id={`${id}-clip`}>
          <circle cx="130" cy="130" r="100" />
        </clipPath>
      </defs>

      {/* Outer ring (teal) */}
      <circle cx="130" cy="130" r="120" fill="none" stroke={`url(#${id}-outer)`} strokeWidth="2" opacity="0.5" />

      {/* Outer ring glow */}
      <circle cx="130" cy="130" r="120" fill="none" stroke="#00D4AA" strokeWidth="6" opacity="0.08" filter={`url(#${id}-softglow)`} />

      {/* Diamond connecting outer and inner rings */}
      <polygon points="130,10 250,130 130,250 10,130" fill="none" stroke={`url(#${id}-diamond)`} strokeWidth="1.2" />

      {/* Diamond vertex glows */}
      <circle cx="130" cy="10" r="3" fill="#FF6B35" opacity="0.7" filter={`url(#${id}-glow)`} />
      <circle cx="250" cy="130" r="3" fill="#00D4AA" opacity="0.6" filter={`url(#${id}-glow)`} />
      <circle cx="130" cy="250" r="3" fill="#E83F6F" opacity="0.7" filter={`url(#${id}-glow)`} />
      <circle cx="10" cy="130" r="3" fill="#00B4D8" opacity="0.6" filter={`url(#${id}-glow)`} />

      {/* Tick marks on outer ring */}
      <line x1="130" y1="10" x2="130" y2="18" stroke="#FF6B35" strokeWidth="1.5" opacity="0.5" />
      <line x1="250" y1="130" x2="242" y2="130" stroke="#00D4AA" strokeWidth="1.5" opacity="0.5" />
      <line x1="130" y1="250" x2="130" y2="242" stroke="#E83F6F" strokeWidth="1.5" opacity="0.5" />
      <line x1="10" y1="130" x2="18" y2="130" stroke="#00B4D8" strokeWidth="1.5" opacity="0.5" />

      {/* Minor tick marks */}
      <line x1="192" y1="27" x2="188" y2="33" stroke="#FF6B35" strokeWidth="0.6" opacity="0.25" />
      <line x1="68" y1="27" x2="72" y2="33" stroke="#00D4AA" strokeWidth="0.6" opacity="0.25" />
      <line x1="192" y1="233" x2="188" y2="227" stroke="#E83F6F" strokeWidth="0.6" opacity="0.25" />
      <line x1="68" y1="233" x2="72" y2="227" stroke="#00B4D8" strokeWidth="0.6" opacity="0.25" />

      {/* Inner ring glow */}
      <circle cx="130" cy="130" r="100" fill="none" stroke="#FF6B35" strokeWidth="8" opacity="0.12" filter={`url(#${id}-softglow)`} />

      {/* Main ring */}
      <circle cx="130" cy="130" r="100" fill="none" stroke={`url(#${id}-ring)`} strokeWidth="4.5" />

      {/* Inner fill */}
      <circle cx="130" cy="130" r="97" fill={`url(#${id}-inner)`} />

      {/* Star field + swoosh */}
      <g clipPath={`url(#${id}-clip)`}>
        <circle cx="75" cy="65" r="1" fill="white" opacity="0.4" />
        <circle cx="190" cy="80" r="1.2" fill="white" opacity="0.5" />
        <circle cx="160" cy="55" r="0.8" fill="white" opacity="0.3" />
        <circle cx="95" cy="195" r="1" fill="white" opacity="0.35" />
        <circle cx="55" cy="140" r="0.8" fill="white" opacity="0.25" />
        <circle cx="205" cy="160" r="0.8" fill="white" opacity="0.3" />
        <circle cx="80" cy="110" r="0.6" fill="white" opacity="0.2" />
        <circle cx="180" cy="190" r="0.7" fill="white" opacity="0.25" />

        {/* Swoosh */}
        <path
          d="M 35 150 Q 80 105 130 100 Q 180 95 225 115"
          stroke={`url(#${id}-swoosh)`}
          strokeWidth="3"
          fill="none"
          strokeLinecap="round"
          filter={`url(#${id}-glow)`}
        />
        <path
          d="M 40 165 Q 90 130 140 128 Q 190 126 220 135"
          stroke="#00D4AA"
          strokeWidth="0.8"
          fill="none"
          strokeLinecap="round"
          opacity="0.25"
        />
      </g>

      {/* AC Monogram */}
      <text
        x="130"
        y="132"
        textAnchor="middle"
        dominantBaseline="central"
        fill="white"
        fontSize="50"
        fontFamily="Inter, -apple-system, BlinkMacSystemFont, sans-serif"
        fontWeight="700"
        letterSpacing="4"
      >
        AC
      </text>

      {/* ASHWIN label */}
      <text
        x="130"
        y="205"
        textAnchor="middle"
        fill="#FF6B35"
        fontSize="9"
        fontFamily="Inter, -apple-system, BlinkMacSystemFont, sans-serif"
        fontWeight="600"
        letterSpacing="6"
        opacity="0.6"
      >
        ASHWIN
      </text>

      {/* Inner cardinal pips */}
      <circle cx="130" cy="30" r="2.5" fill="#FF6B35" opacity="0.8" filter={`url(#${id}-glow)`} />
      <circle cx="130" cy="230" r="2.5" fill="#E83F6F" opacity="0.8" filter={`url(#${id}-glow)`} />
      <circle cx="30" cy="130" r="2" fill="#00D4AA" opacity="0.6" filter={`url(#${id}-glow)`} />
      <circle cx="230" cy="130" r="2" fill="#00B4D8" opacity="0.6" filter={`url(#${id}-glow)`} />
    </svg>
  );
}

interface LogoProps {
  size?: number;
}

export function Logo({ size = 48 }: LogoProps) {
  const id = `logo-${size}`;
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 200 200"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <defs>
        <linearGradient id={`${id}-orbital`} x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#D4745E" />
          <stop offset="100%" stopColor="#C17B6F" />
        </linearGradient>
        <linearGradient id={`${id}-ring`} x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#D4745E" stopOpacity="0.6" />
          <stop offset="100%" stopColor="#D4745E" stopOpacity="0.2" />
        </linearGradient>
      </defs>

      {/* Outer orbital ring */}
      <ellipse
        cx="100"
        cy="100"
        rx="90"
        ry="35"
        transform="rotate(-30 100 100)"
        stroke={`url(#${id}-orbital)`}
        strokeWidth="2.5"
        fill="none"
        opacity="0.7"
      />

      {/* Second orbital ring */}
      <ellipse
        cx="100"
        cy="100"
        rx="85"
        ry="30"
        transform="rotate(25 100 100)"
        stroke={`url(#${id}-ring)`}
        strokeWidth="2"
        fill="none"
        opacity="0.5"
      />

      {/* Core circle */}
      <circle cx="100" cy="100" r="52" fill="#2C2C2C" />

      {/* Inner glow ring */}
      <circle
        cx="100"
        cy="100"
        r="52"
        fill="none"
        stroke="#D4745E"
        strokeWidth="1.5"
        opacity="0.3"
      />

      {/* AC Monogram */}
      <text
        x="100"
        y="108"
        textAnchor="middle"
        dominantBaseline="middle"
        fill="#F9F7F4"
        fontSize="36"
        fontFamily="Inter, -apple-system, BlinkMacSystemFont, sans-serif"
        fontWeight="600"
        letterSpacing="3"
      >
        AC
      </text>

      {/* Sage green inner orbit */}
      <ellipse
        cx="100"
        cy="100"
        rx="62"
        ry="20"
        transform="rotate(-10 100 100)"
        stroke="#8B9D83"
        strokeWidth="1.5"
        fill="none"
        opacity="0.4"
      />

      {/* Orbital accent dots */}
      <circle cx="38" cy="72" r="3" fill="#D4745E" opacity="0.8" />
      <circle cx="162" cy="128" r="2.5" fill="#8B9D83" opacity="0.7" />
      <circle cx="145" cy="52" r="2" fill="#D4745E" opacity="0.5" />
      <circle cx="55" cy="148" r="2" fill="#8B9D83" opacity="0.5" />

      {/* Sparkle accents */}
      <path
        d="M170 65 L172 60 L174 65 L179 67 L174 69 L172 74 L170 69 L165 67 Z"
        fill="#D4745E"
        opacity="0.6"
      />
      <path
        d="M30 130 L31.5 126 L33 130 L37 131.5 L33 133 L31.5 137 L30 133 L26 131.5 Z"
        fill="#8B9D83"
        opacity="0.5"
      />
    </svg>
  );
}

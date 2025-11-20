interface LogoProps {
  className?: string;
  size?: 'sm' | 'md' | 'lg';
  showText?: boolean;
}

export function Logo({ className = '', size = 'md', showText = true }: LogoProps) {
  const sizes = {
    sm: { icon: 24, text: 'text-lg' },
    md: { icon: 32, text: 'text-2xl' },
    lg: { icon: 48, text: 'text-4xl' },
  };

  const iconSize = sizes[size].icon;
  const textClass = sizes[size].text;

  return (
    <div className={`flex items-center gap-3 ${className}`}>
      {/* Logo Icon */}
      <svg
        width={iconSize}
        height={iconSize}
        viewBox="0 0 100 100"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        className="flex-shrink-0"
      >
        {/* Outer circle gradient */}
        <defs>
          <linearGradient id="logoGradient" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#3b82f6" />
            <stop offset="50%" stopColor="#8b5cf6" />
            <stop offset="100%" stopColor="#ec4899" />
          </linearGradient>
          <linearGradient id="dataGradient" x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stopColor="#60a5fa" />
            <stop offset="100%" stopColor="#3b82f6" />
          </linearGradient>
        </defs>

        {/* Background circle */}
        <circle cx="50" cy="50" r="48" fill="url(#logoGradient)" opacity="0.1" />

        {/* Storage/Database stack */}
        <g transform="translate(25, 20)">
          {/* Top disk */}
          <ellipse cx="25" cy="10" rx="22" ry="8" fill="url(#dataGradient)" opacity="0.9" />
          <path
            d="M 3 10 L 3 15 Q 3 20, 25 20 Q 47 20, 47 15 L 47 10"
            fill="url(#dataGradient)"
            opacity="0.8"
          />

          {/* Middle disk */}
          <ellipse cx="25" cy="28" rx="22" ry="8" fill="url(#dataGradient)" opacity="0.8" />
          <path
            d="M 3 28 L 3 33 Q 3 38, 25 38 Q 47 38, 47 33 L 47 28"
            fill="url(#dataGradient)"
            opacity="0.7"
          />

          {/* Bottom disk */}
          <ellipse cx="25" cy="46" rx="22" ry="8" fill="url(#dataGradient)" opacity="0.7" />
          <path
            d="M 3 46 L 3 51 Q 3 56, 25 56 Q 47 56, 47 51 L 47 46"
            fill="url(#dataGradient)"
            opacity="0.6"
          />
        </g>

        {/* "0" overlay - representing the zero in St0r */}
        <circle
          cx="72"
          cy="28"
          r="12"
          fill="none"
          stroke="#ec4899"
          strokeWidth="3"
          opacity="0.9"
        />
        <circle
          cx="72"
          cy="28"
          r="7"
          fill="#ec4899"
          opacity="0.2"
        />
      </svg>

      {/* Text Logo */}
      {showText && (
        <div className="flex items-baseline">
          <span className={`${textClass} font-bold text-gray-800 dark:text-gray-100`}>
            St
          </span>
          <span className={`${textClass} font-bold text-blue-600 dark:text-blue-400`}>
            0
          </span>
          <span className={`${textClass} font-bold text-gray-800 dark:text-gray-100`}>
            r
          </span>
        </div>
      )}
    </div>
  );
}

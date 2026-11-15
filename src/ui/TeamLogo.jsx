import React from 'react';

// Team Stellaris mark. Original artwork: a four-point star (a "stellar" point of light) crossed by an
// orbit with a satellite. Inline so it is crisp at every size and needs no request.
export function StellarisMark({ size = 40, title = 'Team Stellaris' }) {
  return (
    <svg className="st-mark" width={size} height={size} viewBox="0 0 64 64" role="img" aria-label={title}>
      <defs>
        <linearGradient id="stm-g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#9fe6ff" /><stop offset="1" stopColor="#3aa8e0" /></linearGradient>
        <linearGradient id="stm-w" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#ffe29a" /><stop offset="1" stopColor="#ffb347" /></linearGradient>
        <radialGradient id="stm-bg" cx=".5" cy=".4" r=".8"><stop offset="0" stopColor="#14264a" /><stop offset="1" stopColor="#060c1b" /></radialGradient>
      </defs>
      <rect x="2" y="2" width="60" height="60" rx="16" fill="url(#stm-bg)" stroke="#27456f" strokeWidth="1.5" />
      <ellipse cx="32" cy="30" rx="23" ry="8.5" transform="rotate(-24 32 30)" fill="none" stroke="url(#stm-g)" strokeWidth="2" strokeOpacity=".85" />
      <path d="M32 8 L36.2 25.8 L54 30 L36.2 34.2 L32 52 L27.8 34.2 L10 30 L27.8 25.8 Z" fill="url(#stm-w)" />
      <circle cx="32" cy="30" r="2.6" fill="#fff8e1" />
      <circle cx="50.6" cy="21.4" r="2.6" fill="#9fe6ff" />
    </svg>
  );
}

// Mark + name. `compact` shows the badge used in the side-panel footer.
export default function TeamLogo({ size = 40, compact = false }) {
  return (
    <div className={`team-logo${compact ? ' compact' : ''}`}>
      <StellarisMark size={size} />
      <div className="tl-text"><b>Team Stellaris</b><span>NASA Space Apps 2026</span></div>
    </div>
  );
}

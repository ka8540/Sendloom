export function NotFoundDog() {
  return (
    <svg className="dog-illustration" viewBox="0 0 320 280" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <ellipse cx="160" cy="246" rx="98" ry="18" fill="rgba(20, 32, 51, 0.12)" />
      <path
        d="M74 126C74 87.3401 105.34 56 144 56H176C214.66 56 246 87.3401 246 126V166C246 204.66 214.66 236 176 236H144C105.34 236 74 204.66 74 166V126Z"
        fill="var(--surface-strong)"
        stroke="var(--line)"
        strokeWidth="6"
      />
      <path
        d="M94 90C74 70 54 66 42 76C30 86 33 108 52 126C68 142 89 150 104 144"
        fill="var(--surface-muted)"
        stroke="var(--line)"
        strokeWidth="6"
        strokeLinecap="round"
      />
      <path
        d="M226 90C246 70 266 66 278 76C290 86 287 108 268 126C252 142 231 150 216 144"
        fill="var(--surface-muted)"
        stroke="var(--line)"
        strokeWidth="6"
        strokeLinecap="round"
      />
      <circle cx="126" cy="138" r="10" fill="var(--text)" />
      <circle cx="194" cy="138" r="10" fill="var(--text)" />
      <ellipse cx="160" cy="168" rx="28" ry="22" fill="var(--accent-soft)" stroke="var(--line)" strokeWidth="5" />
      <path d="M145 166C149.667 173.333 170.333 173.333 175 166" stroke="var(--text)" strokeWidth="5" strokeLinecap="round" />
      <path d="M160 170V180" stroke="var(--text)" strokeWidth="5" strokeLinecap="round" />
      <path d="M136 194C146 204 174 204 184 194" stroke="var(--text)" strokeWidth="6" strokeLinecap="round" />
      <path d="M115 112C121.5 106.667 132.5 106.667 139 112" stroke="var(--text)" strokeWidth="5" strokeLinecap="round" />
      <path d="M181 112C187.5 106.667 198.5 106.667 205 112" stroke="var(--text)" strokeWidth="5" strokeLinecap="round" />
      <path
        d="M111 58C125.667 43.3333 141.667 36 159 36C176.333 36 193 43.3333 209 58"
        stroke="var(--accent)"
        strokeWidth="8"
        strokeLinecap="round"
      />
      <path
        d="M104 234C103 214 117.667 198 138 198H182C202.333 198 217 214 216 234"
        fill="var(--surface-muted)"
        stroke="var(--line)"
        strokeWidth="6"
      />
      <text x="160" y="112" textAnchor="middle" fill="var(--accent)" fontSize="36" fontWeight="800" fontFamily="Inter, sans-serif">
        404
      </text>
    </svg>
  );
}

// ═══════════════════════════════════════════════════════════
// SECTION CONTENT
//
// Card bodies are real JSX rather than HTML strings so React can
// manage events and we avoid dangerouslySetInnerHTML entirely.
// ═══════════════════════════════════════════════════════════

/** Carousel radius, shared by the layout and the camera controller. */
export const R = 30;

export const Icon = ({ name }) => {
  const paths = {
    identity: (
      <>
        <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
        <circle cx="12" cy="7" r="4" />
      </>
    ),
    socials: (
      <>
        <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
        <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
      </>
    ),
    music: (
      <>
        <path d="M9 18V5l12-2v13" />
        <circle cx="6" cy="18" r="3" />
        <circle cx="18" cy="16" r="3" />
      </>
    ),
    archive: (
      <>
        <rect x="2" y="3" width="20" height="14" rx="2" ry="2" />
        <line x1="8" y1="21" x2="16" y2="21" />
        <line x1="12" y1="17" x2="12" y2="21" />
      </>
    ),
    status: (
      <>
        <circle cx="12" cy="12" r="10" />
        <polyline points="12 6 12 12 16 14" />
      </>
    ),
    projects: <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />,
    check: (
      <>
        <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
        <polyline points="22 4 12 14.01 9 11.01" />
      </>
    ),
    bolt: <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />,
    download: (
      <>
        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
        <polyline points="7 10 12 15 17 10" />
        <line x1="12" y1="15" x2="12" y2="3" />
      </>
    ),
    external: (
      <>
        <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
        <polyline points="15 3 21 3 21 9" />
        <line x1="10" y1="14" x2="21" y2="3" />
      </>
    ),
    shield: <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />,
    instagram: (
      <>
        <rect x="2" y="2" width="20" height="20" rx="5" ry="5" />
        <path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z" />
        <line x1="17.5" y1="6.5" x2="17.51" y2="6.5" />
      </>
    )
  };

  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      {paths[name]}
    </svg>
  );
};

/** Discord's glyph is a filled path, so it needs its own treatment. */
export const DiscordIcon = () => (
  <svg viewBox="0 0 24 24" className="icon-filled" aria-hidden="true" focusable="false">
    <path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028 14.09 14.09 0 0 0 1.226-1.994.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.028zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z" />
  </svg>
);

export const VIRUSTOTAL_URL =
  'https://www.virustotal.com/gui/file/33456b7de494d2bfe03302f3bc9cdc349e60dce1b6da863e94e767f6555564f3/detection';

const Stat = ({ label, children, mono }) => (
  <div className="hud-block full">
    <div className="hud-label">{label}</div>
    <div className={`hud-value${mono ? ' mono' : ''}`}>{children}</div>
  </div>
);

/**
 * `camOffset` positions the camera relative to the focused card;
 * `lookOffset` nudges what it aims at. Both are in world units.
 */
export const SECTIONS = [
  {
    id: 'identity',
    title: 'ABOUT ME',
    icon: 'identity',
    width: 580,
    camOffset: [-4, 2, 21],
    lookOffset: [0, 0, 0],
    Content: () => (
      <div className="about-identity-wrapper">
        <div className="about-avatar-wrapper">
          <img src="/profile.png" className="about-avatar-img" alt="Portrait" loading="lazy" />
        </div>
        <div className="about-info-wrapper">
          <div className="hud-grid single">
            <Stat label="BIRTHDAY" mono>
              JUN 23
            </Stat>
            <Stat label="AGE" mono>
              18
            </Stat>
            <div className="hud-block full">
              <div className="hud-label">STATUS</div>
              <div className="hud-value small">Student</div>
              <div className="hud-value small muted">Aspiring AI Engineer</div>
              <div className="hud-value small muted">Technology &amp; Programming</div>
            </div>
          </div>
        </div>
      </div>
    )
  },
  {
    id: 'socials',
    title: 'SOCIALS',
    icon: 'socials',
    camOffset: [4, -1, 23],
    lookOffset: [0, 0, 0],
    Content: ({ onSfx }) => (
      <div className="social-stack">
        <a
          href="https://www.instagram.com/hataeruu/"
          target="_blank"
          rel="noopener noreferrer"
          className="social-link"
          onClick={() => onSfx('select')}
        >
          <span className="social-icon">
            <Icon name="instagram" />
          </span>
          <span className="social-name">Instagram</span>
          <span className="hud-label">@hataeruu</span>
        </a>
        <a
          href="https://discord.com/users/1408523273548988456"
          target="_blank"
          rel="noopener noreferrer"
          className="social-link"
          onClick={() => onSfx('select')}
        >
          <span className="social-icon">
            <DiscordIcon />
          </span>
          <span className="social-name">Discord</span>
          <span className="hud-label">Click to redirect</span>
        </a>
      </div>
    )
  },
  {
    id: 'music',
    title: 'MUSIC',
    icon: 'music',
    camOffset: [0, -3, 20],
    lookOffset: [0, 0, 0],
    Content: null // Rendered by NowPlaying — needs live audio state.
  },
  {
    id: 'archive',
    title: 'INTERESTS',
    icon: 'archive',
    camOffset: [-4, -3, 23],
    lookOffset: [0, 0, 0],
    Content: () => (
      <div className="hud-grid single">
        <Stat label="INTERESTS">Programming / AI / Technology</Stat>
        <Stat label="HOBBIES">Gaming / Anime / Music / Japanese</Stat>
        <Stat label="VIBE">Cyber Y2K Ambient</Stat>
      </div>
    )
  },
  {
    id: 'status',
    title: 'CURRENTLY',
    icon: 'status',
    camOffset: [3, 4, 22],
    lookOffset: [0, 0, 0],
    Content: () => (
      <div className="hud-grid single">
        <div className="hud-block full row">
          <div className="hud-icon">
            <Icon name="check" />
          </div>
          <div>
            <div className="hud-label">DOING</div>
            <div className="hud-value">Learning &amp; Building</div>
          </div>
        </div>
        <div className="hud-block full row">
          <div className="hud-icon">
            <Icon name="bolt" />
          </div>
          <div>
            <div className="hud-label">FOCUS</div>
            <div className="hud-value">AI / Programming</div>
          </div>
        </div>
      </div>
    )
  },
  {
    id: 'projects',
    title: 'PROJECTS',
    icon: 'projects',
    width: 420,
    camOffset: [4, 1, 21],
    lookOffset: [0, 0, 0],
    Content: ({ onDownload, onSfx }) => (
      <div className="hud-grid single">
        <div className="hud-block full project-block">
          <div className="hud-label">HOOKLOADER</div>
          <div className="hud-value lead">Valorant Hook Loader</div>
          <p className="project-copy">
            A hookloader designed for Valorant cheats. This is open-source code &mdash; completely
            free to use, modify, and redistribute without any need to credit me.
          </p>
          <button type="button" className="btn btn-primary" onClick={onDownload}>
            <Icon name="download" />
            DOWNLOAD .ZIP
          </button>
          <a
            href={VIRUSTOTAL_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="btn btn-ghost"
            onClick={() => onSfx('virustotal')}
          >
            <Icon name="external" />
            VIEW ON VIRUSTOTAL
          </a>
        </div>
        <div className="hud-block full license-block">
          <div className="hud-label dim">LICENSE</div>
          <div className="hud-value small">Free &amp; Open Source &mdash; No Credit Required</div>
        </div>
      </div>
    )
  }
];

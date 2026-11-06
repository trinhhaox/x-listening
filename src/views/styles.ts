// CSS dùng chung cho mọi trang (chèn inline trong <style>).
export const STYLES = `    :root {
      /* HeroUI Modern Palette */
      --heroui-primary: #006FEE;
      --heroui-primary-50: #E6F1FE;
      --heroui-primary-100: #CCE3FD;
      --heroui-primary-200: #99C7FB;
      --heroui-primary-600: #005BC4;
      --heroui-primary-700: #004493;

      --heroui-success: #17C964;
      --heroui-success-50: #E8FAF0;
      --heroui-success-100: #D1F4E0;
      --heroui-success-600: #12A150;

      --heroui-warning: #F5A524;
      --heroui-warning-50: #FEF7EC;
      --heroui-warning-100: #FDEFD9;
      --heroui-warning-600: #C4841D;

      --heroui-danger: #F31260;
      --heroui-danger-50: #FEE7EF;
      --heroui-danger-100: #FDD0DF;
      --heroui-danger-600: #C20E4D;

      --heroui-secondary: #7828C8;
      --heroui-secondary-50: #F2EAFA;

      --bg: #FAFAFA;
      --paper: #FFFFFF;
      --card: #FFFFFF;
      --card-subtle: #F9FAFB;
      --ink: #11181C;
      --ink-soft: #3F3F46;
      --muted: #71717A;
      --line: #E4E4E7;
      --line-subtle: #F4F4F5;

      /* Radii */
      --radius-sm: 8px;
      --radius-md: 12px;
      --radius-lg: 16px;
      --radius-xl: 20px;
      --radius-full: 9999px;

      /* Shadows */
      --shadow-sm: 0 1px 2px 0 rgba(0, 0, 0, 0.05);
      --shadow-md: 0 4px 6px -1px rgba(0, 0, 0, 0.05), 0 2px 4px -2px rgba(0, 0, 0, 0.05);
      --shadow-lg: 0 10px 15px -3px rgba(0, 0, 0, 0.08), 0 4px 6px -4px rgba(0, 0, 0, 0.04);
      --shadow-primary: 0 4px 14px 0 rgba(0, 111, 238, 0.35);
      --shadow-danger: 0 4px 14px 0 rgba(243, 18, 96, 0.35);
      --shadow-success: 0 4px 14px 0 rgba(23, 201, 100, 0.35);
    }

    * { box-sizing: border-box; }
    html {
      scroll-padding-top: 80px;
      scroll-behavior: smooth;
    }
    body {
      margin: 0;
      min-height: 100dvh;
      color: var(--ink);
      font-family: "Inter", "Be Vietnam Pro", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      font-size: 14.5px;
      line-height: 1.5;
      background: var(--bg);
      -webkit-font-smoothing: antialiased;
    }

    /* SCROLL MARGIN TRÁNH BỊ NAVBAR ĐÈ LÊN KHI NHẢY TỚI ANCHOR */
    #deck-admin-panel, .executive-radar, .deck-ribbon, .deck-dual-streams, .radar-cloud-card, .deck-page-header {
      scroll-margin-top: 80px;
    }

    /* HEROUI STICKY NAVBAR - DUY NHẤT 1 HÀNG 64PX */
    .deck-top-navbar {
      position: sticky;
      top: 0;
      left: 0;
      right: 0;
      width: 100%;
      height: 64px;
      background: rgba(255, 255, 255, 0.92);
      backdrop-filter: blur(16px);
      -webkit-backdrop-filter: blur(16px);
      border-bottom: 1px solid var(--line);
      z-index: 100;
      box-shadow: 0 1px 3px 0 rgba(0, 0, 0, 0.03);
    }
    .navbar-container {
      max-width: 1440px;
      height: 100%;
      margin: 0 auto;
      padding: 0 24px;
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 16px;
    }

    /* BRAND */
    .navbar-brand {
      display: flex;
      align-items: center;
      gap: 10px;
      flex-shrink: 0;
    }
    .brand-link {
      display: flex;
      align-items: center;
      gap: 8px;
      text-decoration: none;
      color: var(--ink);
    }
    .brand-title {
      font-size: 1.35rem;
      font-weight: 800;
      letter-spacing: -0.03em;
    }
    .brand-badge {
      display: inline-block;
    }

    .live-dot {
      display: inline-flex;
      align-items: center;
      justify-content: center;
    }
    .heroui-pulse {
      width: 9px;
      height: 9px;
      border-radius: 999px;
      background: var(--heroui-success);
      display: inline-block;
      box-shadow: 0 0 0 3px rgba(23, 201, 100, 0.25);
      animation: beat 2s ease-in-out infinite;
    }
    @keyframes beat { 50% { transform: scale(0.8); opacity: 0.6; } }

    /* NAV ITEMS (PILL TABS) */
    .navbar-nav {
      display: flex;
      align-items: center;
      gap: 4px;
      background: var(--line-subtle);
      padding: 4px;
      border-radius: var(--radius-full);
      border: 1px solid var(--line);
      overflow-x: auto;
      white-space: nowrap;
    }
    .nav-item {
      text-decoration: none;
      font-size: 0.84rem;
      font-weight: 500;
      color: var(--muted);
      padding: 6px 14px;
      border-radius: var(--radius-full);
      transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
      display: inline-flex;
      align-items: center;
      gap: 6px;
    }
    .nav-item:hover {
      color: var(--ink);
      background: rgba(0, 0, 0, 0.04);
    }
    .nav-item.active {
      color: #ffffff;
      background: var(--heroui-primary);
      box-shadow: 0 2px 8px rgba(0, 111, 238, 0.35);
      font-weight: 600;
    }

    /* NAVBAR ACTIONS */
    .navbar-actions {
      display: flex;
      align-items: center;
      gap: 8px;
      flex-shrink: 0;
    }

    /* PAGE MAIN WRAPPER */
    main {
      position: relative;
      max-width: 1440px;
      margin: 0 auto;
      padding: 24px 24px 80px;
      z-index: 1;
    }

    /* PAGE HERO HEADER (SUBHEADER) */
    .deck-page-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      flex-wrap: wrap;
      gap: 16px;
      padding: 18px 24px;
      background: var(--paper);
      border: 1px solid var(--line);
      border-radius: var(--radius-xl);
      margin-bottom: 24px;
      box-shadow: var(--shadow-sm);
    }
    .title-with-badge {
      display: flex;
      align-items: center;
      gap: 12px;
      flex-wrap: wrap;
    }
    .deck-page-header h1 {
      margin: 0;
      font-size: 1.35rem;
      font-weight: 700;
      letter-spacing: -0.02em;
      color: var(--ink);
    }
    .deck-page-header p {
      margin: 4px 0 0;
      font-size: 0.86rem;
      color: var(--muted);
    }
    .page-header-actions {
      display: flex;
      align-items: center;
      gap: 10px;
      flex-wrap: wrap;
    }

    /* HEROUI BUTTONS */
    .btn {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 6px;
      padding: 8px 16px;
      font-size: 0.88rem;
      font-weight: 500;
      border-radius: var(--radius-md);
      border: 1px solid transparent;
      cursor: pointer;
      text-decoration: none;
      transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
      white-space: nowrap;
      user-select: none;
    }
    .btn:active {
      transform: scale(0.97);
    }
    .btn-primary {
      background: var(--heroui-primary);
      color: #ffffff;
      box-shadow: var(--shadow-primary);
    }
    .btn-primary:hover {
      background: var(--heroui-primary-600);
    }
    .btn-outline {
      background: #ffffff;
      border-color: var(--line);
      color: var(--ink);
      box-shadow: var(--shadow-sm);
    }
    .btn-outline:hover {
      background: var(--line-subtle);
      border-color: #d4d4d8;
    }
    .btn-danger {
      background: var(--heroui-danger);
      color: #ffffff;
      box-shadow: var(--shadow-danger);
    }
    .btn-danger:hover {
      background: var(--heroui-danger-600);
    }
    .btn-danger-flat {
      background: var(--heroui-danger-50);
      color: var(--heroui-danger);
    }
    .btn-danger-flat:hover {
      background: var(--heroui-danger-100);
    }
    .btn-sm {
      padding: 6px 12px;
      font-size: 0.82rem;
      border-radius: 10px;
    }
    .btn-xs {
      padding: 4px 8px;
      font-size: 0.76rem;
      border-radius: 8px;
    }
    .btn-lg {
      padding: 12px 24px;
      font-size: 0.96rem;
      border-radius: var(--radius-md);
      font-weight: 600;
    }
    .btn-block {
      width: 100%;
    }

    /* HEROUI CARDS */
    .heroui-card {
      background: var(--paper);
      border: 1px solid var(--line);
      border-radius: var(--radius-lg);
      box-shadow: var(--shadow-sm);
      transition: all 0.2s ease;
    }
    .heroui-card:hover {
      box-shadow: var(--shadow-md);
    }
    .heroui-card-sub {
      background: var(--card-subtle);
      border: 1px solid var(--line);
      border-radius: var(--radius-md);
    }

    /* HEROUI CHIPS / BADGES */
    .heroui-chip {
      display: inline-flex;
      align-items: center;
      gap: 5px;
      padding: 3px 10px;
      font-size: 0.74rem;
      font-weight: 600;
      border-radius: var(--radius-full);
      text-decoration: none;
      line-height: 1.4;
      white-space: nowrap;
    }
    .heroui-chip-primary {
      background: var(--heroui-primary-50);
      color: var(--heroui-primary);
    }
    .heroui-chip-success {
      background: var(--heroui-success-50);
      color: var(--heroui-success);
    }
    .heroui-chip-warning {
      background: var(--heroui-warning-50);
      color: var(--heroui-warning);
    }
    .heroui-chip-danger {
      background: var(--heroui-danger-50);
      color: var(--heroui-danger);
    }
    .heroui-chip-default {
      background: var(--line-subtle);
      color: var(--muted);
    }
    .heroui-chip-bordered {
      background: #ffffff;
      border: 1px solid var(--line);
      color: var(--ink-soft);
    }
    .heroui-dot {
      width: 6px;
      height: 6px;
      border-radius: 999px;
      background: currentColor;
      display: inline-block;
    }

    /* HEROUI INPUTS & SELECTS */
    .heroui-input, .heroui-select, .heroui-textarea {
      width: 100%;
      padding: 9px 12px;
      font-size: 0.88rem;
      font-family: inherit;
      color: var(--ink);
      background: var(--line-subtle);
      border: 1px solid transparent;
      border-radius: var(--radius-md);
      transition: all 0.2s ease;
      outline: none;
      text-overflow: ellipsis;
    }
    .heroui-input:hover, .heroui-select:hover, .heroui-textarea:hover {
      background: #f0f0f2;
    }
    .heroui-input:focus, .heroui-select:focus, .heroui-textarea:focus {
      background: #ffffff;
      border-color: var(--heroui-primary);
      box-shadow: 0 0 0 3px rgba(0, 111, 238, 0.15);
    }
    .heroui-input-sm, .heroui-select-sm {
      padding: 5px 8px;
      font-size: 0.78rem;
      border-radius: 8px;
    }
    .heroui-label {
      display: flex;
      flex-direction: column;
      gap: 6px;
      font-size: 0.82rem;
      font-weight: 600;
      color: var(--ink-soft);
      margin-bottom: 12px;
      min-width: 0;
    }
    .heroui-link {
      color: var(--heroui-primary);
      text-decoration: none;
      font-weight: 500;
    }
    .heroui-link:hover {
      text-decoration: underline;
    }

    /* ALERTS */
    .deck-alert {
      padding: 12px 16px;
      border-radius: var(--radius-md);
      font-size: 0.88rem;
      margin-bottom: 20px;
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .deck-alert.info {
      background: var(--heroui-primary-50);
      color: var(--heroui-primary-700);
      border: 1px solid var(--heroui-primary-100);
    }
    .deck-alert.warning {
      background: var(--heroui-warning-50);
      color: var(--heroui-warning-600);
      border: 1px solid var(--heroui-warning-100);
    }
    .deck-alert.error {
      background: var(--heroui-danger-50);
      color: var(--heroui-danger-600);
      border: 1px solid var(--heroui-danger-100);
    }

    /* EXECUTIVE RADAR GRID */
    .executive-radar {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(360px, 1fr));
      gap: 20px;
      margin-bottom: 24px;
    }
    .radar-card {
      padding: 20px;
      display: flex;
      flex-direction: column;
      gap: 16px;
    }
    .radar-card-head {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      gap: 12px;
    }
    .radar-card-head h3 {
      margin: 0;
      font-size: 1.05rem;
      font-weight: 700;
      letter-spacing: -0.02em;
    }
    .radar-sub {
      font-size: 0.78rem;
      color: var(--muted);
    }

    /* KPI BOXES */
    .kpi-grid {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 10px;
    }
    .kpi-box {
      padding: 12px;
      display: flex;
      flex-direction: column;
      gap: 4px;
    }
    .kpi-label {
      font-size: 0.74rem;
      color: var(--muted);
      font-weight: 500;
    }
    .kpi-val {
      font-size: 1.55rem;
      font-weight: 700;
      color: var(--ink);
      letter-spacing: -0.03em;
    }

    /* FEELBAR */
    .feel-container {
      margin-top: 4px;
      display: flex;
      flex-direction: column;
      gap: 6px;
    }
    .feel-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      font-size: 0.8rem;
    }
    .feel-title {
      font-weight: 600;
      color: var(--ink-soft);
    }
    .feel-percent {
      font-size: 0.78rem;
      color: var(--muted);
    }
    .feel-bar-track {
      height: 8px;
      background: var(--line-subtle);
      border-radius: var(--radius-full);
      overflow: hidden;
      display: flex;
    }
    .feel-bar-pos { background: var(--heroui-success); }
    .feel-bar-neg { background: var(--heroui-danger); }
    .feel-bar-neu { background: #A1A1AA; }
    .feel-sub {
      display: flex;
      justify-content: space-between;
      font-size: 0.74rem;
      color: var(--muted);
    }

    /* BARS CHART */
    .radar-chart-area {
      min-height: 110px;
      display: flex;
      align-items: flex-end;
    }
    .radar-bars-wrapper {
      display: flex;
      align-items: flex-end;
      gap: 8px;
      width: 100%;
      height: 100px;
    }
    .radar-bar-col {
      flex: 1;
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 4px;
      height: 100%;
      justify-content: flex-end;
    }
    .radar-bar-track {
      width: 100%;
      height: 70px;
      display: flex;
      align-items: flex-end;
      border-radius: 6px;
      background: var(--line-subtle);
      overflow: hidden;
    }
    .radar-bar-fill {
      width: 100%;
      background: linear-gradient(180deg, var(--heroui-primary) 0%, var(--heroui-primary-600) 100%);
      border-radius: 6px 6px 0 0;
      transition: height 0.4s ease;
    }
    .radar-bar-val {
      font-size: 0.7rem;
      font-weight: 600;
      color: var(--ink);
    }
    .radar-bar-lbl {
      font-size: 0.68rem;
      color: var(--muted);
    }
    .voices-tray {
      margin-top: 8px;
      display: flex;
      flex-direction: column;
      gap: 6px;
    }
    .tray-title {
      font-size: 0.76rem;
      font-weight: 600;
      color: var(--muted);
    }
    .voices-chips {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
    }
    .empty-radar {
      font-size: 0.85rem;
      color: var(--muted);
      margin: auto;
    }

    /* ALARMS */
    .alarms-scroll-area {
      max-height: 230px;
      overflow-y: auto;
      display: flex;
      flex-direction: column;
      gap: 8px;
      padding-right: 4px;
    }
    .alarm-item {
      padding: 12px;
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 12px;
    }
    .alarm-content {
      display: flex;
      flex-direction: column;
      gap: 3px;
    }
    .alarm-header {
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .alarm-meta {
      font-size: 0.74rem;
      color: var(--muted);
    }
    .alarm-text {
      margin: 0;
      font-size: 0.82rem;
      line-height: 1.35;
      display: -webkit-box;
      -webkit-line-clamp: 2;
      -webkit-box-orient: vertical;
      overflow: hidden;
    }
    .alarm-reason {
      font-size: 0.72rem;
      color: var(--heroui-danger);
    }
    .empty-alarms {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      text-align: center;
      padding: 30px 16px;
      color: var(--muted);
    }
    .shield-icon {
      font-size: 2rem;
      margin-bottom: 8px;
    }

    /* WORD CLOUD & TOPICS */
    .radar-cloud-card {
      padding: 20px;
      margin-bottom: 24px;
    }
    .cloud-card-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      flex-wrap: wrap;
      gap: 16px;
      padding-bottom: 16px;
      border-bottom: 1px solid var(--line);
      margin-bottom: 16px;
    }
    .cloud-card-title {
      display: flex;
      align-items: center;
      gap: 12px;
    }
    .cloud-icon {
      font-size: 1.8rem;
    }
    .cloud-card-title h3 {
      margin: 0;
      font-size: 1.1rem;
      font-weight: 700;
    }
    .cloud-sub {
      font-size: 0.78rem;
      color: var(--muted);
    }
    .cloud-clusters-tray {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
    }
    .cloud-words-wrapper {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 10px;
      padding: 10px 0;
    }
    .cloud-word-chip {
      text-decoration: none;
      padding: 4px 12px;
      border-radius: var(--radius-full);
      font-weight: 600;
      transition: all 0.2s ease;
      display: inline-flex;
      align-items: center;
      gap: 6px;
    }
    .cloud-word-chip:hover {
      transform: translateY(-2px);
      box-shadow: var(--shadow-sm);
    }
    .cloud-word-chip.pos {
      background: var(--heroui-success-50);
      color: var(--heroui-success-600);
      border: 1px solid var(--heroui-success-100);
    }
    .cloud-word-chip.neg {
      background: var(--heroui-danger-50);
      color: var(--heroui-danger-600);
      border: 1px solid var(--heroui-danger-100);
    }
    .cloud-word-chip.neu {
      background: var(--line-subtle);
      color: var(--ink-soft);
      border: 1px solid var(--line);
    }
    .chip-count {
      font-size: 0.72rem;
      padding: 2px 6px;
      border-radius: var(--radius-full);
      background: rgba(0, 0, 0, 0.06);
    }

    /* ADMIN ACCORDION PANEL - 2 CỘT RỘNG RÃI */
    .deck-admin-details {
      margin-bottom: 24px;
      overflow: hidden;
    }
    .deck-admin-summary {
      padding: 16px 20px;
      cursor: pointer;
      display: flex;
      justify-content: space-between;
      align-items: center;
      user-select: none;
      list-style: none;
      transition: background 0.2s ease;
    }
    .deck-admin-summary::-webkit-details-marker { display: none; }
    .deck-admin-summary:hover {
      background: var(--line-subtle);
    }
    .admin-summary-content {
      display: flex;
      align-items: center;
      flex-wrap: wrap;
      gap: 14px;
    }
    .admin-summary-title {
      display: flex;
      align-items: center;
      gap: 8px;
      font-size: 0.98rem;
    }
    .admin-summary-badges {
      display: flex;
      align-items: center;
      gap: 6px;
      flex-wrap: wrap;
    }
    .admin-pill-action {
      font-size: 0.76rem;
      color: var(--heroui-primary);
      font-weight: 600;
    }
    .summary-arrow {
      font-size: 1.1rem;
      color: var(--muted);
      transition: transform 0.2s ease;
    }
    details[open] .summary-arrow {
      transform: rotate(180deg);
    }
    .deck-admin-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(460px, 1fr));
      gap: 20px;
      padding: 20px;
      background: var(--line-subtle);
      border-top: 1px solid var(--line);
    }
    @media (max-width: 640px) {
      .deck-admin-grid {
        grid-template-columns: 1fr;
      }
    }
    .admin-card {
      padding: 18px;
      display: flex;
      flex-direction: column;
      gap: 14px;
    }
    .admin-card-head h3 {
      margin: 0;
      font-size: 1rem;
      font-weight: 700;
      color: var(--ink);
      line-height: 1.4;
    }
    .form-row {
      display: flex;
      gap: 12px;
    }
    @media (max-width: 520px) {
      .form-row {
        flex-direction: column;
        gap: 8px;
      }
    }
    .form-row > * {
      flex: 1;
      min-width: 0;
    }
    .check-label {
      display: flex;
      align-items: center;
      gap: 6px;
      font-size: 0.8rem;
      color: var(--ink-soft);
      cursor: pointer;
    }
    .admin-tool-list {
      display: flex;
      flex-direction: column;
      gap: 8px;
      max-height: 280px;
      overflow-y: auto;
    }
    .tool-list-row {
      padding: 10px 12px;
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 10px;
    }
    .tool-list-info {
      display: flex;
      flex-direction: column;
      gap: 4px;
      overflow: hidden;
      min-width: 0;
    }
    .tool-title-wrap {
      display: flex;
      align-items: center;
      gap: 6px;
      flex-wrap: wrap;
    }
    .source-pill {
      font-size: 0.7rem;
      font-weight: 600;
      padding: 2px 8px;
      border-radius: var(--radius-full);
      text-transform: uppercase;
    }
    .source-pill.facebook { background: #1877F2; color: #ffffff; }
    .source-pill.x { background: #000000; color: #ffffff; }
    .source-pill.threads { background: #333333; color: #ffffff; }
    .source-pill.youtube { background: #FF0000; color: #ffffff; }
    .source-pill.web { background: #0F9D58; color: #ffffff; }
    .tool-error {
      margin: 0;
      font-size: 0.74rem;
      color: var(--heroui-danger);
    }
    .tool-list-actions {
      display: flex;
      gap: 6px;
      flex-shrink: 0;
    }
    .admin-divider {
      border: 0;
      border-top: 1px solid var(--line);
      margin: 4px 0;
    }
    .sample-actions {
      display: flex;
      gap: 8px;
      margin-top: 8px;
      flex-wrap: wrap;
    }

    /* RIBBON FILTER BAR */
    .deck-ribbon {
      padding: 16px 20px;
      margin-bottom: 24px;
      display: flex;
      flex-direction: column;
      gap: 14px;
    }
    .ribbon-tabs {
      display: flex;
      gap: 4px;
      background: var(--line-subtle);
      padding: 4px;
      border-radius: var(--radius-full);
      width: fit-content;
      border: 1px solid var(--line);
      flex-wrap: wrap;
    }
    .tab-link {
      text-decoration: none;
      font-size: 0.82rem;
      font-weight: 500;
      color: var(--muted);
      padding: 6px 14px;
      border-radius: var(--radius-full);
      transition: all 0.2s ease;
    }
    .tab-link:hover {
      color: var(--ink);
    }
    .tab-link.active {
      color: #ffffff;
      background: var(--heroui-primary);
      box-shadow: 0 2px 6px rgba(0, 111, 238, 0.3);
      font-weight: 600;
    }
    .ribbon-filter-bar {
      display: flex;
      justify-content: space-between;
      align-items: center;
      flex-wrap: wrap;
      gap: 12px;
    }
    .filter-group {
      display: flex;
      align-items: center;
      flex-wrap: wrap;
      gap: 8px;
      flex: 1;
    }
    .search-input { width: 220px; }
    .tag-input { width: 165px; }
    .assignee-input { width: 175px; }
    .likes-input { width: 130px; }
    .btn-clear {
      font-size: 0.8rem;
      color: var(--heroui-danger);
      text-decoration: none;
      font-weight: 500;
      padding: 6px 10px;
    }
    .btn-clear:hover {
      text-decoration: underline;
    }
    .ribbon-export {
      display: flex;
      gap: 8px;
      align-items: center;
      flex-wrap: wrap;
    }

    /* DUAL-STREAM LAYOUT */
    .deck-dual-streams {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 20px;
    }
    @media (max-width: 960px) {
      .deck-dual-streams {
        grid-template-columns: 1fr;
      }
    }
    .stream-column {
      padding: 20px;
      display: flex;
      flex-direction: column;
      gap: 14px;
    }
    .stream-column.stream-critical {
      border-color: rgba(243, 18, 96, 0.3);
      background: #FFFDFD;
    }
    .stream-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
    .stream-title-wrap {
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .stream-title-wrap h2 {
      margin: 0;
      font-size: 1.05rem;
      font-weight: 700;
      letter-spacing: -0.02em;
    }
    .stream-subtitle {
      margin: 0;
      font-size: 0.8rem;
      color: var(--muted);
    }
    .stream-cards-list {
      display: flex;
      flex-direction: column;
      gap: 12px;
    }
    .stream-empty {
      padding: 40px 16px;
      text-align: center;
      display: flex;
      flex-direction: column;
      align-items: center;
      color: var(--muted);
    }
    .empty-icon {
      font-size: 2.2rem;
      margin-bottom: 8px;
    }

    /* MENTION CARDS */
    .deck-mention-card {
      padding: 16px;
      display: flex;
      flex-direction: column;
      gap: 12px;
      animation: fadeIn 0.3s ease both;
    }
    @keyframes fadeIn {
      from { opacity: 0; transform: translateY(6px); }
      to { opacity: 1; transform: translateY(0); }
    }
    .deck-mention-card.is-critical {
      border-left: 4px solid var(--heroui-danger);
    }
    .deck-mention-card.starred {
      border-left: 4px solid var(--heroui-warning);
    }
    .card-top-row {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 10px;
    }
    .author-info {
      display: flex;
      align-items: center;
      gap: 10px;
    }
    .avatar-letter {
      width: 34px;
      height: 34px;
      border-radius: var(--radius-full);
      background: var(--line-subtle);
      border: 1px solid var(--line);
      display: flex;
      align-items: center;
      justify-content: center;
      font-weight: 700;
      font-size: 0.88rem;
      color: var(--heroui-primary);
    }
    .author-names {
      display: flex;
      flex-direction: column;
    }
    .author-name {
      font-size: 0.88rem;
      color: var(--ink);
    }
    .author-handle {
      font-size: 0.74rem;
      color: var(--muted);
    }
    .card-top-badges {
      display: flex;
      align-items: center;
      gap: 6px;
      flex-wrap: wrap;
    }
    .card-time {
      font-size: 0.74rem;
    }
    .card-body-text p {
      margin: 0;
      font-size: 0.92rem;
      line-height: 1.55;
      word-break: break-word;
    }
    .card-note-box {
      background: var(--heroui-warning-50);
      border-left: 3px solid var(--heroui-warning);
      padding: 8px 12px;
      border-radius: 6px;
      font-size: 0.82rem;
      color: var(--ink-soft);
    }
    .card-meta-row {
      display: flex;
      align-items: center;
      gap: 10px;
      flex-wrap: wrap;
      font-size: 0.78rem;
      padding-top: 4px;
      border-top: 1px dashed var(--line);
    }
    .card-actions-bar {
      display: flex;
      align-items: center;
      justify-content: space-between;
      flex-wrap: wrap;
      gap: 8px;
      padding-top: 4px;
    }
    .heroui-btn-group {
      display: inline-flex;
      border-radius: var(--radius-md);
      overflow: hidden;
      border: 1px solid var(--line);
    }
    .queue-btn-form { display: inline; }
    .btn-q {
      background: #ffffff;
      border: 0;
      border-right: 1px solid var(--line);
      padding: 5px 10px;
      font-size: 0.76rem;
      color: var(--muted);
      cursor: pointer;
      transition: all 0.15s ease;
    }
    .btn-q:last-child { border-right: 0; }
    .btn-q:hover { background: var(--line-subtle); color: var(--ink); }
    .btn-q.active {
      background: var(--heroui-primary);
      color: #ffffff;
      font-weight: 600;
    }
    .util-btns {
      display: flex;
      gap: 4px;
    }
    .btn-icon {
      background: transparent;
      border: 1px solid var(--line);
      border-radius: var(--radius-md);
      width: 28px;
      height: 28px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      cursor: pointer;
      font-size: 0.85rem;
      transition: all 0.15s ease;
    }
    .btn-icon:hover {
      background: var(--line-subtle);
      border-color: #d4d4d8;
    }
    .inline-forms {
      display: flex;
      align-items: center;
      gap: 6px;
      flex-wrap: wrap;
    }
    .inline-form {
      display: inline-flex;
      align-items: center;
      gap: 4px;
    }
    .card-note-form {
      display: flex;
      gap: 6px;
      margin-top: 2px;
    }

    /* BRIEF PAGE */
    .ai-brief-card {
      padding: 24px;
      background: linear-gradient(180deg, #FFFFFF 0%, #F9FAFB 100%);
    }
    .ai-brief-head {
      margin-bottom: 16px;
    }
    .ai-brief-head h2 {
      margin: 8px 0 0;
      font-size: 1.25rem;
      font-weight: 700;
    }
    .ai-brief-content {
      font-size: 0.95rem;
      line-height: 1.65;
      color: var(--ink-soft);
    }
    .brief-columns-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(min(320px, 100%), 1fr));
      gap: 20px;
    }
    .brief-col {
      padding: 20px;
    }
    .brief-col h3 {
      margin: 0 0 14px;
      font-size: 1rem;
      font-weight: 700;
    }
    .brief-list {
      list-style: none;
      padding: 0;
      margin: 0;
      display: flex;
      flex-direction: column;
      gap: 10px;
    }
    .brief-item {
      padding: 12px;
      display: flex;
      flex-direction: column;
      gap: 6px;
    }
    .brief-item p {
      margin: 0;
      font-size: 0.86rem;
      line-height: 1.45;
    }
    .brief-item.neg { border-left: 3px solid var(--heroui-danger); }
    .brief-item.starred { border-left: 3px solid var(--heroui-warning); }

    /* COMPARE PAGE */
    .compare-select-form {
      display: flex;
      gap: 16px;
      align-items: flex-end;
      flex-wrap: wrap;
    }
    .compare-select-form label {
      flex: 1;
      min-width: 200px;
    }
    .compare-legend {
      display: flex;
      gap: 20px;
      font-size: 0.88rem;
      margin-bottom: 16px;
    }
    .dot-legend {
      width: 10px;
      height: 10px;
      border-radius: 999px;
      display: inline-block;
      margin-right: 6px;
    }
    .dot-legend.left { background: var(--heroui-primary); }
    .dot-legend.right { background: var(--heroui-success); }
    .compare-chart-wrapper {
      display: flex;
      align-items: flex-end;
      gap: 12px;
      height: 180px;
      padding-top: 20px;
    }
    .compare-bar-col {
      flex: 1;
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 6px;
      height: 100%;
      justify-content: flex-end;
    }
    .compare-bars-pair {
      display: flex;
      gap: 4px;
      align-items: flex-end;
      width: 100%;
      height: 120px;
      justify-content: center;
    }
    .cbar {
      width: 14px;
      border-radius: 4px 4px 0 0;
      transition: height 0.3s ease;
    }
    .cbar.left-bar { background: var(--heroui-primary); }
    .cbar.right-bar { background: var(--heroui-success); }
    .cbar-date { font-size: 0.72rem; color: var(--muted); }
    .cbar-detail { font-size: 0.68rem; font-weight: 600; }

    /* HASHTAGS TABLE */
    .hashtag-table-wrapper {
      padding: 20px;
    }
    .hashtag-table-header {
      margin-bottom: 16px;
    }
    .hashtag-table-header h3 {
      margin: 0;
      font-size: 1.1rem;
      font-weight: 700;
    }
    .table-responsive {
      overflow-x: auto;
    }
    .hashtag-table {
      width: 100%;
      border-collapse: collapse;
      font-size: 0.88rem;
    }
    .hashtag-table th {
      text-align: left;
      padding: 10px 12px;
      border-bottom: 1px solid var(--line);
      color: var(--muted);
      font-weight: 600;
      font-size: 0.76rem;
      text-transform: uppercase;
      letter-spacing: 0.04em;
    }
    .hashtag-table td {
      padding: 12px;
      border-bottom: 1px solid var(--line-subtle);
      vertical-align: middle;
    }
    .hashtag-link-badge {
      font-weight: 700;
      font-size: 0.95rem;
    }
    .hash-symbol {
      color: var(--heroui-primary);
      margin-right: 2px;
    }
    .mini-feelbar-wrap {
      display: flex;
      flex-direction: column;
      gap: 4px;
    }
    .mini-feelbar-track {
      height: 6px;
      background: var(--line-subtle);
      border-radius: var(--radius-full);
      overflow: hidden;
      display: flex;
    }
    .mini-bar-pos { background: var(--heroui-success); }
    .mini-bar-neg { background: var(--heroui-danger); }
    .mini-bar-neu { background: #A1A1AA; }
    .mini-feelbar-labels {
      display: flex;
      justify-content: space-between;
      font-size: 0.68rem;
      color: var(--muted);
    }
    .hashtag-action-btns {
      display: flex;
      gap: 6px;
    }

    /* SETTINGS PAGE */
    .settings-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(min(340px, 100%), 1fr));
      gap: 20px;
      margin-bottom: 24px;
    }
    .settings-card {
      padding: 20px;
      display: flex;
      flex-direction: column;
      gap: 14px;
    }
    .settings-card-head {
      display: flex;
      align-items: center;
      gap: 12px;
      padding-bottom: 12px;
      border-bottom: 1px solid var(--line);
    }
    .platform-icon {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 42px;
      height: 42px;
      border-radius: var(--radius-md);
      background: var(--heroui-primary-50);
      color: var(--heroui-primary);
      flex-shrink: 0;
    }

    /* SVG VECTOR ICONS (HEROUI / LUCIDE STYLE) */
    .ui-icon {
      display: inline-block;
      vertical-align: -0.16em;
      flex-shrink: 0;
    }
    .btn .ui-icon, .nav-item .ui-icon, .heroui-chip .ui-icon {
      margin-right: 5px;
    }
    .btn-icon .ui-icon {
      margin: 0;
    }
    .stat-dot {
      display: inline-block;
      width: 7px;
      height: 7px;
      border-radius: 999px;
      margin-right: 5px;
      vertical-align: middle;
    }
    .stat-dot.pos { background: var(--heroui-success); }
    .stat-dot.neg { background: var(--heroui-danger); }
    .stat-dot.neu { background: #a1a1aa; }

    .stats-item {
      display: inline-flex;
      align-items: center;
      gap: 3px;
    }
    .stats-item .ui-icon {
      vertical-align: middle;
    }
    .settings-card-head h3 {
      margin: 0;
      font-size: 1.05rem;
      font-weight: 700;
    }
    .hint {
      margin: 2px 0 0;
      font-size: 0.78rem;
      color: var(--muted);
    }
    .settings-footer-actions {
      display: flex;
      align-items: center;
      gap: 16px;
      padding: 20px;
      background: var(--paper);
      border: 1px solid var(--line);
      border-radius: var(--radius-lg);
      box-shadow: var(--shadow-sm);
    }

    /* LOGIN PAGE */
    .login-wrapper {
      min-height: 80dvh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 20px;
    }
    .login-card {
      width: 100%;
      max-width: 420px;
      padding: 32px;
      display: flex;
      flex-direction: column;
      gap: 24px;
    }
    .deck-brand h1 {
      margin: 8px 0 4px;
      font-size: 1.8rem;
      font-weight: 800;
      letter-spacing: -0.03em;
    }
    .deck-subtitle {
      margin: 0;
      font-size: 0.88rem;
      color: var(--muted);
    }
    .brand-badge-row {
      display: flex;
      gap: 6px;
    }

    /* UTILITY HELPERS */
    .text-muted { color: var(--muted); }
    .text-danger { color: var(--heroui-danger); }
    .text-success { color: var(--heroui-success); }
    .text-center { text-align: center; }

    /* ===== RESPONSIVE & POLISH ===== */
    .deck-alert { display: block; line-height: 1.5; }
    .deck-alert > svg { vertical-align: -3px; margin-right: 6px; }
    .deck-alert:has(.alert-lines) { display: flex; align-items: flex-start; gap: 8px; }
    .deck-alert:has(.alert-lines) > svg { margin: 2px 0 0; flex: none; }
    .alert-lines { display: grid; gap: 4px; }
    .deck-alert a { color: inherit; font-weight: 600; text-decoration: underline; }
    .deck-alert code, .hint code { word-break: break-all; white-space: normal; }

    .executive-radar { grid-template-columns: repeat(auto-fit, minmax(min(360px, 100%), 1fr)); }
    .deck-admin-grid { grid-template-columns: repeat(auto-fit, minmax(min(460px, 100%), 1fr)); }
    .heroui-card, .deck-card, .mention-card { min-width: 0; }

    .card-more { margin-top: 10px; border-top: 1px dashed var(--border, #e4e4e7); padding-top: 8px; }
    .card-more > summary {
      cursor: pointer; list-style: none; display: inline-flex; align-items: center; gap: 6px;
      font-size: 0.78rem; color: var(--muted); user-select: none;
    }
    .card-more > summary::-webkit-details-marker { display: none; }
    .card-more > summary::after { content: "▾"; font-size: 0.7rem; transition: transform .15s; }
    .card-more[open] > summary::after { transform: rotate(180deg); }
    .card-more[open] > summary { margin-bottom: 8px; }

    .ribbon-filter-bar .heroui-select, .ribbon-filter-bar select { width: auto; min-width: 140px; max-width: 100%; }

    @media (max-width: 900px) {
      .deck-top-navbar { height: auto; }
      .navbar-container { flex-wrap: wrap; height: auto; padding-top: 10px; padding-bottom: 0; row-gap: 6px; }
      .navbar-nav {
        order: 3; flex: 1 0 100%; overflow-x: auto; flex-wrap: nowrap; scrollbar-width: none;
        -webkit-overflow-scrolling: touch; padding-bottom: 6px;
      }
      .navbar-nav::-webkit-scrollbar { display: none; }
      .navbar-nav a { white-space: nowrap; flex: none; }
      .navbar-actions { margin-left: auto; }
    }
    @media (max-width: 640px) {
      .kpi-grid { grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 8px; }
      .ribbon-filter-bar .heroui-select, .ribbon-filter-bar select,
      .search-input, .tag-input, .assignee-input, .likes-input { width: 100%; min-width: 0; flex: 1 1 140px; }
      .filter-group { width: 100%; }
      .navbar-actions .btn { padding-left: 10px; padding-right: 10px; }
      .brand-badge { display: none; }
      .navbar-actions .btn-label { display: none; }
      .card-top-row { flex-wrap: wrap; row-gap: 8px; }
      .card-top-badges { flex: 1 0 100%; flex-direction: row; flex-wrap: wrap; justify-content: flex-start; align-items: center; gap: 6px; }
      .card-time { margin-left: auto; }
      .ribbon-tabs { flex-wrap: nowrap; overflow-x: auto; max-width: 100%; scrollbar-width: none; border-radius: 999px; }
      .ribbon-tabs::-webkit-scrollbar { display: none; }
      .ribbon-tabs > * { flex: none; white-space: nowrap; }
      .navbar-container { flex-wrap: wrap; }
      .navbar-brand { min-width: 0; }
      .navbar-actions { gap: 6px; }
    }`;

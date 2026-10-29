/* icons.js — one shared icon set (Lucide-style 24px strokes) for every page.
   Injects a single <svg> sprite, then exposes window.icon(name, className). */
(function () {
  const P = {
    /* brand mark — an S monogram drawn as one continuous stroke */
    logo: '<path d="M16.8 7.3c0-2.1-2.1-3.4-4.8-3.4S7.2 5.2 7.2 7.3c0 4.7 9.6 3.6 9.6 8.3 0 2.1-2.1 3.4-4.8 3.4s-4.8-1.3-4.8-3.4" stroke-width="2"/>',
    /* app + navigation */
    activity: '<path d="M3 13h4l2.5 6L14 5l2.5 8H21"/>',
    receipt: '<path d="M5 3.5h14v16.2a.8.8 0 0 1-1.2.7L15 19l-2.6 1.6a.8.8 0 0 1-.8 0L9 19l-2.8 1.4a.8.8 0 0 1-1.2-.7z"/><path d="M9 8h6M9 12h6"/>',
    target: '<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="4.5"/><circle cx="12" cy="12" r=".9" fill="currentColor" stroke="none"/>',
    repeat: '<path d="M17 3.5 20 6.5l-3 3"/><path d="M20 6.5H8A4 4 0 0 0 4 10.5v1"/><path d="M7 20.5 4 17.5l3-3"/><path d="M4 17.5h12a4 4 0 0 0 4-4v-1"/>',
    users: '<circle cx="9.5" cy="8" r="3.4"/><path d="M3 20c.6-3.4 3.3-5.3 6.5-5.3S15.4 16.6 16 20"/><path d="M16.5 5.2a3.4 3.4 0 0 1 0 6.6"/><path d="M18 14.9c2.1.6 3.5 2.3 3.9 5.1"/>',
    wallet: '<path d="M3.5 8.5A2.5 2.5 0 0 1 6 6h11.5A2.5 2.5 0 0 1 20 8.5v8A2.5 2.5 0 0 1 17.5 19H6a2.5 2.5 0 0 1-2.5-2.5z"/><path d="M3.5 10.5h5a2 2 0 0 0 0 4h-5"/><path d="M16 6V4.6a1.4 1.4 0 0 0-1.8-1.3L5.4 5.7"/>',
    calendar: '<rect x="3.5" y="5" width="17" height="15.5" rx="2.5"/><path d="M3.5 10h17M8 3.5v3M16 3.5v3"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    download: '<path d="M12 3.5v11M7.5 10.5 12 15l4.5-4.5M4.5 19.5h15"/>',
    search: '<circle cx="10.8" cy="10.8" r="6.3"/><path d="m15.5 15.5 4 4"/>',
    trash: '<path d="M4.5 7h15M9.5 7V4.8h5V7M6.5 7l.8 12.2a1.5 1.5 0 0 0 1.5 1.3h6.4a1.5 1.5 0 0 0 1.5-1.3L17.5 7M10 11v6M14 11v6"/>',
    x: '<path d="M6 6l12 12M18 6 6 18"/>',
    menu: '<path d="M4 7h16M4 12h16M4 17h16"/>',
    'alert-triangle': '<path d="M12 4.5 21 19.5H3z"/><path d="M12 10v4M12 16.8v.2"/>',
    'alert-circle': '<circle cx="12" cy="12" r="8.5"/><path d="M12 8v4.5M12 16.2v.2"/>',
    'check-circle': '<circle cx="12" cy="12" r="8.5"/><path d="m8.5 12 2.5 2.5 4.5-5"/>',
    zap: '<path d="M13 3 5 13.5h5.5L10 21l8-10.5h-5.5z"/>',
    'trending-up': '<path d="M4 16.5l5-5 3.5 3.5L20 7"/><path d="M14.5 7H20v5.5"/>',
    'arrow-right': '<path d="M5 12h13M13 7l5 5-5 5"/>',
    'arrow-up-right': '<path d="M7 17 17 7M8.5 7H17v8.5"/>',
    check: '<path d="M5 12.5 9.5 17 19 7.5"/>',
    sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2.5v2.2M12 19.3v2.2M4.2 4.2l1.6 1.6M18.2 18.2l1.6 1.6M2.5 12h2.2M19.3 12h2.2M4.2 19.8l1.6-1.6M18.2 5.8l1.6-1.6"/>',
    moon: '<path d="M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5z"/>',
    'piggy-bank': '<path d="M3.5 12.5A5.5 5.5 0 0 1 9 7h4.5a5.5 5.5 0 0 1 5.5 5.5v1A4.5 4.5 0 0 1 14.5 18H8a4.5 4.5 0 0 1-4.5-4.5z"/><path d="M6 18v2M16 18v2M19 11h1.5M14 11v.2"/>',
    split: '<path d="M4 9h13l-3.5-3.5M20 15H7l3.5 3.5"/>',
    user: '<circle cx="12" cy="8.5" r="3.8"/><path d="M4.5 20.5c.7-3.8 3.7-6 7.5-6s6.8 2.2 7.5 6"/>',
    'log-out': '<path d="M14.5 4.5h3A2 2 0 0 1 19.5 6.5v11a2 2 0 0 1-2 2h-3"/><path d="M10 8.5 6 12l4 3.5M6 12h9"/>',
    'chevron-down': '<path d="m6.5 9.5 5.5 5.5 5.5-5.5"/>',
    eye: '<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="3.2"/>',
    'eye-off': '<path d="M10.6 6.2A8.9 8.9 0 0 1 12 6c6 0 9.5 6 9.5 6a16 16 0 0 1-3.2 3.9M6.4 7.8A15.6 15.6 0 0 0 2.5 12S6 18 12 18a9.3 9.3 0 0 0 3.6-.7"/><path d="M10 10a2.8 2.8 0 0 0 4 4M3.5 3.5l17 17"/>',
    lock: '<rect x="4.5" y="10.5" width="15" height="10" rx="2.5"/><path d="M8 10.5V8a4 4 0 0 1 8 0v2.5"/>',
    mail: '<rect x="3" y="5.5" width="18" height="13" rx="2.5"/><path d="m3.6 7 7.4 5.4a1.7 1.7 0 0 0 2 0L20.4 7"/>',
    'shield-check': '<path d="M12 3.2 19.5 6v6c0 4.3-3 7.7-7.5 9-4.5-1.3-7.5-4.7-7.5-9V6z"/><path d="m9 12 2.2 2.2L15.5 10"/>',
    sparkles: '<path d="m12 4 1.6 4.4L18 10l-4.4 1.6L12 16l-1.6-4.4L6 10l4.4-1.6z"/><path d="M18.5 15.5 19.2 17.3 21 18l-1.8.7-.7 1.8-.7-1.8L16 18l1.8-.7z"/>',
    'pie-chart': '<path d="M12 3.5v8.5h8.5A8.5 8.5 0 1 0 12 3.5z"/><path d="M15.5 3.9A8.5 8.5 0 0 1 20.1 8.5"/>',
    'bar-chart': '<path d="M4.5 20V13M9.5 20V7M14.5 20v-9M19.5 20V4"/>',
    bell: '<path d="M18 9a6 6 0 1 0-12 0c0 5-2 6.5-2 6.5h16S18 14 18 9z"/><path d="M10.3 19a2 2 0 0 0 3.4 0"/>',
    settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 14.5a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-2.7 1.1v.3a2 2 0 1 1-4 0v-.2a1.6 1.6 0 0 0-2.8-1.1l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.6 1.6 0 0 0-1.1-2.7H3.3a2 2 0 1 1 0-4h.2a1.6 1.6 0 0 0 1.1-2.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.6 1.6 0 0 0 2.7-1.1V3.3a2 2 0 1 1 4 0v.2a1.6 1.6 0 0 0 2.8 1.1l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0 1.1 2.7h.3a2 2 0 1 1 0 4h-.2a1.6 1.6 0 0 0-1.5 1.1z"/>',
    'layout-grid': '<rect x="3.5" y="3.5" width="7" height="7" rx="2"/><rect x="13.5" y="3.5" width="7" height="7" rx="2"/><rect x="3.5" y="13.5" width="7" height="7" rx="2"/><rect x="13.5" y="13.5" width="7" height="7" rx="2"/>',
    /* category icons */
    utensils: '<path d="M6 3v7a2.5 2.5 0 0 0 5 0V3M8.5 10v11M16.5 3c-1.4 1-2.2 2.8-2.2 5.2 0 1.8.8 2.8 2.2 3v9.8"/>',
    bus: '<rect x="4" y="4" width="16" height="13" rx="2.5"/><path d="M4 11h16M8 4v7M16 4v7M7.5 20.5v-3.5M16.5 20.5v-3.5"/><path d="M8 14h.2M16 14h.2"/>',
    'shopping-cart': '<circle cx="9.5" cy="19.5" r="1.3"/><circle cx="17" cy="19.5" r="1.3"/><path d="M2.5 3.5h2.3l2.5 11.3h11l2.2-8.3H6"/>',
    film: '<rect x="3" y="4.5" width="18" height="15" rx="2.5"/><path d="M3 9.5h18M3 14.5h18M8 4.5v15M16 4.5v15"/>',
    book: '<path d="M4.5 4.5A1.5 1.5 0 0 1 6 3h12.5v18H6a1.5 1.5 0 0 1-1.5-1.5z"/><path d="M4.5 16.5h14"/>',
    'shopping-bag': '<path d="M5 7.5h14l-1 12.5a1.5 1.5 0 0 1-1.5 1.4H7.5A1.5 1.5 0 0 1 6 20z"/><path d="M8.5 10V6.5a3.5 3.5 0 0 1 7 0V10"/>',
    lightbulb: '<path d="M9.5 18h5M10 21h4"/><path d="M12 3a6 6 0 0 0-3.5 10.9c.6.5 1 1.3 1 2.1h5c0-.8.4-1.6 1-2.1A6 6 0 0 0 12 3z"/>',
    package: '<path d="M20.5 7.8 12 3.4 3.5 7.8v8.4L12 20.6l8.5-4.4z"/><path d="m3.6 7.7 8.4 4.4 8.4-4.4M12 12.1v8.5"/>',
    coffee: '<path d="M4 8h13v6.5a4.5 4.5 0 0 1-9 0V8z"/><path d="M17 9.5h1.8a2.3 2.3 0 0 1 0 4.5H17"/><path d="M3.5 21h14"/>',
    music: '<circle cx="7" cy="17.5" r="2.8"/><circle cx="18" cy="15.5" r="2.8"/><path d="M9.8 17.5V6.5l11-2v11"/>',
    smartphone: '<rect x="6.5" y="2.5" width="11" height="19" rx="2.5"/><path d="M11 18.5h2"/>',
    home: '<path d="m3.5 10.5 8.5-7 8.5 7V19a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z"/><path d="M9.5 21v-6.5h5V21"/>',
    dumbbell: '<path d="M4 9v6M7 7v10M17 7v10M20 9v6M7 12h10"/>',
    'heart-pulse': '<path d="M12 20.5S3.5 15.3 3.5 9.4a4.6 4.6 0 0 1 8.5-2.5 4.6 4.6 0 0 1 8.5 2.5c0 5.9-8.5 11.1-8.5 11.1z"/><path d="M4 11.5h3.5l1.5-2.5 2 5 1.5-3h4"/>',
    gift: '<rect x="3.5" y="8.5" width="17" height="4" rx="1"/><path d="M5 12.5v7a1.5 1.5 0 0 0 1.5 1.5h11a1.5 1.5 0 0 0 1.5-1.5v-7M12 8.5V21"/><path d="M12 8.5S11 3.5 8.5 3.5a2.2 2.2 0 0 0 0 5zM12 8.5s1-5 3.5-5a2.2 2.2 0 0 1 0 5z"/>',
    plane: '<path d="M10.5 3.5a1.5 1.5 0 0 1 3 0V9l7 4v2.5l-7-2v4l2 1.8v1.7l-3.5-1-3.5 1v-1.7l2-1.8v-4l-7 2V13l7-4z"/>',
  };

  const sprite = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  sprite.setAttribute('aria-hidden', 'true');
  sprite.setAttribute('width', '0');
  sprite.setAttribute('height', '0');
  sprite.style.position = 'absolute';
  sprite.innerHTML = Object.entries(P).map(([name, body]) =>
    `<symbol id="i-${name}" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${body}</symbol>`).join('');
  document.documentElement.appendChild(sprite);

  window.ICON_NAMES = Object.keys(P);
  window.CATEGORY_ICONS = ['utensils', 'coffee', 'bus', 'shopping-cart', 'shopping-bag', 'film', 'music',
    'book', 'lightbulb', 'smartphone', 'home', 'dumbbell', 'heart-pulse', 'gift', 'plane', 'package'];
  window.icon = (name, cls = 'ico') =>
    `<svg class="${cls}" aria-hidden="true"><use href="#i-${P[name] ? name : 'package'}"/></svg>`;
})();

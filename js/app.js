/* js/app.js
   TUNZZA — Core client logic (Step 5)
   - Loads events.json (/events.json) with shape { "events": { "slug": { ... } } }
   - Falls back to INLINE_EVENTS when events.json cannot be fetched (local dev)
   - Uses ?e=slug or path /slug to select event
   - Feature toggles: showGifts, showMoments
   - Gift flow: copy number -> show toast -> open dialer / USSD (safe # encoding)
   - Moments flow: open uploadLink in new tab (Dropbox File Request recommended)
   - Optional Filestack picker commented for later
*/

/* -----------------------
   Inline fallback events
   ----------------------- */
const INLINE_EVENTS = {
  "demo": {
    "name": "TUNZZA Demo Event",
    "showGifts": true,
    "showMoments": true,
    "lipaNumber": "123456",
    "ussd": "*150*00#",
    "uploadLink": "https://www.dropbox.com/request/demo"
  },

  "wedding-john-mary": {
    "name": "John & Mary Wedding",
    "showGifts": true,
    "showMoments": true,
    "lipaNumber": "888777",
    "ussd": "*150*00#",
    "uploadLink": "https://www.dropbox.com/request/wedding"
  },

  "corporate-launch": {
    "name": "Brand Launch Night",
    "showGifts": false,
    "showMoments": true,
    "uploadLink": "https://www.dropbox.com/request/brandlaunch"
  },

  "vip-dinner": {
    "name": "Private VIP Dinner",
    "showGifts": true,
    "showMoments": false,
    "lipaNumber": "555222",
    "ussd": "*150*00#"
  }
};

/* -----------------------
   Helpers
   ----------------------- */
function qs(key) {
  return new URLSearchParams(location.search).get(key);
}

function getSlugFromPath() {
  const parts = location.pathname.split('/').filter(Boolean);
  return parts.length ? parts[0] : null;
}

function safeText(elem, text) {
  if (!elem) return;
  elem.textContent = text ?? '';
}

/* small toast helper */
function showToast(message = 'Done', ms = 1600) {
  if (document.getElementById('tunzza-toast')) return;
  const el = document.createElement('div');
  el.id = 'tunzza-toast';
  el.textContent = message;
  Object.assign(el.style, {
    position: 'fixed',
    left: '50%',
    bottom: '28px',
    transform: 'translateX(-50%)',
    background: 'rgba(20,20,20,0.96)',
    color: '#fff',
    padding: '8px 14px',
    borderRadius: '999px',
    border: '1px solid rgba(212,175,55,0.12)',
    fontSize: '13px',
    zIndex: 9999,
    boxShadow: '0 8px 30px rgba(0,0,0,0.6)'
  });
  document.body.appendChild(el);
  setTimeout(() => (el.style.opacity = '0'), ms);
  setTimeout(() => el.remove(), ms + 300);
}

/* copy to clipboard with fallback */
async function copyToClipboard(text) {
  if (!text) return false;
  if (navigator.clipboard && navigator.clipboard.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch (e) {
      // fallback to execCommand
    }
  }
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.left = '-9999px';
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    ta.remove();
    return true;
  } catch (e) {
    return false;
  }
}

/* encode '#' in USSD so URL doesn't break */
function ussdEncode(ussd) {
  if (!ussd) return ussd;
  return ussd.replace(/#/g, '%23');
}

/* open tel: link with fallback anchor click to improve compatibility */
function openTelLink(href) {
  try {
    window.location.href = href;
    setTimeout(() => {
      const a = document.createElement('a');
      a.href = href;
      a.rel = 'noopener';
      document.body.appendChild(a);
      a.click();
      a.remove();
    }, 250);
  } catch (e) {
    console.warn('Could not open tel: link', e);
  }
}

/* try to fetch events.json from server root, otherwise return inline */
async function loadEventsJson() {
  // If running as file:// (local), skip fetch and use inline (file protocol blocks fetch)
  if (location.protocol === 'file:') {
    console.warn('Running from file:// — using inline events.json');
    return { events: INLINE_EVENTS };
  }

  try {
    const res = await fetch('/events.json', { cache: 'no-store' });
    if (!res.ok) throw new Error('events.json not found');
    const json = await res.json();
    // allow both shapes: { events: {...} } or top-level slug object
    if (json && json.events) return json;
    // if someone provided a plain object of slugs
    return { events: json };
  } catch (e) {
    console.warn('Could not load /events.json — falling back to inline EVENTS', e);
    return { events: INLINE_EVENTS };
  }
}

/* -----------------------
   Main init
   ----------------------- */
async function init() {
  const root = await loadEventsJson();
  const events = root.events || INLINE_EVENTS;

  // determine slug: ?e=slug or path /slug; fallback to "demo"
  const slug = (qs('e') || getSlugFromPath() || 'demo');
  const cfg = (events[slug]) ? events[slug] : (events['demo'] || Object.values(events)[0]);

  // DOM references (IDs from index.html)
  const titleEl = document.getElementById('event-title');
  const lipaEl = document.getElementById('lipaNumber');
  const giftBtn = document.getElementById('giftBtn');
  const momentBtn = document.getElementById('momentBtn');
  const footNote = document.getElementById('footNote');

  // Render basic info
  safeText(titleEl, cfg.name || cfg.title || 'TUNZZA');
  safeText(lipaEl, cfg.lipaNumber ?? '--');

  // Apply feature toggles
  if (!cfg.showGifts) {
    if (giftBtn) giftBtn.style.display = 'none';
  } else {
    if (giftBtn) giftBtn.style.display = '';
  }

  if (!cfg.showMoments) {
    if (momentBtn) momentBtn.style.display = 'none';
  } else {
    if (momentBtn) momentBtn.style.display = '';
  }

  // If neither feature is enabled, show a helpful note
  if (!cfg.showGifts && !cfg.showMoments) {
    if (footNote) footNote.textContent = 'This event has no active features. Contact the host for more info.';
  } else {
    if (footNote) footNote.textContent = 'No app required — upload anonymously or pay via your phone.';
  }

  /* Gift button behavior: copy number + open dialer */
  if (giftBtn) {
    giftBtn.addEventListener('click', async () => {
      const number = cfg.lipaNumber;
      const ussd = cfg.ussd;

      if (!number && !ussd) {
        alert('No payment number configured for this event.');
        return;
      }

      // Copy lipa number to clipboard if available
      if (number) {
        const copied = await copyToClipboard(number);
        if (copied) showToast('Number copied ✔');
        else alert('Could not copy number — please long-press the number to copy manually.');
      }

      // If USSD provided, open dialer with USSD encoded; otherwise open tel:number
      if (ussd) {
        const safe = ussdEncode(ussd);
        openTelLink(`tel:${safe}`);
      } else if (number) {
        openTelLink(`tel:${number}`);
      }

      // simple analytics hook
      console.log('tunzza:event:gift_clicked', { slug, title: cfg.name || cfg.title });
    });
  }

  /* Moment button behavior: open upload link (Dropbox File Request or other) */
  if (momentBtn) {
    momentBtn.addEventListener('click', async () => {
      const upload = cfg.uploadLink;
      const filestackKey = cfg.filestackKey || null; // optionally support filestack later

      // If Filestack key present and you'd like to use in-page picker, you can implement here.
      // For now we prefer the simple redirect to anonymous upload link (Dropbox File Request).
      if (filestackKey) {
        // Optional: dynamic Filestack integration (commented)
        // await loadFilestackAndOpen(filestackKey);
        // return;
      }

      if (upload) {
        window.open(upload, '_blank', 'noopener');
      } else {
        alert('No upload destination configured for this event.');
      }

      // analytics hook
      console.log('tunzza:event:moment_clicked', { slug, title: cfg.name || cfg.title });
    });
  }

  // Accessibility: focus first visible action
  setTimeout(() => {
    try {
      if (giftBtn && giftBtn.offsetParent !== null) giftBtn.focus();
      else if (momentBtn && momentBtn.offsetParent !== null) momentBtn.focus();
    } catch (e) { /* ignore */ }
  }, 150);
}

/* Start on DOM ready */
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}

/* -----------------------
   Notes for you (junior-friendly)
   -----------------------
 - Save this file as js/app.js
 - Put events.json at the project root (next to index.html). Example shape:
   {
     "events": {
       "demo": { "name":"...", "showGifts":true, "showMoments":true, ... },
       "wedding-john-mary": { ... }
     }
   }
 - Test locally with Live Server extension in VS Code (avoids file:// fetch issues)
 - To preview a specific event:
     http://localhost:5500/?e=wedding-john-mary
   or
     http://localhost:5500/wedding-john-mary
 - To add more fields later (e.g., filestackKey or gallery config) just extend the event object.
 - When you deploy to Netlify, upload events.json with the same shape to the site root.
*/
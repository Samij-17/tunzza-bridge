/* js/app.js
   TUNZZA — Core client logic (Firestore + Filestack)
   - Firestore-first events loader (collection "events")
   - Falls back to /events.json and INLINE_EVENTS
   - Gift: copy -> toast -> open dialer (USSD safe)
   - Moments: Filestack picker -> store metadata to Firestore (events/{slug}/uploads)
   - Optional small gallery render if #uploadsGallery exists
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

/* ====== FIREBASE CONFIG (your provided config) ======
   For Firebase JS SDK v7.20.0 and later, measurementId is optional
   Make sure admin.html uses the same config too.
*/
const FIREBASE_CONFIG = {
  apiKey: "AIzaSyAcyZWb7soqLZE2585Xc8gXypXklBezuRQ",
  authDomain: "tunzza-live.firebaseapp.com",
  projectId: "tunzza-live",
  storageBucket: "tunzza-live.firebasestorage.app",
  messagingSenderId: "1002471005700",
  appId: "1:1002471005700:web:39f66d78d7273506b79f51",
  measurementId: "G-37C3EB9VJX"
};
/* =================================================== */

/* -----------------------
   Helpers
   ----------------------- */
function qs(key) { return new URLSearchParams(location.search).get(key); }
function getSlugFromPath() { const parts = location.pathname.split('/').filter(Boolean); return parts.length ? parts[0] : null; }
function safeText(elem, text) { if (!elem) return; elem.textContent = text ?? ''; }

/* small toast helper */
function showToast(message = 'Done', ms = 1600) {
  if (document.getElementById('tunzza-toast')) return;
  const el = document.createElement('div');
  el.id = 'tunzza-toast';
  el.textContent = message;
  Object.assign(el.style, {
    position: 'fixed', left: '50%', bottom: '28px', transform: 'translateX(-50%)',
    background: 'rgba(20,20,20,0.96)', color: '#fff', padding: '8px 14px', borderRadius: '999px',
    border: '1px solid rgba(212,175,55,0.12)', fontSize: '13px', zIndex: 9999, boxShadow: '0 8px 30px rgba(0,0,0,0.6)'
  });
  document.body.appendChild(el);
  setTimeout(()=> el.style.opacity = '0', ms);
  setTimeout(()=> el.remove(), ms + 300);
}

/* copy to clipboard with fallback */
async function copyToClipboard(text) {
  if (!text) return false;
  if (navigator.clipboard && navigator.clipboard.writeText) {
    try { await navigator.clipboard.writeText(text); return true; } catch (e) { /* fallback */ }
  }
  try {
    const ta = document.createElement('textarea'); ta.value = text; ta.style.position = 'fixed'; ta.style.left = '-9999px';
    document.body.appendChild(ta); ta.select(); document.execCommand('copy'); ta.remove(); return true;
  } catch (e) { return false; }
}

/* encode '#' in USSD so URL doesn't break */
function ussdEncode(ussd) { if (!ussd) return ussd; return ussd.replace(/#/g, '%23'); }

/* open tel: link with fallback anchor click to improve compatibility */
function openTelLink(href) {
  try {
    window.location.href = href;
    setTimeout(()=>{
      const a = document.createElement('a'); a.href = href; a.rel = 'noopener'; document.body.appendChild(a); a.click(); a.remove();
    }, 250);
  } catch (e) { console.warn('Could not open tel: link', e); }
}

/* show small debug box with available slugs */
function showAvailableSlugs(slugs) {
  try {
    let el = document.getElementById('debug-available-slugs');
    if (!el) {
      el = document.createElement('div');
      el.id = 'debug-available-slugs';
      el.style.cssText = 'position:fixed;left:12px;bottom:12px;background:rgba(0,0,0,0.6);color:#fff;padding:10px;border-radius:8px;font-size:12px;z-index:99999;max-width:260px;backdrop-filter:blur(3px)';
      document.body.appendChild(el);
    }
    el.innerText = 'Available slugs:\n' + (slugs && slugs.length ? slugs.join('\n') : '(none)');
  } catch(e){ /* ignore */ }
}

/* -----------------------
   Lazy loaders: Firebase + Filestack
   ----------------------- */
async function ensureFirebaseLoaded() {
  if (window.firebase && window.firebase.firestore) return;
  await new Promise((resolve, reject) => {
    const s1 = document.createElement('script');
    s1.src = 'https://www.gstatic.com/firebasejs/9.23.0/firebase-app-compat.js';
    s1.onload = () => {
      const s2 = document.createElement('script');
      s2.src = 'https://www.gstatic.com/firebasejs/9.23.0/firebase-firestore-compat.js';
      s2.onload = resolve;
      s2.onerror = reject;
      document.head.appendChild(s2);
    };
    s1.onerror = reject;
    document.head.appendChild(s1);
  });
}

async function ensureFilestackLoaded() {
  if (window.filestack) return;
  await new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://static.filestackapi.com/filestack-js/4.x.x/filestack.min.js';
    s.onload = resolve;
    s.onerror = reject;
    document.head.appendChild(s);
  });
}

/* -----------------------
   Filestack picker + client-side Firestore write
   (writes metadata to events/{slug}/uploads/{handle})
   ----------------------- */
async function openFilestackPickerForEvent(eventCfg, slug) {
  const key = eventCfg.filestackKey || null;
  if (!key) {
    alert('Filestack not configured for this event.');
    return false;
  }

  try {
    await ensureFilestackLoaded();
  } catch (e) {
    console.error('Could not load Filestack script', e);
    alert('Upload service unavailable. Try the upload link instead.');
    return false;
  }

  try {
    const client = filestack.init(key);

    const picker = client.picker({
      accept: ['image/*','video/*'],
      maxFiles: 20,
      fromSources: ['local_file_system','camera'],
      camera: true,
      uploadInBackground: false,
      onUploadDone: async (res) => {
        // res.filesUploaded is an array
        showToast('Upload complete — thanks!');

        // attempt to write metadata to Firestore client-side if firebase is available
        try {
          if (FIREBASE_CONFIG && window.firebase) {
            if (!window.firebase.firestore) {
              await ensureFirebaseLoaded();
              if (!window.firebase.apps || !window.firebase.apps.length) firebase.initializeApp(FIREBASE_CONFIG);
            } else if (!window.firebase.apps || !window.firebase.apps.length) {
              firebase.initializeApp(FIREBASE_CONFIG);
            }

            const db = firebase.firestore();
            const batch = db.batch();
            res.filesUploaded.forEach(f => {
              const id = (f.handle) ? f.handle : (f.url ? f.url.split('/').pop() : String(Date.now()));
              const docRef = db.collection('events').doc(slug).collection('uploads').doc(id);
              batch.set(docRef, {
                filename: f.filename || null,
                url: f.url || null,
                handle: f.handle || null,
                mimetype: f.mimetype || f.mimetypes || null,
                size: f.size || null,
                createdAt: firebase.firestore.FieldValue.serverTimestamp(),
                source: 'filestack-client'
              }, { merge: true });
            });
            await batch.commit();
            console.log('Client wrote upload metadata to Firestore for', slug);
            // optional: refresh small gallery
            renderUploadsGallery(slug);
          }
        } catch (err) {
          console.warn('Could not write upload metadata client-side', err);
        }
      }
    });

    picker.open();
    return true;
  } catch (err) {
    console.error('Filestack picker error', err);
    alert('Could not start the camera/upload. Please try the upload link.');
    return false;
  }
}

/* -----------------------
   Small gallery renderer (optional)
   Place an element with id="uploadsGallery" in your HTML where you want thumbnails.
   ----------------------- */
async function renderUploadsGallery(slug) {
  if (!slug) return;
  const galleryEl = document.getElementById('uploadsGallery') || document.getElementById('gallery');
  if (!galleryEl) return; // not requested

  try {
    await ensureFirebaseLoaded();
    if (!window.firebase.apps || !window.firebase.apps.length) firebase.initializeApp(FIREBASE_CONFIG);
    const db = firebase.firestore();

    const snaps = await db.collection('events').doc(slug).collection('uploads').orderBy('createdAt','desc').limit(40).get();
    galleryEl.innerHTML = '';
    snaps.forEach(doc => {
      const d = doc.data();
      const thumb = document.createElement('a');
      thumb.href = d.url || '#';
      thumb.target = '_blank';
      thumb.rel = 'noopener';
      thumb.style.display = 'inline-block';
      thumb.style.margin = '6px';
      thumb.style.width = '72px';
      thumb.style.height = '72px';
      thumb.style.overflow = 'hidden';
      thumb.style.borderRadius = '8px';
      thumb.style.background = 'rgba(255,255,255,0.02)';
      thumb.style.border = '1px solid rgba(255,255,255,0.03)';
      thumb.title = d.filename || '';
      if (d.url && (d.mimetype || '').startsWith('image')) {
        const img = document.createElement('img');
        img.src = d.url;
        img.style.width = '100%';
        img.style.height = '100%';
        img.style.objectFit = 'cover';
        thumb.appendChild(img);
      } else {
        thumb.textContent = d.filename ? d.filename.slice(0,10) : 'file';
        thumb.style.padding = '8px';
        thumb.style.fontSize = '12px';
      }
      galleryEl.appendChild(thumb);
    });
  } catch (e) {
    console.warn('Could not render uploads gallery', e);
  }
}

/* -----------------------
   Firestore-aware loader (replaces simple /events.json fetch)
   - Tries Firestore events collection if FIREBASE_CONFIG present
   - Falls back to /events.json
   - Final fallback: INLINE_EVENTS
   - Shows debug list of available slugs
   ----------------------- */
async function loadEventsJson() {
  const requestedSlug = (qs('e') || getSlugFromPath() || 'demo');

  // 1) FIRESTORE path (if configured)
  if (FIREBASE_CONFIG && FIREBASE_CONFIG.apiKey) {
    try {
      await ensureFirebaseLoaded();
      if (!window.firebase.apps || !window.firebase.apps.length) firebase.initializeApp(FIREBASE_CONFIG);
      const db = firebase.firestore();

      const snapshot = await db.collection('events').get();
      const events = {};
      snapshot.forEach(doc => {
        const data = doc.data();
        if (typeof data.showGifts === 'string') data.showGifts = data.showGifts === 'true';
        if (typeof data.showMoments === 'string') data.showMoments = data.showMoments === 'true';
        events[doc.id] = data;
      });

      console.log('Firestore: loaded events keys ->', Object.keys(events));
      showAvailableSlugs(Object.keys(events));

      // if requested slug missing, try fetching single doc
      if (requestedSlug && !events[requestedSlug]) {
        try {
          const single = await db.collection('events').doc(requestedSlug).get();
          if (single.exists) {
            events[requestedSlug] = single.data();
            console.log('Firestore: fetched single missing doc ->', requestedSlug);
            showAvailableSlugs(Object.keys(events));
          } else {
            console.warn('Firestore: requested slug not found:', requestedSlug);
          }
        } catch (singleErr) {
          console.warn('Firestore single-doc fetch failed', singleErr);
        }
      }

      if (Object.keys(events).length) return { events };
      console.warn('Firestore `events` collection empty — falling back to events.json or inline.');
    } catch (fbErr) {
      console.warn('Firestore load failed, falling back to events.json. Error:', fbErr && fbErr.message);
      // continue to next fallback
    }
  } // end firestore try

  // 2) Try /events.json (if not running on file://)
  if (location.protocol !== 'file:') {
    try {
      const res = await fetch('/events.json', { cache: 'no-store' });
      if (res.ok) {
        const json = await res.json();
        const ev = json && json.events ? json.events : json;
        console.log('/events.json loaded keys ->', Object.keys(ev || {}));
        showAvailableSlugs(Object.keys(ev || {}));
        return { events: ev };
      } else {
        console.warn('/events.json fetch returned', res.status);
      }
    } catch (e) {
      console.warn('Could not fetch /events.json (continuing to inline fallback)', e);
    }
  } else {
    console.warn('Running from file:// — skipping /events.json fetch');
  }

  // 3) Final fallback to inline events defined in file
  console.log('Using INLINE_EVENTS keys ->', Object.keys(INLINE_EVENTS));
  showAvailableSlugs(Object.keys(INLINE_EVENTS));
  return { events: INLINE_EVENTS };
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

  // Apply theme color or hero if present (apply to CSS variable --gold or card background if present)
  try {
    if (cfg.themeColor) document.documentElement.style.setProperty('--gold', cfg.themeColor);
    if (cfg.hero) {
      const card = document.querySelector('.card');
      if (card) {
        card.style.backgroundImage = `linear-gradient(180deg, rgba(0,0,0,0.45), rgba(0,0,0,0.25)), url('${cfg.hero}')`;
        card.style.backgroundSize = 'cover'; card.style.backgroundPosition = 'center';
      }
    }
  } catch(e) { /* ignore */ }

  // Apply feature toggles
  if (!cfg.showGifts) { if (giftBtn) giftBtn.style.display = 'none'; } else { if (giftBtn) giftBtn.style.display = ''; }
  if (!cfg.showMoments) { if (momentBtn) momentBtn.style.display = 'none'; } else { if (momentBtn) momentBtn.style.display = ''; }

  // Info footnote
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

      if (!number && !ussd) { alert('No payment number configured for this event.'); return; }

      if (number) {
        const copied = await copyToClipboard(number);
        if (copied) showToast('Number copied ✔'); else alert('Could not copy number — please long-press to copy manually.');
      }

      if (ussd) {
        const safe = ussdEncode(ussd);
        openTelLink(`tel:${safe}`);
      } else if (number) {
        openTelLink(`tel:${number}`);
      }

      console.log('tunzza:event:gift_clicked', { slug, title: cfg.name || cfg.title });
    });
  }

  /* Moment button behavior: Filestack inline picker or fallback upload link */
  if (momentBtn) {
    momentBtn.addEventListener('click', async () => {
      const upload = cfg.uploadLink || null;
      const filestackKey = cfg.filestackKey || null;
      const uploadOption = cfg.uploadOption || (filestackKey ? 'filestack' : (upload ? 'link' : 'none'));

      if (uploadOption === 'filestack' && filestackKey) {
        // Attach slug to cfg and open picker. Will write metadata to Firestore client-side.
        cfg.slug = slug;
        cfg.filestackKey = filestackKey;
        await openFilestackPickerForEvent(cfg, slug);
        return;
      }

      // fallback: simple upload link (Dropbox File Request or similar)
      if (upload) {
        window.open(upload, '_blank', 'noopener');
      } else {
        alert('No upload destination configured for this event.');
      }

      console.log('tunzza:event:moment_clicked', { slug, title: cfg.name || cfg.title });
    });
  }

  // optionally render small uploads gallery if element exists
  setTimeout(()=> renderUploadsGallery(slug), 600);

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
   Notes:
   - To enable Filestack for an event, set:
       uploadOption: "filestack"
       filestackKey: "<your_filestack_client_key>"
     in the event document (Firestore) or in events.json.
   - Uploaded file metadata is written client-side to Firestore under:
       events/{slug}/uploads/{fileHandle}
     For production robustness, it's recommended to also configure a Filestack webhook + server function
     to verify uploads and write metadata server-side (see Filestack webhook docs).
   - Admin (admin.html) can read uploads and show a gallery, or provide export-to-zip functionality via
     a Cloud Function that reads S3/Filestack objects and builds a ZIP.
*/
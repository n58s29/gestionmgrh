let data = { members: [], events: [] };
let isDirty = false;
let lastSavedJSON = '';

function genId() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }

// ═══ SECURITY UTILS ═══
function esc(s) {
  if (!s) return '';
  const d = document.createElement('div');
  d.textContent = String(s);
  return d.innerHTML;
}

function safeUrl(url) {
  if (!url) return '#';
  try { const u = new URL(url); return ['http:','https:','data:'].includes(u.protocol) ? url : '#'; }
  catch { return '#'; }
}

function validateData(raw) {
  if (!raw || typeof raw !== 'object') return { members: [], events: [] };
  const d = { members: [], events: [] };
  if (Array.isArray(raw.members)) d.members = raw.members.filter(m =>
    m && typeof m.firstname === 'string' && typeof m.lastname === 'string' && typeof m.id === 'string'
  ).map(m => ({ id:m.id, firstname:String(m.firstname||''), lastname:String(m.lastname||''), role:String(m.role||''), company:String(m.company||''), email:String(m.email||''), phone:String(m.phone||''), linkedin:String(m.linkedin||''), photo:String(m.photo||'') }));
  if (Array.isArray(raw.events)) d.events = raw.events.filter(e =>
    e && typeof e.title === 'string' && typeof e.date === 'string' && typeof e.id === 'string'
  ).map(e => ({ id:e.id, title:String(e.title||''), date:String(e.date||''), time:String(e.time||''), theme:String(e.theme||''), location:String(e.location||''), description:String(e.description||''), attendees:Array.isArray(e.attendees)?e.attendees.filter(a=>typeof a==='string'):[], guests:Array.isArray(e.guests)?e.guests.filter(g=>g&&typeof g.firstname==='string').map(g=>({firstname:String(g.firstname||''),lastname:String(g.lastname||''),role:String(g.role||''),company:String(g.company||''),email:String(g.email||'')})):[] }));
  return d;
}

// ═══ DATA LAYER (Firebase Firestore) ═══
let saveTimeout = null;
const SAVE_DEBOUNCE_MS = 2000;

async function openDataFile() {
  // Connect to Firebase and load data
  if (!firebaseReady) {
    if (!initFirebase()) {
      toast('Erreur: Firebase non initialisé. Vérifiez la configuration.', 'error');
      return;
    }
  }

  setSyncStatus('saving', 'Chargement depuis le cloud...');
  const remoteData = await firebaseLoadData();

  if (remoteData) {
    data = validateData(remoteData);
    toast('Données chargées depuis le cloud', 'success');
  } else {
    // No data in Firestore → try seeding from local JSON or start fresh
    try {
      const response = await fetch('data/mgrh-data.json');
      if (response.ok) {
        const seedData = await response.json();
        data = validateData(seedData);
        await firebaseSaveData(data);
        toast('Base initiale importée dans le cloud', 'success');
      }
    } catch {
      data = { members: [], events: [] };
      await firebaseSaveData(data);
      toast('Nouvelle base créée dans le cloud', 'success');
    }
  }

  lastSavedJSON = JSON.stringify(data);
  showApp(); renderAll(); hideHint();
  startAutoSync();
  setSyncStatus('connected', 'Cloud connecté: ' + formatTime());
}

async function writeToFile() {
  // Save to Firestore
  setSyncStatus('saving', 'Sauvegarde cloud...');
  const ok = await firebaseSaveData(data);
  if (ok) {
    lastSavedJSON = JSON.stringify(data);
    isDirty = false;
    setSyncStatus('connected', 'Sauvegardé: ' + formatTime());
  } else {
    setSyncStatus('error', 'Erreur sauvegarde cloud');
  }
  return ok;
}

// ═══ REAL-TIME SYNC ═══
function startAutoSync() {
  firebaseStartListener((remoteData) => {
    const remoteJSON = JSON.stringify({ members: remoteData.members, events: remoteData.events });
    if (remoteJSON !== lastSavedJSON && !isDirty) {
      data = validateData(remoteData);
      lastSavedJSON = remoteJSON;
      renderAll();
      const by = remoteData.lastModifiedBy || '';
      setSyncStatus('connected', 'Synchro: ' + formatTime() + (by ? ' (' + by + ')' : ''));
    }
  });
}

async function forceSave() {
  if (!firebaseReady) {
    await openDataFile();
    return;
  }
  const ok = await writeToFile();
  if (ok) toast('Sauvegarde forcée OK', 'success');
  else toast('Erreur de sauvegarde cloud', 'error');
}

function markDirty() {
  isDirty = true;
  setSyncStatus('saving', 'Modifications non sauvegardées...');
  try { localStorage.setItem('mgrh-data-backup', JSON.stringify(data)); } catch(e) {}
  // Debounced auto-save to Firestore
  if (saveTimeout) clearTimeout(saveTimeout);
  saveTimeout = setTimeout(async () => {
    if (isDirty && firebaseReady) {
      await writeToFile();
    }
  }, SAVE_DEBOUNCE_MS);
}

function setSyncStatus(state, text) {
  document.getElementById('syncDot').className = 'sync-dot ' + state;
  document.getElementById('syncText').textContent = text;
}

function formatTime() {
  return new Date().toLocaleString('fr-FR', { day:'2-digit', month:'2-digit', hour:'2-digit', minute:'2-digit', second:'2-digit' });
}

function showApp() {
  document.getElementById('welcomeScreen').style.display = 'none';
  document.getElementById('appContent').style.display = 'block';
  document.getElementById('forceSaveBtn').style.display = 'flex';
}

function hideHint() {
  const hint = document.getElementById('calloutHint');
  if (hint) hint.style.display = 'none';
  const btn = document.getElementById('connectBtn');
  if (btn) btn.classList.remove('glow');
}

// ═══ TABS ═══
function switchTab(tab) {
  document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
  document.getElementById('tab-' + tab).classList.add('active');
  document.getElementById('nav-' + tab).classList.add('active');
  if (tab === 'events') renderMembersPanel();
}

function toast(msg, type = 'success') {
  const el = document.createElement('div');
  el.className = 'toast ' + type; el.textContent = msg;
  document.getElementById('toasts').appendChild(el);
  setTimeout(() => el.remove(), 3000);
}

// ═══ MEMBERS ═══
function getInitials(m) { return ((m.firstname?.[0] || '') + (m.lastname?.[0] || '')).toUpperCase(); }

function renderMembers() {
  const q = (document.getElementById('memberSearch').value || '').toLowerCase();
  const grid = document.getElementById('membersGrid');
  const filtered = data.members.filter(m => !q || (m.firstname+' '+m.lastname+' '+m.role+' '+m.company).toLowerCase().includes(q));
  document.getElementById('memberCount').textContent = data.members.length + ' membre' + (data.members.length > 1 ? 's' : '');
  grid.innerHTML = filtered.map(m => `
    <div class="member-card" draggable="true" ondragstart="dragMember(event,'${esc(m.id)}')">
      <div class="member-card-actions">
        <button class="icon-btn" onclick="editMember('${esc(m.id)}')" title="Modifier"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg></button>
        <button class="icon-btn delete" onclick="deleteMember('${esc(m.id)}')" title="Supprimer"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg></button>
      </div>
      <div class="member-avatar">${m.photo ? '<img src="'+safeUrl(m.photo)+'" onerror="this.remove();this.parentElement.textContent=\''+getInitials(m)+'\'">' : getInitials(m)}</div>
      <div class="member-name">${esc(m.firstname)} ${esc(m.lastname)}</div>
      ${m.role ? '<div class="member-role">'+esc(m.role)+'</div>' : ''}
      ${m.company ? '<div class="member-company">'+esc(m.company)+'</div>' : ''}
      <div class="member-contact">
        ${m.email ? '<a href="mailto:'+esc(m.email)+'"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg>'+esc(m.email)+'</a>' : ''}
        ${m.phone ? '<a href="tel:'+esc(m.phone)+'"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z"/></svg>'+esc(m.phone)+'</a>' : ''}
      </div>
      ${m.linkedin ? '<a href="'+safeUrl(m.linkedin)+'" target="_blank" class="linkedin-link"><svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 0 1-2.063-2.065 2.064 2.064 0 1 1 2.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z"/></svg>LinkedIn</a>' : ''}
    </div>`).join('');
}

function renderMembersPanel() {
  const q = (document.getElementById('panelMemberSearch')?.value || '').toLowerCase();
  const list = document.getElementById('membersPanelList');
  if (!list) return;
  const filtered = data.members.filter(m => !q || (m.firstname+' '+m.lastname+' '+m.role+' '+m.company).toLowerCase().includes(q));
  list.innerHTML = filtered.map(m => `
    <div class="drag-member-chip" draggable="true" ondragstart="dragMember(event,'${esc(m.id)}')">
      <div class="drag-chip-avatar">${m.photo ? '<img src="'+safeUrl(m.photo)+'" onerror="this.remove();this.parentElement.textContent=\''+getInitials(m)+'\'">' : getInitials(m)}</div>
      <div class="drag-chip-info"><div class="drag-chip-name">${esc(m.firstname)} ${esc(m.lastname)}</div><div class="drag-chip-role">${esc(m.role||m.company||'')}</div></div>
    </div>`).join('');
}

function openMemberModal(id) {
  document.getElementById('memberModalTitle').textContent = id ? 'Modifier un adhérent' : 'Ajouter un adhérent';
  document.getElementById('editMemberId').value = id || '';
  document.getElementById('photoPreview').innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>';
  if (id) {
    const m = data.members.find(x => x.id === id); if (!m) return;
    document.getElementById('memberFirstname').value = m.firstname||'';
    document.getElementById('memberLastname').value = m.lastname||'';
    document.getElementById('memberRole').value = m.role||'';
    document.getElementById('memberCompany').value = m.company||'';
    document.getElementById('memberEmail').value = m.email||'';
    document.getElementById('memberPhone').value = m.phone||'';
    document.getElementById('memberLinkedin').value = m.linkedin||'';
    document.getElementById('photoUrl').value = m.photo||'';
    if (m.photo) document.getElementById('photoPreview').innerHTML = '<img src="'+m.photo+'">';
  } else {
    ['memberFirstname','memberLastname','memberRole','memberCompany','memberEmail','memberPhone','memberLinkedin','photoUrl'].forEach(i => document.getElementById(i).value = '');
  }
  document.getElementById('memberModal').classList.add('active');
}
function closeMemberModal() { document.getElementById('memberModal').classList.remove('active'); }
function editMember(id) { openMemberModal(id); }

function saveMember() {
  const fn = document.getElementById('memberFirstname').value.trim();
  const ln = document.getElementById('memberLastname').value.trim();
  if (!fn || !ln) { toast('Prénom et nom requis', 'error'); return; }
  const photo = document.getElementById('photoUrl').value.trim() || (document.getElementById('photoPreview').querySelector('img')?.src || '');
  const d = { firstname:fn, lastname:ln, role:document.getElementById('memberRole').value.trim(), company:document.getElementById('memberCompany').value.trim(), email:document.getElementById('memberEmail').value.trim(), phone:document.getElementById('memberPhone').value.trim(), linkedin:document.getElementById('memberLinkedin').value.trim(), photo: (photo.startsWith('data:')||photo.startsWith('http')) ? photo : '' };
  const editId = document.getElementById('editMemberId').value;
  if (editId) { const idx = data.members.findIndex(m => m.id === editId); if (idx >= 0) data.members[idx] = {...data.members[idx], ...d}; toast('Adhérent modifié','success'); }
  else { data.members.push({ id: genId(), ...d }); toast('Adhérent ajouté','success'); }
  closeMemberModal(); renderAll(); markDirty();
}

function deleteMember(id) {
  if (!confirm('Supprimer cet adhérent ?')) return;
  data.members = data.members.filter(m => m.id !== id);
  data.events.forEach(ev => { ev.attendees = (ev.attendees||[]).filter(a => a !== id); });
  renderAll(); markDirty(); toast('Adhérent supprimé','success');
}

function handlePhotoUpload(e) {
  const file = e.target.files[0]; if (!file) return;
  const r = new FileReader();
  r.onload = (ev) => { document.getElementById('photoPreview').innerHTML = '<img src="'+ev.target.result+'">'; document.getElementById('photoUrl').value = ev.target.result; };
  r.readAsDataURL(file);
}
function previewPhotoUrl() {
  const url = document.getElementById('photoUrl').value.trim();
  if (url && url.startsWith('http')) document.getElementById('photoPreview').innerHTML = '<img src="'+safeUrl(url)+'" onerror="this.remove();this.parentElement.textContent=\'?\'">';
}

// ═══ EVENTS ═══
const MO = ['Jan','Fév','Mar','Avr','Mai','Jun','Jul','Aoû','Sep','Oct','Nov','Déc'];

function renderEvents() {
  const k = document.getElementById('eventsKanban');
  const now = new Date(); now.setHours(0,0,0,0);
  // Split into upcoming and past
  const upcoming = data.events.filter(ev => new Date(ev.date) >= now).sort((a,b) => new Date(a.date)-new Date(b.date));
  const past = data.events.filter(ev => new Date(ev.date) < now).sort((a,b) => new Date(b.date)-new Date(a.date));
  const sorted = [...upcoming, ...past];
  document.getElementById('eventCount').textContent = sorted.length + ' événement' + (sorted.length>1?'s':'');
  k.innerHTML = sorted.map(ev => {
    const d = new Date(ev.date), isPast = d<now, att = ev.attendees||[], guests = ev.guests||[], total = att.length + guests.length;
    return `<div class="event-tile ${isPast?'past':''}" ondragover="event.preventDefault();event.dataTransfer.dropEffect='copy';this.classList.add('drag-over')" ondragleave="this.classList.remove('drag-over')" ondrop="dropOnEvent(event,'${esc(ev.id)}');this.classList.remove('drag-over')">
      <div class="event-header">
        <div class="event-info">
          ${ev.theme?'<div class="event-theme">'+esc(ev.theme)+'</div>':''}
          <div class="event-title">${esc(ev.title)}</div>
          <div class="event-meta">
            ${ev.time?'<span><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>'+esc(ev.time)+'</span>':''}
            ${ev.location?'<span><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>'+esc(ev.location)+'</span>':''}
          </div>
        </div>
        <div class="event-date-badge"><span class="event-date-day">${d.getDate()}</span><span class="event-date-month">${MO[d.getMonth()]}</span><span class="event-date-year">${d.getFullYear()}</span></div>
        <div class="event-tile-actions">
          <button class="icon-btn" onclick="printEventSheet('${esc(ev.id)}')" title="Trombinoscope"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 6 2 18 2 18 9"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/></svg></button>
          <button class="icon-btn" onclick="editEvent('${esc(ev.id)}')" title="Modifier"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg></button>
          <button class="icon-btn delete" onclick="deleteEvent('${esc(ev.id)}')" title="Supprimer"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg></button>
        </div>
      </div>
      ${ev.description?'<div class="event-desc">'+esc(ev.description)+'</div>':''}
      <div class="event-attendees">
        ${total>0?'<div class="badge-count">'+total+'</div>':''}
        ${total===0?'<span class="drop-hint"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="5 9 2 12 5 15"/><polyline points="9 5 12 2 15 5"/><polyline points="15 19 12 22 9 19"/><polyline points="19 9 22 12 19 15"/><line x1="2" y1="12" x2="22" y2="12"/><line x1="12" y1="2" x2="12" y2="22"/></svg>Glissez un adhérent ou ajoutez un invité</span>':''}
        ${att.map(aId => { const m=data.members.find(x=>x.id===aId); if(!m) return ''; return '<span class="attendee-chip"><span class="attendee-chip-avatar">'+(m.photo?'<img src="'+safeUrl(m.photo)+'" onerror="this.remove();this.parentElement.textContent=\''+getInitials(m)+'\'">':getInitials(m))+'</span>'+esc(m.firstname)+' '+esc(m.lastname)+'<button class="attendee-remove" onclick="removeAttendee(\''+esc(ev.id)+"','"+esc(aId)+'\')" title="Retirer">&times;</button></span>'; }).join('')}
        ${guests.map((g,i) => '<span class="attendee-chip guest"><span class="attendee-chip-avatar guest-avatar"><svg xmlns="http://www.w3.org/2000/svg" class="guest-icon-svg" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/><line x1="1" y1="1" x2="4" y2="4" stroke="none"/></svg></span>'+esc(g.firstname)+' '+esc(g.lastname)+(g.company?' <span style="color:var(--text-light);font-size:11px">('+esc(g.company)+')</span>':'')+'<button class="attendee-remove" onclick="removeGuest(\''+esc(ev.id)+"',"+i+')" title="Retirer">&times;</button></span>').join('')}
        <button class="add-guest-btn" onclick="openGuestModal('${esc(ev.id)}')"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="8.5" cy="7" r="4"/><line x1="20" y1="8" x2="20" y2="14"/><line x1="23" y1="11" x2="17" y2="11"/></svg>Invité</button>
      </div>
    </div>`;
  }).join('');
}

function openEventModal(id) {
  document.getElementById('eventModalTitle').textContent = id ? "Modifier l'événement" : 'Ajouter un événement';
  document.getElementById('editEventId').value = id || '';
  if (id) {
    const ev = data.events.find(x=>x.id===id); if(!ev) return;
    document.getElementById('eventTheme').value=ev.theme||'';
    document.getElementById('eventTitleInput').value=ev.title||'';
    document.getElementById('eventDate').value=ev.date||'';
    document.getElementById('eventTime').value=ev.time||'';
    document.getElementById('eventLocation').value=ev.location||'';
    document.getElementById('eventDesc').value=ev.description||'';
  } else { ['eventTheme','eventTitleInput','eventDate','eventTime','eventLocation','eventDesc'].forEach(i=>document.getElementById(i).value=''); }
  document.getElementById('eventModal').classList.add('active');
}
function closeEventModal() { document.getElementById('eventModal').classList.remove('active'); }
function editEvent(id) { openEventModal(id); }

function saveEvent() {
  const title=document.getElementById('eventTitleInput').value.trim(), date=document.getElementById('eventDate').value;
  if (!title||!date) { toast('Titre et date requis','error'); return; }
  const d = { theme:document.getElementById('eventTheme').value.trim(), title, date, time:document.getElementById('eventTime').value, location:document.getElementById('eventLocation').value.trim(), description:document.getElementById('eventDesc').value.trim() };
  const editId=document.getElementById('editEventId').value;
  if (editId) { const idx=data.events.findIndex(e=>e.id===editId); if(idx>=0) data.events[idx]={...data.events[idx],...d}; toast('Événement modifié','success'); }
  else { data.events.push({id:genId(),attendees:[],...d}); toast('Événement ajouté','success'); }
  closeEventModal(); renderAll(); markDirty();
}

function deleteEvent(id) {
  if (!confirm('Supprimer cet événement ?')) return;
  data.events = data.events.filter(e=>e.id!==id);
  renderAll(); markDirty(); toast('Événement supprimé','success');
}

// ═══ GUESTS (non-members) ═══

// ═══ PRINT: Feuille de présence / Trombinoscope ═══
const MOIS_FULL = ['janvier','février','mars','avril','mai','juin','juillet','août','septembre','octobre','novembre','décembre'];

function printEventSheet(eventId) {
  const ev = data.events.find(x => x.id === eventId);
  if (!ev) return;
  const d = new Date(ev.date);
  const dateStr = d.getDate() + ' ' + MOIS_FULL[d.getMonth()] + ' ' + d.getFullYear();

  const participants = [];
  (ev.attendees || []).forEach(aId => {
    const m = data.members.find(x => x.id === aId);
    if (m) participants.push({ ...m, isGuest: false });
  });
  (ev.guests || []).forEach(g => { participants.push({ ...g, isGuest: true }); });
  participants.sort((a, b) => (a.lastname || '').localeCompare(b.lastname || ''));

  const ini = (p) => ((p.firstname?.[0] || '') + (p.lastname?.[0] || '')).toUpperCase();

  const cards = participants.map(p => {
    const hasPic = p.photo && !p.isGuest;
    const avatarInner = hasPic
      ? '<img src="' + safeUrl(p.photo) + '" onerror="this.remove();this.parentElement.textContent=\'' + ini(p) + '\'">'
      : p.isGuest
        ? '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="1.5"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>'
        : ini(p);
    const bg = p.isGuest ? '#94a3b8' : '#952088';

    return '<div class="card">'
      + '<div class="avatar" style="background:' + bg + ';">' + avatarInner + '</div>'
      + '<div class="info">'
      + '<div class="name">' + esc(p.firstname) + ' ' + esc(p.lastname) + (p.isGuest ? ' <span class="guest-tag">INVITÉ</span>' : '') + '</div>'
      + (p.role ? '<div class="role">' + esc(p.role) + '</div>' : '')
      + (p.company ? '<div class="company">' + esc(p.company) + '</div>' : '')
      + '</div></div>';
  }).join('');

  const html = '<!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8"><title>Trombinoscope - ' + esc(ev.title) + '</title>'
    + '<style>'
    + '@page { size: A4 portrait; margin: 0; }'
    + '@media print { body { margin: 12mm 14mm; } .no-print { display:none; } }'
    + '* { margin:0; padding:0; box-sizing:border-box; }'
    + 'body { font-family: "Segoe UI", Tahoma, sans-serif; color: #1a1a1a; padding: 12mm 14mm; }'

    // Header
    + '.header { display:flex; align-items:center; gap:16px; padding-bottom:14px; border-bottom:3px solid #952088; margin-bottom:16px; break-inside:avoid; }'
    + '.header-logo { width:60px; height:60px; border-radius:8px; object-fit:contain; }'
    + '.header-text { flex:1; }'
    + '.header-title { font-family:Georgia,serif; font-size:10px; color:#952088; text-transform:uppercase; letter-spacing:2px; }'
    + '.header-event { font-family:Georgia,serif; font-size:20px; font-weight:700; line-height:1.2; margin:2px 0 4px; }'
    + '.header-meta { display:flex; gap:16px; font-size:12px; color:#666; flex-wrap:wrap; }'
    + '.header-badge { text-align:center; background:#952088; color:#fff; border-radius:8px; padding:6px 12px; flex-shrink:0; }'
    + '.header-badge-day { font-size:22px; font-weight:700; line-height:1; }'
    + '.header-badge-month { font-size:10px; text-transform:uppercase; letter-spacing:1px; }'
    + '.header-badge-year { font-size:9px; opacity:0.7; }'
    + '.subtitle { font-family:Georgia,serif; font-size:13px; font-weight:700; margin-bottom:12px; display:flex; align-items:center; gap:6px; break-after:avoid; }'
    + '.subtitle .count { background:#952088; color:#fff; font-family:"Segoe UI",sans-serif; font-size:10px; font-weight:700; width:20px; height:20px; border-radius:50%; display:flex; align-items:center; justify-content:center; }'

    // Grid 2 columns
    + '.grid { display:grid; grid-template-columns:1fr 1fr; gap:8px; }'
    + '.card { display:flex; align-items:center; gap:10px; padding:7px 10px; border:1px solid #e8e0e7; border-radius:8px; break-inside:avoid; }'
    + '.avatar { width:52px; height:52px; border-radius:50%; display:flex; align-items:center; justify-content:center; color:#fff; font-size:17px; font-weight:700; flex-shrink:0; overflow:hidden; }'
    + '.avatar img { width:100%; height:100%; object-fit:cover; border-radius:50%; }'
    + '.info { flex:1; min-width:0; }'
    + '.name { font-size:13px; font-weight:700; line-height:1.3; }'
    + '.role { font-size:10px; color:#952088; font-weight:600; line-height:1.3; }'
    + '.company { font-size:10px; color:#666; line-height:1.3; }'
    + '.guest-tag { font-size:8px; color:#64748b; font-weight:500; background:#f0f0f0; padding:1px 5px; border-radius:3px; margin-left:3px; vertical-align:middle; }'

    + '.footer { margin-top:16px; padding-top:10px; border-top:1px solid #e8e0e7; display:flex; justify-content:space-between; font-size:10px; color:#999; }'
    + '.no-print { background:#952088; color:#fff; border:none; padding:12px 28px; border-radius:8px; font-family:"Segoe UI",sans-serif; font-size:14px; font-weight:700; cursor:pointer; position:fixed; bottom:24px; right:24px; box-shadow:0 4px 16px rgba(149,32,136,0.3); z-index:100; }'
    + '.no-print:hover { background:#721868; }'
    + '</style></head><body>'
    + '<button class="no-print" onclick="window.print()">Imprimer</button>'

    // Header
    + '<div class="header">'
    + '<img src="logo.jpg" class="header-logo" onerror="this.style.display=\'none\'">'
    + '<div class="header-text">'
    + '<div class="header-title">Mouvement Génération RH</div>'
    + (ev.theme ? '<div style="font-size:10px;color:#952088;text-transform:uppercase;letter-spacing:1px;font-weight:600;">' + esc(ev.theme) + '</div>' : '')
    + '<div class="header-event">' + esc(ev.title) + '</div>'
    + '<div class="header-meta">'
    + '<span><strong>' + dateStr + '</strong></span>'
    + (ev.time ? '<span>' + esc(ev.time) + '</span>' : '')
    + (ev.location ? '<span>' + esc(ev.location) + '</span>' : '')
    + '</div></div>'
    + '<div class="header-badge"><div class="header-badge-day">' + d.getDate() + '</div><div class="header-badge-month">' + MO[d.getMonth()] + '</div><div class="header-badge-year">' + d.getFullYear() + '</div></div>'
    + '</div>'

    // Subtitle
    + '<div class="subtitle">Qui est qui ? <span class="count">' + participants.length + '</span></div>'

    // Grid
    + '<div class="grid">' + (participants.length > 0 ? cards : '<div style="grid-column:1/-1;padding:24px;text-align:center;color:#999;font-style:italic;">Aucun participant inscrit</div>') + '</div>'

    + '<div class="footer"><span>MGRH — Mouvement Génération RH</span><span>Trombinoscope — ' + dateStr + '</span></div>'
    + '</body></html>';

  const w = window.open('', '_blank');
  w.document.write(html);
  w.document.close();
}

function openGuestModal(eventId) {
  document.getElementById('guestEventId').value = eventId;
  ['guestFirstname','guestLastname','guestRole','guestCompany','guestEmail'].forEach(i=>document.getElementById(i).value='');
  document.getElementById('guestModal').classList.add('active');
}
function closeGuestModal() { document.getElementById('guestModal').classList.remove('active'); }

function saveGuest() {
  const fn = document.getElementById('guestFirstname').value.trim();
  const ln = document.getElementById('guestLastname').value.trim();
  if (!fn||!ln) { toast('Prénom et nom requis','error'); return; }
  const eventId = document.getElementById('guestEventId').value;
  const ev = data.events.find(x=>x.id===eventId);
  if (!ev) return;
  if (!ev.guests) ev.guests = [];
  ev.guests.push({ firstname:fn, lastname:ln, role:document.getElementById('guestRole').value.trim(), company:document.getElementById('guestCompany').value.trim(), email:document.getElementById('guestEmail').value.trim() });
  closeGuestModal(); renderEvents(); markDirty();
  toast(fn+' '+ln+' ajouté comme invité','success');
}

function removeGuest(eventId, guestIndex) {
  const ev = data.events.find(x=>x.id===eventId);
  if (!ev||!ev.guests) return;
  ev.guests.splice(guestIndex, 1);
  renderEvents(); markDirty(); toast('Invité retiré','success');
}

// ═══ DRAG & DROP ═══
let draggedMemberId = null;
function dragMember(e, memberId) {
  draggedMemberId = memberId;
  e.dataTransfer.setData('text/plain', memberId);
  e.dataTransfer.effectAllowed = 'copy';
  const m = data.members.find(x=>x.id===memberId);
  const ghost = document.createElement('div');
  ghost.className='drag-ghost'; ghost.textContent=m?m.firstname+' '+m.lastname:'';
  ghost.style.left='-9999px'; document.body.appendChild(ghost);
  e.dataTransfer.setDragImage(ghost,0,0);
  setTimeout(()=>ghost.remove(),0);
  e.target.closest('.member-card,.drag-member-chip')?.classList.add('dragging');
}
document.addEventListener('dragend',()=>{
  document.querySelectorAll('.dragging').forEach(c=>c.classList.remove('dragging'));
  document.querySelectorAll('.drag-over').forEach(t=>t.classList.remove('drag-over'));
  draggedMemberId=null;
});

function dropOnEvent(e, eventId) {
  e.preventDefault();
  const memberId = e.dataTransfer.getData('text/plain')||draggedMemberId;
  if (!memberId) return;
  const ev=data.events.find(x=>x.id===eventId); if(!ev) return;
  if(!ev.attendees) ev.attendees=[];
  if (ev.attendees.includes(memberId)) {
    const m=data.members.find(x=>x.id===memberId);
    toast((m?m.firstname+' '+m.lastname:'Ce membre')+' est déjà inscrit !','warning'); return;
  }
  ev.attendees.push(memberId);
  renderEvents(); markDirty();
  const m=data.members.find(x=>x.id===memberId);
  toast((m?m.firstname+' '+m.lastname:'Membre')+' inscrit !','success');
}

function removeAttendee(eventId, memberId) {
  const ev=data.events.find(x=>x.id===eventId); if(!ev) return;
  ev.attendees=(ev.attendees||[]).filter(a=>a!==memberId);
  renderEvents(); markDirty(); toast('Inscription retirée','success');
}

function renderAll() { renderMembers(); renderEvents(); renderMembersPanel(); }

// ═══ INIT ═══
(async function init() {
  // Modal close handlers
  document.querySelectorAll('.modal-overlay').forEach(o => o.addEventListener('click', e => { if(e.target===o) o.classList.remove('active'); }));
  document.addEventListener('keydown', e => { if(e.key==='Escape') document.querySelectorAll('.modal-overlay').forEach(o=>o.classList.remove('active')); });

  // Try auto-connecting to Firebase
  if (initFirebase()) {
    await openDataFile();
  } else {
    // Fallback to localStorage backup
    try {
      const backup = localStorage.getItem('mgrh-data-backup');
      if (backup) { data=validateData(JSON.parse(backup)); showApp(); renderAll(); setSyncStatus('error','Mode hors-ligne — cliquez pour connecter'); }
    } catch(e) {}
  }
})();

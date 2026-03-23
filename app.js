// ═══════════════════════════════════════════
// STORAGE HELPERS  (shared persistent store)
// ═══════════════════════════════════════════
const S = window.storage;

async function sget(k) {
  try {
    const r = await S.get(k, true);
    return r ? JSON.parse(r.value) : null;
  } catch {
    return null;
  }
}

async function sset(k, v) {
  try {
    await S.set(k, JSON.stringify(v), true);
  } catch (e) {
    console.error('sset error:', e);
  }
}


// ═══════════════════════════════════════════
// APP STATE
// ═══════════════════════════════════════════
let currentUser    = null;
let selectedServer  = '__home__';
let selectedChannel = null;
let membersVisible  = true;

// Used for smart incremental rendering — only re-render when message count changes
let lastMsgCount   = -1;
let lastMsgKey     = '';


// ═══════════════════════════════════════════
// AUTH
// ═══════════════════════════════════════════
function switchTab(t) {
  document.querySelectorAll('.auth-tab').forEach((el, i) =>
    el.classList.toggle('active', (t === 'login' && i === 0) || (t === 'register' && i === 1))
  );
  document.getElementById('login-form').style.display    = t === 'login'    ? '' : 'none';
  document.getElementById('register-form').style.display = t === 'register' ? '' : 'none';
}

async function handleLogin() {
  const u = document.getElementById('login-user').value.trim().toLowerCase();
  const p = document.getElementById('login-pass').value;
  if (!u || !p) { showAuthError('login', 'Please fill in all fields.'); return; }

  const users = await sget('users') || {};
  if (!users[u])                          { showAuthError('login', 'User not found.');       return; }
  if (users[u].password !== btoa(p))      { showAuthError('login', 'Incorrect password.');   return; }

  currentUser = { username: u, ...users[u] };
  enterApp();
}

async function handleRegister() {
  const u  = document.getElementById('reg-user').value.trim().toLowerCase();
  const p  = document.getElementById('reg-pass').value;
  const p2 = document.getElementById('reg-pass2').value;

  if (!u || !p)                            { showAuthError('reg', 'Please fill in all fields.');        return; }
  if (p !== p2)                            { showAuthError('reg', 'Passwords do not match.');           return; }
  if (u.length < 3)                        { showAuthError('reg', 'Username must be 3+ characters.');   return; }
  if (p.length < 4)                        { showAuthError('reg', 'Password must be 4+ characters.');   return; }
  if (!/^[a-z0-9_]+$/.test(u))            { showAuthError('reg', 'Username: letters, numbers, _ only.'); return; }

  const users = await sget('users') || {};
  if (users[u]) { showAuthError('reg', 'Username already taken.'); return; }

  const colorIdx = Object.keys(users).length % 8;
  users[u] = { password: btoa(p), color: colorIdx, joined: Date.now() };
  await sset('users', users);

  currentUser = { username: u, color: colorIdx };
  await ensureGlobalServer();
  enterApp();
}

function showAuthError(prefix, msg) {
  const el = document.getElementById(prefix + '-error');
  el.textContent = msg;
  setTimeout(() => { el.textContent = ''; }, 3000);
}

async function ensureGlobalServer() {
  let servers = await sget('servers') || {};
  if (!servers['__global__']) {
    servers['__global__'] = {
      id: '__global__',
      name: 'Global',
      icon: '🌍',
      description: 'Welcome to Nexus!',
      owner: '__system__',
      members: [],
      channels: [
        { id: 'general',   name: 'general',   type: 'text', description: 'General chat for everyone' },
        { id: 'off-topic', name: 'off-topic',  type: 'text', description: 'Random stuff' }
      ],
      inviteCode: 'global',
      createdAt: Date.now()
    };
    await sset('servers', servers);
  }

  // Re-fetch in case it was just created by another session
  servers = await sget('servers') || {};
  if (!servers['__global__'].members.includes(currentUser.username)) {
    servers['__global__'].members.push(currentUser.username);
    await sset('servers', servers);
  }
}

function logout() {
  currentUser     = null;
  selectedServer  = '__home__';
  selectedChannel = null;
  lastMsgCount    = -1;
  lastMsgKey      = '';
  document.getElementById('app').classList.remove('visible');
  document.getElementById('auth-screen').style.display = 'flex';
}

async function enterApp() {
  document.getElementById('auth-screen').style.display = 'none';
  document.getElementById('app').classList.add('visible');
  document.getElementById('current-username').textContent    = currentUser.username;
  document.getElementById('current-avatar-letter').textContent = currentUser.username[0].toUpperCase();
  document.getElementById('current-avatar').className = `user-avatar-sm c${currentUser.color}`;
  await ensureGlobalServer();
  await renderServerBar();
  await selectServer('__global__');
}


// ═══════════════════════════════════════════
// SERVER / GROUP MANAGEMENT
// ═══════════════════════════════════════════
async function renderServerBar() {
  const servers   = await sget('servers') || {};
  const myServers = Object.values(servers).filter(s => s.members.includes(currentUser.username));
  const bar       = document.getElementById('server-icons');
  bar.innerHTML   = '';

  for (const s of myServers) {
    const el        = document.createElement('div');
    el.className    = `server-icon${selectedServer === s.id ? ' active' : ''}`;
    el.title        = s.name;
    el.textContent  = s.icon || s.name[0].toUpperCase();
    el.id           = `sicon-${s.id}`;
    el.onclick      = () => selectServer(s.id);
    bar.appendChild(el);
  }
}

async function selectServer(id) {
  selectedServer  = id;
  selectedChannel = null;
  lastMsgCount    = -1;

  document.querySelectorAll('.server-icon').forEach(el => el.classList.remove('active'));
  const icon = document.getElementById(`sicon-${id}`);
  if (icon) icon.classList.add('active');

  if (id === '__home__') {
    document.getElementById('home-icon').classList.add('active');
    document.getElementById('server-name-label').textContent = 'Home';
    renderHomeChannels();
  } else {
    document.getElementById('home-icon').classList.remove('active');
    const servers = await sget('servers') || {};
    const s = servers[id];
    if (!s) return;
    document.getElementById('server-name-label').textContent = s.name;
    renderServerChannels(s);
  }

  showNoChannel();
}

function showNoChannel() {
  document.getElementById('no-channel').style.display    = 'flex';
  document.getElementById('channel-view').style.display  = 'none';
}

function renderHomeChannels() {
  const list = document.getElementById('channels-list');
  list.innerHTML = `
    <div class="channel-section">
      <div class="section-label">Direct Messages</div>
      <div class="channel-list">
        <div class="channel-item" onclick="openDM()">
          <span class="ch-icon">➕</span> Find or start DM
        </div>
      </div>
    </div>
    <div class="channel-section" style="margin-top:16px">
      <div class="section-label">
        Groups
        <span class="add-ch" onclick="openCreateGroup()">+</span>
      </div>
      <div class="channel-list">
        <div class="channel-item" onclick="document.getElementById('join-group-modal').style.display='flex'">
          <span class="ch-icon">🔗</span> Join with invite code
        </div>
      </div>
    </div>
  `;
}

async function renderServerChannels(s) {
  const list = document.getElementById('channels-list');
  list.innerHTML = '';

  // Text channels section
  const sec = document.createElement('div');
  sec.className = 'channel-section';
  sec.innerHTML = `
    <div class="section-label">
      Text Channels
      <span class="add-ch" id="add-ch-btn">+</span>
    </div>
    <div class="channel-list" id="text-ch-list"></div>
  `;
  list.appendChild(sec);

  const chList = sec.querySelector('#text-ch-list');
  for (const ch of (s.channels || [])) {
    const el       = document.createElement('div');
    el.className   = `channel-item${selectedChannel === ch.id ? ' active' : ''}`;
    el.innerHTML   = `<span class="ch-icon">#</span>${ch.name}`;
    el.onclick     = () => openChannel(s.id, ch);
    chList.appendChild(el);
  }

  sec.querySelector('#add-ch-btn').onclick = () => addChannel(s.id);

  // Invite code display
  const inv = document.createElement('div');
  inv.style.cssText = 'padding:12px 16px; margin-top:auto;';
  inv.innerHTML = `
    <div style="font-size:11px; color:var(--muted); margin-bottom:4px;">INVITE CODE</div>
    <div style="display:flex; gap:6px; align-items:center;">
      <code style="font-size:13px; background:var(--surface); padding:5px 10px; border-radius:6px;
                   color:var(--accent2); flex:1; overflow:hidden; text-overflow:ellipsis;">
        ${s.inviteCode}
      </code>
      <button class="icon-btn" onclick="copyCode('${s.inviteCode}')" title="Copy">📋</button>
    </div>
  `;
  list.appendChild(inv);
}


// ═══════════════════════════════════════════
// CHANNEL & MESSAGES
// ═══════════════════════════════════════════
async function openChannel(serverId, ch) {
  selectedChannel = ch.id;
  lastMsgCount    = -1; // force full re-render on channel switch

  document.querySelectorAll('.channel-item').forEach(el => el.classList.remove('active'));
  event.currentTarget?.classList.add('active');

  document.getElementById('no-channel').style.display   = 'none';
  const cv = document.getElementById('channel-view');
  cv.style.display = 'flex';

  document.getElementById('ch-type-icon').textContent  = '#';
  document.getElementById('ch-name-display').textContent = ch.name;
  document.getElementById('ch-desc-display').textContent = ch.description || '';
  document.getElementById('msg-input').placeholder      = `Message #${ch.name}`;

  await loadMessages(serverId, ch.id);
  await renderMembers(serverId);
}

async function loadMessages(serverId, channelId) {
  const key  = `msgs:${serverId}:${channelId}`;
  const msgs = await sget(key) || [];
  renderMessages(msgs);
  lastMsgCount = msgs.length;
  lastMsgKey   = key;
}

function renderMessages(msgs) {
  const el = document.getElementById('messages');
  const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 80;

  el.innerHTML = '';

  if (msgs.length === 0) {
    el.innerHTML = `
      <div class="welcome-banner">
        <h2>Welcome to the channel! 👋</h2>
        <p>This is the beginning of this channel's history. Say hello!</p>
      </div>`;
    return;
  }

  let lastAuthor = null;
  let lastDay    = null;

  for (const m of msgs) {
    const day = new Date(m.ts).toLocaleDateString('en-US', {
      weekday: 'long', month: 'long', day: 'numeric'
    });

    if (day !== lastDay) {
      const div       = document.createElement('div');
      div.className   = 'day-divider';
      div.innerHTML   = `<span>${day}</span>`;
      el.appendChild(div);
      lastDay    = day;
      lastAuthor = null;
    }

    if (m.author !== lastAuthor) {
      const g       = document.createElement('div');
      g.className   = 'msg-group';
      g.innerHTML   = `
        <div class="msg-avatar c${m.color || 0}">${m.author[0].toUpperCase()}</div>
        <div class="msg-body">
          <div class="msg-meta">
            <span class="msg-author">${escHtml(m.author)}</span>
            <span class="msg-time">${formatTime(m.ts)}</span>
          </div>
          <div class="msg-text">${escHtml(m.text)}</div>
        </div>`;
      el.appendChild(g);
    } else {
      const c       = document.createElement('div');
      c.className   = 'msg-continued';
      c.innerHTML   = `<div class="msg-text">${escHtml(m.text)}</div>`;
      el.appendChild(c);
    }

    lastAuthor = m.author;
  }

  if (atBottom) el.scrollTop = el.scrollHeight;
}

async function sendMessage() {
  if (!currentUser || !selectedChannel || !selectedServer) return;

  const inp  = document.getElementById('msg-input');
  const text = inp.value.trim();
  if (!text) return;

  inp.value       = '';
  inp.style.height = '';

  const key  = `msgs:${selectedServer}:${selectedChannel}`;
  const msgs = await sget(key) || [];
  msgs.push({ author: currentUser.username, color: currentUser.color || 0, text, ts: Date.now() });
  await sset(key, msgs);

  // Immediately render so the sender sees their message right away
  renderMessages(msgs);
  lastMsgCount = msgs.length;
}

function handleKey(e) {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    sendMessage();
  }
}

function autoResize(el) {
  el.style.height = '';
  el.style.height = Math.min(el.scrollHeight, 200) + 'px';
}


// ═══════════════════════════════════════════
// MEMBERS
// ═══════════════════════════════════════════
async function renderMembers(serverId) {
  const servers = await sget('servers') || {};
  const s       = servers[serverId];
  if (!s) return;

  const users = await sget('users') || {};
  const list  = document.getElementById('members-list');
  list.innerHTML = '';

  for (const m of (s.members || [])) {
    const color = users[m] ? users[m].color : 0;
    const el    = document.createElement('div');
    el.className = 'member-item';
    el.innerHTML = `
      <div class="m-av c${color}">
        ${m[0].toUpperCase()}
        <div class="s-dot" style="background:var(--online)"></div>
      </div>
      <div>
        <div class="m-name">${escHtml(m)}</div>
        <div class="m-role">${s.owner === m ? 'Owner' : 'Member'}</div>
      </div>`;
    list.appendChild(el);
  }
}


// ═══════════════════════════════════════════
// GROUP CRUD
// ═══════════════════════════════════════════
function openCreateGroup() {
  document.getElementById('create-group-modal').style.display = 'flex';
}

async function createGroup() {
  const name = document.getElementById('group-name-input').value.trim();
  const desc = document.getElementById('group-desc-input').value.trim();
  if (!name) return;

  const id         = 'g_' + Date.now();
  const inviteCode = Math.random().toString(36).slice(2, 8);
  const icons      = ['🎮','🎨','📚','🎵','🏆','🔥','💡','🚀','🌊','🌿'];
  const servers    = await sget('servers') || {};

  servers[id] = {
    id, name, description: desc,
    icon: icons[Math.floor(Math.random() * icons.length)],
    owner: currentUser.username,
    members: [currentUser.username],
    channels: [
      { id: 'general', name: 'general', type: 'text', description: 'General discussion' },
      { id: 'random',  name: 'random',  type: 'text', description: 'Random stuff' }
    ],
    inviteCode,
    createdAt: Date.now()
  };

  await sset('servers', servers);
  document.getElementById('create-group-modal').style.display = 'none';
  document.getElementById('group-name-input').value = '';
  document.getElementById('group-desc-input').value = '';
  await renderServerBar();
  await selectServer(id);
  showToast(`Group "${name}" created! Share code: ${inviteCode}`);
}

async function joinGroup() {
  const code = document.getElementById('join-code-input').value.trim().toLowerCase();
  if (!code) return;

  const servers = await sget('servers') || {};
  const s       = Object.values(servers).find(s => s.inviteCode === code);

  if (!s) {
    showToast('Invalid invite code.');
    return;
  }
  if (s.members.includes(currentUser.username)) {
    showToast('You are already in this group.');
    document.getElementById('join-group-modal').style.display = 'none';
    return;
  }

  s.members.push(currentUser.username);
  await sset('servers', servers);
  document.getElementById('join-group-modal').style.display = 'none';
  document.getElementById('join-code-input').value = '';
  await renderServerBar();
  await selectServer(s.id);
  showToast(`Joined "${s.name}"!`);
}

async function addChannel(serverId) {
  const name = prompt('Channel name:');
  if (!name) return;

  const clean   = name.toLowerCase().replace(/[^a-z0-9-]/g, '-');
  const servers = await sget('servers') || {};
  if (!servers[serverId]) return;

  servers[serverId].channels.push({ id: clean + '-' + Date.now(), name: clean, type: 'text', description: '' });
  await sset('servers', servers);
  renderServerChannels(servers[serverId]);
  showToast(`#${clean} channel created!`);
}

async function openDM() {
  const username = prompt('Enter username to message:');
  if (!username || username.trim().toLowerCase() === currentUser.username) return;

  const u     = username.trim().toLowerCase();
  const users = await sget('users') || {};
  if (!users[u]) { showToast('User not found.'); return; }

  const dmId     = [currentUser.username, u].sort().join('__dm__');
  const serverId = '__dm__';

  document.getElementById('no-channel').style.display  = 'none';
  document.getElementById('channel-view').style.display = 'flex';
  document.getElementById('ch-type-icon').textContent   = '@';
  document.getElementById('ch-name-display').textContent = u;
  document.getElementById('ch-desc-display').textContent = '';
  document.getElementById('msg-input').placeholder       = `Message @${u}`;

  selectedServer  = serverId;
  selectedChannel = dmId;
  lastMsgCount    = -1;

  await loadMessages(serverId, dmId);

  const color = users[u]?.color || 0;
  document.getElementById('members-list').innerHTML = `
    <div class="member-item">
      <div class="m-av c${color}">
        ${u[0].toUpperCase()}
        <div class="s-dot" style="background:var(--online)"></div>
      </div>
      <div>
        <div class="m-name">${escHtml(u)}</div>
        <div class="m-role">Member</div>
      </div>
    </div>`;
}


// ═══════════════════════════════════════════
// UTILITIES
// ═══════════════════════════════════════════
function escHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function formatTime(ts) {
  return new Date(ts).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}

function toggleMembers() {
  const p     = document.getElementById('members-panel');
  membersVisible = !membersVisible;
  p.style.display = membersVisible ? '' : 'none';
}

function copyCode(code) {
  navigator.clipboard.writeText(code).catch(() => {});
  showToast('Invite code copied!');
}

function closeModal(e, id) {
  if (e.target.id === id) document.getElementById(id).style.display = 'none';
}

function showToast(msg) {
  const t     = document.createElement('div');
  t.className = 'toast';
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 3000);
}


// ═══════════════════════════════════════════
// KEYBOARD SHORTCUTS (auth forms)
// ═══════════════════════════════════════════
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Enter') return;
  const authVisible = document.getElementById('auth-screen').style.display !== 'none';
  if (!authVisible) return;
  const loginVisible = document.getElementById('login-form').style.display !== 'none';
  if (loginVisible) handleLogin();
  else              handleRegister();
});


// ═══════════════════════════════════════════
// FAST MESSAGE POLLING  (500 ms)
// ═══════════════════════════════════════════
setInterval(async () => {
  if (!currentUser || !selectedChannel || !selectedServer) return;

  const key  = `msgs:${selectedServer}:${selectedChannel}`;
  const msgs = await sget(key) || [];

  // Only re-render if the message count or key changed — avoids flicker
  if (key !== lastMsgKey || msgs.length !== lastMsgCount) {
    const el       = document.getElementById('messages');
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    renderMessages(msgs);
    if (atBottom) el.scrollTop = el.scrollHeight;
    lastMsgCount = msgs.length;
    lastMsgKey   = key;
  }
}, 500);

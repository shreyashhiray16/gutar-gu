(() => {
  // Extract room token from URL: /room/{token}
  const pathParts = window.location.pathname.split('/');
  const token = pathParts[pathParts.length - 1] || pathParts[pathParts.length - 2];

  // DOM Elements
  const statusLine = document.getElementById('status-line');
  const connectionDot = document.getElementById('connection-dot');
  const rttIndicator = document.getElementById('rtt-indicator');
  const userDisplayName = document.getElementById('user-display-name');
  const userAvatar = document.getElementById('user-avatar');
  const nicknameModal = document.getElementById('nickname-modal');
  const nicknameForm = document.getElementById('nickname-form');
  const nicknameInput = document.getElementById('nickname-input');
  const chatMessages = document.getElementById('chat-messages');
  const chatForm = document.getElementById('chat-form');
  const messageInput = document.getElementById('message-input');
  const sendBtn = document.getElementById('send-btn');
  const scrollBottomBtn = document.getElementById('scroll-bottom-btn');
  const typingIndicator = document.getElementById('typing-indicator');
  const typingText = document.getElementById('typing-text');
  const themeToggle = document.getElementById('theme-toggle');
  const themeIcon = document.getElementById('theme-icon');
  const shareRoomBtn = document.getElementById('share-room-btn');
  const leaveRoomBtn = document.getElementById('leave-room-btn');
  const exitModal = document.getElementById('exit-modal');
  const cancelExitBtn = document.getElementById('cancel-exit-btn');
  const confirmExitBtn = document.getElementById('confirm-exit-btn');
  const toastContainer = document.getElementById('toast-container');
  const soundToggleBtn = document.getElementById('sound-toggle-btn');
  const timerSelect = document.getElementById('timer-select');
  const burnToggle = document.getElementById('burn-toggle');
  const viewOnceToggle = document.getElementById('view-once-toggle');
  const e2eBadge = document.getElementById('e2e-badge');
  const waitingRoomBanner = document.getElementById('waiting-room-banner');
  const waitingCopyBtn = document.getElementById('waiting-copy-btn');
  const reconnectingOverlay = document.getElementById('reconnecting-overlay');
  const reconnectingText = document.getElementById('reconnecting-text');
  const mediaBtn = document.getElementById('media-btn');
  const mediaFileInput = document.getElementById('media-file-input');
  const dropZoneOverlay = document.getElementById('drop-zone-overlay');

  // State
  let ws = null;
  let nickname = localStorage.getItem('chat_nickname') || '';
  let isConnected = false;
  let shouldReconnect = true;
  let reconnectAttempt = 0;
  let reconnectTimeout = null;
  let offlineQueue = [];
  let partnerPublicKey = null;

  // Typing & Ping Heartbeat
  let isTyping = false;
  let typingTimeout = null;
  let partnerTypingTimeout = null;
  let heartbeatInterval = null;

  // Sound & Focus State
  let soundEnabled = localStorage.getItem('chat_sound_enabled') !== 'false';
  let unreadCount = 0;
  const originalTitle = document.title;
  let isWindowFocused = document.hasFocus();

  // Initialize UI
  if (soundToggleBtn) {
    soundToggleBtn.textContent = soundEnabled ? '🔔' : '🔕';
    soundToggleBtn.title = soundEnabled ? 'Sound notifications ON' : 'Sound notifications OFF';
    soundToggleBtn.addEventListener('click', () => {
      soundEnabled = !soundEnabled;
      localStorage.setItem('chat_sound_enabled', soundEnabled ? 'true' : 'false');
      soundToggleBtn.textContent = soundEnabled ? '🔔' : '🔕';
      soundToggleBtn.title = soundEnabled ? 'Sound notifications ON' : 'Sound notifications OFF';
      showToast(soundEnabled ? '🔔 Sound notifications enabled' : '🔕 Sound muted');
    });
  }

  // Generate Avatar from nickname hash
  function generateAvatar(name) {
    if (!name) return '👤';
    let hash = 0;
    for (let i = 0; i < name.length; i++) {
      hash = name.charCodeAt(i) + ((hash << 5) - hash);
    }
    const colors = [
      ['#FF6B6B', '#FF8E53'],
      ['#6C5CE7', '#a29bfe'],
      ['#00B894', '#55efc4'],
      ['#0984E3', '#74b9ff'],
      ['#E84393', '#fd79a8'],
      ['#F39C12', '#F1C40F']
    ];
    const pair = colors[Math.abs(hash) % colors.length];
    if (userAvatar) {
      userAvatar.style.background = `linear-gradient(135deg, ${pair[0]} 0%, ${pair[1]} 100%)`;
      userAvatar.textContent = name.trim().charAt(0).toUpperCase();
    }
  }

  // Toast Notification System
  function showToast(message, type = 'normal', duration = 3000) {
    if (!toastContainer) return;
    const toast = document.createElement('div');
    toast.className = `toast ${type === 'danger' ? 'toast-danger' : type === 'success' ? 'toast-success' : ''}`;
    toast.textContent = message;
    toastContainer.appendChild(toast);

    setTimeout(() => {
      toast.style.animation = 'toastOut 0.3s cubic-bezier(0.16, 1, 0.3, 1) forwards';
      setTimeout(() => {
        if (toast.parentNode) toast.parentNode.removeChild(toast);
      }, 300);
    }, duration);
  }

  // Copy Link Handlers
  async function copyRoomLink() {
    const shareUrl = window.location.href;
    try {
      await navigator.clipboard.writeText(shareUrl);
      showToast('🔗 Room link copied to clipboard!', 'success');
      if (shareRoomBtn) {
        shareRoomBtn.textContent = '✓';
        setTimeout(() => { shareRoomBtn.textContent = '🔗'; }, 2000);
      }
    } catch (err) {
      prompt('Copy this shareable chat link:', shareUrl);
    }
  }

  if (shareRoomBtn) shareRoomBtn.addEventListener('click', copyRoomLink);
  if (waitingCopyBtn) waitingCopyBtn.addEventListener('click', copyRoomLink);

  // Sound Notification using Web Audio API
  function playNotificationSound() {
    if (!soundEnabled) return;
    try {
      const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();

      osc.type = 'sine';
      osc.frequency.setValueAtTime(587.33, audioCtx.currentTime); // D5
      osc.frequency.exponentialRampToValueAtTime(880, audioCtx.currentTime + 0.12); // A5

      gain.gain.setValueAtTime(0.001, audioCtx.currentTime);
      gain.gain.linearRampToValueAtTime(0.15, audioCtx.currentTime + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.25);

      osc.connect(gain);
      gain.connect(audioCtx.destination);

      osc.start();
      osc.stop(audioCtx.currentTime + 0.25);
    } catch (e) {}
  }

  // Focus and Unread Count
  window.addEventListener('focus', () => {
    isWindowFocused = true;
    unreadCount = 0;
    document.title = originalTitle;
    sendReadReceiptsForUnread();
  });

  window.addEventListener('blur', () => {
    isWindowFocused = false;
  });

  // Privacy Protection: Screenshot warning
  window.addEventListener('beforeprint', () => {
    showToast('⚠️ Privacy alert: Printing or capturing chat is discouraged.', 'danger', 4000);
  });

  // Theme Toggle
  const savedTheme = localStorage.getItem('chat_theme') || 'dark';
  document.documentElement.setAttribute('data-theme', savedTheme);
  themeIcon.textContent = savedTheme === 'dark' ? '☀️' : '🌙';

  themeToggle.addEventListener('click', () => {
    const current = document.documentElement.getAttribute('data-theme') || 'dark';
    const next = current === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    localStorage.setItem('chat_theme', next);
    themeIcon.textContent = next === 'dark' ? '☀️' : '🌙';
  });

  // Textarea input
  messageInput.addEventListener('input', () => {
    messageInput.style.height = 'auto';
    messageInput.style.height = `${Math.min(messageInput.scrollHeight, 120)}px`;
    handleTyping();
  });

  messageInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      chatForm.dispatchEvent(new Event('submit'));
    }
  });

  // Quick Emoji Click
  document.querySelectorAll('.emoji-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const emoji = btn.dataset.emoji;
      if (!emoji || messageInput.disabled) return;
      messageInput.value += emoji;
      messageInput.focus();
      handleTyping();
    });
  });

  // Scroll to bottom
  chatMessages.addEventListener('scroll', () => {
    const distanceToBottom = chatMessages.scrollHeight - chatMessages.scrollTop - chatMessages.clientHeight;
    if (distanceToBottom > 120) {
      scrollBottomBtn.classList.remove('hidden');
    } else {
      scrollBottomBtn.classList.add('hidden');
    }
  });

  scrollBottomBtn.addEventListener('click', () => {
    chatMessages.scrollTop = chatMessages.scrollHeight;
    scrollBottomBtn.classList.add('hidden');
  });

  if (nickname) {
    nicknameInput.value = nickname;
    if (userDisplayName) userDisplayName.textContent = nickname;
    generateAvatar(nickname);
  }

  function formatTime(timestamp) {
    if (!timestamp) return '';
    const date = new Date(timestamp);
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }

  // Safe parsing of text with clickable URLs (strictly using DOM methods, NEVER innerHTML)
  function renderSafeContent(container, text) {
    const urlRegex = /(https?:\/\/[^\s]+)/g;
    let lastIndex = 0;
    let match;

    while ((match = urlRegex.exec(text)) !== null) {
      if (match.index > lastIndex) {
        container.appendChild(document.createTextNode(text.substring(lastIndex, match.index)));
      }
      const link = document.createElement('a');
      link.href = match[0];
      link.textContent = match[0];
      link.target = '_blank';
      link.rel = 'noopener noreferrer nofollow';
      container.appendChild(link);
      lastIndex = urlRegex.lastIndex;
    }

    if (lastIndex < text.length) {
      container.appendChild(document.createTextNode(text.substring(lastIndex)));
    }
  }

  // Exit & Wipe confirmation flow with shred animation
  function promptExitModal() {
    if (exitModal) exitModal.style.display = 'flex';
  }

  function cancelExit() {
    if (exitModal) exitModal.style.display = 'none';
  }

  function executeWipeAndExit() {
    if (exitModal) exitModal.style.display = 'none';
    showToast('🧹 Shredding and wiping session...', 'danger', 2000);

    // Destroy Crypto Keys
    if (window.E2EE) window.E2EE.destroy();

    // Trigger shredder fade-out animation on all messages
    const rows = document.querySelectorAll('.message-row');
    rows.forEach((row, i) => {
      row.style.animationDelay = `${i * 30}ms`;
      row.classList.add('shredding');
    });

    // Close WebSocket cleanly
    shouldReconnect = false;
    if (ws) {
      try { ws.close(); } catch (e) {}
    }

    setTimeout(() => {
      clearMessages();
      try {
        window.history.replaceState(null, '', '/');
      } catch (e) {}
      window.location.href = '/';
    }, 600);
  }

  if (leaveRoomBtn) leaveRoomBtn.addEventListener('click', promptExitModal);
  if (cancelExitBtn) cancelExitBtn.addEventListener('click', cancelExit);
  if (confirmExitBtn) confirmExitBtn.addEventListener('click', executeWipeAndExit);

  // Shred / Purge specific message locally with animation
  function shredMessageLocally(msgId) {
    const row = chatMessages.querySelector(`[data-msg-id="${msgId}"]`);
    if (row) {
      row.classList.add('shredding');
      setTimeout(() => {
        if (row.parentNode) row.parentNode.removeChild(row);
      }, 500);
    }
  }

  // Send read receipt
  function sendReadReceipt(msgId) {
    if (isConnected && ws) {
      ws.send(JSON.stringify({
        type: 'read_receipt',
        message_id: msgId
      }));
    }
  }

  function sendReadReceiptsForUnread() {
    const partnerRows = chatMessages.querySelectorAll('.message-row.partner:not([data-read-acknowledged])');
    partnerRows.forEach(row => {
      const id = row.dataset.msgId;
      if (id) {
        row.dataset.readAcknowledged = 'true';
        sendReadReceipt(id);
        if (row.dataset.burnAfterRead === 'true') {
          setTimeout(() => shredMessageLocally(id), 2500);
        }
      }
    });
  }

  // Append Chat Message
  function appendMessage(sender, text, timestamp, type = 'partner', msgId = '', timerSeconds = 0, burnAfterRead = false) {
    const row = document.createElement('div');
    row.classList.add('message-row', type);
    const id = msgId || `local-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`;
    row.dataset.msgId = id;
    if (burnAfterRead) row.dataset.burnAfterRead = 'true';

    // Clipboard notice on message bubble
    row.addEventListener('copy', () => {
      showToast('🔒 Ephemeral message copy event', 'normal', 1500);
    });

    if (type !== 'system') {
      const senderEl = document.createElement('div');
      senderEl.classList.add('message-sender');
      senderEl.textContent = sender;
      row.appendChild(senderEl);
    }

    const bubble = document.createElement('div');
    bubble.classList.add('message-bubble');
    if (type === 'partner') bubble.title = 'Double click to react 👍';

    // Timer badge inside bubble if message has auto-destruct
    if (timerSeconds > 0) {
      const timerBadge = document.createElement('span');
      timerBadge.className = 'timer-badge';
      timerBadge.textContent = `⏳ ${timerSeconds}s`;
      bubble.appendChild(timerBadge);
    }

    if (burnAfterRead) {
      const burnBadge = document.createElement('span');
      burnBadge.className = 'burn-tag-bubble';
      burnBadge.textContent = `🔥 Burn`;
      bubble.appendChild(burnBadge);
    }

    const contentSpan = document.createElement('span');
    contentSpan.className = 'message-text-content';
    renderSafeContent(contentSpan, text);
    bubble.appendChild(contentSpan);

    row.appendChild(bubble);

    // Double-click partner message to react
    if (type === 'partner') {
      bubble.addEventListener('dblclick', () => {
        addReactionToMessage(id, '👍', true);
      });
    }

    // Time & Read ticks for sender
    if (timestamp && type !== 'system') {
      const timeEl = document.createElement('div');
      timeEl.classList.add('message-time');
      timeEl.textContent = formatTime(timestamp);

      if (type === 'me') {
        const tickSpan = document.createElement('span');
        tickSpan.className = 'read-status sent';
        tickSpan.id = `status-${id}`;
        tickSpan.textContent = ' ✓';
        tickSpan.title = 'Sent';
        timeEl.appendChild(tickSpan);
      }

      row.appendChild(timeEl);
    }

    chatMessages.appendChild(row);

    // Auto-scroll
    const isNearBottom = chatMessages.scrollHeight - chatMessages.scrollTop - chatMessages.clientHeight < 150;
    if (isNearBottom || type === 'me') {
      chatMessages.scrollTop = chatMessages.scrollHeight;
    }

    // Schedule auto-destruct timer removal if specified
    if (timerSeconds > 0) {
      setTimeout(() => {
        shredMessageLocally(id);
        if (isConnected && ws) {
          ws.send(JSON.stringify({ type: 'purge_message', message_id: id }));
        }
      }, timerSeconds * 1000);
    }

    // Handle Unread count and sound when partner sends a message
    if (type === 'partner') {
      if (!isWindowFocused) {
        unreadCount++;
        document.title = `(${unreadCount}) ${originalTitle}`;
        playNotificationSound();
      } else {
        row.dataset.readAcknowledged = 'true';
        sendReadReceipt(id);
        if (burnAfterRead) {
          setTimeout(() => shredMessageLocally(id), 2500);
        }
      }
    }

    return id;
  }

  // Append Ephemeral Media Bubble (P2P image transfer, cap at 5MB, view once support)
  function appendMediaMessage(sender, dataUrl, mimeType, timestamp, type = 'partner', msgId = '', viewOnce = false, timerSeconds = 0) {
    const row = document.createElement('div');
    row.classList.add('message-row', type, 'media-row');
    const id = msgId || `media-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`;
    row.dataset.msgId = id;

    if (type !== 'system') {
      const senderEl = document.createElement('div');
      senderEl.classList.add('message-sender');
      senderEl.textContent = sender;
      row.appendChild(senderEl);
    }

    const bubble = document.createElement('div');
    bubble.classList.add('message-bubble', 'media-bubble');

    if (viewOnce) {
      const viewOnceTag = document.createElement('span');
      viewOnceTag.className = 'burn-tag-bubble';
      viewOnceTag.textContent = '👁️ View Once';
      bubble.appendChild(viewOnceTag);
    }

    const imgWrapper = document.createElement('div');
    imgWrapper.className = `media-img-wrapper ${viewOnce && type === 'partner' ? 'view-once-blurred' : ''}`;

    const img = document.createElement('img');
    img.src = dataUrl;
    img.alt = 'Ephemeral media';
    img.className = 'ephemeral-chat-img';
    imgWrapper.appendChild(img);

    // View-once behavior
    if (viewOnce && type === 'partner') {
      const overlayBtn = document.createElement('button');
      overlayBtn.type = 'button';
      overlayBtn.className = 'view-once-reveal-btn';
      overlayBtn.textContent = '👁️ Tap to View';
      overlayBtn.onclick = () => {
        imgWrapper.classList.remove('view-once-blurred');
        overlayBtn.remove();
        showToast('👁️ This image will disappear permanently in 5s', 'normal', 3000);
        setTimeout(() => {
          shredMessageLocally(id);
          if (isConnected && ws) {
            ws.send(JSON.stringify({ type: 'purge_message', message_id: id }));
          }
        }, 5000);
      };
      imgWrapper.appendChild(overlayBtn);
    }

    bubble.appendChild(imgWrapper);
    row.appendChild(bubble);

    if (timestamp && type !== 'system') {
      const timeEl = document.createElement('div');
      timeEl.classList.add('message-time');
      timeEl.textContent = formatTime(timestamp);
      row.appendChild(timeEl);
    }

    chatMessages.appendChild(row);
    chatMessages.scrollTop = chatMessages.scrollHeight;

    if (timerSeconds > 0) {
      setTimeout(() => {
        shredMessageLocally(id);
      }, timerSeconds * 1000);
    }

    if (type === 'partner') {
      playNotificationSound();
    }

    return id;
  }

  function addReactionToMessage(messageId, emoji, sendToServer = false) {
    const row = chatMessages.querySelector(`[data-msg-id="${messageId}"]`);
    if (!row) return;

    let badge = row.querySelector('.reaction-badge');
    if (!badge) {
      badge = document.createElement('div');
      badge.classList.add('reaction-badge');
      row.appendChild(badge);
    }
    badge.textContent = emoji;

    if (sendToServer && ws && isConnected) {
      ws.send(JSON.stringify({
        type: 'reaction',
        message_id: messageId,
        emoji: emoji
      }));
    }
  }

  function setStatus(text, state = 'connecting') {
    statusLine.textContent = text;
    connectionDot.className = 'status-dot';
    if (state === 'connected') connectionDot.classList.add('dot-connected');
    else if (state === 'waiting') connectionDot.classList.add('dot-waiting');
    else if (state === 'offline') connectionDot.classList.add('dot-offline');
    else connectionDot.classList.add('dot-connecting');
  }

  function clearMessages() {
    chatMessages.replaceChildren();
  }

  function handleTyping() {
    if (!isConnected || !ws) return;

    if (!isTyping) {
      isTyping = true;
      ws.send(JSON.stringify({ type: 'typing', typing: true }));
    }

    clearTimeout(typingTimeout);
    typingTimeout = setTimeout(() => {
      isTyping = false;
      if (isConnected && ws) {
        ws.send(JSON.stringify({ type: 'typing', typing: false }));
      }
    }, 1500);
  }

  // Ping heartbeat to measure RTT connection quality
  function startHeartbeat() {
    clearInterval(heartbeatInterval);
    heartbeatInterval = setInterval(() => {
      if (isConnected && ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({
          type: 'ping',
          client_time: Date.now()
        }));
      }
    }, 5000);
  }

  function stopHeartbeat() {
    clearInterval(heartbeatInterval);
  }

  // Flush offline queued messages on reconnect
  function flushOfflineQueue() {
    if (!isConnected || !ws || offlineQueue.length === 0) return;
    showToast(`🔄 Sending ${offlineQueue.length} queued messages...`, 'normal', 2000);
    while (offlineQueue.length > 0 && ws.readyState === WebSocket.OPEN) {
      const item = offlineQueue.shift();
      ws.send(JSON.stringify(item));
    }
  }

  // Initiate E2EE Key Exchange with partner
  async function initiateKeyExchange() {
    if (!window.E2EE) return;
    try {
      const myPublicKey = await window.E2EE.init();
      if (myPublicKey && ws && isConnected) {
        ws.send(JSON.stringify({
          type: 'key_exchange',
          key: myPublicKey
        }));
      }
    } catch (err) {
      console.warn("E2EE init failed:", err);
    }
  }

  // Connect WebSocket with Exponential Backoff
  function connectWebSocket() {
    clearTimeout(reconnectTimeout);
    setStatus("Connecting...", "connecting");

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/ws/${encodeURIComponent(token)}`;

    ws = new WebSocket(wsUrl);

    ws.onopen = async () => {
      isConnected = true;
      reconnectAttempt = 0;
      if (reconnectingOverlay) reconnectingOverlay.classList.add('hidden');
      setStatus("Connected", "waiting");
      messageInput.disabled = false;
      sendBtn.disabled = false;
      if (mediaBtn) mediaBtn.disabled = false;
      messageInput.focus();

      if (nickname) {
        ws.send(JSON.stringify({
          type: 'set_nickname',
          nickname: nickname
        }));
      }

      startHeartbeat();
      flushOfflineQueue();
      await initiateKeyExchange();
    };

    ws.onmessage = async (event) => {
      try {
        const data = JSON.parse(event.data);

        // Ping / Pong RTT measurement
        if (data.type === 'pong') {
          const rtt = Date.now() - (data.client_time || Date.now());
          if (rttIndicator) {
            rttIndicator.textContent = `${rtt} ms`;
            rttIndicator.className = 'rtt-badge';
            if (rtt < 80) rttIndicator.classList.add('good');
            else if (rtt < 220) rttIndicator.classList.add('fair');
            else rttIndicator.classList.add('slow');
          }
          return;
        }

        // Delivery ack
        if (data.type === 'ack') {
          const tick = document.getElementById(`status-${data.id}`);
          if (tick) {
            tick.textContent = ' ✓';
            tick.title = 'Delivered to server';
          }
          return;
        }

        // Read receipt from partner
        if (data.type === 'read_receipt') {
          const tick = document.getElementById(`status-${data.message_id}`);
          if (tick) {
            tick.textContent = ' ✓✓';
            tick.classList.add('read');
            tick.title = 'Read by partner';
          }
          // If sender had burn-after-read active for this msg, shred sender side too
          const row = chatMessages.querySelector(`[data-msg-id="${data.message_id}"]`);
          if (row && row.dataset.burnAfterRead === 'true') {
            setTimeout(() => shredMessageLocally(data.message_id), 1200);
          }
          return;
        }

        // Purge message
        if (data.type === 'purge_message') {
          shredMessageLocally(data.message_id);
          return;
        }

        // Key Exchange for E2EE
        if (data.type === 'key_exchange' && data.key) {
          if (window.E2EE) {
            const success = await window.E2EE.setPartnerKey(data.key);
            if (success) {
              if (e2eBadge) {
                e2eBadge.textContent = '🔒 E2EE Active';
                e2eBadge.classList.add('active');
                e2eBadge.title = 'End-to-end encrypted with AES-256-GCM. Server cannot read messages.';
              }
              showToast('🔐 End-to-End Encryption Established!', 'success');
              if (!partnerPublicKey) {
                partnerPublicKey = data.key;
                const myPublicKey = await window.E2EE.init();
                if (myPublicKey && ws && isConnected) {
                  ws.send(JSON.stringify({ type: 'key_exchange', key: myPublicKey }));
                }
              }
            }
          }
          return;
        }

        // Status messages sent by server
        if (data.type === 'status') {
          if (data.text === 'room full') {
            setStatus("Room full", "offline");
            appendMessage("System", "Room is full (max 2 users).", data.timestamp, "system");
            shouldReconnect = false;
            messageInput.disabled = true;
            sendBtn.disabled = true;
            if (mediaBtn) mediaBtn.disabled = true;
            return;
          }
          const isWaiting = data.text.includes('Waiting');
          setStatus(data.text, isWaiting ? 'waiting' : 'connected');
          if (waitingRoomBanner) {
            if (isWaiting) waitingRoomBanner.classList.remove('hidden');
            else waitingRoomBanner.classList.add('hidden');
          }
          return;
        }

        // When a new partner connects
        if (data.type === 'join') {
          clearMessages();
          if (waitingRoomBanner) waitingRoomBanner.classList.add('hidden');
          setStatus("Partner connected", "connected");
          showToast('🎉 Partner connected to chat!', 'success');
          appendMessage("System", data.text || "Partner connected", data.timestamp, "system");
          await initiateKeyExchange();
          return;
        }

        // When partner leaves
        if (data.type === 'leave') {
          setStatus("Partner left - Session Wiped", "waiting");
          typingIndicator.classList.add('hidden');
          if (waitingRoomBanner) waitingRoomBanner.classList.remove('hidden');
          showToast('🧹 Partner left. All messages have been shredded & wiped!', 'danger', 4000);

          // Shred all messages visually with shredder animation, then clear them completely
          const rows = document.querySelectorAll('.message-row');
          rows.forEach((row, i) => {
            row.style.animationDelay = `${i * 20}ms`;
            row.classList.add('shredding');
          });

          setTimeout(() => {
            clearMessages();
            appendMessage("System", "Partner left. The session was completely wiped — no trace remains.", Date.now(), "system");
          }, 500);

          if (window.E2EE) window.E2EE.destroy();
          if (e2eBadge) {
            e2eBadge.textContent = '🔒 E2EE Standby';
            e2eBadge.classList.remove('active');
          }
          return;
        }

        // Partner typing state
        if (data.type === 'typing') {
          if (data.typing) {
            typingText.textContent = `${data.sender || 'Partner'} is typing...`;
            typingIndicator.classList.remove('hidden');
            clearTimeout(partnerTypingTimeout);
            partnerTypingTimeout = setTimeout(() => {
              typingIndicator.classList.add('hidden');
            }, 3000);
          } else {
            typingIndicator.classList.add('hidden');
          }
          return;
        }

        // Partner reaction
        if (data.type === 'reaction') {
          addReactionToMessage(data.message_id, data.emoji, false);
          return;
        }

        // Ephemeral Media message
        if (data.type === 'ephemeral_media') {
          typingIndicator.classList.add('hidden');
          appendMediaMessage(
            data.sender || 'Partner',
            data.media_data,
            data.mime_type,
            data.timestamp,
            'partner',
            data.id,
            data.view_once,
            data.timer
          );
          return;
        }

        // Incoming message from partner
        if (data.type === 'message') {
          typingIndicator.classList.add('hidden');
          let text = data.text;

          // Decrypt if E2EE is active
          if (data.encrypted && data.cipher_bytes && data.iv && window.E2EE && window.E2EE.isReady) {
            text = await window.E2EE.decrypt(data.cipher_bytes, data.iv);
          }

          appendMessage(
            data.sender || "Partner",
            text,
            data.timestamp,
            "partner",
            data.id,
            data.timer || 0,
            data.burn_after_read || false
          );
          return;
        }

        // Rate limit / error
        if (data.type === 'error') {
          showToast(`⚠️ ${data.text}`, 'danger');
          appendMessage("Alert", data.text, data.timestamp, "system");
          return;
        }
      } catch (err) {
        console.error("Message parse error", err);
      }
    };

    ws.onclose = () => {
      isConnected = false;
      stopHeartbeat();
      messageInput.disabled = true;
      sendBtn.disabled = true;
      if (mediaBtn) mediaBtn.disabled = true;
      typingIndicator.classList.add('hidden');

      if (!shouldReconnect) return;

      reconnectAttempt++;
      const delay = Math.min(1000 * Math.pow(2, reconnectAttempt - 1), 30000);
      setStatus("Reconnecting...", "connecting");
      if (reconnectingOverlay) {
        reconnectingOverlay.classList.remove('hidden');
        if (reconnectingText) reconnectingText.textContent = `Reconnecting in ${Math.round(delay / 1000)}s...`;
      }

      reconnectTimeout = setTimeout(() => {
        connectWebSocket();
      }, delay);
    };

    ws.onerror = (err) => {
      console.error("WebSocket error:", err);
    };
  }

  // Handle Nickname Modal Form
  nicknameForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const entered = nicknameInput.value.trim();
    nickname = entered || `User-${Math.floor(100 + Math.random() * 900)}`;
    localStorage.setItem('chat_nickname', nickname);
    if (userDisplayName) userDisplayName.textContent = nickname;
    generateAvatar(nickname);
    nicknameModal.style.display = 'none';

    try {
      window.history.replaceState(null, '', window.location.pathname);
    } catch (err) {}

    connectWebSocket();
  });

  // Handle Sending Messages
  chatForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const rawText = messageInput.value.trim();
    if (!rawText) return;

    const timerVal = parseInt(timerSelect.value, 10) || 0;
    const isBurn = burnToggle.checked;
    const msgId = `msg-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`;

    // Reset typing state
    isTyping = false;
    clearTimeout(typingTimeout);
    if (isConnected && ws) {
      ws.send(JSON.stringify({ type: 'typing', typing: false }));
    }

    // Encrypt if E2EE active
    let isEncrypted = false;
    let cipherBytes = null;
    let iv = null;
    let textToSend = rawText;

    if (window.E2EE && window.E2EE.isReady) {
      const encResult = await window.E2EE.encrypt(rawText);
      if (encResult.encrypted) {
        isEncrypted = true;
        cipherBytes = encResult.cipherBytes;
        iv = encResult.iv;
        textToSend = "[Encrypted blob]";
      }
    }

    const payload = {
      id: msgId,
      type: 'message',
      text: textToSend,
      timer: timerVal,
      burn_after_read: isBurn,
      encrypted: isEncrypted,
      cipher_bytes: cipherBytes,
      iv: iv
    };

    if (isConnected && ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(payload));
    } else {
      offlineQueue.push(payload);
      showToast('⚠️ Offline: Message queued and will send on reconnect.', 'normal');
    }

    appendMessage(nickname || "Me", rawText, Date.now(), 'me', msgId, timerVal, isBurn);

    // Send button pulse animation
    sendBtn.classList.add('pulsing');
    setTimeout(() => sendBtn.classList.remove('pulsing'), 500);

    messageInput.value = '';
    messageInput.style.height = 'auto';
    messageInput.focus();
  });

  // Ephemeral Media Handling (<5MB, Base64 transfer, never stored on server)
  function sendEphemeralImage(file) {
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) {
      showToast('⚠️ Image exceeds 5MB limit. Ephemeral media capped at 5MB.', 'danger');
      return;
    }
    const reader = new FileReader();
    reader.onload = (e) => {
      const dataUrl = e.target.result;
      const isViewOnce = viewOnceToggle ? viewOnceToggle.checked : false;
      const timerVal = parseInt(timerSelect.value, 10) || 0;
      const msgId = `media-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`;

      const payload = {
        id: msgId,
        type: 'ephemeral_media',
        media_data: dataUrl,
        mime_type: file.type || 'image/png',
        view_once: isViewOnce,
        timer: timerVal
      };

      if (isConnected && ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(payload));
      } else {
        offlineQueue.push(payload);
      }

      appendMediaMessage(nickname || "Me", dataUrl, file.type, Date.now(), 'me', msgId, isViewOnce, timerVal);
      showToast('📸 Ephemeral image sent (Zero server storage)', 'success');
    };
    reader.readAsDataURL(file);
  }

  // Media Button click & file input
  if (mediaBtn && mediaFileInput) {
    mediaBtn.addEventListener('click', () => mediaFileInput.click());
    mediaFileInput.addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (file) sendEphemeralImage(file);
      mediaFileInput.value = '';
    });
  }

  // Paste image directly into textarea
  messageInput.addEventListener('paste', (e) => {
    const items = (e.clipboardData || e.originalEvent.clipboardData).items;
    for (let i = 0; i < items.length; i++) {
      if (items[i].type.indexOf('image') !== -1) {
        e.preventDefault();
        const blob = items[i].getAsFile();
        sendEphemeralImage(blob);
        break;
      }
    }
  });

  // Drag and drop image onto window
  window.addEventListener('dragover', (e) => {
    e.preventDefault();
    if (dropZoneOverlay) dropZoneOverlay.classList.remove('hidden');
  });

  window.addEventListener('dragleave', (e) => {
    if (e.relatedTarget === null && dropZoneOverlay) {
      dropZoneOverlay.classList.add('hidden');
    }
  });

  window.addEventListener('drop', (e) => {
    e.preventDefault();
    if (dropZoneOverlay) dropZoneOverlay.classList.add('hidden');
    if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      const file = e.dataTransfer.files[0];
      if (file.type.startsWith('image/')) {
        sendEphemeralImage(file);
      } else {
        showToast('⚠️ Only ephemeral images (<5MB) are supported.', 'danger');
      }
    }
  });

  // PWA Service Worker Registration
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('/static/sw.js').catch(() => {});
    });
  }
})();

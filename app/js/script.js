(function() {
    'use strict';

    // ---------- DOM ----------
    const inputMode      = document.getElementById('inputMode');
    const karaokeMode    = document.getElementById('karaokeMode');
    const completionScreen = document.getElementById('completionScreen');
    const completionSongName = document.getElementById('completionSongName');
    const lyricsInput    = document.getElementById('lyricsInput');
    const goBtn          = document.getElementById('goBtn');
    const resetBtn       = document.getElementById('resetBtn');
    const phraseContext  = document.getElementById('phraseContext');
    const phraseActive   = document.getElementById('phraseActive');
    const statusDot      = document.getElementById('statusDot');
    const statusText     = document.getElementById('statusText');
    const repeatPhraseBtn= document.getElementById('repeatPhraseBtn');
    const prevBtn        = document.getElementById('prevBtn');
    const nextBtn        = document.getElementById('nextBtn');
    const micBtn         = document.getElementById('micBtn');
    const progressFill   = document.getElementById('progressFill');
    const progressText   = document.getElementById('progressText');
    const progressPercent= document.getElementById('progressPercent');
    const speedSlider    = document.getElementById('speedSlider');
    const speedValue     = document.getElementById('speedValue');

    // song title in header (editable)
    const songTitleDisplay = document.getElementById('songTitleDisplay');

    // search
    const searchArtist   = document.getElementById('searchArtist');
    const searchTitle    = document.getElementById('searchTitle');
    const searchLyricsBtn= document.getElementById('searchLyricsBtn');
    const searchFeedback = document.getElementById('searchFeedback');

    // completion
    const completionResetBtn = document.getElementById('completionResetBtn');

    // ---------- STATE ----------
    let phrases = [];
    let currentPhraseIndex = 0;
    let phraseCompleted = [];
    let recognition = null;
    let isListening = false;
    let selectedWordIndices = new Set();
    let wordElements = [];
    let nextWordIndex = 0;
    let playbackRate = 0.85;

    const synth = window.speechSynthesis;
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;

    /* ============================================================
       VOICE PICKER
       ============================================================ */
    let voices = [];

    function loadVoices() {
      if (!synth) return;
      voices = synth.getVoices() || [];
    }
    loadVoices();
    if (synth) {
      if (synth.addEventListener) synth.addEventListener('voiceschanged', loadVoices);
      setTimeout(loadVoices, 250);
      setTimeout(loadVoices, 1000);
      setTimeout(loadVoices, 2500);
    }

    function langPrefix(text) {
      const t = (text || '').toLowerCase();
      const pt = (t.match(/\b(o|a|os|as|um|uma|de|do|da|que|e|é|para|com|não|em|isso|me|eu|você|está)\b/g) || []).length;
      const en = (t.match(/\b(the|a|an|is|are|was|were|to|of|and|in|for|with|not|this|that|i|you|it|my)\b/g) || []).length;
      return pt > en ? 'pt' : 'en';
    }

    function pickVoice(text) {
      if (!voices.length) loadVoices();
      if (!voices.length) return null;
      const lp = langPrefix(text);
      let best = null, bestScore = -1;
      for (const v of voices) {
        if (!v.lang || !v.lang.toLowerCase().startsWith(lp)) continue;
        const name = (v.name || '').toLowerCase();
        let s = 1;
        if (name.includes('neural'))    s += 50;
        if (name.includes('natural'))   s += 40;
        if (name.includes('premium'))   s += 30;
        if (name.includes('enhanced'))  s += 25;
        if (name.includes('google'))    s += 20;
        if (name.includes('microsoft')) s += 15;
        if (name.includes('siri'))      s += 15;
        if (v.localService)             s += 5;
        if (s > bestScore) { bestScore = s; best = v; }
      }
      return best || voices.find(v => v.default) || voices[0] || null;
    }

    function logChosenVoice(text) {
      const v = pickVoice(text);
      if (v) {
        console.log('[How to Sing] Voice:', v.name, '| lang:', v.lang,
                    '| local:', v.localService);
      }
    }

    /* ============================================================
       SPEECH — race-safe
       ============================================================ */
    function speak(text, onEnd) {
      if (!synth) { setStatus('Speech synthesis not available', 'error'); return; }
      if (!text || !text.trim()) return;

      if (!voices.length) loadVoices();
      if (!voices.length) {
        setTimeout(() => {
          loadVoices();
          if (voices.length) speak(text, onEnd);
          else setStatus('No voices available on this device', 'error');
        }, 300);
        return;
      }

      logChosenVoice(text);

      const fire = () => {
        const u = new SpeechSynthesisUtterance(text);
        const v = pickVoice(text);
        if (v) u.voice = v;
        u.rate = playbackRate;
        u.pitch = 1.0;
        u.volume = 1.0;

        u.onstart = () => setStatus(`Listening… (${playbackRate.toFixed(2)}×)`, 'listening');
        u.onend = () => {
          if (onEnd) onEnd();
          else setStatus('Ready · tap Sing it', 'success');
        };
        u.onerror = (e) => {
          if (e.error === 'interrupted' || e.error === 'canceled') return;
          setStatus('Could not play audio', 'error');
        };
        synth.speak(u);
      };

      if (synth.speaking || synth.pending) {
        synth.cancel();
        setTimeout(fire, 60);
      } else {
        fire();
      }
    }

    /* ============================================================
       HELPERS
       ============================================================ */
    function setStatus(msg, type) {
      statusText.textContent = msg;
      statusDot.className = 'status-dot';
      if (type === 'listening') statusDot.classList.add('listening');
      else if (type === 'success') statusDot.classList.add('success');
      else if (type === 'error') statusDot.classList.add('error');
    }

    function stripPunct(s) {
      return s.toLowerCase().replace(/[^a-z0-9\s']/g, ' ').replace(/\s+/g, ' ').trim();
    }

    function wordMatches(spokenToken, targetClean) {
      if (!spokenToken || !targetClean) return false;
      if (spokenToken === targetClean) return true;
      if (targetClean.length >= 3 && spokenToken.length >= 2) {
        if (spokenToken.startsWith(targetClean)) return true;
        if (targetClean.startsWith(spokenToken) && spokenToken.length >= Math.ceil(targetClean.length * 0.6)) return true;
      }
      return false;
    }

    function escapeHTML(s) {
      return s.replace(/[&<>"']/g, c => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
      })[c]);
    }

    /* ============================================================
 TOAST
 ============================================================ */
const toastContainer = document.getElementById('toastContainer');

function showToast(message, type = 'info', duration = 3500) {
const toast = document.createElement('div');
toast.className = 'toast ' + type;

const icons = {
  success: 'fa-circle-check',
  error:   'fa-circle-exclamation',
  warning: 'fa-triangle-exclamation',
  info:    'fa-circle-info'
};
const icon = icons[type] || icons.info;

toast.innerHTML = `<i class="fa-solid ${icon}"></i><span>${escapeHTML(message)}</span>`;
toastContainer.appendChild(toast);

// Trigger the CSS transition on the next frame
requestAnimationFrame(() => toast.classList.add('show'));

// Auto-dismiss
setTimeout(() => {
  toast.classList.remove('show');
  toast.addEventListener('transitionend', () => toast.remove(), { once: true });
}, duration);
}

    /* ============================================================
       PARSE
       ============================================================ */
    function parseLyrics(text) {
      const lines = text.split(/\n/).map(l => l.trim()).filter(l => l.length > 0);
      return lines.map(line => {
        const tokens = line.split(/\s+/).filter(t => t.length > 0);
        const words = tokens.map(t => ({
          text: t,
          clean: stripPunct(t),
          done: false
        }));
        return { raw: line, words };
      });
    }

    /* ============================================================
       RENDER
       ============================================================ */
    function renderPhrase() {
      selectedWordIndices.clear();
      wordElements = [];
      nextWordIndex = 0;

      const phrase = phrases[currentPhraseIndex];
      if (!phrase) return;

      while (nextWordIndex < phrase.words.length && !phrase.words[nextWordIndex].clean) {
        phrase.words[nextWordIndex].done = true;
        nextWordIndex++;
      }

      let ctxHTML = '';
      phrases.forEach((p, i) => {
        if (i !== currentPhraseIndex - 1 && i !== currentPhraseIndex + 1) return;
        const cls = phraseCompleted[i] ? 'ctx-line done' : 'ctx-line';
        ctxHTML += `<span class="${cls}">${escapeHTML(p.raw)}</span>`;
      });
      phraseContext.innerHTML = ctxHTML;

      phraseActive.innerHTML = '';
      phrase.words.forEach((w, idx) => {
        const span = document.createElement('span');
        span.className = 'word';
        if (w.done) span.classList.add('phrase-done');
        span.textContent = w.text;
        span.dataset.idx = idx;

        span.addEventListener('click', (e) => {
          e.stopPropagation();
          handleWordTap(idx, span);
        });

        phraseActive.appendChild(span);
        wordElements.push(span);
      });

      markNextWord();
      updateProgress();
      updateNavButtons();
    }

    function markNextWord() {
      wordElements.forEach(el => el.classList.remove('next-up'));
      if (nextWordIndex < wordElements.length) {
        wordElements[nextWordIndex].classList.add('next-up');
      }
    }

    function handleWordTap(idx, span) {
      const phrase = phrases[currentPhraseIndex];
      const word = phrase.words[idx];
      if (!word) return;
      if (selectedWordIndices.has(idx)) {
        selectedWordIndices.delete(idx);
        span.classList.remove('selected');
      } else {
        selectedWordIndices.add(idx);
        span.classList.add('selected');
      }
      speak(word.text);
    }

    /* ============================================================
       PROGRESS / NAV
       ============================================================ */
    function updateProgress() {
      const total = phrases.length;
      const done = phraseCompleted.filter(Boolean).length;
      const pct = total > 0 ? Math.round((done / total) * 100) : 0;
      progressFill.style.width = pct + '%';
      progressText.textContent = `Phrase ${currentPhraseIndex + 1} of ${total}`;
      progressPercent.textContent = pct + '%';
    }

    function updateNavButtons() {
      prevBtn.disabled = currentPhraseIndex === 0;
      nextBtn.disabled = currentPhraseIndex >= phrases.length - 1;
      if (phraseCompleted[currentPhraseIndex]) {
        micBtn.className = 'nav-btn done';
        micBtn.innerHTML = '<i class="fa-solid fa-check"></i> <span>Done</span>';
      } else {
        micBtn.className = 'nav-btn primary';
        micBtn.innerHTML = '<i class="fa-solid fa-microphone"></i> <span>Sing it</span>';
      }
    }

    function goToPhrase(index) {
      if (index < 0 || index >= phrases.length) return;
      stopListening();
      currentPhraseIndex = index;
      renderPhrase();
      setStatus('Ready · tap Sing it', 'success');
    }

    /* ============================================================
       RECOGNITION
       ============================================================ */
    function initRecognition() {
      if (!SpeechRecognition) {
        setStatus('Speech recognition not supported on this browser', 'error');
        return null;
      }
      const r = new SpeechRecognition();
      r.continuous = true;
      r.interimResults = true;
      r.lang = 'en-US';

      r.onstart = () => {
        isListening = true;
        setStatus('Listening… sing the purple word', 'listening');
        micBtn.innerHTML = '<i class="fa-solid fa-stop"></i> <span>Stop</span>';
        micBtn.classList.remove('primary');
        micBtn.style.background = '#e57373';
        micBtn.style.borderColor = '#e57373';
        micBtn.style.color = 'white';
      };

      r.onresult = (event) => {
        const phrase = phrases[currentPhraseIndex];
        if (!phrase) return;
        if (nextWordIndex >= phrase.words.length) return;

        let full = '';
        for (let i = 0; i < event.results.length; i++) {
          full += event.results[i][0].transcript + ' ';
        }
        const tokens = stripPunct(full).split(/\s+/).filter(Boolean);
        if (tokens.length === 0) return;

        let advanced = false;
        for (let t = 0; t < tokens.length; t++) {
          if (nextWordIndex >= phrase.words.length) break;
          const targetWord = phrase.words[nextWordIndex];
          if (!targetWord.clean) { nextWordIndex++; continue; }

          if (wordMatches(tokens[t], targetWord.clean)) {
            confirmWord(nextWordIndex);
            nextWordIndex++;
            advanced = true;
            while (nextWordIndex < phrase.words.length && !phrase.words[nextWordIndex].clean) {
              phrase.words[nextWordIndex].done = true;
              if (wordElements[nextWordIndex]) wordElements[nextWordIndex].classList.add('phrase-done');
              nextWordIndex++;
            }
          }
        }

        if (advanced) {
          markNextWord();
          if (nextWordIndex >= phrase.words.length) {
            completePhrase();
          } else {
            const nextW = phrase.words[nextWordIndex];
            setStatus(`Now sing: “${nextW.text}”`, 'success');
          }
        } else if (tokens.length > 0) {
          const expected = phrase.words[nextWordIndex];
          if (expected) {
            setStatus(`Heard “${tokens[tokens.length-1]}” — try “${expected.text}” next`, 'error');
          }
        }
      };

      r.onerror = (e) => {
        if (e.error === 'no-speech') {
          setStatus('No speech detected — try again', 'error');
        } else if (e.error === 'aborted') {
          // ignore
        } else if (e.error === 'not-allowed') {
          setStatus('Microphone permission needed', 'error');
        } else {
          setStatus('Mic error: ' + e.error, 'error');
        }
      };

      r.onend = () => {
        isListening = false;
        micBtn.style.background = '';
        micBtn.style.borderColor = '';
        micBtn.style.color = '';
        if (phraseCompleted[currentPhraseIndex]) {
          updateNavButtons();
        } else {
          micBtn.innerHTML = '<i class="fa-solid fa-microphone"></i> <span>Sing it</span>';
          micBtn.classList.add('primary');
          setStatus('Stopped · tap Sing it to continue', 'success');
        }
      };

      return r;
    }

    function confirmWord(idx) {
      const phrase = phrases[currentPhraseIndex];
      const word = phrase.words[idx];
      if (!word || word.done) return;
      word.done = true;
      const el = wordElements[idx];
      if (el) {
        el.classList.add('phrase-done');
        el.classList.add('highlight');
        setTimeout(() => el.classList.remove('highlight'), 700);
      }
    }

    function completePhrase() {
      phraseCompleted[currentPhraseIndex] = true;
      updateProgress();
      updateNavButtons();
      setStatus('Phrase complete! Press Next', 'success');
      stopListening();
      setTimeout(() => {
        if (currentPhraseIndex < phrases.length - 1) {
          goToPhrase(currentPhraseIndex + 1);
        } else {
          setStatus('All phrases done — amazing work!', 'success');
          showCompletionScreen();
        }
      }, 1200);
    }

    /* ============================================================
       COMPLETION SCREEN
       ============================================================ */
    function showCompletionScreen() {
      stopListening();
      if (synth) synth.cancel();

      // Update the song name on the completion screen
      const songName = songTitleDisplay.textContent.trim() || 'your song';
      completionSongName.textContent = `“${songName}”`;

      // Hide karaoke mode, show completion
      karaokeMode.style.display = 'none';
      completionScreen.classList.add('visible');
      inputMode.style.display = 'none';
    }


    /* ============================================================
       START LISTENING
       ============================================================ */
    function startListening() {
      if (phraseCompleted[currentPhraseIndex]) {
        if (currentPhraseIndex < phrases.length - 1) goToPhrase(currentPhraseIndex + 1);
        else showCompletionScreen();
        return;
      }
      if (!recognition) recognition = initRecognition();
      if (!recognition) return;
      if (isListening) return;
      const phrase = phrases[currentPhraseIndex];
      nextWordIndex = 0;
      while (nextWordIndex < phrase.words.length && phrase.words[nextWordIndex].done) {
        nextWordIndex++;
      }
      markNextWord();
      try { recognition.start(); } catch (e) {}
    }

    function stopListening() {
      if (recognition && isListening) {
        try { recognition.stop(); } catch (e) {}
      }
      isListening = false;
    }

    /* ============================================================
       LRCLIB — LYRICS SEARCH
       ============================================================ */
    function setSearchFeedback(msg, type) {
      searchFeedback.className = 'search-feedback visible ' + type;
      if (type === 'loading') {
        searchFeedback.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> <span>${msg}</span>`;
      } else if (type === 'success') {
        searchFeedback.innerHTML = `<i class="fa-solid fa-circle-check"></i> <span>${msg}</span>`;
      } else if (type === 'error') {
        searchFeedback.innerHTML = `<i class="fa-solid fa-circle-exclamation"></i> <span>${msg}</span>`;
      }
    }

    function clearSearchFeedback() {
      searchFeedback.className = 'search-feedback';
      searchFeedback.innerHTML = '';
    }

    async function fetchLyricsFromLRCLIB(artist, title) {
      const url = `https://lrclib.net/api/search?artist_name=${encodeURIComponent(artist)}&track_name=${encodeURIComponent(title)}`;
      const res = await fetch(url, {
        headers: {
          'User-Agent': 'HowToSing/1.0 (https://dicarvalho.prof)'
        }
      });
      if (!res.ok) throw new Error('Network response ' + res.status);
      const results = await res.json();
      if (!results || results.length === 0) return null;

      const withLyrics = results.filter(r => r.plainLyrics && r.plainLyrics.trim().length > 0);
      if (withLyrics.length === 0) return null;

      const wanted = artist.toLowerCase();
      withLyrics.sort((a, b) => {
        const aMatch = (a.artistName || '').toLowerCase().includes(wanted) ? 0 : 1;
        const bMatch = (b.artistName || '').toLowerCase().includes(wanted) ? 0 : 1;
        return aMatch - bMatch;
      });

      return withLyrics[0];
    }

    // Split long blocks into phrases
    function normalizeLyrics(text) {
      const rawLines = text.split(/\n/).map(l => l.trim()).filter(l => l.length > 0);
      const out = [];
      rawLines.forEach(line => {
        const words = line.split(/\s+/);
        if (words.length <= 10) {
          out.push(line);
          return;
        }
        let chunk = [];
        let chunkLen = 0;
        words.forEach((w, i) => {
          chunk.push(w);
          chunkLen++;
          const endsPhrase = /[,.!?;:]$/.test(w) || i === words.length - 1;
          if ((chunkLen >= 8 && endsPhrase) || chunkLen >= 12) {
            out.push(chunk.join(' '));
            chunk = [];
            chunkLen = 0;
          }
        });
        if (chunk.length) out.push(chunk.join(' '));
      });
      return out.join('\n');
    }

    /* ============================================================
       SONG TITLE — AUTO UPDATE FROM SEARCH
       ============================================================ */
    function updateSongTitle(title) {
      if (title && title.trim()) {
        songTitleDisplay.textContent = title.trim();
      }
    }

    searchLyricsBtn.addEventListener('click', async () => {
      const artist = searchArtist.value.trim();
      const title = searchTitle.value.trim();

      if (!artist || !title) {
        setSearchFeedback('Por favor, coloque o artista e o nome da música.', 'error');
        return;
      }

      searchLyricsBtn.disabled = true;
      searchLyricsBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> <span>Searching…</span>';
      setSearchFeedback(`Looking up “${title}” by ${artist}…`, 'loading');

      try {
        const hit = await fetchLyricsFromLRCLIB(artist, title);
        if (!hit) {
          setSearchFeedback('No lyrics found. Check the spelling or paste them manually.', 'error');
          return;
        }
        const cleaned = normalizeLyrics(hit.plainLyrics);
        lyricsInput.value = cleaned;

        // Auto-update the song title in the header
        const foundTitle = hit.trackName || title;
        updateSongTitle(foundTitle);

        setSearchFeedback(
          `Found “${hit.trackName || title}” by ${hit.artistName || artist}. Ready to practice!`,
          'success'
        );
      } catch (err) {
        console.error('[LRCLIB]', err);
        setSearchFeedback('Lyrics service unreachable. Check your connection or paste manually.', 'error');
      } finally {
        searchLyricsBtn.disabled = false;
        searchLyricsBtn.innerHTML = '<i class="fa-solid fa-arrow-right-to-bracket"></i> <span>Find</span>';
      }
    });

    // Allow Enter key in search fields
    [searchArtist, searchTitle].forEach(inp => {
      inp.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          searchLyricsBtn.click();
        }
      });
    });

    // Manual edit of song title: ensure it stays visible
    songTitleDisplay.addEventListener('blur', () => {
      if (!songTitleDisplay.textContent.trim()) {
        songTitleDisplay.textContent = 'Música';
      }
    });

    /* ============================================================
       GO / RESET
       ============================================================ */
    function startKaraoke() {
      const raw = lyricsInput.value.trim();
      if (!raw) {
        showToast('Por favor, cole uma letra primeiro.');
        return;
      }
      phrases = parseLyrics(raw);
      if (phrases.length === 0) {
        showToast('Nenhuma frase detectada.');
        return;
      }
      phraseCompleted = phrases.map(() => false);
      currentPhraseIndex = 0;

      // Hide completion screen and input mode, show karaoke
      completionScreen.classList.remove('visible');
      inputMode.style.display = 'none';
      karaokeMode.style.display = 'flex';

      renderPhrase();
      setStatus('Ready · tap Sing it', 'success');
    }

    function resetToInput() {
      stopListening();
      if (synth) synth.cancel();

      // Hide karaoke and completion, show input
      karaokeMode.style.display = 'none';
      completionScreen.classList.remove('visible');
      inputMode.style.display = 'flex';

      phrases = [];
      phraseCompleted = [];
      currentPhraseIndex = 0;
      nextWordIndex = 0;
      selectedWordIndices.clear();
      clearSearchFeedback();

      // Reset song title to placeholder
      songTitleDisplay.textContent = 'Música';
    }

    /* ============================================================
       SPEED CONTROL
       ============================================================ */
    function updateSpeedLabel() {
      speedValue.textContent = playbackRate.toFixed(2) + '×';
    }

    speedSlider.addEventListener('input', (e) => {
      playbackRate = parseFloat(e.target.value);
      updateSpeedLabel();
      if (synth && (synth.speaking || synth.pending)) {
        synth.cancel();
        setStatus('Speed ' + playbackRate.toFixed(2) + '× · tap Hear it', 'success');
      }
    });

    /* ============================================================
       EVENTS
       ============================================================ */
    goBtn.addEventListener('click', startKaraoke);
    resetBtn.addEventListener('click', resetToInput);
    prevBtn.addEventListener('click', () => goToPhrase(currentPhraseIndex - 1));
    nextBtn.addEventListener('click', () => goToPhrase(currentPhraseIndex + 1));

    micBtn.addEventListener('click', () => {
      if (isListening) {
        stopListening();
      } else if (phraseCompleted[currentPhraseIndex]) {
        if (currentPhraseIndex < phrases.length - 1) goToPhrase(currentPhraseIndex + 1);
        else showCompletionScreen();
      } else {
        startListening();
      }
    });

    repeatPhraseBtn.addEventListener('click', () => {
      const phrase = phrases[currentPhraseIndex];
      if (!phrase) return;
      if (selectedWordIndices.size > 0) {
        const idxs = Array.from(selectedWordIndices).sort((a, b) => a - b);
        const txt = idxs.map(i => phrase.words[i].text).join(' ');
        speak(txt);
      } else {
        speak(phrase.raw);
      }
    });

    // Completion screen actions
    completionResetBtn.addEventListener('click', resetToInput);
    

    window.addEventListener('beforeunload', () => {
      if (synth) synth.cancel();
      stopListening();
    });

    updateSpeedLabel();
  })();

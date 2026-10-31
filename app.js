(() => {
  "use strict";

  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  const select = document.getElementById("dhikrSelect");
  const countEl = document.getElementById("count");
  const status = document.getElementById("status");
  const statusText = document.getElementById("statusText");
  const listenBtn = document.getElementById("listenBtn");
  const listenText = document.getElementById("listenText");
  const resetBtn = document.getElementById("resetBtn");
  const recognitionTitle = document.getElementById("recognitionTitle");
  const recognitionDetail = document.getElementById("recognitionDetail");
  const lastHeard = document.getElementById("lastHeard");
  const micPulse = document.getElementById("micPulse");
  const toast = document.getElementById("toast");

  const STORE_KEY = "misbah_voice_counts_v1";
  const counts = JSON.parse(localStorage.getItem(STORE_KEY) || "{}");
  let recognition = null;
  let listening = false;
  let manuallyStopped = true;
  let restartTimer = null;
  let lastAcceptedText = "";
  let lastAcceptedAt = 0;
  let toastTimer = null;

  const aliases = {
    "الله أكبر": ["الله أكبر", "الله واكبر", "اللّه أكبر", "اللهُ أكبر"],
    "سبحان الله": ["سبحان الله", "سبحانلله", "سبحان اللهِ"],
    "الحمد لله": ["الحمد لله", "الحمدلله", "الحمد للهِ"],
    "لا إله إلا الله": ["لا إله إلا الله", "لا اله الا الله", "لا إله الا الله", "لا اله إلا الله"]
  };

  function normalize(value) {
    return String(value || "")
      .toLowerCase()
      .replace(/[\u064B-\u065F\u0670\u0640]/g, "")
      .replace(/[أإآٱ]/g, "ا")
      .replace(/ة/g, "ه")
      .replace(/[^\u0621-\u064A0-9\s]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function currentDhikr() { return select.value; }
  function currentCount() { return Number(counts[currentDhikr()] || 0); }

  function save() {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(counts)); }
    catch (_) { showToast("تعذر حفظ العدد على هذا الجهاز."); }
  }

  function renderCount() {
    countEl.textContent = currentCount().toLocaleString("ar");
  }

  function setStatus(text, active) {
    statusText.textContent = text;
    status.classList.toggle("listening", Boolean(active));
    micPulse.classList.toggle("active", Boolean(active));
    listenBtn.classList.toggle("stop", Boolean(active));
    listenText.textContent = active ? "إيقاف الاستماع" : "ابدأ الاستماع";
  }

  function showToast(message) {
    toast.textContent = message;
    toast.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove("show"), 3300);
  }

  function matchesSelected(transcript) {
    const heard = normalize(transcript);
    const variants = aliases[currentDhikr()] || [currentDhikr()];
    return variants.some(phrase => {
      const target = normalize(phrase);
      return heard === target || (` ${heard} `).includes(` ${target} `);
    });
  }

  function acceptTranscript(transcript) {
    const cleaned = String(transcript || "").trim();
    if (!cleaned) return;
    lastHeard.textContent = cleaned;

    if (!matchesSelected(cleaned)) {
      recognitionTitle.textContent = "لم يتم احتساب هذا الصوت";
      recognitionDetail.textContent = "قل الذكر المحدد: " + currentDhikr();
      return;
    }

    const normalized = normalize(cleaned);
    const now = Date.now();
    // Prevent the same final result from being counted twice by browser event retries.
    if (normalized === lastAcceptedText && now - lastAcceptedAt < 1100) return;
    lastAcceptedText = normalized;
    lastAcceptedAt = now;

    counts[currentDhikr()] = currentCount() + 1;
    save();
    renderCount();
    recognitionTitle.textContent = "تم احتساب الذكر ✓";
    recognitionDetail.textContent = "أحسنت، واصل على مهل";
    if (navigator.vibrate) navigator.vibrate(35);
  }

  function createRecognition() {
    if (!SpeechRecognition) return null;
    const engine = new SpeechRecognition();
    engine.lang = "ar-JO";
    engine.continuous = true;
    engine.interimResults = false;
    engine.maxAlternatives = 3;

    engine.onstart = () => {
      if (!listening) return;
      setStatus("يستمع إليك الآن", true);
      recognitionTitle.textContent = "أنا أستمع إليك";
      recognitionDetail.textContent = "قل: " + currentDhikr();
    };

    engine.onresult = event => {
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        if (!result.isFinal) continue;
        // Count only one matching alternative for each final recognition result.
        let found = false;
        for (let j = 0; j < result.length; j++) {
          const phrase = result[j].transcript;
          if (matchesSelected(phrase)) {
            acceptTranscript(phrase);
            found = true;
            break;
          }
        }
        if (!found && result.length) acceptTranscript(result[0].transcript);
      }
    };

    engine.onerror = event => {
      if (event.error === "not-allowed" || event.error === "service-not-allowed") {
        listening = false;
        manuallyStopped = true;
        clearTimeout(restartTimer);
        setStatus("إذن الميكروفون غير متاح", false);
        recognitionTitle.textContent = "تعذر الوصول إلى الميكروفون";
        recognitionDetail.textContent = "تحقق من إعدادات الموقع في Safari ثم حاول مجدداً.";
        showToast("اسمح للمتصفح باستخدام الميكروفون من إعدادات الموقع.");
      } else if (event.error === "audio-capture") {
        recognitionDetail.textContent = "لم يتم العثور على ميكروفون متاح.";
      } else if (event.error === "network") {
        recognitionDetail.textContent = "تعذر الاتصال بخدمة التعرف الصوتي. تحقق من الإنترنت.";
      }
      // no-speech is normal during pauses; onend handles a controlled restart.
    };

    engine.onend = () => {
      if (!listening || manuallyStopped) return;
      clearTimeout(restartTimer);
      restartTimer = setTimeout(() => {
        if (!listening || manuallyStopped) return;
        try { engine.start(); }
        catch (_) {
          // A start already in progress is harmless; wait for the next end event.
        }
      }, 650);
    };
    return engine;
  }

  function startListening() {
    if (!SpeechRecognition) {
      showToast("التعرف الصوتي غير مدعوم في هذا المتصفح. جرّب Chrome أو Safari بإصدار حديث.");
      recognitionTitle.textContent = "المتصفح لا يدعم التعرف الصوتي";
      recognitionDetail.textContent = "هذه الميزة تعتمد على دعم المتصفح لخدمة تحويل الكلام إلى نص.";
      return;
    }
    if (listening) return;
    if (!recognition) recognition = createRecognition();
    listening = true;
    manuallyStopped = false;
    lastAcceptedText = "";
    setStatus("جارٍ تشغيل الميكروفون", true);
    recognitionTitle.textContent = "جارٍ الاتصال";
    recognitionDetail.textContent = "قد تظهر رسالة إذن الميكروفون عند أول استخدام فقط.";
    try {
      recognition.start();
    } catch (error) {
      listening = false;
      manuallyStopped = true;
      setStatus("جاهز للبدء", false);
      showToast("تعذر بدء الاستماع. انتظر لحظة ثم حاول مرة أخرى.");
    }
  }

  function stopListening() {
    listening = false;
    manuallyStopped = true;
    clearTimeout(restartTimer);
    if (recognition) {
      try { recognition.stop(); } catch (_) {}
    }
    setStatus("تم إيقاف الاستماع", false);
    recognitionTitle.textContent = "توقف الاستماع";
    recognitionDetail.textContent = "يمكنك العودة وبدء الاستماع متى شئت.";
  }

  listenBtn.addEventListener("click", () => {
    if (listening) stopListening();
    else startListening();
  });

  select.addEventListener("change", () => {
    renderCount();
    lastHeard.textContent = "—";
    recognitionTitle.textContent = "الذكر المحدد: " + currentDhikr();
    recognitionDetail.textContent = listening ? "قل الذكر الجديد بوضوح." : "ابدأ الاستماع عندما تكون مستعداً.";
  });

  resetBtn.addEventListener("click", () => {
    if (!confirm("هل تريد تصفير عدّاد «" + currentDhikr() + "»؟")) return;
    counts[currentDhikr()] = 0;
    save();
    renderCount();
    showToast("تم تصفير عدّاد الذكر المحدد.");
  });

  window.addEventListener("pagehide", () => {
    listening = false;
    manuallyStopped = true;
    clearTimeout(restartTimer);
    if (recognition) {
      try { recognition.abort(); } catch (_) {}
    }
  });

  renderCount();
  setStatus("جاهز للبدء", false);
})();

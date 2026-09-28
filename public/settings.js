// 設定パネル (アカウント / 通知 / 音声 / テーマ)
// index.html のメインスクリプトの後に読み込まれるため、socket をそのまま使えます。
(() => {
  // ★ Firebase コンソール(Authentication)で取得した値に置き換えてください
  const FIREBASE_CONFIG = {
    apiKey: "AIzaSyBwg8F35Joy0frgQ0yohf-nTobjc1BUgzc",
   authDomain: "new-world-ae4c0.firebaseapp.com",
   projectId: "new-world-ae4c0",
  };
  const FB = "https://www.gstatic.com/firebasejs/10.12.2/";
  const configured = !FIREBASE_CONFIG.apiKey.startsWith("YOUR_");

  const KEY = "appSettings";
  const $ = (id) => document.getElementById(id);
  const DEFAULTS = {
    theme: "system", notify: false,
    micId: "", spkId: "", micVol: 100, spkVol: 100, echo: true, noise: true,
    joinMicMute: false, joinSpkMute: false,
  };
  let S = { ...DEFAULTS };
  try { S = { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) || "{}") }; } catch {}
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(S)); } catch {} };

  // ---------- パネルの開閉・タブ ----------
  const overlay = $("settingsOverlay");
  function closeSettings() { overlay.classList.add("hidden"); stopMicTest(); }
  $("gearBtn").onclick = () => { overlay.classList.remove("hidden"); refreshDevices(); };
  $("closeSettings").onclick = closeSettings;
  overlay.addEventListener("click", (e) => { if (e.target === overlay) closeSettings(); });
  document.querySelectorAll(".tab").forEach((b) => {
    b.onclick = () => {
      document.querySelectorAll(".tab").forEach((x) => x.classList.toggle("on", x === b));
      document.querySelectorAll(".panel").forEach((p) =>
        p.classList.toggle("hidden", p.dataset.panel !== b.dataset.tab));
    };
  });

  // ---------- テーマ ----------
  const mq = matchMedia("(prefers-color-scheme: light)");
  function applyTheme() {
    const t = S.theme === "system" ? (mq.matches ? "light" : "dark") : S.theme;
    document.documentElement.dataset.theme = t;
  }
  mq.addEventListener("change", applyTheme);
  document.querySelectorAll('input[name="theme"]').forEach((r) => {
    r.checked = r.value === S.theme;
    r.onchange = () => { S.theme = r.value; save(); applyTheme(); };
  });

  // ---------- 通知 (デスクトップ通知: タブを見ていない間に表示) ----------
  const notifySupported = "Notification" in window;
  function notifyUi() {
    const t = $("notifyToggle");
    t.disabled = !notifySupported;
    t.checked = S.notify && notifySupported && Notification.permission === "granted";
    $("notifyHint").textContent = !notifySupported
      ? "このブラウザは通知に対応していません"
      : Notification.permission === "denied"
        ? "ブラウザ側でブロックされています。サイトの設定から許可してください"
        : "画面を見ていない間に、マッチング・新着メッセージ・相手の退出を通知します";
  }
  $("notifyToggle").onchange = async (e) => {
    if (e.target.checked) S.notify = (await Notification.requestPermission()) === "granted";
    else S.notify = false;
    save(); notifyUi();
  };
  function notify(title, body) {
    if (!S.notify || !notifySupported || Notification.permission !== "granted" || !document.hidden) return;
    new Notification(title, { body, tag: "room" });
  }
  socket.on("matched", ({ partnerName }) => notify("マッチングしました", `${partnerName} さんと接続しました`));
  socket.on("chat_message", ({ from, name, text }) => { if (from !== socket.id) notify(name, text); });
  socket.on("partner_left", () => notify("相手が退出しました", "もう一度入室できます"));

  // ---------- 音声 ----------
  const remoteAudio = $("remoteAudio");
  const canSink = "setSinkId" in HTMLMediaElement.prototype;

  async function refreshDevices() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) return;
    const devs = await navigator.mediaDevices.enumerateDevices();
    const fill = (sel, kind, cur, label) => {
      sel.innerHTML = "";
      sel.add(new Option("既定のデバイス", ""));
      devs.filter((d) => d.kind === kind)
        .forEach((d, i) => sel.add(new Option(d.label || `${label} ${i + 1}`, d.deviceId)));
      sel.value = cur;
      if (sel.value !== cur) sel.value = "";
    };
    fill($("micSel"), "audioinput", S.micId, "マイク");
    fill($("spkSel"), "audiooutput", S.spkId, "スピーカー");
    $("spkSel").disabled = !canSink;
    $("spkHint").textContent = canSink ? "" : "このブラウザではスピーカーの指定に対応していません(Chrome / Edge で利用できます)";
  }
  if (navigator.mediaDevices && navigator.mediaDevices.addEventListener) {
    navigator.mediaDevices.addEventListener("devicechange", refreshDevices);
  }

  function applyAudio() {
    remoteAudio.volume = S.spkVol / 100;
    if (canSink) remoteAudio.setSinkId(S.spkId || "").catch(() => {});
    VoiceCall.setSettings({ micId: S.micId, echo: S.echo, noise: S.noise, micGain: S.micVol / 100 });
  }

  function bindAudio() {
    $("micSel").onchange = (e) => { S.micId = e.target.value; save(); applyAudio(); };
    $("spkSel").onchange = (e) => { S.spkId = e.target.value; save(); applyAudio(); };
    for (const [id, key] of [["micVol", "micVol"], ["spkVol", "spkVol"]]) {
      const el = $(id), out = $(id + "Val");
      el.value = S[key];
      out.textContent = S[key] + "%";
      el.oninput = () => { S[key] = +el.value; out.textContent = el.value + "%"; applyAudio(); };
      el.onchange = save;
    }
    for (const [id, key] of [["echoToggle", "echo"], ["noiseToggle", "noise"]]) {
      const el = $(id);
      el.checked = S[key];
      el.onchange = () => { S[key] = el.checked; save(); applyAudio(); };
    }
  }

  // マイクテスト: 選択中のマイクと音量設定で入力レベルを表示
  let test = null;
  async function startMicTest() {
    try {
      const audio = { echoCancellation: S.echo, noiseSuppression: S.noise };
      if (S.micId) audio.deviceId = { ideal: S.micId };
      const stream = await navigator.mediaDevices.getUserMedia({ audio });
      const ctx = new AudioContext();
      const an = ctx.createAnalyser();
      an.fftSize = 1024;
      const gain = ctx.createGain();
      gain.gain.value = S.micVol / 100;
      ctx.createMediaStreamSource(stream).connect(gain).connect(an);
      const buf = new Uint8Array(an.fftSize);
      let raf = 0;
      const tick = () => {
        an.getByteTimeDomainData(buf);
        let sum = 0;
        for (const v of buf) { const x = (v - 128) / 128; sum += x * x; }
        $("meterBar").style.width = Math.min(1, Math.sqrt(sum / buf.length) * 4) * 100 + "%";
        raf = requestAnimationFrame(tick);
      };
      tick();
      test = { stream, ctx, stop: () => cancelAnimationFrame(raf) };
      $("micTestBtn").textContent = "テスト停止";
      refreshDevices(); // 許可後はデバイス名が取得できる
    } catch {
      $("micTestBtn").textContent = "マイクを使えません";
    }
  }
  function stopMicTest() {
    if (!test) return;
    test.stop();
    test.stream.getTracks().forEach((t) => t.stop());
    test.ctx.close();
    test = null;
    $("meterBar").style.width = "0";
    $("micTestBtn").textContent = "テスト開始";
  }
  $("micTestBtn").onclick = () => (test ? stopMicTest() : startMicTest());

  // ---------- 入室時ミュート / スピーカーミュート ----------
  // 入室前の画面と音声タブのチェックボックスは同じ設定を共有する
  for (const [key, ids] of [
    ["joinMicMute", ["preMic", "joinMicMute"]],
    ["joinSpkMute", ["preSpk", "joinSpkMute"]],
  ]) {
    const els = ids.map($);
    els.forEach((el) => {
      el.checked = S[key];
      el.onchange = () => {
        S[key] = el.checked;
        save();
        els.forEach((o) => (o.checked = S[key]));
      };
    });
  }

  const spkBtn = $("spkMuteBtn");
  let spkMuted = false;
  function setSpkMuted(v) {
    spkMuted = v;
    remoteAudio.muted = v;
    spkBtn.textContent = v ? "🔇 スピーカーのミュート解除" : "🔊 スピーカーをミュートする";
  }
  spkBtn.onclick = () => setSpkMuted(!spkMuted);

  // index.html 側の matched 処理(ミュート状態のリセット)の後に実行される
  socket.on("matched", () => {
    if (S.joinMicMute) $("muteBtn").click();
    setSpkMuted(S.joinSpkMute);
  });

  // ---------- アカウント (Firebase Authentication) ----------
  let fb = null;

  function renderAccount(user) {
    const box = $("accountBody");
    box.innerHTML = "";
    const add = (tag, text, cls) => {
      const e = document.createElement(tag);
      if (text) e.textContent = text;
      if (cls) e.className = cls;
      box.appendChild(e);
      return e;
    };
    const msg = document.createElement("p");
    msg.className = "hint";
    const run = async (fn) => {
      try { msg.textContent = ""; await fn(); } catch (e) { msg.textContent = "エラー: " + (e.code || e.message); }
    };
    const button = (text, cls, fn) => {
      const b = add("button", text, cls);
      b.disabled = !fb;
      b.onclick = () => run(fn);
      return b;
    };

    if (!configured) add("p", "アカウント機能を使うには、settings.js の FIREBASE_CONFIG を設定してください。", "hint");

    if (user) {
      if (user.photoURL) { const img = add("img", "", "avatar"); img.src = user.photoURL; img.alt = ""; }
      add("p", user.displayName || "(名前未設定)").style.fontWeight = "600";
      add("p", user.email || "", "hint").style.margin = "0 0 12px";
      const hasPw = user.providerData.some((p) => p.providerId === "password");
      add("label", "ユーザー名");
      const nameIn = add("input");
      nameIn.value = user.displayName || "";
      nameIn.maxLength = 20;
      nameIn.placeholder = "表示名";
      button("名前を保存", "secondary", async () => {
        const n = nameIn.value.trim().slice(0, 20);
        if (!n) throw new Error("名前を入力してください");
        await fb.m.updateProfile(user, { displayName: n });
        $("nameInput").value = n;
        renderAccount(fb.auth.currentUser);
      });
      if (hasPw && !user.emailVerified) {
        add("p", "メールアドレスが未確認です。届いた確認メールのリンクを開いてください。", "hint");
        button("確認メールを再送", "secondary", async () => {
          await fb.m.sendEmailVerification(user);
          msg.textContent = "確認メールを送信しました。";
        });
      }
      if (hasPw) {
        button("パスワード変更メールを送る", "secondary", async () => {
          await fb.m.sendPasswordResetEmail(fb.auth, user.email);
          msg.textContent = "メールを送信しました。メール内のリンクから変更できます。";
        });
      } else {
        const a = add("a", "Googleアカウントのパスワードは Google で変更", "hint");
        a.href = "https://myaccount.google.com/security"; a.target = "_blank"; a.rel = "noopener";
        a.style.display = "block"; a.style.marginBottom = "12px";
      }
      button("サインアウト", "secondary", () => fb.m.signOut(fb.auth));
      const del = button("アカウントを削除", "secondary", async () => {
        if (!confirm("アカウントを完全に削除します。元に戻せません。よろしいですか?")) return;
        try {
          await fb.m.deleteUser(user);
        } catch (e) {
          if (e.code !== "auth/requires-recent-login") throw e;
          // 削除は最近サインインした人だけ可能なので、本人確認をやり直す
          if (hasPw) {
            const pw = prompt("本人確認のため、パスワードを入力してください");
            if (!pw) return;
            await fb.m.reauthenticateWithCredential(user, fb.m.EmailAuthProvider.credential(user.email, pw));
          } else {
            await fb.m.reauthenticateWithPopup(user, new fb.m.GoogleAuthProvider());
          }
          await fb.m.deleteUser(user);
        }
      });
      del.style.color = "#ff6b6b";
      if (user.displayName) $("nameInput").value = user.displayName;
    } else {
      add("p", "サインインしていません。アカウントを作成すると、名前などを引き継げます。", "hint").style.margin = "0 0 12px";
      button("Googleでサインイン", "", () => fb.m.signInWithPopup(fb.auth, new fb.m.GoogleAuthProvider()));
      const email = add("input"); email.type = "email"; email.placeholder = "メールアドレス";
      const pw = add("input"); pw.type = "password"; pw.placeholder = "パスワード(6文字以上)";
      button("サインイン", "secondary", () => fb.m.signInWithEmailAndPassword(fb.auth, email.value, pw.value));
      button("アカウントを作成", "secondary", async () => {
        const cred = await fb.m.createUserWithEmailAndPassword(fb.auth, email.value, pw.value);
        await fb.m.sendEmailVerification(cred.user);
      });
    }
    box.appendChild(msg);
  }

  async function initAuth() {
    renderAccount(null);
    if (!configured) return;
    const [{ initializeApp }, m] = await Promise.all([
      import(FB + "firebase-app.js"),
      import(FB + "firebase-auth.js"),
    ]);
    const auth = m.getAuth(initializeApp(FIREBASE_CONFIG));
    fb = { auth, m };
    m.onAuthStateChanged(auth, renderAccount);

    // メール確認の完了を自動で検出する
    // (確認済みかどうかは、reload() しないと端末側の情報が更新されないため)
    const checkVerified = async () => {
      const u = auth.currentUser;
      if (!u || u.emailVerified) return;
      try {
        await u.reload();
        if (u.emailVerified) renderAccount(u);
      } catch {}
    };
    setInterval(checkVerified, 5000);
    window.addEventListener("focus", checkVerified);
    document.addEventListener("visibilitychange", () => { if (!document.hidden) checkVerified(); });
  }

  // ---------- 初期化 ----------
  applyTheme();
  bindAudio();
  applyAudio();
  notifyUi();
  initAuth().catch((e) => console.error("[auth]", e));
})();

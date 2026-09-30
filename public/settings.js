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
    joinMicMute: true, joinSpkMute: true,
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

  // ---------- アバター(アイコン画像) ----------
  // localStorage に保存(サインインしていなくても、この端末では使える)。
  // サインイン中は Firestore にも保存し、他の端末からも同じアイコンで使えるようにする。
  const AVATAR_KEY = "myAvatar";
  function loadLocalAvatar() {
    try { return localStorage.getItem(AVATAR_KEY); } catch { return null; }
  }
  function saveLocalAvatar(dataUrl) {
    try {
      if (dataUrl) localStorage.setItem(AVATAR_KEY, dataUrl);
      else localStorage.removeItem(AVATAR_KEY);
    } catch {}
  }
  // 変更を index.html 側(チャット表示)に伝える
  function broadcastAvatarChange() {
    window.dispatchEvent(new CustomEvent("avatarchange"));
  }

  // 画像ファイルを、正方形に切り抜いて小さく圧縮した data URL に変換する
  function fileToAvatarDataUrl(file) {
    return new Promise((resolve, reject) => {
      if (!file.type.startsWith("image/")) { reject(new Error("画像ファイルを選んでください")); return; }
      if (file.size > 8 * 1024 * 1024) { reject(new Error("ファイルが大きすぎます(8MBまで)")); return; }
      const img = new Image();
      const url = URL.createObjectURL(file);
      img.onload = () => {
        URL.revokeObjectURL(url);
        const SIZE = 128;
        const canvas = document.createElement("canvas");
        canvas.width = SIZE; canvas.height = SIZE;
        const ctx = canvas.getContext("2d");
        const side = Math.min(img.width, img.height);
        const sx = (img.width - side) / 2, sy = (img.height - side) / 2;
        ctx.drawImage(img, sx, sy, side, side, 0, 0, SIZE, SIZE);
        resolve(canvas.toDataURL("image/jpeg", 0.72));
      };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("画像を読み込めませんでした")); };
      img.src = url;
    });
  }

  async function syncAvatarToCloud(dataUrl) {
    if (!fb || !fb.auth.currentUser || !fb.fs) return;
    const { doc, setDoc, deleteDoc } = fb.fs.m;
    const ref = doc(fb.fs.db, "avatars", fb.auth.currentUser.uid);
    if (dataUrl) await setDoc(ref, { data: dataUrl, updatedAt: Date.now() });
    else await deleteDoc(ref).catch(() => {});
  }

  async function syncAvatarFromCloud(user) {
    if (!fb || !fb.fs || !user) return;
    try {
      const { doc, getDoc } = fb.fs.m;
      const snap = await getDoc(doc(fb.fs.db, "avatars", user.uid));
      if (snap.exists() && snap.data().data) {
        saveLocalAvatar(snap.data().data);
        broadcastAvatarChange();
        renderAvatarPreview();
      }
    } catch (e) { console.warn("[avatar] クラウドからの取得に失敗", e); }
  }

  let avatarPreviewEl = null;
  function renderAvatarPreview() {
    if (!avatarPreviewEl) return;
    const url = loadLocalAvatar();
    avatarPreviewEl.style.backgroundImage = url ? `url(${url})` : "none";
    avatarPreviewEl.textContent = url ? "" : "🙂";
  }

  function buildAvatarSection(container) {
    const wrap = document.createElement("div");
    wrap.style.cssText = "display:flex; align-items:center; gap:12px; margin-bottom:14px;";

    avatarPreviewEl = document.createElement("div");
    avatarPreviewEl.style.cssText =
      "width:56px; height:56px; border-radius:50%; background:#20242f; background-size:cover; " +
      "background-position:center; display:flex; align-items:center; justify-content:center; font-size:24px; flex:none;";
    renderAvatarPreview();

    const btnCol = document.createElement("div");
    btnCol.style.cssText = "flex:1;";

    const fileInput = document.createElement("input");
    fileInput.type = "file";
    fileInput.accept = "image/*";
    fileInput.style.display = "none";

    const changeBtn = document.createElement("button");
    changeBtn.type = "button";
    changeBtn.className = "secondary";
    changeBtn.textContent = "画像を変更";
    changeBtn.style.margin = "0 0 6px";
    changeBtn.onclick = () => fileInput.click();

    const removeBtn = document.createElement("button");
    removeBtn.type = "button";
    removeBtn.className = "secondary";
    removeBtn.textContent = "画像を削除";
    removeBtn.style.margin = "0";

    const errEl = document.createElement("p");
    errEl.className = "hint";
    errEl.style.margin = "4px 0 0";

    fileInput.addEventListener("change", async () => {
      const file = fileInput.files && fileInput.files[0];
      fileInput.value = "";
      if (!file) return;
      try {
        errEl.textContent = "処理中…";
        const dataUrl = await fileToAvatarDataUrl(file);
        saveLocalAvatar(dataUrl);
        broadcastAvatarChange();
        renderAvatarPreview();
        errEl.textContent = fb && fb.auth.currentUser ? "保存しました(このアカウントに同期されます)" : "保存しました(この端末のみ)";
        await syncAvatarToCloud(dataUrl);
      } catch (e) {
        errEl.textContent = "エラー: " + e.message;
      }
    });

    removeBtn.addEventListener("click", async () => {
      saveLocalAvatar(null);
      broadcastAvatarChange();
      renderAvatarPreview();
      errEl.textContent = "";
      await syncAvatarToCloud(null);
    });

    btnCol.appendChild(changeBtn);
    btnCol.appendChild(removeBtn);
    btnCol.appendChild(errEl);
    wrap.appendChild(avatarPreviewEl);
    wrap.appendChild(btnCol);
    wrap.appendChild(fileInput);
    container.appendChild(wrap);
  }

  // ---------- アカウント (Firebase Authentication) ----------
  let fb = null;

  function renderAccount(user) {
    const box = $("accountBody");
    box.innerHTML = "";

    buildAvatarSection(box);

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
          await syncAvatarToCloud(null);
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
      add("p", "サインインしていません。アカウントを作成すると、名前やアイコンを他の端末でも引き継げます。", "hint").style.margin = "0 0 12px";
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
    const [{ initializeApp }, m, fsMod] = await Promise.all([
      import(FB + "firebase-app.js"),
      import(FB + "firebase-auth.js"),
      import(FB + "firebase-firestore.js"),
    ]);
    const app = initializeApp(FIREBASE_CONFIG);
    const auth = m.getAuth(app);
    const db = fsMod.getFirestore(app);
    fb = { auth, m, fs: { db, m: fsMod } };
    m.onAuthStateChanged(auth, (user) => {
      renderAccount(user);
      if (user) syncAvatarFromCloud(user);
    });

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

// 音声通話モジュール (WebRTC)
//   VoiceCall.start(socket, initiator, audioEl, onStateChange)
//   VoiceCall.stop()
//   VoiceCall.setMuted(bool)
//   VoiceCall.setSettings({ micId, echo, noise, agc, micGain })  // 通話中でも反映

const VoiceCall = (() => {
  const ICE_SERVERS = [{ urls: "stun:stun.l.google.com:19302" }];

  let cfg = { micId: "", echo: true, noise: true, agc: true, micGain: 1 };
  let pc = null, socket = null, ready = null, sender = null;
  let rawStream = null, outTrack = null, audioCtx = null, gainNode = null;
  let pendingCandidates = [];
  let muted = false;

  // Opus を高音質設定に書き換える(128kbps / FEC有効 / DTX無効 / 10ms)
  function tuneOpus(sdp) {
    const m = sdp.match(/a=rtpmap:(\d+) opus\/48000\/2/);
    if (!m) return sdp;
    const pt = m[1];
    const params =
      "minptime=10;useinbandfec=1;usedtx=0;stereo=0;maxaveragebitrate=128000;maxplaybackrate=48000";
    const re = new RegExp(`a=fmtp:${pt} .*`);
    if (re.test(sdp)) return sdp.replace(re, `a=fmtp:${pt} ${params}`);
    return sdp.replace(m[0], `${m[0]}\r\na=fmtp:${pt} ${params}`);
  }

  async function flushCandidates() {
    for (const c of pendingCandidates) {
      try { await pc.addIceCandidate(c); } catch (e) { console.warn(e); }
    }
    pendingCandidates = [];
  }

  // マイク取得 → GainNode(音量調整) → 送信用トラック
  async function acquireMic() {
    const audio = {
      echoCancellation: cfg.echo,
      noiseSuppression: cfg.noise,
      autoGainControl: cfg.agc,
      channelCount: { ideal: 1 },
      sampleRate: { ideal: 48000 },
    };
    if (cfg.micId) audio.deviceId = { ideal: cfg.micId };
    const raw = await navigator.mediaDevices.getUserMedia({ audio });
    if (!audioCtx) audioCtx = new AudioContext();
    audioCtx.resume().catch(() => {});
    const src = audioCtx.createMediaStreamSource(raw);
    gainNode = audioCtx.createGain();
    gainNode.gain.value = cfg.micGain;
    const dest = audioCtx.createMediaStreamDestination();
    src.connect(gainNode).connect(dest);
    if (rawStream) rawStream.getTracks().forEach((t) => t.stop());
    rawStream = raw;
    outTrack = dest.stream.getAudioTracks()[0];
    outTrack.contentHint = "speech";
    outTrack.enabled = !muted;
    return { track: outTrack, stream: dest.stream };
  }

  function cleanupMic() {
    if (rawStream) rawStream.getTracks().forEach((t) => t.stop());
    if (audioCtx) audioCtx.close().catch(() => {});
    rawStream = outTrack = audioCtx = gainNode = null;
  }

  async function onSignal(msg) {
    if (!pc || !msg) return;
    const current = pc;
    try {
      if (msg.type === "offer") {
        await ready;
        if (pc !== current) return;
        await pc.setRemoteDescription(msg.sdp);
        await flushCandidates();
        const answer = await pc.createAnswer();
        await pc.setLocalDescription({ type: answer.type, sdp: tuneOpus(answer.sdp) });
        socket.emit("signal", { type: "answer", sdp: pc.localDescription });
      } else if (msg.type === "answer") {
        await pc.setRemoteDescription(msg.sdp);
        await flushCandidates();
      } else if (msg.type === "candidate" && msg.candidate) {
        if (pc.remoteDescription) await pc.addIceCandidate(msg.candidate);
        else pendingCandidates.push(msg.candidate);
      }
    } catch (e) {
      console.error("[VoiceCall] signal error", e);
    }
  }

  async function start(sock, initiator, audioEl, onStateChange) {
    stop();
    muted = false;
    socket = sock;
    pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
    const current = pc;

    pc.oniceconnectionstatechange = () => {
      console.log("[VoiceCall] ice:", current.iceConnectionState);
      if (onStateChange) onStateChange(current.iceConnectionState);
    };
    pc.onicecandidate = (e) => {
      if (e.candidate) socket.emit("signal", { type: "candidate", candidate: e.candidate });
    };
    pc.ontrack = (e) => {
      if (onStateChange) onStateChange("track-received");
      audioEl.srcObject = e.streams[0];
      audioEl.play().catch(() => {
        if (onStateChange) onStateChange("autoplay-blocked");
      });
    };

    socket.on("signal", onSignal);

    // マイクが使えなくても通話は切らない(聞くだけで続行)
    ready = acquireMic()
      .then(({ track, stream }) => {
        if (pc !== current) { cleanupMic(); return; }
        sender = pc.addTrack(track, stream);
      })
      .catch((e) => {
        console.warn("[VoiceCall] マイクなしで続行します", e);
        if (onStateChange) onStateChange("no-mic");
        if (initiator && pc === current) {
          pc.addTransceiver("audio", { direction: "recvonly" });
        }
      });

    await ready;

    if (initiator && pc === current) {
      const offer = await pc.createOffer();
      await pc.setLocalDescription({ type: offer.type, sdp: tuneOpus(offer.sdp) });
      socket.emit("signal", { type: "offer", sdp: pc.localDescription });
    }
  }

  // 設定の反映。音量は即時、マイク/エコー/ノイズの変更は通話中ならマイクを取り直す
  async function setSettings(next) {
    const prev = cfg;
    cfg = { ...cfg, ...next };
    if (gainNode) gainNode.gain.value = cfg.micGain;
    const changed = ["micId", "echo", "noise", "agc"].some((k) => prev[k] !== cfg[k]);
    if (changed && pc && sender) {
      try {
        const { track } = await acquireMic();
        await sender.replaceTrack(track);
      } catch (e) {
        console.warn("[VoiceCall] マイクの切り替えに失敗", e);
      }
    }
  }

  function setMuted(m) {
    muted = m;
    if (outTrack) outTrack.enabled = !m;
  }

  function stop() {
    if (socket) socket.off("signal", onSignal);
    cleanupMic();
    if (pc) pc.close();
    pc = sender = ready = null;
    pendingCandidates = [];
  }

  return { start, stop, setMuted, setSettings };
})();

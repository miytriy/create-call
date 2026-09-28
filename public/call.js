// 音声通話モジュール (WebRTC)
// 使い方:
//   <audio id="remoteAudio" autoplay></audio>
//   <script src="/call.js"></script>
//
//   socket.on("matched", ({ initiator }) =>
//     VoiceCall.start(socket, initiator, document.getElementById("remoteAudio")));
//   socket.on("partner_left", () => VoiceCall.stop());
//   // 退出ボタンを押したときも VoiceCall.stop() を呼ぶ
//   // ミュート: VoiceCall.setMuted(true / false)

const VoiceCall = (() => {
  const ICE_SERVERS = [{ urls: "stun:stun.l.google.com:19302" }];

  let pc = null;
  let localStream = null;
  let socket = null;
  let pendingCandidates = [];
  let ready = null;

  async function flushCandidates() {
    for (const c of pendingCandidates) {
      try { await pc.addIceCandidate(c); } catch (e) { console.warn(e); }
    }
    pendingCandidates = [];
  }

  async function onSignal(msg) {
    if (!pc || !msg) return;
    const current = pc;
    try {
      if (msg.type === "offer") {
        await ready; // マイク取得を待ってから応答する
        if (pc !== current) return;
        await pc.setRemoteDescription(msg.sdp);
        await flushCandidates();
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
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
      console.log("[VoiceCall] 相手の音声トラックを受信");
      if (onStateChange) onStateChange("track-received");
      audioEl.srcObject = e.streams[0];
      audioEl.play().catch((err) => {
        console.warn("[VoiceCall] 自動再生がブロックされました", err);
        if (onStateChange) onStateChange("autoplay-blocked");
      });
    };

    socket.on("signal", onSignal);

    ready = navigator.mediaDevices
      .getUserMedia({ audio: true })
      .then((stream) => {
        if (pc !== current) { stream.getTracks().forEach((t) => t.stop()); return; }
        localStream = stream;
        stream.getTracks().forEach((t) => pc.addTrack(t, stream));
      });

    try {
      await ready;
    } catch (e) {
      console.error("[VoiceCall] マイクを取得できません", e);
      stop();
      throw e;
    }

    if (initiator && pc === current) {
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      socket.emit("signal", { type: "offer", sdp: pc.localDescription });
    }
  }

  function setMuted(muted) {
    if (!localStream) return;
    localStream.getAudioTracks().forEach((t) => (t.enabled = !muted));
  }

  function stop() {
    if (socket) socket.off("signal", onSignal);
    if (localStream) localStream.getTracks().forEach((t) => t.stop());
    if (pc) pc.close();
    pc = null;
    localStream = null;
    pendingCandidates = [];
    ready = null;
  }

  return { start, stop, setMuted };
})();

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

  // Opus(音声コーデック)を高音質設定に書き換える
  //  - maxaveragebitrate: 最大128kbps(声なら十分に高音質)
  //  - useinbandfec: パケットが欠けても音が途切れにくくする
  //  - usedtx=0: 無音時も送り続けて、音の出だしが欠けるのを防ぐ
  //  - minptime=10: 10msごとに送って遅延を減らす
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

    // マイクが使えなくても通話は切らない(聞くだけのモードで続行)
    ready = Promise.resolve()
      .then(() => navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          channelCount: { ideal: 1 },
          sampleRate: { ideal: 48000 },
        },
      }))
      .then((stream) => {
        if (pc !== current) { stream.getTracks().forEach((t) => t.stop()); return; }
        localStream = stream;
        stream.getTracks().forEach((t) => {
          t.contentHint = "speech";
          pc.addTrack(t, stream);
        });
      })
      .catch((e) => {
        console.warn("[VoiceCall] マイクなしで続行します", e);
        if (onStateChange) onStateChange("no-mic");
        // 発信側は、音声を受信する枠を明示しないとofferに音声が含まれない
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

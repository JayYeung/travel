export class VoiceCompanion {
  constructor({ api, render, setState, token }) {
    this.api = api; this.render = render; this.setState = setState; this.token = token;
    this.captureStream = null; this.sessionId = null; this.started = false; this.active = false;
  }
  async capture() {
    this.stop();
    if (!navigator.mediaDevices?.getDisplayMedia) throw new Error("Use a recent Chrome browser on localhost to capture Meet tab audio.");
    const stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
    if (!stream.getAudioTracks().length) { stream.getTracks().forEach(track => track.stop()); throw new Error("No audio was shared. Choose the Meet tab and enable Share tab audio."); }
    this.captureStream = stream;
    stream.getAudioTracks()[0].addEventListener("ended", () => this.stop());
    this.audioContext = new AudioContext();
    const source = this.audioContext.createMediaStreamSource(new MediaStream(stream.getAudioTracks()));
    this.analyser = this.audioContext.createAnalyser(); this.analyser.fftSize = 2048; source.connect(this.analyser);
    this.samples = new Float32Array(this.analyser.fftSize);
    this.setState("Meet audio connected. Present this Fieldwork tab with audio, then begin.");
  }
  prepare(sessionId) { this.sessionId = sessionId; this.started = false; this.active = true; }
  async begin() {
    if (!this.captureStream || !this.sessionId || this.started) return;
    this.started = true; this.setState("Preparing opening question…");
    try {
      await this.audioContext.resume();
      const intro = await this.api(`/api/sessions/${this.sessionId}/intro`, "POST");
      this.render(await this.api(`/api/sessions/${this.sessionId}`));
      await this.play(intro);
      if (this.active) this.listen();
    } catch (err) { this.started = false; throw err; }
  }
  processAnswerNow() {
    if (this.recorder?.state !== "recording") return;
    this.heard = true;
    this.recorder.stop();
  }
  async play(result) {
    if (!result.audio) throw new Error("Could not generate speech. Check the OpenAI key on the server.");
    this.setState(`Speaking: ${result.say}`);
    const player = new Audio(`data:audio/mpeg;base64,${result.audio}`);
    this.player = player;
    await player.play();
    await new Promise((resolve, reject) => { player.onended = resolve; player.onerror = () => reject(new Error("Audio playback failed")); });
    this.player = null;
  }
  listen() {
    if (!this.active || !this.captureStream?.active) return;
    const track = this.captureStream.getAudioTracks()[0];
    const type = MediaRecorder.isTypeSupported("audio/webm;codecs=opus") ? "audio/webm;codecs=opus" : "audio/webm";
    const recorder = new MediaRecorder(new MediaStream([track]), { mimeType: type });
    this.recorder = recorder; this.chunks = []; this.heard = false;
    let speechTicks = 0, quietTicks = 0;
    const startedAt = Date.now();
    recorder.ondataavailable = event => { if (event.data.size) this.chunks.push(event.data); };
    recorder.onstop = async () => {
      clearInterval(this.meter);
      if (!this.active) return;
      if (!this.heard) { this.listen(); return; }
      try {
        this.setState("Transcribing the answer…");
        const clip = new Blob(this.chunks, { type: "audio/webm" });
        const response = await fetch(`/api/sessions/${this.sessionId}/transcribe`, { method: "POST", headers: { Authorization: `Bearer ${this.token()}`, "Content-Type": "audio/webm" }, body: clip });
        const transcript = await response.json(); if (!response.ok) throw new Error(transcript.error || "Transcription failed");
        if (!transcript.text?.trim()) { this.listen(); return; }
        this.setState(`Heard: ${transcript.text}`);
        const next = await this.api(`/api/sessions/${this.sessionId}/turn`, "POST", { text: transcript.text.trim(), speaker: "Guest" });
        this.render(await this.api(`/api/sessions/${this.sessionId}`));
        await this.play(next);
        if (next.done) { this.setState("Interview complete."); this.stop(); return; }
        this.listen();
      } catch (err) { this.setState(`Paused: ${err.message}`); this.active = false; }
    };
    recorder.start(1000); this.setState("Listening for the guest…");
    this.meter = setInterval(() => {
      if (recorder.state !== "recording") return;
      this.analyser.getFloatTimeDomainData(this.samples);
      let sum = 0; for (const value of this.samples) sum += value * value;
      const loud = Math.sqrt(sum / this.samples.length) > 0.014;
      if (loud) { speechTicks++; quietTicks = 0; if (speechTicks >= 3) this.heard = true; }
      else if (this.heard) quietTicks++;
      if ((this.heard && quietTicks >= 18) || Date.now() - startedAt > (this.heard ? 90_000 : 20_000)) recorder.stop();
    }, 100);
  }
  stop() {
    this.active = false; this.started = false;
    if (this.meter) clearInterval(this.meter);
    if (this.recorder?.state === "recording") this.recorder.stop();
    if (this.player) { this.player.pause(); this.player = null; }
    this.captureStream?.getTracks().forEach(track => track.stop());
    this.captureStream = null;
    this.audioContext?.close().catch(() => {});
  }
}

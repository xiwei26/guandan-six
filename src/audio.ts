type Sound = 'deal'|'turn'|'play'|'pass'|'bomb'|'win';
const KEY = 'guandan.sound';
const TONES: Record<Sound,{frequencies:number[];type:OscillatorType;duration:number;gain:number}> = {
  deal: {frequencies:[300,380,300],type:'triangle',duration:.05,gain:.04},
  turn: {frequencies:[560,740],type:'sine',duration:.09,gain:.06},
  play: {frequencies:[420,610],type:'sine',duration:.09,gain:.06},
  pass: {frequencies:[300,240],type:'sine',duration:.11,gain:.04},
  bomb: {frequencies:[180,130,95],type:'square',duration:.15,gain:.05},
  win: {frequencies:[523,659,784],type:'triangle',duration:.15,gain:.06},
};
let shared: AudioContext|null = null;
export function soundEnabled(): boolean {
  try { return localStorage.getItem(KEY) !== 'off'; } catch { return true; }
}
export function setSoundEnabled(enabled: boolean): void {
  try { localStorage.setItem(KEY,enabled ? 'on' : 'off'); } catch { /* 音效偏好无法保存时不影响对局 */ }
}
/** Synthesised feedback only: no audio assets, and a failure never blocks the game. */
export function playSound(kind: Sound): void {
  if (!soundEnabled()) return;
  const Ctor = window.AudioContext ?? (window as {webkitAudioContext?: typeof AudioContext}).webkitAudioContext;
  if (!Ctor) return;
  try {
    shared ??= new Ctor();
    const context = shared;
    if (context.state === 'suspended') void context.resume();
    const preset = TONES[kind];
    preset.frequencies.forEach((frequency,index)=>{
      const start = context.currentTime + index * preset.duration;
      const oscillator = context.createOscillator();
      const volume = context.createGain();
      oscillator.type = preset.type;
      oscillator.frequency.value = frequency;
      volume.gain.setValueAtTime(0.0001,start);
      volume.gain.linearRampToValueAtTime(preset.gain,start + 0.012);
      volume.gain.exponentialRampToValueAtTime(0.0001,start + preset.duration);
      oscillator.connect(volume).connect(context.destination);
      oscillator.start(start);
      oscillator.stop(start + preset.duration + 0.02);
    });
  } catch { /* 浏览器拒绝播放时静默 */ }
}

let context: AudioContext | undefined;
export function playFeedback(correct:boolean){
 try { context??=new AudioContext(); const audio=context;void audio.resume().then(()=>{
  const start=audio.currentTime;
  (correct?[523,659,784]:[330,247]).forEach((frequency,i)=>{const oscillator=audio.createOscillator(),gain=audio.createGain();oscillator.type='sine';oscillator.frequency.value=frequency;gain.gain.setValueAtTime(.0001,start+i*.13);gain.gain.exponentialRampToValueAtTime(.12,start+i*.13+.015);gain.gain.exponentialRampToValueAtTime(.0001,start+i*.13+.18);oscillator.connect(gain);gain.connect(audio.destination);oscillator.start(start+i*.13);oscillator.stop(start+i*.13+.2);oscillator.onended=()=>{oscillator.disconnect();gain.disconnect();};});
 }).catch(()=>{}); }catch{/* Text feedback remains available when audio is unsupported. */}
}
export function stopSpeech(){if('speechSynthesis' in window)window.speechSynthesis.cancel();}
export function readQuestion(text:string){if(!('speechSynthesis' in window))return;stopSpeech();const utterance=new SpeechSynthesisUtterance(text);utterance.lang='vi-VN';utterance.rate=.85;const voice=window.speechSynthesis.getVoices().find(v=>v.lang.toLowerCase().startsWith('vi'));if(voice)utterance.voice=voice;window.speechSynthesis.speak(utterance);}

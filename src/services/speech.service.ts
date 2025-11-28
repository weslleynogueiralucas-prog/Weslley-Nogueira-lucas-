
import { Injectable, signal } from '@angular/core';

@Injectable({
  providedIn: 'root'
})
export class SpeechService {
  isListening = signal<boolean>(false);
  availableVoices = signal<SpeechSynthesisVoice[]>([]);
  
  private recognition: any; // Using any for non-standard webkitSpeechRecognition
  private synthesis = window.speechSynthesis;

  constructor() {
    this.initRecognition();
    this.loadVoices();
    
    // Chrome carrega vozes de forma assíncrona
    if (window.speechSynthesis.onvoiceschanged !== undefined) {
      window.speechSynthesis.onvoiceschanged = () => this.loadVoices();
    }
  }

  private loadVoices() {
    const voices = this.synthesis.getVoices();
    // Prioriza vozes PT-BR, mas carrega todas
    const sortedVoices = voices.sort((a, b) => {
      const aBR = a.lang.includes('pt-BR') ? 1 : 0;
      const bBR = b.lang.includes('pt-BR') ? 1 : 0;
      return bBR - aBR;
    });
    this.availableVoices.set(sortedVoices);
  }

  private initRecognition() {
    if ('webkitSpeechRecognition' in window) {
      const SpeechRecognition = (window as any).webkitSpeechRecognition;
      this.recognition = new SpeechRecognition();
      this.recognition.continuous = false;
      this.recognition.interimResults = false;
      this.recognition.lang = 'pt-BR';

      this.recognition.onstart = () => this.isListening.set(true);
      this.recognition.onend = () => this.isListening.set(false);
    }
  }

  listen(): Promise<string> {
    return new Promise((resolve, reject) => {
      if (!this.recognition) {
        reject('Navegador não suporta reconhecimento de voz.');
        return;
      }

      this.recognition.onresult = (event: any) => {
        const transcript = event.results[0][0].transcript;
        resolve(transcript);
      };

      this.recognition.onerror = (event: any) => {
        reject(event.error);
      };

      this.recognition.start();
    });
  }

  stopListening() {
    if (this.recognition) {
      this.recognition.stop();
    }
  }

  speak(text: string, voiceURI?: string, rate: number = 1.0) {
    if (this.synthesis.speaking) {
      this.synthesis.cancel();
    }

    // Quebra texto longo para evitar corte do navegador
    const sentences = text.match(/[^.!?]+[.!?]+|[^.!?]+$/g) || [text];

    let index = 0;
    
    const speakNext = () => {
      if (index >= sentences.length) return;

      const utterance = new SpeechSynthesisUtterance(sentences[index]);
      utterance.lang = 'pt-BR';
      utterance.rate = rate; 

      // Selecionar Voz
      const voices = this.synthesis.getVoices();
      let selectedVoice = null;
      
      if (voiceURI) {
        selectedVoice = voices.find(v => v.voiceURI === voiceURI);
      }
      
      // Fallback inteligente se não achar a voz específica
      if (!selectedVoice) {
        selectedVoice = voices.find(v => v.lang.includes('pt-BR')) || voices[0];
      }

      if (selectedVoice) utterance.voice = selectedVoice;

      utterance.onend = () => {
        index++;
        speakNext();
      };
      
      // Tratamento de erro simples
      utterance.onerror = () => {
         index++;
         speakNext();
      }

      this.synthesis.speak(utterance);
    };

    speakNext();
  }

  stopSpeaking() {
    this.synthesis.cancel();
  }
}


import { Injectable } from '@angular/core';

export interface UserProfile {
  name: string;
  photo: string;
  isGuest: boolean;
}

export interface GameCardData {
  title: string;
  genre: string;
  platform: string;
  score: number; // 0-100
  difficulty: 'Easy' | 'Medium' | 'Hard' | 'Souls-like';
  playtime: string;
  stats: {
    graphics: number;
    gameplay: number;
    story: number;
    sound: number;
  };
  summary: string;
}

export interface ChatMessage {
  id: number;
  text: string;
  sender: 'user' | 'ai';
  imageUrl?: string;
  timestamp: number;
  type?: 'text' | 'image_req';
  expanded?: boolean; // Controls "Read More" state
  gameCard?: GameCardData; // Optional Game Card Data
  copied?: boolean; // Controls visual feedback for copy action
}

export interface UserSettings {
  autoSaveMedia: boolean;
  voiceURI: string;    // ID da voz escolhida
  voiceRate: number;   // Velocidade da fala (0.5 a 2.0)
}

@Injectable({
  providedIn: 'root'
})
export class StorageService {
  private readonly USER_KEY = 'parceiro_user_v1';
  private readonly HISTORY_KEY = 'parceiro_history_v1';
  private readonly MEMORY_KEY = 'parceiro_ai_memory_v1';
  private readonly SETTINGS_KEY = 'parceiro_settings_v1';
  
  // Default Assets
  readonly DEFAULT_AVATAR = 'https://picsum.photos/seed/gamer/200/200';
  readonly AI_AVATAR = 'https://cdn-icons-png.flaticon.com/512/4712/4712035.png';

  getUser(): UserProfile | null {
    const data = localStorage.getItem(this.USER_KEY);
    return data ? JSON.parse(data) : null;
  }

  saveUser(user: UserProfile): void {
    localStorage.setItem(this.USER_KEY, JSON.stringify(user));
  }

  getHistory(): ChatMessage[] {
    const data = localStorage.getItem(this.HISTORY_KEY);
    return data ? JSON.parse(data) : [];
  }

  saveHistory(messages: ChatMessage[]): void {
    localStorage.setItem(this.HISTORY_KEY, JSON.stringify(messages));
  }

  // --- Settings ---
  getSettings(): UserSettings {
    const data = localStorage.getItem(this.SETTINGS_KEY);
    const parsed = data ? JSON.parse(data) : {};
    
    // Merge with defaults to ensure new fields exist
    return {
      autoSaveMedia: parsed.autoSaveMedia ?? false,
      voiceURI: parsed.voiceURI ?? '',
      voiceRate: parsed.voiceRate ?? 1.1
    };
  }

  saveSettings(settings: UserSettings): void {
    localStorage.setItem(this.SETTINGS_KEY, JSON.stringify(settings));
  }

  // --- Long Term Memory ---
  getUserMemory(): string {
    return localStorage.getItem(this.MEMORY_KEY) || '';
  }

  saveUserMemory(memory: string): void {
    localStorage.setItem(this.MEMORY_KEY, memory);
  }

  clearHistory(): void {
    localStorage.removeItem(this.HISTORY_KEY);
  }

  clearAll(): void {
    localStorage.clear();
  }
}
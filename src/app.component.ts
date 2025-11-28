
import { Component, OnInit, signal, computed, ViewChild, ElementRef, inject, AfterViewChecked } from '@angular/core';
import { CommonModule, NgOptimizedImage } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { StorageService, UserProfile, ChatMessage, UserSettings, GameCardData } from './services/storage.service';
import { SpeechService } from './services/speech.service';
import { GeminiService } from './services/gemini.service';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [CommonModule, FormsModule, NgOptimizedImage],
  templateUrl: './app.component.html',
  styleUrls: []
})
export class AppComponent implements OnInit, AfterViewChecked {
  private storage = inject(StorageService);
  speech = inject(SpeechService);
  private gemini = inject(GeminiService);

  @ViewChild('scrollContainer') private scrollContainer!: ElementRef;
  @ViewChild('fileInput') private fileInput!: ElementRef;
  @ViewChild('profileInput') private profileInput!: ElementRef;

  user = signal<UserProfile | null>(null);
  messages = signal<ChatMessage[]>([]);
  settings = signal<UserSettings>({ autoSaveMedia: false, voiceURI: '', voiceRate: 1.1 });
  inputText = signal<string>('');
  isLoading = signal<boolean>(false);
  isSettingsOpen = signal<boolean>(false);
  isProfileModalOpen = signal<boolean>(false);
  voiceMode = signal<boolean>(false);
  attachedImage = signal<string | null>(null);

  hasUser = computed(() => !!this.user());
  tempName = signal('');
  tempPhoto = signal('');

  private messageCounter = 0;
  private readonly MEMORY_UPDATE_THRESHOLD = 5;

  ngOnInit() {
    this.loadData();
  }

  ngAfterViewChecked() {
    this.scrollToBottom();
  }

  loadData() {
    const userData = this.storage.getUser();
    const userMemory = this.storage.getUserMemory();
    const userSettings = this.storage.getSettings();
    this.gemini.initChat(userMemory);

    if (userData) {
      this.user.set(userData);
      this.tempName.set(userData.name);
      this.tempPhoto.set(userData.photo);
    }
    this.messages.set(this.storage.getHistory());
    this.settings.set(userSettings);
  }

  scrollToBottom(): void {
    if (this.scrollContainer) {
      try { this.scrollContainer.nativeElement.scrollTop = this.scrollContainer.nativeElement.scrollHeight; } catch(err) { }
    }
  }

  async login(guest: boolean = false) {
    const mockNames = ['Gabriel', 'Leo', 'Bruno', 'Lucas', 'Ana', 'Bia'];
    const randomName = mockNames[Math.floor(Math.random() * mockNames.length)];
    
    const newUser: UserProfile = {
      name: guest ? 'Visitante' : randomName,
      photo: this.storage.DEFAULT_AVATAR,
      isGuest: guest
    };
    this.user.set(newUser);
    this.storage.saveUser(newUser);
    
    if (this.messages().length === 0) {
      this.isLoading.set(true);
      if (guest) {
        this.addSystemMessage(`Olá! Sou o Wesley. Como posso ajudar você hoje?`);
      } else {
        const memory = this.storage.getUserMemory();
        const greeting = await this.gemini.generateGreeting(newUser.name, memory);
        this.addSystemMessage(greeting);
      }
      this.isLoading.set(false);
    }
  }

  saveProfile() {
    if (!this.user()) return;
    const updated = { ...this.user()!, name: this.tempName(), photo: this.tempPhoto() || this.storage.DEFAULT_AVATAR };
    this.user.set(updated);
    this.storage.saveUser(updated);
    this.isProfileModalOpen.set(false);
  }

  toggleAutoSave() {
    this.updateSetting('autoSaveMedia', !this.settings().autoSaveMedia);
  }

  updateSetting(key: keyof UserSettings, value: any) {
    this.settings.update(s => {
      const newSettings = { ...s, [key]: value };
      this.storage.saveSettings(newSettings);
      return newSettings;
    });
  }

  downloadImage(dataUrl: string, filename: string) {
    const link = document.createElement('a');
    link.href = dataUrl;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }

  toggleMessageExpanded(msgId: number) {
    this.messages.update(msgs => 
      msgs.map(m => m.id === msgId ? { ...m, expanded: !m.expanded } : m)
    );
  }

  copyToClipboard(id: number, text: string) {
    if (!navigator.clipboard) return;
    
    navigator.clipboard.writeText(text).then(() => {
      this.messages.update(msgs => 
        msgs.map(m => m.id === id ? { ...m, copied: true } : m)
      );
      setTimeout(() => {
        this.messages.update(msgs => 
          msgs.map(m => m.id === id ? { ...m, copied: false } : m)
        );
      }, 2000);
    }).catch(err => console.error('Failed to copy', err));
  }

  async sendMessage() {
    const text = this.inputText().trim();
    const image = this.attachedImage(); 

    if (!text && !image) return;

    // 1. Adiciona mensagem do usuário
    const userMsg: ChatMessage = { id: Date.now(), text, sender: 'user', imageUrl: image || undefined, timestamp: Date.now() };
    this.updateMessages(userMsg);
    
    this.inputText.set('');
    this.attachedImage.set(null);

    // 2. Comandos locais
    if (this.handleLocalCommands(text)) return;

    // 3. Loading
    this.isLoading.set(true);
    
    const aiMsgId = Date.now() + 1;
    let fullResponse = '';
    let messageCreated = false;

    try {
      const stream = this.gemini.sendMessageStream(text, image || undefined);

      for await (const chunk of stream) {
        fullResponse += chunk;
        
        if (!messageCreated) {
          this.isLoading.set(false); 
          this.updateMessages({ id: aiMsgId, text: fullResponse, sender: 'ai', timestamp: Date.now() });
          messageCreated = true;
        } else {
          this.messages.update(msgs => {
            const index = msgs.findIndex(m => m.id === aiMsgId);
            if (index !== -1) {
              const newMsgs = [...msgs];
              newMsgs[index] = { ...newMsgs[index], text: fullResponse };
              return newMsgs;
            }
            return msgs;
          });
        }
      }
      
      if (messageCreated) {
        this.storage.saveHistory(this.messages());
        this.processPostResponse(fullResponse, aiMsgId, text);
      } else {
        this.isLoading.set(false);
      }

    } catch (e) {
      this.isLoading.set(false);
    }
  }

  async processPostResponse(fullResponse: string, aiMsgId: number, userText: string) {
      let finalCleanText = fullResponse;
      let cardData: GameCardData | undefined;

      // Extrair Game Card
      const cardRegex = /\[\[GAME_CARD:\s*(\{.*?\})\s*\]\]/;
      const cardMatch = fullResponse.match(cardRegex);

      if (cardMatch) {
        try {
          cardData = JSON.parse(cardMatch[1]);
          finalCleanText = finalCleanText.replace(cardRegex, '').trim();
        } catch (e) { }
      }

      // Extrair Geração de Imagem
      const imgRegex = /\[\[GENERATE_IMAGE:\s*(.*?)\]\]/;
      const imgMatch = fullResponse.match(imgRegex);

      if (imgMatch) {
        // Remove APENAS o comando, mantendo o comentário natural feito antes
        let cleanText = finalCleanText.replace(imgRegex, '').trim();
        
        // Se a IA não disse nada antes (raro), coloca um placeholder
        if (!cleanText) cleanText = "Pode deixar, gerando sua imagem...";

        this.messages.update(msgs => {
           const index = msgs.findIndex(m => m.id === aiMsgId);
           if (index !== -1) {
             msgs[index].text = cleanText;
             if (cardData) msgs[index].gameCard = cardData;
           }
           return [...msgs];
        });

        const prompt = imgMatch[1];
        const generatedImage = await this.gemini.generateImage(prompt);
        
        if (generatedImage) {
          this.updateMessages({
            id: Date.now() + 2, 
            text: cardData ? 'Se liga no card.' : 'Tá na mão!', 
            sender: 'ai', 
            imageUrl: generatedImage, 
            timestamp: Date.now()
          });
          if (this.settings().autoSaveMedia) {
             this.downloadImage(generatedImage, `wesley_art_${Date.now()}.jpg`);
          }
        }
      } else {
        // Fluxo normal (sem imagem gerada)
        this.messages.update(msgs => {
           const index = msgs.findIndex(m => m.id === aiMsgId);
           if (index !== -1) {
             msgs[index].text = finalCleanText;
             if (cardData) msgs[index].gameCard = cardData;
           }
           return [...msgs];
        });
      }

      if (this.voiceMode() && !imgMatch) {
        this.speech.speak(finalCleanText, this.settings().voiceURI, this.settings().voiceRate);
      }
      this.checkAndLearn(userText, fullResponse);
  }

  handleLocalCommands(text: string): boolean {
    const lower = text.toLowerCase().trim();
    if (['limpar chat', 'clear', 'limpar'].some(cmd => lower === cmd)) {
      this.messages.set([]);
      this.storage.clearHistory();
      setTimeout(() => {
         this.addSystemMessage("Tudo limpo. Manda a boa.");
      }, 500);
      return true;
    }
    return false;
  }

  async checkAndLearn(lastUserMsg: string, lastAiMsg: string) {
    this.messageCounter++;
    if (this.messageCounter >= this.MEMORY_UPDATE_THRESHOLD) {
      this.messageCounter = 0;
      const recentContext = `User: ${lastUserMsg}\nAI: ${lastAiMsg}`;
      const currentMemory = this.storage.getUserMemory();
      const newMemory = await this.gemini.updateUserMemory(currentMemory, recentContext);
      if (newMemory !== currentMemory) this.storage.saveUserMemory(newMemory);
    }
  }

  addSystemMessage(text: string) {
    const msg: ChatMessage = { id: Date.now(), text, sender: 'ai', timestamp: Date.now() };
    this.updateMessages(msg);
    if (this.voiceMode()) {
      this.speech.speak(text, this.settings().voiceURI, this.settings().voiceRate);
    }
  }

  updateMessages(msg: ChatMessage) {
    const current = this.messages();
    const updated = [...current, msg];
    this.messages.set(updated);
    this.storage.saveHistory(updated);
  }

  toggleVoiceMode() {
    this.voiceMode.update(v => !v);
    if (!this.voiceMode()) this.speech.stopSpeaking();
    else this.addSystemMessage('Modo voz on. Pode falar.');
  }

  async startListening() {
    try {
      const text = await this.speech.listen();
      this.inputText.set(text);
      this.sendMessage();
    } catch (error) { }
  }

  triggerFileUpload() { this.fileInput.nativeElement.click(); }
  triggerProfileUpload() { this.profileInput.nativeElement.click(); }
  
  onFileSelected(event: any) {
    const file = event.target.files[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (e: any) => this.attachedImage.set(e.target.result);
      reader.readAsDataURL(file);
    }
  }

  onProfileImageSelected(event: any) {
    const file = event.target.files[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (e: any) => this.tempPhoto.set(e.target.result);
      reader.readAsDataURL(file);
    }
  }

  removeAttachment() { this.attachedImage.set(null); }
  clearHistory() {
    this.messages.set([]);
    this.storage.clearHistory();
    this.isSettingsOpen.set(false);
    this.addSystemMessage("Histórico apagado.");
  }
}

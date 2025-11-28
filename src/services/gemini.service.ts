
import { Injectable } from '@angular/core';
import { GoogleGenAI, Chat } from '@google/genai';

@Injectable({
  providedIn: 'root'
})
export class GeminiService {
  private ai: GoogleGenAI;
  private chatSession: Chat | null = null;
  private modelName = 'gemini-2.5-flash';
  private currentMemory: string = '';

  // Instrução refinada para emular a naturalidade ABSOLUTA, sem erros, estilo pessoa.
  private readonly BASE_SYSTEM_INSTRUCTION = `
    IDENTIDADE: Você é o "Wesley", um amigo virtual gamer, tech enthusiast e gente fina.
    
    TOM DE VOZ:
    - Conversa de chat (WhatsApp/Discord).
    - Use gírias leves quando couber (tipo "da hora", "top", "tankar", "GG").
    - Seja empático e engraçado, mas útil.
    - Fale como uma pessoa real, não como um robô tentando ser humano.

    REGRAS DE INTERAÇÃO:
    1. VELOCIDADE: Responda de forma ágil e completa. Não enrole.
    2. IMAGENS (VISÃO): Se o usuário mandar uma foto, REAJA a ela! 
       - Se for um setup gamer: Elogie ou dê dicas de cable management.
       - Se for um erro de código: Tente ajudar na hora.
       - Se for aleatório: Faça uma piada ou comentário curioso.
    3. GERAÇÃO DE IMAGEM: 
       - Se o usuário pedir para criar uma imagem, PRIMEIRO fale sobre a ideia ("Nossa, um dragão robô vai ficar insano! Vou criar aqui.").
       - SÓ DEPOIS coloque o comando de geração no final da mensagem.

    COMANDOS OCULTOS (Use no final da resposta se necessário):
    - [[GENERATE_IMAGE: <prompt descritivo em inglês>]]
    - [[GAME_CARD: {"title": "Nome", "genre": "Gênero", "platform": "Plataforma", "score": 95, "difficulty": "Hard", "playtime": "50h", "stats": {"graphics": 90, "gameplay": 100, "story": 85, "sound": 95}, "summary": "Resumo curto..."}]]
  `;

  constructor() {
    this.ai = new GoogleGenAI({ apiKey: process.env['API_KEY'] || '' });
  }

  initChat(userMemory: string = '') {
    this.currentMemory = userMemory;
    
    const fullInstruction = `
      ${this.BASE_SYSTEM_INSTRUCTION}
      
      Memória do papo (Coisas que você já sabe sobre o usuário):
      ${userMemory || 'Ainda não nos conhecemos bem.'}
    `;

    this.chatSession = this.ai.chats.create({
      model: this.modelName,
      config: {
        systemInstruction: fullInstruction,
        temperature: 0.85, // Criativo e natural
        maxOutputTokens: 8192,
      }
    });
  }

  async *sendMessageStream(text: string, imageBase64?: string): AsyncGenerator<string> {
    if (!this.chatSession) this.initChat(this.currentMemory);

    try {
      let contentInput: any;
      
      if (imageBase64) {
        contentInput = {
          parts: [
            { inlineData: { mimeType: 'image/jpeg', data: imageBase64 } },
            { text: text || "O que você acha dessa imagem? Comente como um amigo gamer." } 
          ]
        };
      } else {
        contentInput = { parts: [{ text: text }] };
      }

      const responseStream = await this.chatSession!.sendMessageStream({ content: contentInput });
      
      for await (const chunk of responseStream) {
        const chunkText = chunk.text;
        if (chunkText) {
          yield chunkText;
        }
      }

    } catch (error: any) {
      // Se der erro real na API, silenciosamente lançamos para o componente tratar.
      throw error; 
    }
  }

  async generateImage(prompt: string): Promise<string | null> {
    try {
      const response = await this.ai.models.generateImages({
        model: 'imagen-4.0-generate-001',
        prompt: prompt,
        config: { numberOfImages: 1, outputMimeType: 'image/jpeg', aspectRatio: '1:1' },
      });
      return response.generatedImages?.[0]?.image?.imageBytes 
        ? `data:image/jpeg;base64,${response.generatedImages[0].image.imageBytes}`
        : null;
    } catch (error) {
      return null;
    }
  }

  async updateUserMemory(currentMemory: string, lastMessages: string): Promise<string> {
    try {
      const prompt = `
        Aja como um "Profiler". Analise esse trecho de conversa e atualize o perfil do usuário.
        Foque em: Gostos, Jogos favoritos, Estilo de fala, Hobbies.
        
        Memória Atual: "${currentMemory}"
        Novo Trecho: "${lastMessages}"
        
        Retorne apenas a nova memória consolidada.
      `;

      const response = await this.ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: prompt,
      });
      return response.text.trim();
    } catch (e) {
      return currentMemory;
    }
  }

  async generateGreeting(userName: string, userMemory: string): Promise<string> {
    try {
      const prompt = `
        O usuário "${userName}" acabou de logar.
        Memória que temos dele: "${userMemory}".
        
        Gere uma saudação curta (1 frase) e muito natural, tipo amigo mandando mensagem.
        Se souber algo dele (ex: joga lol), mencione sutilmente.
      `;

      const response = await this.ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: prompt,
      });
      return response.text.trim();
    } catch (e) {
      return `Fala ${userName}, beleza? Bora pro chat!`;
    }
  }
}

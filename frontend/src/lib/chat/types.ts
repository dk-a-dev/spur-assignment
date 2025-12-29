export type Sender = 'user' | 'ai';

export type ChatMessage = {
  id: string;
  sender: Sender;
  text: string;
  createdAt?: string;
};

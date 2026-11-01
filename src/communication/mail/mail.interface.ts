export interface SendMailOptions {
  to: string;
  subject: string;
  html: string;
  text?: string;
}

export interface MailProvider {
  send(options: SendMailOptions): Promise<{ messageId: string }>;
}

export interface SendSmsOptions {
  to: string;
  message: string;
}

export interface SmsProvider {
  send(options: SendSmsOptions): Promise<{ messageId: string }>;
}

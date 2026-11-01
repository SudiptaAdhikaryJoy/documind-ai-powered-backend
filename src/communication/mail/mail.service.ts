import { Injectable, Logger } from '@nestjs/common';
import * as nodemailer from 'nodemailer';
import type { Transporter } from 'nodemailer';
import { MailProvider, SendMailOptions } from './mail.interface';

@Injectable()
export class MailService implements MailProvider {
  private readonly logger = new Logger(MailService.name);
  private readonly fromAddress: string;
  private readonly transporter: Transporter | null = null;

  constructor() {
    const smtpUser = process.env.SMTP_USER;
    const smtpPass = process.env.SMTP_PASS;
    this.fromAddress =
      process.env.MAIL_FROM ??
      (smtpUser ? `DocuMind AI <${smtpUser}>` : 'DocuMind AI <no-reply@documind.ai>');

    if (smtpUser && smtpPass) {
      this.transporter = nodemailer.createTransport({
        host: process.env.SMTP_HOST ?? 'smtp.gmail.com',
        port: Number(process.env.SMTP_PORT ?? 587),
        secure: process.env.SMTP_SECURE === 'true',
        auth: {
          user: smtpUser,
          pass: smtpPass,
        },
      });
      this.logger.log(`Nodemailer SMTP initialized for ${smtpUser}`);
    }
  }

  async send(options: SendMailOptions): Promise<{ messageId: string }> {
    if (this.transporter) {
      return this.sendWithNodemailer(options);
    }

    // Fallback: Mock Provider (Logs formatted email to terminal/logger)
    return this.sendWithMock(options);
  }

  private async sendWithNodemailer(options: SendMailOptions): Promise<{ messageId: string }> {
    try {
      this.logger.log(`Dispatching email via Nodemailer to ${options.to}...`);
      const info = await this.transporter!.sendMail({
        from: this.fromAddress,
        to: options.to,
        subject: options.subject,
        html: options.html,
        text: options.text,
      });

      this.logger.log(`Email successfully delivered to ${options.to} (Message-ID: ${info.messageId})`);
      return { messageId: info.messageId };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(`Nodemailer dispatch failed: ${message}. Falling back to mock logger.`);
      return this.sendWithMock(options);
    }
  }

  private async sendWithMock(options: SendMailOptions): Promise<{ messageId: string }> {
    const messageId = `mock-mail-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    this.logger.log(
      `\n┌── [MOCK EMAIL DISPATCHED] ───────────────────────────\n` +
      `│ Message-ID : ${messageId}\n` +
      `│ From       : ${this.fromAddress}\n` +
      `│ To         : ${options.to}\n` +
      `│ Subject    : ${options.subject}\n` +
      `│ Body       :\n│ ${options.text?.replace(/\n/g, '\n│ ') ?? options.subject}\n` +
      `└───────────────────────────────────────────────────────`,
    );
    return { messageId };
  }
}


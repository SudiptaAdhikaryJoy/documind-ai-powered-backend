import { Injectable, Logger } from '@nestjs/common';
import { SendSmsOptions, SmsProvider } from './sms.interface';

@Injectable()
export class SmsService implements SmsProvider {
  private readonly logger = new Logger(SmsService.name);
  private readonly provider: string;
  private readonly firebaseApiKey?: string;
  private readonly twilioSid?: string;
  private readonly twilioToken?: string;
  private readonly twilioFrom?: string;
  private readonly gatewayUrl?: string;
  private readonly gatewayMethod: string;

  constructor() {
    this.provider = (process.env.SMS_PROVIDER ?? 'firebase').toLowerCase();
    this.firebaseApiKey = process.env.FIREBASE_API_KEY;
    this.twilioSid = process.env.TWILIO_ACCOUNT_SID;
    this.twilioToken = process.env.TWILIO_AUTH_TOKEN;
    this.twilioFrom = process.env.TWILIO_PHONE_NUMBER;
    this.gatewayUrl = process.env.SMS_GATEWAY_URL;
    this.gatewayMethod = (process.env.SMS_GATEWAY_METHOD ?? 'GET').toUpperCase();
  }

  async send(options: SendSmsOptions): Promise<{ messageId: string }> {
    const normalizedPhone = this.normalizePhoneNumber(options.to);
    const normalizedOptions = { ...options, to: normalizedPhone };

    if (this.gatewayUrl) {
      return this.sendWithGenericGateway(normalizedOptions);
    }

    if (this.provider === 'twilio' && this.twilioSid && this.twilioToken) {
      return this.sendWithTwilio(normalizedOptions);
    }

    if (this.provider === 'firebase' && this.firebaseApiKey) {
      return this.sendWithFirebase(normalizedOptions);
    }

    // Default: Mock Provider (Logs to logger/terminal with ASCII framing)
    return this.sendWithMock(normalizedOptions);
  }

  private normalizePhoneNumber(phone: string): string {
    const cleaned = phone.trim().replace(/[\s\-()]/g, '');
    if (cleaned.startsWith('+')) {
      return cleaned;
    }
    // If it's an 11-digit Bangladesh number (e.g. 01608525108)
    if (/^01[3-9]\d{8}$/.test(cleaned)) {
      return `+88${cleaned}`;
    }
    // If it starts with 8801...
    if (/^8801[3-9]\d{8}$/.test(cleaned)) {
      return `+${cleaned}`;
    }
    return `+${cleaned}`;
  }

  private async sendWithMock(options: SendSmsOptions): Promise<{ messageId: string }> {
    const messageId = `mock-sms-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    this.logger.log(
      `\n┌── [MOCK SMS DISPATCHED] ────────────────────────────\n` +
      `│ Message-ID : ${messageId}\n` +
      `│ Recipient  : ${options.to}\n` +
      `│ Content    : ${options.message}\n` +
      `└───────────────────────────────────────────────────────`,
    );
    return { messageId };
  }

  private async sendWithFirebase(options: SendSmsOptions): Promise<{ messageId: string }> {
    try {
      const url = `https://identitytoolkit.googleapis.com/v1/accounts:sendVerificationCode?key=${this.firebaseApiKey}`;
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          phoneNumber: options.to,
        }),
      });

      if (!response.ok) {
        const errText = await response.text();
        this.logger.warn(`Firebase SMS API responded with ${response.status}: ${errText}. Using mock logger.`);
        return this.sendWithMock(options);
      }

      const data = (await response.json()) as { sessionInfo?: string };
      this.logger.log(`Firebase SMS verification dispatched to ${options.to}`);
      return { messageId: data.sessionInfo ?? `fb-${Date.now()}` };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(`Firebase SMS error: ${message}. Falling back to mock.`);
      return this.sendWithMock(options);
    }
  }

  private async sendWithTwilio(options: SendSmsOptions): Promise<{ messageId: string }> {
    try {
      const url = `https://api.twilio.com/2010-04-01/Accounts/${this.twilioSid}/Messages.json`;
      const auth = Buffer.from(`${this.twilioSid}:${this.twilioToken}`).toString('base64');
      const body = new URLSearchParams({
        To: options.to,
        From: this.twilioFrom ?? '',
        Body: options.message,
      });

      const response = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: `Basic ${auth}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: body.toString(),
      });

      if (!response.ok) {
        const errText = await response.text();
        this.logger.warn(`Twilio SMS API responded with ${response.status}: ${errText}. Using mock logger.`);
        return this.sendWithMock(options);
      }

      const data = (await response.json()) as { sid: string };
      this.logger.log(`Twilio SMS dispatched to ${options.to} (SID: ${data.sid})`);
      return { messageId: data.sid };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(`Twilio SMS error: ${message}. Falling back to mock.`);
      return this.sendWithMock(options);
    }
  }

  private async sendWithGenericGateway(options: SendSmsOptions): Promise<{ messageId: string }> {
    try {
      const rawPhone = options.to.replace(/^\+88/, '').replace(/^\+/, '');
      const dynamicUrl = this.gatewayUrl!
        .replace('{to}', encodeURIComponent(options.to))
        .replace('{phone}', encodeURIComponent(options.to))
        .replace('{rawPhone}', encodeURIComponent(rawPhone))
        .replace('{message}', encodeURIComponent(options.message));

      this.logger.log(`Calling dynamic SMS gateway for ${options.to}...`);
      const response = await fetch(dynamicUrl, {
        method: this.gatewayMethod,
      });

      if (!response.ok) {
        const text = await response.text();
        this.logger.warn(`Gateway SMS failed with status ${response.status}: ${text}. Using mock logger.`);
        return this.sendWithMock(options);
      }

      this.logger.log(`Dynamic SMS successfully delivered to ${options.to}`);
      return { messageId: `gw-${Date.now()}` };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(`Generic SMS Gateway error: ${message}. Falling back to mock.`);
      return this.sendWithMock(options);
    }
  }
}

import { Injectable, Logger } from '@nestjs/common';
import { MailService } from '../mail/mail.service';
import { EmailTemplates } from '../mail/templates/email-templates';

@Injectable()
export class NotificationService {
  private readonly logger = new Logger(NotificationService.name);

  constructor(private readonly mail: MailService) {}

  async notifyDocumentReady(uploaderEmail: string, title: string, workspaceName: string) {
    if (!uploaderEmail) return;
    const { subject, html, text } = EmailTemplates.documentReadyTemplate(title, workspaceName);
    await this.mail.send({ to: uploaderEmail, subject, html, text });
  }

  async notifyDocumentRejected(uploaderEmail: string, title: string, reason: string, workspaceName: string) {
    if (!uploaderEmail) return;
    const { subject, html, text } = EmailTemplates.documentRejectedTemplate(title, reason, workspaceName);
    await this.mail.send({ to: uploaderEmail, subject, html, text });
  }

  async notifyPlanQuotaWarning(ownerEmail: string, workspaceName: string, used: number, limit: number) {
    if (!ownerEmail) return;
    const { subject, html, text } = EmailTemplates.planQuotaWarningTemplate(workspaceName, used, limit);
    await this.mail.send({ to: ownerEmail, subject, html, text });
  }

  async notifyTokenReuseAlert(userEmail: string) {
    if (!userEmail) return;
    const { subject, html, text } = EmailTemplates.tokenReuseSecurityAlertTemplate(userEmail, new Date());
    await this.mail.send({ to: userEmail, subject, html, text });
  }
}

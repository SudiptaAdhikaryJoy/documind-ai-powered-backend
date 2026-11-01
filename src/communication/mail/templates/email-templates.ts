export class EmailTemplates {
  static otpTemplate(code: string, purposeDescription: string): { subject: string; html: string; text: string } {
    const subject = `DocuMind AI — Your Verification Code: ${code}`;
    const text = `Your verification code for ${purposeDescription} is: ${code}\nThis code will expire in 10 minutes. If you did not request this, please ignore this email.`;
    const html = `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; max-width: 560px; margin: 0 auto; padding: 24px; border: 1px solid #e2e8f0; border-radius: 8px;">
        <h2 style="color: #0f172a; margin-bottom: 8px;">DocuMind AI</h2>
        <p style="color: #475569; font-size: 15px;">Your one-time verification code for <strong>${purposeDescription}</strong> is:</p>
        <div style="background-color: #f1f5f9; border-radius: 6px; padding: 16px; text-align: center; margin: 24px 0;">
          <span style="font-size: 32px; font-weight: 700; letter-spacing: 6px; color: #1e293b;">${code}</span>
        </div>
        <p style="color: #64748b; font-size: 13px;">This code expires in <strong>10 minutes</strong>. Never share this code with anyone.</p>
        <hr style="border: none; border-top: 1px solid #e2e8f0; margin: 24px 0;" />
        <p style="color: #94a3b8; font-size: 12px;">If you did not request this code, you can safely ignore this email.</p>
      </div>
    `;
    return { subject, html, text };
  }

  static workspaceInviteTemplate(
    inviterName: string,
    workspaceName: string,
    role: string,
    inviteUrl: string,
  ): { subject: string; html: string; text: string } {
    const subject = `Invitation to join "${workspaceName}" on DocuMind AI`;
    const text = `${inviterName} has invited you to join the workspace "${workspaceName}" as a ${role} on DocuMind AI.\nAccept invitation: ${inviteUrl}`;
    const html = `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; max-width: 560px; margin: 0 auto; padding: 24px; border: 1px solid #e2e8f0; border-radius: 8px;">
        <h2 style="color: #0f172a; margin-bottom: 8px;">DocuMind AI</h2>
        <p style="color: #475569; font-size: 15px;"><strong>${inviterName}</strong> has invited you to join the workspace <strong>"${workspaceName}"</strong> as a <strong>${role}</strong>.</p>
        <div style="margin: 28px 0; text-align: center;">
          <a href="${inviteUrl}" style="background-color: #2563eb; color: #ffffff; text-decoration: none; padding: 12px 24px; border-radius: 6px; font-weight: 600; font-size: 14px; display: inline-block;">Accept Invitation</a>
        </div>
        <p style="color: #64748b; font-size: 13px;">Or copy and paste this link in your browser:<br/><span style="color: #2563eb; word-break: break-all;">${inviteUrl}</span></p>
        <hr style="border: none; border-top: 1px solid #e2e8f0; margin: 24px 0;" />
        <p style="color: #94a3b8; font-size: 12px;">This invitation will expire in 7 days.</p>
      </div>
    `;
    return { subject, html, text };
  }

  static tokenReuseSecurityAlertTemplate(userEmail: string, timestamp: Date): { subject: string; html: string; text: string } {
    const subject = `[SECURITY ALERT] Suspicious session activity detected on your DocuMind account`;
    const text = `We detected an attempted reuse of an expired/revoked session token on your DocuMind account (${userEmail}) at ${timestamp.toISOString()}.\nAs a security precaution, all active sessions for your account have been terminated.\nPlease log in again and update your password if you did not initiate this.`;
    const html = `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; max-width: 560px; margin: 0 auto; padding: 24px; border: 1px solid #fecaca; border-radius: 8px; background-color: #fffaf0;">
        <h2 style="color: #b91c1c; margin-bottom: 8px;">Security Alert</h2>
        <p style="color: #475569; font-size: 15px;">We detected an attempted reuse of an already revoked session token on your account (<strong>${userEmail}</strong>).</p>
        <div style="background-color: #fee2e2; border-left: 4px solid #ef4444; padding: 12px; margin: 16px 0; color: #991b1b; font-size: 13px;">
          <strong>Action Taken:</strong> All active sessions for your account have been immediately invalidated to prevent unauthorized access.
        </div>
        <p style="color: #475569; font-size: 14px;">If this was you (e.g. browser restored older tabs), simply log in again. If you did not perform this action, please reset your password immediately.</p>
      </div>
    `;
    return { subject, html, text };
  }

  static documentReadyTemplate(
    documentTitle: string,
    workspaceName: string,
  ): { subject: string; html: string; text: string } {
    const subject = `Document Ready: "${documentTitle}" is indexed in "${workspaceName}"`;
    const text = `Your document "${documentTitle}" has finished indexing and is now ready for verified search in "${workspaceName}".`;
    const html = `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; max-width: 560px; margin: 0 auto; padding: 24px; border: 1px solid #e2e8f0; border-radius: 8px;">
        <h2 style="color: #0f172a; margin-bottom: 8px;">DocuMind AI</h2>
        <p style="color: #15803d; font-size: 15px; font-weight: 600;">✓ Document Indexed Successfully</p>
        <p style="color: #475569; font-size: 14px;">Your document <strong>"${documentTitle}"</strong> has finished chunking and embedding. It is now searchable by team members in workspace <strong>"${workspaceName}"</strong>.</p>
      </div>
    `;
    return { subject, html, text };
  }

  static documentRejectedTemplate(
    documentTitle: string,
    reason: string,
    workspaceName: string,
  ): { subject: string; html: string; text: string } {
    const subject = `Document Notice: "${documentTitle}" could not be indexed in "${workspaceName}"`;
    const text = `Your document "${documentTitle}" could not be indexed in "${workspaceName}". Reason: ${reason}`;
    const html = `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; max-width: 560px; margin: 0 auto; padding: 24px; border: 1px solid #fed7aa; border-radius: 8px;">
        <h2 style="color: #0f172a; margin-bottom: 8px;">DocuMind AI</h2>
        <p style="color: #c2410c; font-size: 15px; font-weight: 600;">Document Indexing Notice</p>
        <p style="color: #475569; font-size: 14px;">Your document <strong>"${documentTitle}"</strong> in workspace <strong>"${workspaceName}"</strong> was not indexed.</p>
        <p style="color: #64748b; font-size: 13px;"><strong>Reason:</strong> ${reason}</p>
        <p style="color: #94a3b8; font-size: 12px;">Your document quota was not consumed.</p>
      </div>
    `;
    return { subject, html, text };
  }

  static planQuotaWarningTemplate(
    workspaceName: string,
    used: number,
    limit: number,
  ): { subject: string; html: string; text: string } {
    const percent = Math.round((used / limit) * 100);
    const subject = `[Notice] Workspace "${workspaceName}" has reached ${percent}% of monthly question quota`;
    const text = `Your workspace "${workspaceName}" has used ${used}/${limit} (${percent}%) questions this month on the Free Plan.`;
    const html = `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; max-width: 560px; margin: 0 auto; padding: 24px; border: 1px solid #e2e8f0; border-radius: 8px;">
        <h2 style="color: #0f172a; margin-bottom: 8px;">DocuMind AI</h2>
        <p style="color: #d97706; font-size: 15px; font-weight: 600;">Plan Quota Notice (${percent}%)</p>
        <p style="color: #475569; font-size: 14px;">Your workspace <strong>"${workspaceName}"</strong> has queried <strong>${used} of ${limit}</strong> allocated monthly questions on the Free Plan.</p>
        <p style="color: #64748b; font-size: 13px;">When the limit is reached, questions will be paused until next month or upon upgrading to the Team Plan.</p>
      </div>
    `;
    return { subject, html, text };
  }
}

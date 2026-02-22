interface PasswordResetEmailParams {
  code: string;
  resetUrl: string;
  expiresInMinutes: number;
}

export function passwordResetEmailHtml(params: PasswordResetEmailParams): string {
  return `
<!DOCTYPE html>
<html>
<body style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
  <h2>Reset your password</h2>
  <p>Use the code below to reset your password:</p>
  <div style="background: #f4f4f4; padding: 20px; text-align: center; font-size: 32px; letter-spacing: 8px; font-weight: bold; border-radius: 8px; margin: 20px 0;">
    ${params.code}
  </div>
  <p>Or click the link below:</p>
  <p><a href="${params.resetUrl}" style="display: inline-block; background: #0070f3; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px;">Reset Password</a></p>
  <p style="color: #666; font-size: 14px;">This code expires in ${params.expiresInMinutes} minutes.</p>
  <p style="color: #666; font-size: 14px;">If you didn't request a password reset, you can safely ignore this email.</p>
</body>
</html>`.trim();
}

export function passwordResetEmailText(params: PasswordResetEmailParams): string {
  return [
    'Reset your password',
    '',
    `Your password reset code is: ${params.code}`,
    '',
    `Or visit this link: ${params.resetUrl}`,
    '',
    `This code expires in ${params.expiresInMinutes} minutes.`,
    '',
    "If you didn't request a password reset, you can safely ignore this email.",
  ].join('\n');
}

export const TOKEN_TYPE = {
  EMAIL_VERIFICATION: 'EMAIL_VERIFICATION',
  PASSWORD_RESET: 'PASSWORD_RESET',
} as const;

export type TokenType = (typeof TOKEN_TYPE)[keyof typeof TOKEN_TYPE];

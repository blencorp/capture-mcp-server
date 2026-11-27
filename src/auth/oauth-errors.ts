import { OAuthError, OAuthErrorCode } from '@modelcontextprotocol/server';

export { OAuthError };

const error = (code: OAuthErrorCode) => (message: string) => new OAuthError(code, message);

// RFC 6749 section 5.2 and RFC 7591 section 3.2.2 error responses, one constructor per code.
export const invalidRequest = error(OAuthErrorCode.InvalidRequest);
export const invalidClient = error(OAuthErrorCode.InvalidClient);
export const invalidGrant = error(OAuthErrorCode.InvalidGrant);
export const invalidScope = error(OAuthErrorCode.InvalidScope);
export const invalidToken = error(OAuthErrorCode.InvalidToken);
export const invalidClientMetadata = error(OAuthErrorCode.InvalidClientMetadata);
export const unsupportedGrantType = error(OAuthErrorCode.UnsupportedGrantType);
export const methodNotAllowed = error(OAuthErrorCode.MethodNotAllowed);
export const tooManyRequests = error(OAuthErrorCode.TooManyRequests);
export const serverError = error(OAuthErrorCode.ServerError);

/**
 * Google Cloud Credentials Helper
 * Supports local development (file path), Vercel deployment (raw JSON),
 * and legacy Vercel deployment (base64).
 */

export function getGoogleClientOptions() {
  const baseOptions = {
    projectId: process.env['GOOGLE_CLOUD_PROJECT_ID']!,
  };

  const credentials = process.env.GOOGLE_APPLICATION_CREDENTIALS;

  if (credentials) {
    // If the credential starts with '{', we assume it's a raw JSON string
    if (credentials.trim().startsWith('{')) {
      try {
        return {
          ...baseOptions,
          credentials: JSON.parse(credentials),
        };
      } catch (e) {
        throw new Error('Failed to parse GOOGLE_APPLICATION_CREDENTIALS as JSON', { cause: e });
      }
    } else {
      // Otherwise, we assume it's a file path for local development
      return {
        ...baseOptions,
        keyFilename: credentials,
      };
    }
  }

  // Fallback for legacy base64 encoded credentials
  if (process.env['GOOGLE_APPLICATION_CREDENTIALS_BASE64']) {
    try {
      const base64Credentials = process.env['GOOGLE_APPLICATION_CREDENTIALS_BASE64'];
      const credentialsJson = Buffer.from(base64Credentials, 'base64').toString('utf8');
      return {
        ...baseOptions,
        credentials: JSON.parse(credentialsJson),
      };
    } catch (e) {
      throw new Error('Failed to parse GOOGLE_APPLICATION_CREDENTIALS_BASE64', { cause: e });
    }
  }

  throw new Error('Google Cloud credentials not configured. Set either GOOGLE_APPLICATION_CREDENTIALS or GOOGLE_APPLICATION_CREDENTIALS_BASE64');
}

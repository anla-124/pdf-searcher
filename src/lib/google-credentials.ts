/**
 * Google Cloud Credentials Helper
 * Supports both local development (file path) and Vercel deployment (base64)
 */

export function getGoogleCredentials() {
  // For Vercel deployment: use base64 encoded credentials
  if (process.env['GOOGLE_APPLICATION_CREDENTIALS_BASE64']) {
    const base64Credentials = process.env['GOOGLE_APPLICATION_CREDENTIALS_BASE64']
    const credentialsJson = Buffer.from(base64Credentials, 'base64').toString('utf8')
    return JSON.parse(credentialsJson)
  }
  
  // For local development: use file path (existing behavior)
  if (process.env['GOOGLE_APPLICATION_CREDENTIALS']) {
    return {
      keyFilename: process.env['GOOGLE_APPLICATION_CREDENTIALS']
    }
  }
  
  throw new Error('Google Cloud credentials not configured. Set either GOOGLE_APPLICATION_CREDENTIALS or GOOGLE_APPLICATION_CREDENTIALS_BASE64')
}

export function getGoogleClientOptions() {
  const baseOptions = {
    projectId: process.env['GOOGLE_CLOUD_PROJECT_ID']!,
  }
  
  // For Vercel: use credentials object
  if (process.env['GOOGLE_APPLICATION_CREDENTIALS_BASE64']) {
    return {
      ...baseOptions,
      credentials: getGoogleCredentials()
    }
  }
  
  // For local: use keyFilename only if it exists
  const keyFilename = process.env['GOOGLE_APPLICATION_CREDENTIALS']
  if (keyFilename) {
    return {
      ...baseOptions,
      keyFilename
    }
  }
  
  // Return base options if no credentials
  return baseOptions
}
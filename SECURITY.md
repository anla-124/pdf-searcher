# 🔒 Security Configuration Guide

## ⚠️ CRITICAL: Environment Setup

**NEVER commit real credentials to git!** This repository now uses template files for security.

### 1. Environment Variables Setup

1. Copy the template file:
   ```bash
   cp .env.local.template .env.local
   ```

2. Edit `.env.local` with your actual credentials:
   - Supabase URL and keys
   - Google Cloud project settings
   - Pinecone API key
   - Redis credentials
   - Generate secure secrets for JWT and CRON

### 2. Google Service Account Setup

1. Copy the template file:
   ```bash
   cp credentials/google-service-account.json.template credentials/google-service-account.json
   ```

2. Replace with your actual Google Cloud service account JSON:
   - Download from Google Cloud Console
   - Ensure it has Document AI and Storage permissions

### 3. Security Best Practices

#### Environment Variables
- Use strong, unique secrets (32+ characters)
- Rotate API keys regularly
- Use different credentials for dev/staging/prod
- Never log or expose credentials in console

#### File Permissions (not done for now)
```bash
chmod 600 .env.local
chmod 600 credentials/google-service-account.json
```

#### Deployment Security
- Use Vercel environment variables for production
- Enable Supabase RLS (Row Level Security)
- Configure proper CORS origins
- Use HTTPS only in production

### 4. Credential Generation Examples

#### JWT Secret
```bash
openssl rand -hex 32
```

#### CRON Secret
```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

### 5. Emergency Response

If credentials are accidentally committed:
1. **Immediately rotate all exposed keys**
2. Revoke the compromised service accounts
3. Generate new API keys
4. Update all deployment environments
5. Check access logs for unauthorized usage

### 6. Monitoring & Alerts

- Enable Supabase database logging
- Set up Pinecone usage alerts
- Monitor Google Cloud billing/usage
- Configure Redis access alerts

## 🚨 Current Status

✅ Credential files are now secured with templates
✅ .gitignore properly configured
✅ Real credentials moved to .backup files
⚠️  **Action Required**: Set up your actual credentials using the templates above
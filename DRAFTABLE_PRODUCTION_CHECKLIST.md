# Draftable Integration - Production Deployment Checklist

## ✅ Code Changes Applied (Production-Ready)

### Security Fixes
- ✅ Error details only shown in development mode
- ✅ Signed URLs not logged in production
- ✅ Viewer URLs not logged in production
- ✅ Auth token kept server-side only

### Reliability Improvements
- ✅ 30-second timeout added for Draftable API calls
- ✅ Clear comments about production URL handling

---

## 📋 Pre-Deployment Checklist

### 1. Environment Variables

**Required in Production:**
```bash
# Draftable Configuration
NEXT_PUBLIC_DRAFTABLE_ACCOUNT_ID=your_account_id
DRAFTABLE_AUTH_TOKEN=your_secret_token      # ⚠️ Server-side only, never expose
NEXT_PUBLIC_DRAFTABLE_API_URL=https://draftable.anduin.center/api/v1

# Supabase Production
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_production_anon_key
```

**DO NOT SET in Production:**
```bash
# ❌ This should ONLY be set in local development
# SUPABASE_PUBLIC_URL=https://ngrok-url.com
```

### 2. Cloudflare Access Configuration (IT Team)

**Contact your IT team to configure ONE of these options:**

**Option A: Service Token (Recommended)**
- Create a Cloudflare Access Service Token
- Whitelist the token for `draftable.anduin.center`
- Add headers to requests:
  - `CF-Access-Client-Id: <service-token-id>`
  - `CF-Access-Client-Secret: <service-token-secret>`

**Option B: IP Whitelist**
- Whitelist your production server's public IP(s)
- Or whitelist the Draftable server's IP to bypass checks

**Option C: Adjust Rate Limits**
- Increase Cloudflare's request size limit for `/api/v1/comparisons` endpoint
- Current issue: Requests >200KB trigger bot detection

### 3. Supabase Storage Configuration

Ensure production Supabase storage:
- ✅ Has public read access OR signed URL generation enabled
- ✅ CORS configured to allow Draftable server IP
- ✅ Files stored with proper content-type headers

### 4. Testing Checklist

Before going live, test:

1. **Happy Path:**
   - [ ] Compare two PDF documents
   - [ ] Viewer opens without loading spinner
   - [ ] Comparison renders correctly

2. **Error Handling:**
   - [ ] Try to compare non-existent documents (should get 404)
   - [ ] Try without authentication (should get 401)
   - [ ] Try to compare someone else's documents (should get 404)

3. **Performance:**
   - [ ] Large PDFs (>10MB) complete within 30 seconds
   - [ ] Viewer URL expires after 1 hour (test with old URL)
   - [ ] Comparison expires after 2 hours

4. **Logs:**
   - [ ] No sensitive URLs appear in production logs
   - [ ] No error details exposed to clients
   - [ ] All operations properly logged for debugging

---

## 🔍 How Production Differs from Development

### Development (Local)
```
Browser → Next.js → Local Supabase (127.0.0.1:54321)
                ↓
                ngrok/localtunnel (public URL)
                ↓
                Draftable (downloads via public URL)
```

### Production
```
Browser → Next.js → Production Supabase (xyz.supabase.co)
                ↓
                Draftable (downloads directly from Supabase)
```

**Key Difference:** Production Supabase URLs are already public and accessible by Draftable, so no tunneling needed!

---

## 🐛 Known Issues & Mitigations

### Issue 1: Cloudflare Bot Detection (Current)
**Status:** Blocking file uploads in development
**Mitigation:** Use URL-based approach (current implementation)
**Long-term Fix:** IT team to configure Service Token

### Issue 2: Signed URLs Expire
**Status:** Expected behavior
**Impact:** Links expire after 1 hour
**Mitigation:** Users re-generate comparison if needed

### Issue 3: Large File Timeout
**Status:** 30-second timeout may be too short for very large files
**Mitigation:** Adjust timeout in code if needed
**Location:** `src/app/api/draftable/compare/route.ts:152`

---

## 📊 Monitoring Recommendations

### Metrics to Track
1. **Success Rate:** % of comparisons created successfully
2. **Response Time:** Time to create comparison (should be <5 seconds)
3. **Timeout Rate:** % of requests that timeout (should be <1%)
4. **Error Rate:** % of 500 errors (should be <0.1%)

### Alerts to Set Up
- Alert if success rate drops below 95%
- Alert if average response time exceeds 10 seconds
- Alert if timeout rate exceeds 5%

---

## 🔐 Security Notes

### What's Protected
✅ Draftable auth token (server-side only)
✅ User document access (validated by user_id)
✅ Signed URLs (expire after 1 hour)
✅ Viewer URLs (expire after 1 hour, signed)

### What's Public
- Draftable account ID (safe to expose)
- Draftable API URL (your company's URL)
- Comparison identifiers (random, non-guessable)

---

## 📞 Support Contacts

- **Draftable Issues:** Check self-hosted instance logs
- **Cloudflare Issues:** Contact IT team for Access configuration
- **Supabase Issues:** Check Supabase project settings
- **Code Issues:** Review logs in your production environment

---

## ✨ Post-Deployment Verification

After deploying, run through this checklist:

1. [ ] Environment variables are set correctly
2. [ ] IT team has configured Cloudflare Access (if needed)
3. [ ] Test comparison works end-to-end
4. [ ] Logs show no sensitive information
5. [ ] Error messages are generic (no details exposed)
6. [ ] Monitoring/alerts are configured

---

**Last Updated:** 2025-11-10
**Next Review:** Before production deployment

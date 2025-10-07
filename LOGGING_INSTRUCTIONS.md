# Centralized Logging System

The entire logging system is now controlled by a **single environment variable** in `.env.local`:

## Quick Toggle

### Turn ON all verbose logging:
```bash
VERBOSE_LOGS=true
```

### Turn OFF all verbose logging (default):
```bash
VERBOSE_LOGS=false
```

## What Gets Logged

When `VERBOSE_LOGS=true`, you'll see:
- ✅ **API request start/end** with full details
- ✅ **Database queries** with parameters
- ✅ **Cache operations** (hits/misses)
- ✅ **Document processing** with page assignments
- ✅ **Similarity search** debugging 
- ✅ **Performance metrics** for all operations
- ✅ **Request headers** and correlation IDs

When `VERBOSE_LOGS=false`, you'll only see:
- ⚠️ **Warnings and errors**
- 🐌 **Slow requests** (>1 second)
- 💥 **Failed requests** (4xx/5xx status codes)

## Alternative Environment Variables

The system also recognizes:
- `ENABLE_VERBOSE_LOGS=true`
- `DEBUG_LOGS=true` 
- `LOG_LEVEL=debug`

## Testing

1. **Set verbose logging**: `VERBOSE_LOGS=true` in `.env.local`
2. **Restart server**: `npm run dev`
3. **Look for debug output**: You should see logging configuration printed
4. **Use your app**: All operations will be logged in detail
5. **Turn off**: `VERBOSE_LOGS=false` and restart for quiet logs

## Production

In production, the system defaults to verbose logging regardless of the environment variable, but you can still control it by setting `VERBOSE_LOGS=false` in production environment.
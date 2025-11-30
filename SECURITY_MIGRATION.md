# Security Migration: API Key Storage

## What Changed

**SECURITY FIX:** HuggingFace API keys are now stored in VS Code's encrypted `SecretStorage` instead of plaintext settings.

### Before (Insecure)
- API keys stored in `settings.json` as plaintext
- Visible in settings UI
- Synced to GitHub if settings were committed
- Accessible to any extension that reads settings

### After (Secure)
- API keys stored in VS Code's encrypted `SecretStorage`
- Never visible in settings UI or files
- Not synced to cloud/GitHub
- Only accessible to Liftoff extension

## Automatic Migration

**No action required!** When you first launch the updated extension:

1. Extension checks `SecretStorage` for API key
2. If not found, checks old `settings.json` location
3. If found in settings, automatically:
   - Copies key to encrypted `SecretStorage`
   - Removes key from `settings.json`
   - Shows notification: "🔒 Security: API key migrated to encrypted storage"

## Files Modified

### 1. `src/extension.ts`

#### Lines 97-118: Updated `setApiKey` command
```typescript
// OLD: Stored in plaintext settings
await config.update('huggingfaceApiKey', apiKey, true);

// NEW: Store in encrypted SecretStorage
await context.secrets.store('liftoff.hfApiKey', apiKey);
await config.update('huggingfaceApiKey', undefined, vscode.ConfigurationTarget.Global);
```

#### Lines 724-751: Updated activation to retrieve from SecretStorage
```typescript
// OLD: Read from plaintext settings
const apiKey = config.get<string>('huggingfaceApiKey');

// NEW: Read from encrypted SecretStorage with auto-migration
let apiKey = await context.secrets.get('liftoff.hfApiKey');
if (!apiKey) {
  // Check old location and migrate
  const oldKey = config.get<string>('huggingfaceApiKey');
  if (oldKey) {
    await context.secrets.store('liftoff.hfApiKey', oldKey);
    await config.update('huggingfaceApiKey', undefined, vscode.ConfigurationTarget.Global);
    apiKey = oldKey;
  }
}
```

#### Lines 189, 337, 381: Updated API key checks
```typescript
// OLD: Check settings
if (!config.get<string>('huggingfaceApiKey')) { ... }

// NEW: Check SecretStorage
const hasApiKey = await context.secrets.get('liftoff.hfApiKey');
if (!hasApiKey) { ... }
```

### 2. `package.json`

#### Lines 126-130: REMOVED insecure configuration property
```diff
- "liftoff.huggingfaceApiKey": {
-   "type": "string",
-   "default": "",
-   "description": "Your HuggingFace API key (Pro recommended for best models)"
- },
```

**Result:** Setting no longer appears in VS Code settings UI, preventing accidental exposure.

## For Users

### First Launch After Update
1. Extension detects old API key in settings
2. Shows notification: "🔒 Security: API key migrated to encrypted storage"
3. Your key is now secure!

### Setting a New API Key
```
Cmd/Ctrl + Shift + P → "Liftoff: Set HuggingFace API Key"
```
- Key is immediately encrypted
- Never stored in plaintext

### Verifying Migration
1. Open VS Code settings (`Cmd/Ctrl + ,`)
2. Search for "liftoff"
3. You should **NOT** see `huggingfaceApiKey` setting anymore
4. If you do, and it contains a key, manually delete it (already migrated)

## Technical Details

### VS Code SecretStorage
- Uses OS-level encryption:
  - **Windows:** DPAPI (Data Protection API)
  - **macOS:** Keychain
  - **Linux:** libsecret
- Encrypted at rest
- Only accessible by the extension that stored it
- Not synced via Settings Sync

### Migration Strategy
- **Graceful fallback:** Works for both new and existing users
- **Non-destructive:** Old setting only removed after successful migration
- **Idempotent:** Safe to run multiple times
- **No data loss:** Key preserved during migration

## Developer Notes

### Testing the Fix
1. Set API key using old extension
2. Verify it's in `settings.json`:
   ```json
   "liftoff.huggingfaceApiKey": "hf_..."
   ```
3. Update to new extension
4. Launch VS Code
5. Check:
   - ✅ Notification shows migration message
   - ✅ Setting removed from `settings.json`
   - ✅ Extension still works (agents can spawn)

### Accessing SecretStorage in Code
```typescript
// Store
await context.secrets.store('liftoff.hfApiKey', apiKey);

// Retrieve
const apiKey = await context.secrets.get('liftoff.hfApiKey');

// Delete
await context.secrets.delete('liftoff.hfApiKey');
```

## Security Impact

### Threats Mitigated
- ✅ Accidental commit of API keys to GitHub
- ✅ Exposure via Settings Sync to untrusted devices
- ✅ Access by malicious extensions
- ✅ Plaintext storage on disk

### Compliance
- Aligns with OWASP secret management best practices
- Meets VS Code security guidelines for sensitive data
- Compatible with enterprise security policies

## Rollback (Not Recommended)

If you need to rollback for testing:
```typescript
// Retrieve from SecretStorage
const key = await context.secrets.get('liftoff.hfApiKey');

// Store in old location (INSECURE!)
await vscode.workspace.getConfiguration('liftoff').update(
  'huggingfaceApiKey',
  key,
  vscode.ConfigurationTarget.Global
);
```

**Warning:** This defeats the security fix. Only use for debugging.

## FAQ

**Q: Will my existing API key stop working?**
A: No, it's automatically migrated. You won't notice any difference.

**Q: Do I need to re-enter my API key?**
A: No, unless you had no key set before.

**Q: Can I still see my API key in settings?**
A: No, it's encrypted. Use "Liftoff: Set HuggingFace API Key" to update it.

**Q: What if I have multiple VS Code instances?**
A: Each instance has its own SecretStorage. Set the key in each.

**Q: Is this compatible with Remote SSH/WSL?**
A: Yes, SecretStorage works in all VS Code environments.

## Credits

- **Issue:** API keys stored in plaintext settings
- **Fix:** Migrate to VS Code SecretStorage API
- **Date:** 2025-11-30
- **Impact:** All users (automatic migration)

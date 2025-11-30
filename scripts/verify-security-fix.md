# Security Fix Verification Guide

## Quick Verification Steps

### 1. Verify Extension Code Changes

```bash
cd C:\Users\sava6\ClaudeHome\projects\liftoff

# Check extension.ts changes
git diff src/extension.ts | grep -A5 "SecretStorage"

# Check package.json changes
git diff package.json | grep "huggingfaceApiKey"
```

**Expected output:**
- `extension.ts`: Should show `context.secrets.store` and `context.secrets.get`
- `package.json`: Should show removal (`-`) of `huggingfaceApiKey` property

### 2. Test Migration Flow (Manual)

#### Step 1: Set up old-style API key (simulate existing user)
1. Open VS Code Settings (`Cmd/Ctrl + ,`)
2. Search for "liftoff"
3. Find `huggingfaceApiKey` setting
4. **If visible:** You're running old version
5. **If not visible:** ✅ Already on new version

#### Step 2: Install updated extension
```bash
# Compile the updated code
npm run compile

# Reload VS Code window
# Press: Cmd/Ctrl + R
```

#### Step 3: Verify migration
1. Watch for notification: "🔒 Security: API key migrated to encrypted storage"
2. Open settings again, search "liftoff"
3. Verify `huggingfaceApiKey` setting is **gone**
4. Test agent: `Cmd/Ctrl + Shift + P` → "Liftoff: Spawn New Agent"
5. Should work without asking for API key again

### 3. Test New User Flow

#### Step 1: Clear existing key (simulate new user)
Run in VS Code Debug Console (F12):
```javascript
// This requires extension context access
// Alternative: Manually remove from settings
```

Or manually:
1. Close VS Code
2. Edit settings.json, remove `liftoff.huggingfaceApiKey` line
3. Reopen VS Code

#### Step 2: Set new API key
```
Cmd/Ctrl + Shift + P → "Liftoff: Set HuggingFace API Key"
Enter: hf_test123... (your real key)
```

#### Step 3: Verify storage
1. Check settings.json - should **NOT** contain `huggingfaceApiKey`
2. Extension should show: "✅ API key verified!"
3. Try spawning agent - should work

### 4. Verify Settings UI

**Before fix:**
```
Settings → Extensions → Liftoff
  ├─ HuggingFace API Key: [visible input field]  ❌
  ├─ Default Model: [dropdown]
  └─ Auto Handoff: [checkbox]
```

**After fix:**
```
Settings → Extensions → Liftoff
  ├─ Default Model: [dropdown]                    ✅
  └─ Auto Handoff: [checkbox]
  (No API key field - it's encrypted!)
```

### 5. Verify settings.json

**Before fix (INSECURE):**
```json
{
  "liftoff.huggingfaceApiKey": "hf_abc123...",  // ❌ VISIBLE!
  "liftoff.defaultModel": "deepseek-ai/DeepSeek-V3-0324"
}
```

**After fix (SECURE):**
```json
{
  "liftoff.defaultModel": "deepseek-ai/DeepSeek-V3-0324"
  // ✅ No API key!
}
```

### 6. Code Review Checklist

- [x] `setApiKey` command stores to SecretStorage
- [x] `setApiKey` command removes old setting
- [x] `activate()` checks SecretStorage first
- [x] `activate()` migrates from old location if needed
- [x] All commands check SecretStorage, not settings
- [x] `package.json` no longer exposes `huggingfaceApiKey`
- [x] `hfProvider.ts` unchanged (already secure)

### 7. Security Audit

Run these checks to verify no leaks:

```bash
# Check for hardcoded API keys
git grep -i "hf_[a-zA-Z0-9]" src/

# Should return: NO matches (except in comments/docs)

# Check settings.json references
git grep "huggingfaceApiKey" src/

# Should return:
# - src/extension.ts: Only for MIGRATION (reading old key to delete it)
# - NO occurrences in package.json

# Check for plaintext storage
git grep "update.*apiKey" src/

# Should return:
# - src/extension.ts: Only DELETION (undefined value)
```

## Platform-Specific Verification

### Windows
**Storage location:** DPAPI encrypted registry
```
Registry: HKCU\Software\Microsoft\VSCode\Code\<id>
Encrypted: Yes (DPAPI)
```

Verify:
1. Run `regedit`
2. Navigate to path above
3. Secrets should be encrypted blobs, not plaintext

### macOS
**Storage location:** Keychain
```
Keychain Access → Login → Search "vscode"
Item: com.microsoft.VSCode (Code.app)
```

Verify:
1. Open "Keychain Access"
2. Search for "vscode"
3. Should see encrypted entries

### Linux
**Storage location:** libsecret
```
~/.local/share/keyrings/Default_keyring.keyring
Encrypted: Yes (libsecret)
```

Verify:
```bash
secret-tool lookup service vscode
# Should return encrypted data
```

## Automated Tests (Future)

```typescript
// test/security.test.ts
import * as assert from 'assert';
import * as vscode from 'vscode';

suite('Security Tests', () => {
    test('API key not in settings.json', async () => {
        const config = vscode.workspace.getConfiguration('liftoff');
        const key = config.get<string>('huggingfaceApiKey');
        assert.strictEqual(key, undefined, 'API key should not be in settings');
    });

    test('API key stored in SecretStorage', async () => {
        // Requires extension context
        const secrets = vscode.extensions.getExtension('jamie.liftoff')?.exports.secrets;
        const key = await secrets?.get('liftoff.hfApiKey');
        assert.ok(key === undefined || key.startsWith('hf_'), 'Key in SecretStorage');
    });

    test('Settings UI does not expose API key', () => {
        const pkg = require('../package.json');
        const hasApiKeySetting = pkg.contributes.configuration.properties['liftoff.huggingfaceApiKey'];
        assert.strictEqual(hasApiKeySetting, undefined, 'API key setting removed from UI');
    });
});
```

## Troubleshooting

### Issue: "API key not found" after update
**Solution:** Re-enter key using `Liftoff: Set HuggingFace API Key`

### Issue: Migration notification not showing
**Possible causes:**
1. Already migrated (check SecretStorage)
2. No old key existed
3. Extension not fully reloaded

**Solution:** Reload window (`Cmd/Ctrl + R`)

### Issue: Old setting still visible in UI
**Solution:**
1. Ensure package.json compiled correctly
2. Reload window
3. Check `package.json` for removed property

### Issue: Extension crashes on activation
**Check:**
1. `npm run compile` succeeded
2. No TypeScript errors
3. Logs: `Help → Toggle Developer Tools → Console`

## Success Criteria

✅ **Fix is successful if:**
1. No `huggingfaceApiKey` in settings UI
2. No plaintext key in settings.json
3. Agents work after migration
4. New users can set key without seeing plaintext
5. No security warnings in VS Code

## Reporting

If you verify the fix works, document:
```
✅ VERIFIED: Security fix deployed
- Platform: [Windows/macOS/Linux]
- VS Code version: [x.xx.x]
- Extension version: [0.1.0]
- Migration: [Success/Not needed]
- Functionality: [All agents working]
```

If issues found:
```
❌ ISSUE: [Description]
- Steps to reproduce
- Expected behavior
- Actual behavior
- Console errors
- Platform details
```

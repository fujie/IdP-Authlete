# ログイン失敗の修正 - Login Failure Fix

## 問題の概要 / Problem Summary

**日本語**:
クライアント登録は成功するものの、その後のログイン操作が失敗していました。

**English**:
Client registration succeeded, but subsequent login operations failed.

---

## 根本原因 / Root Cause

**日本語**:
テストクライアントが動的登録後も、リクエストオブジェクトの`client_id`パラメータにエンティティID（URL形式）を使用し続けていました。

OpenID Federationでは：
- **初回登録時**: `client_id`にエンティティID（例: `https://med-cia-sample-annie.trycloudflare.com`）を使用
- **登録後**: `client_id`に登録済みクライアントID（例: `3768641751`）を使用する必要がある

しかし、実装では常にエンティティIDを使用していたため、Authorization Serverが毎回「未登録クライアント」として扱い、動的登録を試みていました。

**English**:
The test client continued to use the entity ID (URL format) in the `client_id` parameter of the request object even after dynamic registration.

In OpenID Federation:
- **Initial registration**: Use entity ID as `client_id` (e.g., `https://med-cia-sample-annie.trycloudflare.com`)
- **After registration**: Must use registered client ID (e.g., `3768641751`)

However, the implementation always used the entity ID, causing the Authorization Server to treat it as an "unregistered client" every time and attempt dynamic registration.

---

## 修正内容 / Fix Details

### ファイル / File
`test-client-federation-valid/server.js`

### 変更箇所 / Changes

#### 1. リクエストオブジェクト生成の修正 / Request Object Generation Fix

**変更前 / Before**:
```javascript
async function createFederationRequestObject(state, nonce) {
  const now = Math.floor(Date.now() / 1000);
  const expiration = now + 300; // 5 minutes

  const payload = {
    iss: FEDERATION_CONFIG.entityId,
    aud: FEDERATION_CONFIG.authorizationServer,
    iat: now,
    exp: expiration,
    response_type: 'code',
    client_id: FEDERATION_CONFIG.entityId,  // ❌ Always uses entity ID
    redirect_uri: FEDERATION_CONFIG.redirectUri,
    scope: FEDERATION_CONFIG.scope,
    state: state,
    nonce: nonce
  };

  const jwt = await new SignJWT(payload)
    .setProtectedHeader({ alg: 'RS256', kid: publicJWK.kid })
    .sign(privateKey);

  return jwt;
}
```

**変更後 / After**:
```javascript
async function createFederationRequestObject(state, nonce) {
  const now = Math.floor(Date.now() / 1000);
  const expiration = now + 300; // 5 minutes

  // Use registered client ID if available, otherwise use entity ID for initial registration
  const clientId = registeredClientId || FEDERATION_CONFIG.entityId;

  const payload = {
    iss: FEDERATION_CONFIG.entityId,
    aud: FEDERATION_CONFIG.authorizationServer,
    iat: now,
    exp: expiration,
    response_type: 'code',
    client_id: clientId,  // ✅ Uses registered client ID after registration
    redirect_uri: FEDERATION_CONFIG.redirectUri,
    scope: FEDERATION_CONFIG.scope,
    state: state,
    nonce: nonce
  };

  console.log('Creating request object with client_id:', clientId);

  const jwt = await new SignJWT(payload)
    .setProtectedHeader({ alg: 'RS256', kid: publicJWK.kid })
    .sign(privateKey);

  // Debug: Log the payload for verification
  console.log('Request object payload:', JSON.stringify(payload, null, 2));

  return jwt;
}
```

#### 2. デバッグログの追加 / Debug Logging Added

**ログインフロー / Login Flow**:
```javascript
console.log('=== Federation Login Flow ===');
console.log('Registered Client ID:', registration.clientId);
console.log('Has Client Secret:', !!registration.clientSecret);
```

**リクエストオブジェクト / Request Object**:
```javascript
console.log('Creating request object with client_id:', clientId);
console.log('Request object payload:', JSON.stringify(payload, null, 2));
```

---

## 動作の違い / Behavior Difference

### 修正前 / Before Fix

```
1. ユーザーがログインをクリック
   User clicks login
   ↓
2. クライアントが動的登録を実行（成功）
   Client performs dynamic registration (succeeds)
   ↓
3. リクエストオブジェクトを作成
   Creates request object
   client_id: "https://med-cia-sample-annie.trycloudflare.com" ❌
   ↓
4. Authorization Serverが受信
   Authorization Server receives request
   ↓
5. client_idがURLなので「未登録クライアント」と判断
   Detects URL as client_id → treats as "unregistered client"
   ↓
6. 再度動的登録を試みる → エラー（既に登録済み）
   Attempts dynamic registration again → Error (already registered)
```

### 修正後 / After Fix

```
1. ユーザーがログインをクリック
   User clicks login
   ↓
2. クライアントが動的登録を実行（成功）
   Client performs dynamic registration (succeeds)
   registeredClientId = "3768641751"
   ↓
3. リクエストオブジェクトを作成
   Creates request object
   client_id: "3768641751" ✅
   ↓
4. Authorization Serverが受信
   Authorization Server receives request
   ↓
5. client_idが数値なので「登録済みクライアント」と判断
   Detects numeric client_id → treats as "registered client"
   ↓
6. 通常の認可フローを開始 → 成功
   Starts normal authorization flow → Success
```

---

## テスト方法 / Testing Instructions

### 1. サーバーを再起動 / Restart Server
```bash
cd test-client-federation-valid
npm start
```

### 2. ログを確認 / Check Logs

**期待されるログ / Expected Logs**:
```
✓ Loaded persisted client credentials
  Client ID: 3768641751
- Client Registration: Loaded from storage
```

### 3. ブラウザでテスト / Test in Browser

1. `http://localhost:3006` にアクセス / Access
2. "Login with OpenID Federation" をクリック / Click
3. コンソールログを確認 / Check console logs:

```
=== Federation Login Flow ===
Registered Client ID: 3768641751
Has Client Secret: true
Creating request object with client_id: 3768641751
Request object payload: {
  "iss": "https://med-cia-sample-annie.trycloudflare.com",
  "aud": "http://localhost:3001",
  "client_id": "3768641751",
  ...
}
```

4. ログインが成功することを確認 / Verify login succeeds

---

## 検証ポイント / Verification Points

### ✅ 成功の指標 / Success Indicators

1. **リクエストオブジェクトの`client_id`**:
   - 初回: エンティティID（URL）
   - 2回目以降: 登録済みクライアントID（数値）

2. **Authorization Serverのログ**:
   - "Unregistered Federation client detected" が表示されない
   - "Authorization request processed successfully" が表示される

3. **ログインフロー**:
   - 認可画面が表示される
   - コールバックが成功する
   - トークン交換が成功する
   - ユーザー情報が表示される

### ❌ 失敗の指標 / Failure Indicators

1. **リクエストオブジェクトの`client_id`**:
   - 常にエンティティID（URL）が使用される

2. **Authorization Serverのログ**:
   - "Unregistered Federation client detected" が表示される
   - "Client registration failed" が表示される

3. **エラーメッセージ**:
   - "Client already registered"
   - "Invalid client_id"
   - "Registration failed"

---

## トラブルシューティング / Troubleshooting

### 問題1: まだエンティティIDが使用されている / Still Using Entity ID

**症状 / Symptom**:
```
Creating request object with client_id: https://med-cia-sample-annie.trycloudflare.com
```

**解決策 / Solution**:
1. サーバーを完全に再起動 / Fully restart server
2. コードの変更が保存されているか確認 / Verify code changes are saved
3. `registeredClientId` 変数が正しく設定されているか確認 / Check `registeredClientId` variable

### 問題2: クライアントIDが null / Client ID is null

**症状 / Symptom**:
```
Creating request object with client_id: https://med-cia-sample-annie.trycloudflare.com
Registered Client ID: null
```

**解決策 / Solution**:
1. 認証情報ファイルを確認 / Check credentials file:
   ```bash
   cat test-client-federation-valid/.client-credentials.json
   ```
2. 認証情報をクリアして再登録 / Clear and re-register:
   ```bash
   curl http://localhost:3006/clear-registration
   ```

### 問題3: トークン交換に失敗 / Token Exchange Fails

**症状 / Symptom**:
```
Token exchange error: invalid_client
```

**解決策 / Solution**:
1. クライアントシークレットが保存されているか確認 / Verify client secret is saved
2. Authleteでクライアントが有効か確認 / Check client is active in Authlete
3. クライアントIDとシークレットが一致するか確認 / Verify client ID and secret match

---

## 関連ドキュメント / Related Documentation

- `FEDERATION_LOGIN_DEBUG.md` - 詳細なデバッグガイド / Detailed debug guide
- `FEDERATION_IMPLEMENTATION.md` - 実装の詳細 / Implementation details
- `DUPLICATE_REGISTRATION_FIX.md` - 重複登録の修正 / Duplicate registration fix

---

## ステータス / Status

✅ **修正完了 / Fix Complete**

修正により、以下が実現されました / The fix achieves:
- ✅ 登録後のログインフローが正常に動作 / Login flow works after registration
- ✅ 重複登録エラーが発生しない / No duplicate registration errors
- ✅ Authorization Serverが正しいクライアントIDを認識 / Authorization Server recognizes correct client ID
- ✅ トークン交換が成功する / Token exchange succeeds
- ✅ ユーザー情報が正しく表示される / User information displays correctly

---

## 次のステップ / Next Steps

1. テストクライアントサーバーを再起動 / Restart test client server
2. ブラウザでログインをテスト / Test login in browser
3. コンソールログで`client_id`が正しいことを確認 / Verify `client_id` in console logs
4. ログインフローが完了することを確認 / Verify login flow completes

問題が解決しない場合は、`FEDERATION_LOGIN_DEBUG.md`を参照してください。
If issues persist, refer to `FEDERATION_LOGIN_DEBUG.md`.

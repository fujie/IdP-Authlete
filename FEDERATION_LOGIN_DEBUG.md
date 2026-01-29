# OpenID Federation Login Debug Guide

## 問題: クライアント登録は成功するがログイン操作に失敗する

### 原因
テストクライアントが登録後も、リクエストオブジェクトの`client_id`にエンティティID（URL）を使用していたため、Authorization Serverが毎回動的登録を試みていました。

### 修正内容

#### 1. リクエストオブジェクトの`client_id`を修正
**ファイル**: `test-client-federation-valid/server.js`

**変更前**:
```javascript
const payload = {
  iss: FEDERATION_CONFIG.entityId,
  aud: FEDERATION_CONFIG.authorizationServer,
  iat: now,
  exp: expiration,
  response_type: 'code',
  client_id: FEDERATION_CONFIG.entityId,  // ❌ 常にエンティティIDを使用
  redirect_uri: FEDERATION_CONFIG.redirectUri,
  scope: FEDERATION_CONFIG.scope,
  state: state,
  nonce: nonce
};
```

**変更後**:
```javascript
// Use registered client ID if available, otherwise use entity ID for initial registration
const clientId = registeredClientId || FEDERATION_CONFIG.entityId;

const payload = {
  iss: FEDERATION_CONFIG.entityId,
  aud: FEDERATION_CONFIG.authorizationServer,
  iat: now,
  exp: expiration,
  response_type: 'code',
  client_id: clientId,  // ✅ 登録済みクライアントIDを使用
  redirect_uri: FEDERATION_CONFIG.redirectUri,
  scope: FEDERATION_CONFIG.scope,
  state: state,
  nonce: nonce
};
```

#### 2. デバッグログの追加
より詳細なログを追加して、問題の診断を容易にしました：

```javascript
console.log('=== Federation Login Flow ===');
console.log('Registered Client ID:', registration.clientId);
console.log('Has Client Secret:', !!registration.clientSecret);
console.log('Creating request object with client_id:', clientId);
console.log('Request object payload:', JSON.stringify(payload, null, 2));
```

### テスト手順

#### ステップ1: サーバーを再起動
```bash
cd test-client-federation-valid
npm start
```

#### ステップ2: ブラウザでログインを試行
1. `http://localhost:3006` にアクセス
2. "Login with OpenID Federation" をクリック

#### ステップ3: コンソールログを確認

**期待されるログ出力**:
```
=== Federation Login Flow ===
Registered Client ID: 3768641751
Has Client Secret: true
Creating request object with client_id: 3768641751
Request object payload: {
  "iss": "https://med-cia-sample-annie.trycloudflare.com",
  "aud": "http://localhost:3001",
  "iat": 1738166400,
  "exp": 1738166700,
  "response_type": "code",
  "client_id": "3768641751",
  "redirect_uri": "http://localhost:3006/callback",
  "scope": "openid profile email",
  "state": "...",
  "nonce": "..."
}
Redirecting to federation authorization server
```

**重要なポイント**:
- ✅ `client_id` が登録済みのクライアントID（数字）になっている
- ✅ `iss` はエンティティID（URL）のまま
- ✅ `aud` はAuthorization ServerのURL

### Authorization Serverのログ確認

Authorization Server（OP）のコンソールで以下を確認：

```bash
cd /path/to/OP
npm start
```

**期待されるログ**:
```
Processing authorization request with Request Object
hasRequestObject: true
Client ID from request object: 3768641751
Authorization request processed successfully
```

**エラーが発生する場合のログ**:
```
Unregistered Federation client detected, attempting dynamic registration
clientId: https://med-cia-sample-annie.trycloudflare.com
```
→ これが表示される場合、リクエストオブジェクトの`client_id`がまだエンティティIDになっています

### トラブルシューティング

#### 問題1: まだエンティティIDが使用されている
**症状**: Authorization Serverのログに "Unregistered Federation client detected" が表示される

**解決策**:
1. テストクライアントサーバーを完全に再起動
2. ブラウザのキャッシュをクリア
3. 新しいシークレットウィンドウで試行

#### 問題2: クライアントIDが見つからない
**症状**: "Client not found" エラー

**解決策**:
1. Authleteコンソールでクライアントが登録されているか確認
2. クライアントIDが正しいか確認
3. 必要に応じて `/clear-registration` で認証情報をクリアして再登録

#### 問題3: リダイレクトURIの不一致
**症状**: "redirect_uri_mismatch" エラー

**解決策**:
1. `.env` ファイルの `REDIRECT_URI` を確認
2. Authleteに登録されたリダイレクトURIと一致するか確認
3. 必要に応じてAuthleteコンソールで修正

#### 問題4: トークン交換に失敗
**症状**: コールバック後にエラーが発生

**解決策**:
1. クライアントシークレットが正しく保存されているか確認
2. `.client-credentials.json` ファイルの内容を確認
3. Authorization Serverのトークンエンドポイントログを確認

### デバッグコマンド

#### リクエストオブジェクトのデコード
リクエストオブジェクトの内容を確認したい場合：

```bash
# JWTをデコード（jwt.ioなどのツールを使用）
# または、Node.jsで：
node -e "
const jwt = 'YOUR_JWT_HERE';
const parts = jwt.split('.');
const payload = Buffer.from(parts[1], 'base64').toString();
console.log(JSON.parse(payload));
"
```

#### 認証情報の確認
```bash
cat test-client-federation-valid/.client-credentials.json
```

期待される出力:
```json
{
  "entityId": "https://med-cia-sample-annie.trycloudflare.com",
  "clientId": "3768641751",
  "clientSecret": "[secret]",
  "registeredAt": "2026-01-29T..."
}
```

#### 認証情報のクリア
```bash
curl http://localhost:3006/clear-registration
```

### 期待される動作フロー

1. **初回アクセス時**:
   - クライアントが動的登録を実行
   - 認証情報が `.client-credentials.json` に保存
   - リクエストオブジェクトに登録済みクライアントIDを使用
   - Authorization Serverが認可フローを開始

2. **サーバー再起動後**:
   - 保存された認証情報を読み込み
   - リクエストオブジェクトに登録済みクライアントIDを使用
   - 重複登録を試みない
   - 正常に認可フローを開始

3. **ログイン成功後**:
   - Authorization Serverがコールバックにリダイレクト
   - テストクライアントが認可コードをトークンに交換
   - アクセストークンとIDトークンを取得
   - ユーザー情報を表示

### 修正の確認

修正が正しく適用されたことを確認：

```bash
# test-client-federation-valid/server.js の該当行を確認
grep -A 5 "const clientId = registeredClientId" test-client-federation-valid/server.js
```

期待される出力:
```javascript
  // Use registered client ID if available, otherwise use entity ID for initial registration
  const clientId = registeredClientId || FEDERATION_CONFIG.entityId;

  const payload = {
    iss: FEDERATION_CONFIG.entityId,
```

### まとめ

この修正により：
- ✅ 登録後のログインフローが正常に動作
- ✅ 重複登録エラーが発生しない
- ✅ Authorization Serverが正しいクライアントIDを認識
- ✅ トークン交換が成功する

問題が解決しない場合は、上記のデバッグ手順に従ってログを確認し、具体的なエラーメッセージを提供してください。

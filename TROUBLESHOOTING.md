# トラブルシューティングガイド

## クライアント登録失敗の診断と解決

### 問題: クライアント登録時にエラーA320301が発生

#### エラーメッセージ
```
[A320301] Failed to resolve trust chains of the client: 
Couldn't resolve trust chain: Couldn't fetch entity configuration from 
https://annie-fifty-made-worlds.trycloudflare.com
```

#### 原因
AuthleteがTrust AnchorのEntity Configurationを取得できない。これは以下のいずれかが原因です:

1. **cloudflaredトンネルが起動していない**
2. **Authlete設定のTrust Anchor URLが正しくない**
3. **Trust Anchorサーバーが起動していない**
4. **ネットワーク接続の問題**

#### 診断手順

##### 1. Trust Anchorサーバーの確認

```bash
# ローカルでEntity Configurationが取得できるか確認
curl http://localhost:3010/.well-known/openid-federation

# 期待される結果: JWT形式の文字列（eyJ...）が返される
```

##### 2. cloudflaredトンネルの確認

```bash
# cloudflaredプロセスが実行中か確認
ps aux | grep cloudflared

# 期待される結果: cloudflared tunnel --url http://localhost:3010 が実行中
```

cloudflaredが起動していない場合:
```bash
# 新しいターミナルで起動
cloudflared tunnel --url http://localhost:3010

# 表示されたURLをメモ（例: https://abc-def-ghi.trycloudflare.com）
```

##### 3. HTTPS経由でのアクセス確認

```bash
# cloudflaredのURLでEntity Configurationが取得できるか確認
curl https://your-trust-anchor-url.trycloudflare.com/.well-known/openid-federation

# 期待される結果: JWT形式の文字列が返される
```

エラーが発生する場合:
- cloudflaredトンネルが正しく起動しているか確認
- URLが正しいか確認
- Trust Anchorサーバーが起動しているか確認

##### 4. Authlete設定の確認

Authlete管理画面で以下を確認:

1. **Service Settings** → **Federation**
2. **Trust Anchor**: cloudflaredのURLが設定されているか
   - 例: `https://abc-def-ghi.trycloudflare.com`
3. **保存**されているか確認

#### 解決方法

##### 方法1: cloudflaredトンネルを起動する（推奨）

```bash
# ターミナル1: Trust Anchor用cloudflared
cloudflared tunnel --url http://localhost:3010
# → 表示されたURLをメモ

# ターミナル2: Valid Client用cloudflared
cloudflared tunnel --url http://localhost:3006
# → 表示されたURLをメモ

# ターミナル3: Invalid Client用cloudflared（オプション）
cloudflared tunnel --url http://localhost:3007
# → 表示されたURLをメモ

# ターミナル4: URL設定を更新
./update-federation-urls.sh
# → メモしたURLを入力

# Authlete管理画面でTrust Anchor URLを更新
# Service Settings → Federation → Trust Anchor
# → cloudflaredのURLを入力して保存

# サーバーを再起動
# Trust Anchor, Valid Client, Authorization Serverを再起動
```

##### 方法2: ローカルテスト用の設定（開発環境のみ）

**注意**: この方法はAuthleteがlocalhostにアクセスできる環境でのみ使用可能です。

```bash
# Authlete設定でTrust Anchor URLをlocalhostに設定
# Trust Anchor: http://localhost:3010

# この方法は通常のAuthlete環境では動作しません
# cloudflaredの使用を推奨します
```

#### 確認方法

設定後、再度テスト登録を実行:

```bash
curl -s http://localhost:3006/test-registration | jq .
```

成功する場合の出力例:
```json
{
  "success": true,
  "clientId": "1234567890",
  "clientSecret": "[SET]",
  "entityId": "https://your-client-url.trycloudflare.com"
}
```

### 問題: エラーA320306（メタデータの型エラー）

#### エラーメッセージ
```
[A320306] The type of the metadata is wrong
```

#### 原因
クライアントメタデータのフィールドの型が不正です。

#### 解決方法

`test-client-federation-valid/server.js`で以下のフィールドが文字列であることを確認:

```javascript
openid_relying_party: {
  id_token_signed_response_alg: "RS256",  // 文字列
  token_endpoint_auth_signing_alg: "RS256",  // 文字列
  userinfo_signed_response_alg: "RS256",  // 文字列
  client_registration_types: ["explicit"]  // 配列
}
```

### 問題: エラーA327605（Entity ID重複）

#### エラーメッセージ
```
[A327605] The entity ID is already in use
```

#### 原因
同じEntity IDで既に登録されています（2回目以降の登録）。

#### 解決方法

これは正常な動作です。以下のいずれかを実行:

**方法1: 認証情報をクリア**
```bash
curl http://localhost:3006/clear-registration
```

**方法2: Authleteコンソールでクライアントを削除**
1. Authlete管理画面にログイン
2. Clients → 該当クライアントを検索
3. Delete

### 問題: cloudflaredトンネルが接続できない

#### 症状
```
ERR  error="failed to request quick Tunnel" error="no quick tunnels available"
```

#### 解決方法

1. **cloudflaredを再インストール**
```bash
brew reinstall cloudflare/cloudflare/cloudflared
```

2. **別のポートで試す**
```bash
cloudflared tunnel --url http://localhost:3010
```

3. **インターネット接続を確認**

### 問題: サーバーが起動しない

#### 原因
- 依存関係の不足
- ポートが既に使用されている
- ビルドエラー

#### 解決方法

```bash
# 依存関係を再インストール
npm install
cd trust-anchor && npm install && cd ..
cd test-client-federation-valid && npm install && cd ..

# ビルド
npm run build

# ポートの使用状況を確認
lsof -i :3001  # Authorization Server
lsof -i :3010  # Trust Anchor
lsof -i :3006  # Valid Client

# 使用中のプロセスを終了
kill -9 <PID>
```

## デバッグのヒント

### ログの確認

**Authorization Server:**
```bash
# ログはJSON形式で出力されます
npm start | jq .
```

**Trust Anchor:**
```bash
cd trust-anchor
npm start
```

**Test Client:**
```bash
cd test-client-federation-valid
npm start
```

### Entity Configurationの検証

```bash
# JWTをデコード
curl -s http://localhost:3010/.well-known/openid-federation | \
  cut -d'.' -f2 | \
  base64 -d | \
  jq .
```

### Trust Chainの確認

```bash
# Trust AnchorからEntity Statementを取得
curl -s "http://localhost:3010/federation/fetch?sub=https://your-client-url.trycloudflare.com"
```

### Authleteリクエストの確認

Authorization Serverのログで以下を確認:
- `Making Authlete API request`
- `Authlete API response received`
- `action`フィールドの値

## よくある質問

### Q: cloudflaredのURLはどのくらいの頻度で変更されますか？

A: cloudflaredトンネルを再起動するたびに新しいURLが発行されます。開発中は、トンネルを起動したままにしておくことをお勧めします。

### Q: 本番環境ではどうすればよいですか？

A: 本番環境では、固定のドメイン名を使用してください。cloudflaredの有料プランまたは独自のHTTPSサーバーを使用することをお勧めします。

### Q: Invalid Clientのテストは必須ですか？

A: はい。Invalid Clientのテストは、Trust Chainの検証が正しく機能していることを確認するために重要です。

### Q: Authleteの設定を変更した後、何をする必要がありますか？

A: Authorization Serverを再起動してください。設定の変更は自動的には反映されません。

## サポート

問題が解決しない場合は、以下を確認してください:

1. すべてのサーバーのログを確認
2. Authleteの管理画面でエラーログを確認
3. `.env`ファイルの設定を再確認
4. cloudflaredトンネルが正しく起動しているか確認

## RP-Side OP Trust Chain Validation Troubleshooting

For detailed troubleshooting information about RP-side OP trust chain validation, including error codes, common issues, and resolution steps, see:

**[RP OP Validation Troubleshooting Guide](test-client-federation-valid/README.md#error-codes-and-troubleshooting)**

This guide covers:
- All error codes (`op_unreachable`, `invalid_signature`, `missing_authority_hints`, `trust_chain_invalid`, `timeout`, etc.)
- Detailed troubleshooting steps for each error
- Common issues and solutions
- Debugging tips and tools
- Cache management
- Configuration validation

---

**最終更新**: 2026-02-03

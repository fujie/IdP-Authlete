# OpenID Federation Quick Start Guide

このガイドでは、OpenID Federationのテスト環境を素早くセットアップする手順を説明します。

## 前提条件

- Node.js 18以上
- npm
- Authleteアカウント（無料トライアル可）
- cloudflared（公開URL用）

## 1. 環境変数の設定

### Trust Anchor (.env)

```bash
cd trust-anchor
cp .env.example .env
```

`.env`を編集：
```
PORT=3010
ENTITY_ID=https://ta.diddc.site
ORGANIZATION_NAME=OpenID Federation Test Trust Anchor
HOMEPAGE_URI=https://ta.diddc.site
CONTACTS=admin@trust-anchor.example.com
# 登録するエンティティ（カンマ区切り）
SUBORDINATE_ENTITIES=https://op.diddc.site,https://op2.diddc.site,https://rp-test.diddc.site
# エンティティタイプ（カンマ区切り、上記と同じ順序）
SUBORDINATE_ENTITY_TYPES=openid_provider,openid_provider,openid_relying_party
```

### OP1 (.env)

```bash
cd ..
cp .env.example .env
```

`.env`を編集：
```
PORT=3001
ENTITY_ID=https://op.diddc.site
AUTHLETE_BASE_URL=https://ap1.authlete.com
AUTHLETE_SERVICE_ID=your_service_id
AUTHLETE_SERVICE_ACCESS_TOKEN=your_service_access_token
TRUST_ANCHOR_ID=https://ta.diddc.site
```

### OP2 (.env.op2)

```bash
cp .env.op2.example .env.op2
```

`.env.op2`を編集（OP1と同じAuthlete設定、ポートとEntity IDのみ変更）：
```
PORT=3002
ENTITY_ID=https://op2.diddc.site
# ... その他はOP1と同じ
```

### RP Client (.env)

```bash
cd test-client-federation-valid
cp .env.example .env
```

`.env`を編集：
```
PORT=3006
ENTITY_ID=https://rp-test.diddc.site
AUTHORIZATION_SERVER=https://op.diddc.site
REDIRECT_URI=https://rp-test.diddc.site/callback
TRUST_ANCHOR_ID=https://ta.diddc.site
CLIENT_NAME=Valid OpenID Federation Test Client
CLIENT_URI=https://rp-test.diddc.site
CONTACTS=admin@rp-test.diddc.site
SCOPE=openid profile email
```

## 2. 依存関係のインストール

```bash
# ルートディレクトリ（OP）
npm install

# Trust Anchor
cd trust-anchor
npm install

# RP Client
cd ../test-client-federation-valid
npm install
cd ..
```

## 3. OPのビルド

```bash
npm run build
```

## 4. サービスの起動

### 4.1 Trust Anchorの起動

```bash
cd trust-anchor
npm start
```

**重要**: 初回起動時、Trust Anchorは新しい鍵ペアを生成し、`.trust-anchor-keys.json`に保存します。
コンソールに表示されるJWKSetをコピーして、Authleteダッシュボードに登録してください：

1. Authleteダッシュボード → Services → あなたのサービス
2. OpenID Federation → Trust Anchors
3. Trust Anchor `https://ta.diddc.site`を追加
4. JWKSフィールドに表示されたJWKSetを貼り付け
5. 保存

**注意**: `.trust-anchor-keys.json`は秘密鍵を含むため、Gitにコミットしないでください（.gitignoreに追加済み）。

### 4.2 OP1の起動

```bash
cd ..
node dist/index.js
```

### 4.3 OP2の起動（別ターミナル）

```bash
node -r dotenv/config dist/index.js dotenv_config_path=.env.op2
```

### 4.4 RP Clientの起動（別ターミナル）

```bash
cd test-client-federation-valid
node server.js
```

## 5. cloudflaredの設定

各サービスに対してcloudflaredトンネルを設定：

```bash
# Trust Anchor
cloudflared tunnel --url http://localhost:3010

# OP1
cloudflared tunnel --url http://localhost:3001

# OP2
cloudflared tunnel --url http://localhost:3002

# RP
cloudflared tunnel --url http://localhost:3006
```

生成されたURLを各`.env`ファイルの`ENTITY_ID`に設定してください。

## 6. 動作確認

### Trust Anchor

```bash
curl http://localhost:3010/.well-known/openid-federation
```

### OP1

```bash
curl http://localhost:3001/.well-known/openid-federation
curl http://localhost:3001/health
```

### RP Client

ブラウザで`http://localhost:3006`にアクセスし、「Login with Federation」をクリック。

## 7. Trust Anchor JWKSetの登録

Trust Anchorは初回起動時に鍵ペアを生成し、`.trust-anchor-keys.json`に保存します。
この鍵ペアは再起動時も再利用されるため、一度Authleteに登録すれば更新不要です。

### 現在のTrust Anchor JWKSet

以下のJWKSetをAuthleteダッシュボードに登録してください：

```json
{
  "keys": [
    {
      "kty": "RSA",
      "n": "7AhujgmXusBEMsfu9rKyulvsGCPGm96KlN8tGQ4qGY8ocLoc0TQCI7IuOVmRDuLThffGUKRboA62V_wxoYQUnrWME4wsg-QuXePSmSEWCnmLIalQxf2ONg5_soGFIEunusQG-0kyiWDkTNSlBuhHuUEvkpHXbxq6BOrejfy0ZM63wJz7JwmJTxcfGMA-80jPy0QrxVyOA5vOQeAFqoGxSZKWBIeKs_YCAzVtzayd4Iq0Imy7LeTUnItJjcG0jUVzOs67tZBIbW2ZPouE9sJvBhgDVS4BgwYWXnSxA6tE_yACO1mZMBo2J7_q6sfATeIP_2IjkdUhYqzhHKMDcep4fQ",
      "e": "AQAB",
      "use": "sig",
      "alg": "RS256",
      "kid": "1a5d6d73-b967-4041-a8df-513f5730b4bb"
    }
  ]
}
```

### Authlete設定手順

1. Authleteダッシュボードにログイン: https://ap1.authlete.com/
2. Services → あなたのサービス → OpenID Federation → Trust Anchors
3. Trust Anchor `https://ta.diddc.site`（またはあなたのTrust Anchor URL）を追加
4. 上記のJWKSetをJWKSフィールドに貼り付け
5. 保存

**重要**: この設定は一度だけ行えば、Trust Anchorを再起動しても更新不要です。

## 8. PKCE対応の動的登録

RPクライアントは自動的にPKCE対応のPublicクライアントとして登録されます：

- `token_endpoint_auth_method`: `none`
- `clientType`: `public`
- `pkceRequired`: `true`
- `pkceCodeChallengeMethods`: `['S256']`

初回登録時、Authleteは以下の設定でクライアントを作成します：
- Client Type: Public
- Token Endpoint Auth Method: none
- PKCE Required: true

### Authleteダッシュボードでの確認

1. Authleteダッシュボードにログイン
2. Services → あなたのサービス → Clients
3. Entity ID（例: `https://rp-test.diddc.site`）でクライアントを検索
4. 以下の設定を確認：
   - Client Type: `public`
   - Token Endpoint Auth Method: `none`
   - PKCE Required: チェックが入っている
   - PKCE Code Challenge Methods: `S256`が選択されている

**注意**: 既存のクライアントがある場合、上記の設定に手動で変更してください。

## トラブルシューティング

### Trust Anchor JWKSet更新

Trust Anchorを再起動しても、保存された鍵ペアが使用されるため、Authleteの設定を更新する必要はありません。

鍵ファイルの場所: `trust-anchor/.trust-anchor-keys.json`

鍵を再生成する場合：
1. `.trust-anchor-keys.json`を削除
2. Trust Anchorを再起動
3. コンソールに表示される新しいJWKSetをAuthleteに登録

### PKCE認証エラー

「Client authentication failed」エラーが出る場合：

1. **Authleteダッシュボードでクライアント設定を確認**:
   - Client Type が `public` になっているか
   - Token Endpoint Auth Method が `none` になっているか
   - PKCE Required が有効になっているか

2. **クライアント登録をクリア**:
   ```bash
   curl http://localhost:3006/clear-registration
   ```

3. **再度ログインを試行**:
   - RPが自動的にPKCE対応で再登録します

### Entity ID Conflict (A327605)

既存のクライアントがある場合、RPは自動的にPKCEフォールバックを使用します。

ログに以下のメッセージが表示されます：
```
⚠️  Entity ID conflict detected (A327605) - Using PKCE fallback
This is expected behavior due to Authlete soft delete
Will proceed with PKCE-based authentication (no client secret required)
```

これは正常な動作です。RPはPKCEを使用して認証を続行します。

### Authleteクライアント設定の手動更新

既存のクライアントをPKCE対応に変更する場合：

1. Authleteダッシュボードにログイン
2. Services → あなたのサービス → Clients
3. Entity ID（例: `https://rp-test.diddc.site`）でクライアントを検索
4. 以下の設定を変更：
   - Client Type: `public`に変更
   - Token Endpoint Auth Method: `none`に変更
   - PKCE Required: チェックを入れる
   - PKCE Code Challenge Methods: `S256`を選択
5. 保存

### セキュリティに関する注意事項

以下のファイルは秘密情報を含むため、Gitにコミットしないでください（`.gitignore`に追加済み）：

- `.env`, `.env.op2` - Authlete認証情報
- `.trust-anchor-keys.json` - Trust Anchor秘密鍵
- `.client-credentials.json`, `.op-credentials.json` - クライアント認証情報

詳細は`TROUBLESHOOTING.md`を参照してください。

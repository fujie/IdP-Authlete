# OpenID Federation Dynamic Registration セットアップガイド

このガイドでは、OpenID Federation Dynamic Registrationのテスト環境のセットアップ方法を説明します。

## 📋 目次

1. [概要](#概要)
2. [前提条件](#前提条件)
3. [初回セットアップ](#初回セットアップ)
4. [cloudflared URL更新手順](#cloudflared-url更新手順)
5. [サーバー起動手順](#サーバー起動手順)
6. [動作確認](#動作確認)
7. [トラブルシューティング](#トラブルシューティング)

---

## 概要

このプロジェクトは、OpenID Federationを使用した動的クライアント登録の実装です。

### アーキテクチャ

```
┌─────────────────────┐
│  Trust Anchor       │ ← cloudflared (HTTPS)
│  (port 3010)        │
└──────────┬──────────┘
           │ Trust Chain
           │
┌──────────▼──────────┐
│ Authorization Server│
│  (port 3001)        │
│  + Authlete API     │
└──────────┬──────────┘
           │
           │ Registration
           │
┌──────────▼──────────┐
│ Valid Test Client   │ ← cloudflared (HTTPS)
│  (port 3006)        │
└─────────────────────┘

┌─────────────────────┐
│ Invalid Test Client │ (Trust Anchorに未登録)
│  (port 3007)        │
└─────────────────────┘
```

### 主要コンポーネント

1. **Trust Anchor** (`trust-anchor/`)
   - OpenID Federationの信頼の起点
   - 登録されたクライアントのEntity Statementを発行
   - cloudflaredでHTTPSアクセスを提供

2. **Authorization Server** (ルートディレクトリ)
   - OAuth 2.0 / OpenID Connect認可サーバー
   - Authlete APIと統合
   - Federation Dynamic Registrationエンドポイントを提供

3. **Valid Test Client** (`test-client-federation-valid/`)
   - Trust Anchorに登録されたクライアント
   - 登録成功のテストに使用
   - cloudflaredでHTTPSアクセスを提供

4. **Invalid Test Client** (`test-client-federation-invalid/`)
   - Trust Anchorに未登録のクライアント
   - 登録失敗のテストに使用

---

## 前提条件

### 必須ソフトウェア

- **Node.js**: v18以上
- **npm**: v8以上
- **cloudflared**: 最新版
  - インストール: `brew install cloudflare/cloudflare/cloudflared` (macOS)
  - または: https://developers.cloudflare.com/cloudflare-one/connections/connect-apps/install-and-setup/installation/

### Authlete設定

Authlete管理画面で以下の設定が必要です：

1. **サービス設定**
   - `supportedClientRegistrationTypes`: `EXPLICIT`を含める
   - `federationRegistrationEndpoint`: 設定済み

2. **Federation設定**
   - Federation JWK Set: 秘密鍵を含むJWK Setを設定
   - `federation_signature_key_id`: 秘密鍵のkidを設定
   - Trust Anchor: cloudflared URLを設定（後述）

---

## 初回セットアップ

### 1. 依存関係のインストール

```bash
# ルートディレクトリ（Authorization Server）
npm install

# Trust Anchor
cd trust-anchor
npm install
cd ..

# Valid Test Client
cd test-client-federation-valid
npm install
cd ..

# Invalid Test Client
cd test-client-federation-invalid
npm install
cd ..
```

### 2. Authorization Serverのビルド

```bash
npm run build
```

### 3. 環境変数の設定

`.env`ファイルを作成し、Authlete認証情報を設定：

```bash
# .env
AUTHLETE_API_KEY=your_api_key
AUTHLETE_API_SECRET=your_api_secret
AUTHLETE_SERVICE_API_KEY=your_service_api_key
AUTHLETE_SERVICE_API_SECRET=your_service_api_secret
```

---

## cloudflared URL更新手順

cloudflaredのURLは起動するたびに変更されるため、以下の手順で更新します。

### 方法1: 自動更新スクリプト（推奨）

```bash
# スクリプトを実行
./update-federation-urls.sh
```

スクリプトが以下を実行します：
1. 現在の設定を表示
2. 新しいURLの入力を求める
3. すべての設定ファイルを自動更新

### 方法2: 手動更新

各`.env`ファイルを直接編集：

#### trust-anchor/.env
```bash
ENTITY_ID=https://your-trust-anchor-url.trycloudflare.com
HOMEPAGE_URI=https://your-trust-anchor-url.trycloudflare.com
SUBORDINATE_ENTITIES=https://your-valid-client-url.trycloudflare.com
```

#### test-client-federation-valid/.env
```bash
ENTITY_ID=https://your-valid-client-url.trycloudflare.com
CLIENT_URI=https://your-valid-client-url.trycloudflare.com
TRUST_ANCHOR_ID=https://your-trust-anchor-url.trycloudflare.com
CONTACTS=admin@your-valid-client-url.trycloudflare.com
```

#### test-client-federation-invalid/.env
```bash
TRUST_ANCHOR_ID=https://your-trust-anchor-url.trycloudflare.com
```

### Authlete設定の更新

Authlete管理画面で以下を更新：

1. **Service Settings** → **Federation**
2. **Trust Anchor**: Trust AnchorのcloudflaredURLを設定
   - 例: `https://your-trust-anchor-url.trycloudflare.com`

---

## サーバー起動手順

### 1. cloudflaredトンネルの起動

**ターミナル1: Trust Anchor用**
```bash
cloudflared tunnel --url http://localhost:3010
```

表示されたURLをメモ（例: `https://abc-def-ghi.trycloudflare.com`）

**ターミナル2: Valid Test Client用**
```bash
cloudflared tunnel --url http://localhost:3006
```

表示されたURLをメモ（例: `https://xyz-uvw-rst.trycloudflare.com`）

### 2. URL更新スクリプトの実行

**ターミナル3:**
```bash
./update-federation-urls.sh
```

メモしたURLを入力して設定を更新

### 3. Authlete設定の更新

Authlete管理画面でTrust Anchor URLを更新

### 4. サーバーの起動

**ターミナル4: Trust Anchor**
```bash
cd trust-anchor
npm start
```

**ターミナル5: Valid Test Client**
```bash
cd test-client-federation-valid
npm start
```

**ターミナル6: Invalid Test Client**
```bash
cd test-client-federation-invalid
npm start
```

**ターミナル7: Authorization Server**
```bash
npm start
```

### 起動確認

すべてのサーバーが起動したら、以下のメッセージが表示されます：

```
Trust Anchor:
========================================
OpenID Federation Trust Anchor
========================================
Running on: http://localhost:3010
Entity ID: https://xxx.trycloudflare.com
...

Valid Test Client:
OpenID Federation Test Client (Valid) running on http://localhost:3006
Configuration:
- Entity ID: https://yyy.trycloudflare.com
- Trust Anchor: https://xxx.trycloudflare.com
...

Authorization Server:
Server is running on port 3001
```

---

## 動作確認

### 1. ヘルスチェック

```bash
# Trust Anchor
curl http://localhost:3010/health

# Valid Test Client
curl http://localhost:3006/health

# Invalid Test Client
curl http://localhost:3007/health

# Authorization Server
curl http://localhost:3001/health
```

### 2. Entity Configuration確認

```bash
# Trust Anchor
curl https://your-trust-anchor-url.trycloudflare.com/.well-known/openid-federation

# Valid Test Client
curl https://your-valid-client-url.trycloudflare.com/.well-known/openid-federation
```

### 3. 登録テスト

**Valid Client（成功するはず）:**
```bash
curl http://localhost:3006/test-registration | jq .
```

期待される結果:
- 初回: `success: true` とclient_idが返される
- 2回目以降: エラーA327605（既に登録済み）

**Invalid Client（失敗するはず）:**
```bash
curl http://localhost:3007/test-registration | jq .
```

期待される結果:
- `success: false`
- エラーA320301（Trust Chainの解決失敗）

### 4. End-to-Endテスト

包括的なテストを実行：

```bash
# Test 1: Valid Client Registration
curl -s http://localhost:3006/test-registration | jq .

# Test 2: Invalid Client Registration
curl -s http://localhost:3007/test-registration | jq .

# Test 3: Trust Anchor Entity Configuration
curl -s https://your-trust-anchor-url.trycloudflare.com/.well-known/openid-federation | cut -d'.' -f2 | base64 -d | jq .

# Test 4: Federation Fetch (Valid)
curl -s "https://your-trust-anchor-url.trycloudflare.com/federation/fetch?sub=https://your-valid-client-url.trycloudflare.com"

# Test 5: Federation Fetch (Invalid)
curl -s "https://your-trust-anchor-url.trycloudflare.com/federation/fetch?sub=https://invalid-federation-client.example.com" | jq .
```

---

## トラブルシューティング

### 問題: 登録時にエラーA320301が発生

**原因**: Trust ChainまたはEntity Configurationの取得に失敗

**解決方法**:
1. cloudflaredトンネルが起動しているか確認
2. URLが正しく設定されているか確認
   ```bash
   grep ENTITY_ID trust-anchor/.env
   grep ENTITY_ID test-client-federation-valid/.env
   grep TRUST_ANCHOR_ID test-client-federation-valid/.env
   ```
3. Trust Anchorのログでエラーがないか確認
4. Authlete管理画面のTrust Anchor設定を確認

### 問題: エラーA320306（メタデータの型エラー）

**原因**: クライアントメタデータの型が不正

**解決方法**:
- `test-client-federation-valid/server.js`で以下のフィールドが文字列であることを確認：
  - `id_token_signed_response_alg`
  - `token_endpoint_auth_signing_alg`
  - `userinfo_signed_response_alg`

### 問題: エラーA320310（client_registration_types不足）

**原因**: `client_registration_types`に`explicit`が含まれていない

**解決方法**:
- `test-client-federation-valid/server.js`で以下を確認：
  ```javascript
  client_registration_types: ['explicit']
  ```

### 問題: エラーA327605（Entity ID重複）

**原因**: 同じEntity IDで既に登録されている

**解決方法**:
- これは正常な動作です（2回目以降の登録）
- Authlete管理画面でクライアントを削除して再テスト可能

### 問題: cloudflaredトンネルが接続できない

**原因**: ポートが既に使用されている、またはcloudflaredが正しくインストールされていない

**解決方法**:
1. cloudflaredのバージョン確認
   ```bash
   cloudflared --version
   ```
2. ポートの使用状況確認
   ```bash
   lsof -i :3010
   lsof -i :3006
   ```
3. cloudflaredを再インストール

### 問題: サーバーが起動しない

**原因**: 依存関係の不足またはビルドエラー

**解決方法**:
1. 依存関係を再インストール
   ```bash
   npm install
   cd trust-anchor && npm install && cd ..
   cd test-client-federation-valid && npm install && cd ..
   cd test-client-federation-invalid && npm install && cd ..
   ```
2. Authorization Serverを再ビルド
   ```bash
   npm run build
   ```
3. Node.jsのバージョン確認
   ```bash
   node --version  # v18以上が必要
   ```

---

## 参考資料

### ドキュメント

- `FEDERATION_E2E_TEST_RESULTS.md`: End-to-Endテスト結果
- `FEDERATION_INTEGRATION_SUMMARY.md`: 統合実装の概要
- `FEDERATION_TEST_CLIENTS.md`: テストクライアントの詳細
- `DYNAMIC_REGISTRATION_IMPLEMENTATION.md`: 実装の詳細

### 仕様

- `.kiro/specs/federation-dynamic-registration/requirements.md`: 要件定義
- `.kiro/specs/federation-dynamic-registration/design.md`: 設計書
- `.kiro/specs/federation-dynamic-registration/tasks.md`: タスクリスト

### OpenID Federation仕様

- [OpenID Federation 1.0](https://openid.net/specs/openid-federation-1_0.html)
- [Authlete Federation API](https://docs.authlete.com/)

---

## よくある質問

### Q: cloudflaredのURLはどのくらいの頻度で変更されますか？

A: cloudflaredトンネルを再起動するたびに新しいURLが発行されます。開発中は、トンネルを起動したままにしておくことをお勧めします。

### Q: 本番環境ではどうすればよいですか？

A: 本番環境では、固定のドメイン名を使用してください。cloudflaredの有料プランまたは独自のHTTPSサーバーを使用することをお勧めします。

### Q: Invalid Clientのテストは必須ですか？

A: はい。Invalid Clientのテストは、Trust Chainの検証が正しく機能していることを確認するために重要です。

### Q: Authleteの設定を変更した後、何をする必要がありますか？

A: Authorization Serverを再起動してください。設定の変更は自動的には反映されません。

---

## サポート

問題が解決しない場合は、以下を確認してください：

1. すべてのサーバーのログを確認
2. Authleteの管理画面でエラーログを確認
3. `.env`ファイルの設定を再確認
4. `FEDERATION_E2E_TEST_RESULTS.md`の期待される動作と比較

---

**最終更新**: 2026-01-29
**バージョン**: 1.0.0

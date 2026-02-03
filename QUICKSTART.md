# クイックスタートガイド

OpenID Federation動的クライアント登録のテスト環境を素早くセットアップするためのガイドです。

## 前提条件

- Node.js v18以上
- npm v8以上
- cloudflared（HTTPS公開用）
- Authleteアカウント

## 5分でセットアップ

### 1. 依存関係のインストール

```bash
# メインサーバー
npm install && npm run build

# Trust Anchor
cd trust-anchor && npm install && cd ..

# テストクライアント
cd test-client-federation-valid && npm install && cd ..
cd test-client-federation-invalid && npm install && cd ..
```

### 2. 環境変数の設定

`.env`ファイルを作成:

```bash
# Authlete認証情報
AUTHLETE_API_KEY=your_api_key
AUTHLETE_API_SECRET=your_api_secret
AUTHLETE_SERVICE_API_KEY=your_service_api_key
AUTHLETE_SERVICE_API_SECRET=your_service_api_secret
```

### 3. cloudflaredトンネルの起動

**ターミナル1（Trust Anchor用）:**
```bash
cloudflared tunnel --url http://localhost:3010
# 表示されたURLをメモ（例: https://abc.trycloudflare.com）
```

**ターミナル2（Authorization Server / OP用）:**
```bash
cloudflared tunnel --url http://localhost:3001
# 表示されたURLをメモ（例: https://aaa.trycloudflare.com）
```

**ターミナル3（Valid Client用）:**
```bash
cloudflared tunnel --url http://localhost:3006
# 表示されたURLをメモ（例: https://xyz.trycloudflare.com）
```

**ターミナル4（Invalid Client用）:**
```bash
cloudflared tunnel --url http://localhost:3007
# 表示されたURLをメモ（例: https://def.trycloudflare.com）
```

### 4. URL設定の更新

```bash
# 自動更新スクリプトを実行
./update-federation-urls.sh

# プロンプトに従ってURLを入力
Trust Anchor URL: https://abc.trycloudflare.com
Authorization Server (OP) URL: https://aaa.trycloudflare.com
Valid Client URL: https://xyz.trycloudflare.com
Invalid Client URL: https://def.trycloudflare.com
```

### 5. Trust Anchor設定

Trust Anchor管理画面でOPエンティティを登録:

1. http://localhost:3010/admin にアクセス
2. **Add Entity**セクションで以下を入力:
   - **Entity ID**: Authorization ServerのcloudflaredURL（例: https://aaa.trycloudflare.com）
   - **Entity Type**: `openid_provider`を選択
3. **Add Entity**をクリック

### 6. サーバーの起動

**ターミナル5（Trust Anchor）:**
```bash
cd trust-anchor && npm start
```

**ターミナル6（Authorization Server）:**
```bash
npm start
```

**ターミナル7（Valid Client）:**
```bash
cd test-client-federation-valid && npm start
```

**ターミナル8（Invalid Client）:**
```bash
cd test-client-federation-invalid && npm start
```

## 動作確認

### Trust AnchorへのOP登録

1. Trust Anchor管理画面（http://localhost:3010/admin）にアクセス
2. **Add Entity**セクションで以下を入力:
   - **Entity ID**: Authorization ServerのcloudflaredURL
   - **Entity Type**: `openid_provider`を選択
3. **Add Entity**をクリック
4. ✅ OPが登録されたことを確認

### 正常系テスト（Valid Client）

1. http://localhost:3006 にアクセス
2. Trust Anchor管理画面でValid ClientのEntity IDを登録（Entity Type: `openid_relying_party`）
3. "Start Federation Login"をクリック
4. ✅ 登録成功 → 認可フロー開始

### 異常系テスト（Invalid Client）

1. http://localhost:3007 にアクセス
2. Trust AnchorにInvalid ClientのEntity IDが**登録されていない**ことを確認
3. "Start Federation Login"をクリック
4. ✅ 登録失敗 → エラー画面表示

## トラブルシューティング

### 登録エラーが発生する場合

```bash
# ヘルスチェック
curl http://localhost:3010/health  # Trust Anchor
curl http://localhost:3006/health  # Valid Client
curl http://localhost:3001/health  # Authorization Server

# Entity Configuration確認
curl https://your-trust-anchor-url.trycloudflare.com/.well-known/openid-federation
```

### 認証情報をクリアする場合

```bash
# Valid Client
curl http://localhost:3006/clear-registration

# Invalid Client
curl http://localhost:3007/clear-registration
```

## 次のステップ

詳細なドキュメント:
- `FEDERATION_README.md` - 完全な実装ガイド
- `.kiro/specs/federation-dynamic-registration/` - 仕様書

## サポート

問題が発生した場合は、各サーバーのログを確認してください。

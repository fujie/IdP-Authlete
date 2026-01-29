# OpenID Federation クイックスタートガイド

最速でテスト環境を起動する手順です。

## 🚀 5ステップで起動

### 1. cloudflaredトンネルを起動

```bash
# ターミナル1: Trust Anchor用
cloudflared tunnel --url http://localhost:3010
# → 表示されたURLをメモ（例: https://abc.trycloudflare.com）

# ターミナル2: Valid Client用
cloudflared tunnel --url http://localhost:3006
# → 表示されたURLをメモ（例: https://xyz.trycloudflare.com）
```

### 2. URL更新スクリプトを実行

```bash
# ターミナル3
./update-federation-urls.sh
# → メモしたURLを入力
```

### 3. Authlete設定を更新

Authlete管理画面で：
- **Service Settings** → **Federation** → **Trust Anchor**
- Trust AnchorのcloudflaredURLを設定

### 4. サーバーを起動

```bash
# ターミナル4: Trust Anchor
cd trust-anchor && npm start

# ターミナル5: Valid Client
cd test-client-federation-valid && npm start

# ターミナル6: Invalid Client
cd test-client-federation-invalid && npm start

# ターミナル7: Authorization Server
npm start
```

### 5. 動作確認

```bash
# Valid Client（成功するはず）
curl http://localhost:3006/test-registration | jq .

# Invalid Client（失敗するはず）
curl http://localhost:3007/test-registration | jq .
```

## ✅ 成功の確認

### Valid Client
```json
{
  "success": true,
  "clientId": "3768641751",
  "clientSecret": "[SET]",
  "message": "Dynamic registration successful"
}
```

または（2回目以降）:
```json
{
  "success": false,
  "error": "Request failed with status code 500",
  "details": {
    "error": "invalid_request",
    "error_description": "[A327605] Cannot create a new client because the entity ID is already in use."
  }
}
```

### Invalid Client
```json
{
  "success": false,
  "error": "Request failed with status code 500",
  "details": {
    "error": "validation_failed",
    "error_description": "[A320301] Failed to resolve trust chains of the client"
  },
  "message": "✅ EXPECTED: Dynamic registration failed as expected"
}
```

## 📚 詳細情報

詳しい設定方法やトラブルシューティングは `FEDERATION_SETUP_README.md` を参照してください。

## 🔄 URL変更時の手順

cloudflaredを再起動した場合：

1. 新しいURLをメモ
2. `./update-federation-urls.sh` を実行
3. Authlete設定を更新
4. すべてのサーバーを再起動

## ⚠️ よくあるエラー

### エラーA320301: Trust Chain解決失敗
- cloudflaredトンネルが起動しているか確認
- URLが正しく設定されているか確認
- Authlete設定を確認

### エラーA327605: Entity ID重複
- 正常な動作（既に登録済み）
- Authlete管理画面でクライアントを削除して再テスト可能

### サーバーが起動しない
```bash
# 依存関係を再インストール
npm install
cd trust-anchor && npm install && cd ..
cd test-client-federation-valid && npm install && cd ..
cd test-client-federation-invalid && npm install && cd ..

# ビルド
npm run build
```

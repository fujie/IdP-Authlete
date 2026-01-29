# OpenID Federation Dynamic Registration Test

このドキュメントでは、Authleteのfederation/registrationエンドポイントを使用した動的クライアント登録のテストについて説明します。

## テスト環境

### 認可サーバー
- **URL**: http://localhost:3001
- **Entity Configuration**: http://localhost:3001/.well-known/openid-federation
- **Dynamic Registration**: http://localhost:3001/federation/register

### テストクライアント

#### 1. 有効なTrust Chainを持つクライアント (test-client-valid)
- **URL**: http://localhost:3006
- **Entity ID**: https://localhost:3006
- **Entity Configuration**: http://localhost:3006/.well-known/openid-federation
- **Trust Chain Status**: Trust Anchorに登録済み（有効）
- **期待される動作**: 動的登録成功 → OIDCログイン成功

#### 2. 無効なTrust Chainを持つクライアント (test-client-invalid)
- **URL**: http://localhost:3007
- **Entity ID**: https://localhost:3007
- **Entity Configuration**: http://localhost:3007/.well-known/openid-federation
- **Trust Chain Status**: Trust Anchorに未登録（無効）
- **期待される動作**: 動的登録失敗 → OIDCログイン失敗

## Trust Anchor設定

Trust Anchorには以下のエンティティが登録されています：

### 登録済みエンティティ（有効）
- `http://localhost:3001` (認可サーバー)
- `https://localhost:3002` (既存テストクライアント)
- `http://localhost:3002` (既存テストクライアント - HTTP)
- `http://localhost:3003` (既存テストクライアント)
- `https://localhost:3006` (新規有効テストクライアント) ✅

### 未登録エンティティ（無効）
- `https://localhost:3007` (新規無効テストクライアント) ❌

## テスト手順

### 1. サーバー起動確認

```bash
# 認可サーバーが起動していることを確認
curl http://localhost:3001/health

# 有効なテストクライアントが起動していることを確認
curl http://localhost:3006/health

# 無効なテストクライアントが起動していることを確認
curl http://localhost:3007/health
```

### 2. Entity Configuration確認

```bash
# 認可サーバーのEntity Configuration
curl http://localhost:3001/.well-known/openid-federation

# 有効なクライアントのEntity Configuration
curl http://localhost:3006/.well-known/openid-federation

# 無効なクライアントのEntity Configuration
curl http://localhost:3007/.well-known/openid-federation
```

### 3. 有効なクライアントでのテスト（成功ケース）

1. ブラウザで http://localhost:3006 にアクセス
2. 「Federation ログイン開始」ボタンをクリック
3. 認可サーバーにリダイレクトされる
4. **期待される動作**:
   - Request Objectが解析される
   - Entity Discoveryが実行される
   - Trust Chain検証が成功する
   - 動的クライアント登録が成功する
   - ログイン画面が表示される
5. デモ認証情報でログイン（例: demo/password）
6. 同意画面で「Authorize」をクリック
7. **期待される結果**: 認証成功画面が表示される

### 4. 無効なクライアントでのテスト（失敗ケース）

1. ブラウザで http://localhost:3007 にアクセス
2. 「Federation ログイン開始」ボタンをクリック
3. 認可サーバーにリダイレクトされる
4. **期待される動作**:
   - Request Objectが解析される
   - Entity Discoveryが実行される
   - Trust Chain検証が失敗する
   - 動的クライアント登録が失敗する
   - エラーレスポンスが返される
5. **期待される結果**: エラー画面が表示される（Trust Chain validation failed）

## 実装詳細

### 動的登録フロー

1. **Request Object解析**: クライアントからのRequest ObjectをBase64デコードしてJWTとして解析
2. **Entity Discovery**: クライアントのEntity IDから`/.well-known/openid-federation`を取得
3. **Trust Chain検証**: Trust Anchorに対してクライアントのTrust Chainを検証
4. **Authlete API呼び出し**: 
   - 最初に`/federation/registration`エンドポイントを試行
   - 失敗した場合は標準の`/client/registration`にフォールバック
   - さらに失敗した場合は`/client/create`にフォールバック
5. **クライアント情報保存**: 登録されたクライアント情報をセッションに保存

### Trust Chain検証

Trust Chain検証は`TrustChainService`で実装されており、以下をチェックします：

- エンティティがTrust Anchorに登録されているか
- Trust Chainの有効期限
- Trust AnchorのIDが正しいか

### エラーハンドリング

- Trust Chain検証失敗: `invalid_client_metadata`エラー
- Entity Discovery失敗: `discovery_failed`エラー
- Authlete API失敗: `server_error`エラー

## ログ確認

認可サーバーのログで以下を確認できます：

```bash
# 成功ケース（有効なクライアント）
- "Processing authorization request with Request Object"
- "Unregistered Federation client detected, attempting dynamic registration"
- "Performing Federation Entity Discovery"
- "Entity Configuration discovered successfully"
- "Trust Chain validation successful"
- "Using Authlete Federation Registration API"
- "Client registration successful"

# 失敗ケース（無効なクライアント）
- "Processing authorization request with Request Object"
- "Unregistered Federation client detected, attempting dynamic registration"
- "Performing Federation Entity Discovery"
- "Trust Chain validation failed"
- "Client registration rejected - invalid Trust Chain"
```

## トラブルシューティング

### よくある問題

1. **ポート競合**: 他のプロセスがポートを使用している場合は停止してください
2. **Trust Chain設定**: `src/federation/trustChain.ts`でエンティティが正しく登録されているか確認
3. **Entity Configuration**: クライアントの`/.well-known/openid-federation`が正しく返されているか確認
4. **Authlete設定**: 認可サーバーがAuthleteに正しく接続できているか確認

### デバッグ方法

1. ブラウザの開発者ツールでネットワークタブを確認
2. 認可サーバーのログを確認
3. テストクライアントのログを確認
4. curlコマンドで各エンドポイントを直接テスト

## 期待される結果

- **有効なクライアント**: 動的登録成功 → 認証フロー完了 → ユーザー情報表示
- **無効なクライアント**: 動的登録失敗 → エラー画面表示

このテストにより、OpenID Federation 1.0の動的クライアント登録機能が正しく実装されていることを確認できます。
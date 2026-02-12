# PKCE実装とセキュリティ強化サマリー

## 実装完了日
2026年2月12日

## 実装内容

### 1. PKCE対応の動的クライアント登録

RPクライアントは自動的にPKCE対応のPublicクライアントとして登録されます。

#### クライアント登録設定
- **Client Type**: `public`
- **Token Endpoint Auth Method**: `none`
- **PKCE Required**: `true`
- **PKCE Code Challenge Methods**: `['S256']`

#### 実装ファイル
- `test-client-federation-valid/server.js`
  - `createEntityConfiguration()`: Entity Configurationに`token_endpoint_auth_method: 'none'`を設定
  - `performDynamicRegistration()`: A327605エラー時のPKCEフォールバック処理
  - `/federation-login`: PKCE パラメータ生成と認可リクエストへの追加
  - `/callback`: PKCE code_verifierを使用したトークン交換

#### PKCEフロー
1. **認可リクエスト時**:
   - `code_verifier`を生成（ランダム文字列）
   - `code_challenge`を計算（SHA-256ハッシュ）
   - `code_challenge_method: 'S256'`を設定
   - セッションに`code_verifier`を保存

2. **トークン交換時**:
   - セッションから`code_verifier`を取得
   - トークンリクエストに`code_verifier`を含める
   - `client_secret`は送信しない

#### A327605エラーハンドリング
Authleteのソフトデリート機能により、既存のクライアントIDが存在する場合、A327605エラーが返されます。この場合、RPは自動的にPKCEフォールバックを使用します：

```javascript
// A327605エラー検出
if (error.response?.data?.error === 'entity_id_conflict' ||
    error.response?.data?.error_description?.includes('A327605') ||
    error.response?.data?.resultCode === 'A327605') {
  // PKCEフォールバックを使用
  usePKCE = true;
  opCredentials = { clientSecret: null, usePKCE: true };
}
```

### 2. Trust Anchor鍵ペアの永続化

Trust Anchorは初回起動時に鍵ペアを生成し、`.trust-anchor-keys.json`に保存します。再起動時は保存された鍵を読み込むため、Authleteの設定を更新する必要はありません。

#### 実装ファイル
- `trust-anchor/server.js`
  - `loadOrGenerateKeyPair()`: 既存の鍵を読み込み、存在しない場合は生成
  - `generateAndSaveKeyPair()`: 新しい鍵ペアを生成して保存

#### 鍵ファイル
- **ファイル名**: `.trust-anchor-keys.json`
- **場所**: `trust-anchor/.trust-anchor-keys.json`
- **内容**: 公開鍵JWK、秘密鍵JWK、作成日時
- **セキュリティ**: `.gitignore`に追加済み（Gitにコミットされない）

#### 現在のTrust Anchor JWKSet

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

#### Authlete設定手順
1. Authleteダッシュボードにログイン: https://ap1.authlete.com/
2. Services → あなたのサービス → OpenID Federation → Trust Anchors
3. Trust Anchor `https://ta.diddc.site`（またはあなたのTrust Anchor URL）を追加
4. 上記のJWKSetをJWKSフィールドに貼り付け
5. 保存

**注意**: この設定は一度だけ行えば、Trust Anchorを再起動しても更新不要です。

### 3. .gitignoreの更新

秘密情報を含むファイルを`.gitignore`に追加しました。

#### 追加されたファイル

```gitignore
# Client credentials (persisted registration data)
.client-credentials.json
.op-credentials.json
test-client-federation-valid/.client-credentials.json
test-client-federation-valid/.op-credentials.json
test-client-federation-invalid/.client-credentials.json

# Trust Anchor keys (contains private keys)
.trust-anchor-keys.json
trust-anchor/.trust-anchor-keys.json

# Authlete credentials and sensitive configuration
.env
.env.local
.env.development.local
.env.test.local
.env.production.local
.env.op2
test-client-federation-valid/.env
test-client-federation-invalid/.env
trust-anchor/.env
```

#### 保護される情報
- **クライアント認証情報**: `.client-credentials.json`, `.op-credentials.json`
- **Trust Anchor秘密鍵**: `.trust-anchor-keys.json`
- **環境変数ファイル**: `.env`, `.env.op2`（Authlete認証情報を含む）

### 4. ドキュメントの更新

以下のドキュメントを最新の状態に更新しました：

#### QUICKSTART.md
- PKCE対応の動的登録セクションを追加
- Trust Anchor JWKSet更新手順を追加
- PKCE認証エラーのトラブルシューティングを追加
- Entity ID Conflict (A327605)の説明を追加

#### README.md
- PKCE実装の説明を追加
- Trust Anchor鍵永続化の説明を追加
- セキュリティ強化の説明を追加

#### test-client-federation-valid/README.md
- PKCE認証フローの説明を追加
- A327605エラーハンドリングの説明を追加
- トラブルシューティングセクションを更新

#### trust-anchor/README.md
- 鍵ペア永続化の説明を追加
- JWKSet更新手順を追加
- セキュリティ考慮事項を更新

## セキュリティ強化

### 1. PKCE (Proof Key for Code Exchange)
- **目的**: 認可コード横取り攻撃を防止
- **方式**: S256（SHA-256ハッシュ）
- **適用**: すべてのPublicクライアント

### 2. 秘密情報の保護
- **Git除外**: すべての秘密情報を`.gitignore`に追加
- **ファイル権限**: 秘密鍵ファイルは適切な権限で保護
- **環境変数**: 認証情報は環境変数で管理

### 3. Trust Anchor鍵管理
- **永続化**: 鍵ペアをファイルに保存
- **再利用**: 再起動時も同じ鍵を使用
- **バックアップ**: `.trust-anchor-keys.json`をバックアップ推奨

## トラブルシューティング

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

既存のクライアントがある場合、RPは自動的にPKCEフォールバックを使用します。これは正常な動作です。

ログに以下のメッセージが表示されます：
```
⚠️  Entity ID conflict detected (A327605) - Using PKCE fallback
This is expected behavior due to Authlete soft delete
Will proceed with PKCE-based authentication (no client secret required)
```

### Trust Anchor JWKSet更新

Trust Anchorを再起動しても、保存された鍵ペアが使用されるため、Authleteの設定を更新する必要はありません。

鍵を再生成する場合：
1. `.trust-anchor-keys.json`を削除
2. Trust Anchorを再起動
3. 新しいJWKSetをAuthleteに登録

## 次のステップ

1. **Authleteダッシュボードの設定確認**:
   - Trust Anchor JWKSetが正しく設定されているか確認
   - クライアント設定がPKCE対応になっているか確認

2. **動作確認**:
   - RPクライアントでログインを試行
   - PKCEフローが正常に動作するか確認
   - A327605エラー時のフォールバックが動作するか確認

3. **本番環境への展開**:
   - `.env`ファイルを本番環境用に設定
   - Trust Anchor鍵ファイルをバックアップ
   - セキュリティ設定を確認

## 参考資料

- [RFC 7636: Proof Key for Code Exchange (PKCE)](https://datatracker.ietf.org/doc/html/rfc7636)
- [OpenID Federation 1.0](https://openid.net/specs/openid-federation-1_0.html)
- [Authlete Documentation](https://docs.authlete.com/)

## 変更履歴

- 2026-02-12: PKCE実装、Trust Anchor鍵永続化、.gitignore更新、ドキュメント更新

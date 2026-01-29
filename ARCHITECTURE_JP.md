# アーキテクチャドキュメント

## 概要

このドキュメントでは、OpenID Federation動的クライアント登録の実装アーキテクチャについて説明します。

## システム構成

```
┌──────────────────────────────────────────────────────────────┐
│                     Trust Anchor                              │
│  - エンティティの登録・管理                                    │
│  - Entity Statementの発行                                     │
│  - 管理UI提供                                                 │
└────────────────────┬─────────────────────────────────────────┘
                     │ Trust Chain
                     │
┌────────────────────▼─────────────────────────────────────────┐
│              Authorization Server (OP)                        │
│                                                               │
│  ┌─────────────────────────────────────────────────────┐    │
│  │  Federation Registration Endpoint                    │    │
│  │  - POST /federation/registration                     │    │
│  │  - Entity Configurationの検証                        │    │
│  │  - Trust Chainの検証                                 │    │
│  │  - Authleteへのクライアント登録                       │    │
│  └─────────────────────────────────────────────────────┘    │
│                                                               │
│  ┌─────────────────────────────────────────────────────┐    │
│  │  Request Object Handler                              │    │
│  │  - JWT Request Objectの解析                          │    │
│  │  - Entity Discoveryの実行                            │    │
│  │  - クライアントメタデータの抽出                        │    │
│  └─────────────────────────────────────────────────────┘    │
│                                                               │
│  ┌─────────────────────────────────────────────────────┐    │
│  │  Trust Chain Validator                               │    │
│  │  - Trust Chainの構築                                 │    │
│  │  - JWT署名の検証                                     │    │
│  │  - Trust Anchorの検証                                │    │
│  └─────────────────────────────────────────────────────┘    │
│                                                               │
│  ┌─────────────────────────────────────────────────────┐    │
│  │  Authlete Integration Service                        │    │
│  │  - Authlete APIとの通信                              │    │
│  │  - クライアント情報の登録                             │    │
│  │  - レスポンスの処理                                   │    │
│  └─────────────────────────────────────────────────────┘    │
└───────────────────────────────────────────────────────────────┘
                     │
                     │ Authorization Request
                     │
┌────────────────────▼─────────────────────────────────────────┐
│                  Relying Party (Client)                       │
│  - Entity Configurationの提供                                 │
│  - Request Objectの生成                                       │
│  - 動的登録の実行                                             │
│  - OAuth 2.0フローの実行                                      │
└───────────────────────────────────────────────────────────────┘
```

## コンポーネント詳細

### 1. Federation Registration Endpoint

**ファイル**: `src/federation/federationRegistrationEndpoint.ts`

**責務**:
- Federation登録リクエストの受付
- Entity Configurationの検証
- Trust Chainの検証
- Authleteへのクライアント登録
- 登録結果の返却

**主要メソッド**:
- `registerClient()`: 登録リクエストの処理
- `extractEntityInformation()`: Entity IDとTrust Chainの抽出
- `processAuthleteResponse()`: Authleteレスポンスの処理

**フロー**:
1. リクエストからEntity ConfigurationまたはRequest Objectを抽出
2. Entity IDとTrust Chainを取得
3. Trust Chainを検証
4. Request Objectがある場合は処理
5. Authleteにクライアント情報を登録
6. 登録結果を返却

### 2. Request Object Handler

**ファイル**: `src/federation/federationRequestObjectHandler.ts`

**責務**:
- JWT Request Objectの解析
- Entity Discoveryの実行
- クライアントメタデータの抽出・マージ
- 動的登録の実行

**主要メソッド**:
- `handleRequestObject()`: Request Objectの処理
- `parseRequestObject()`: JWTの解析
- `performEntityDiscovery()`: Entity Configurationの取得
- `mergeClientMetadata()`: メタデータのマージ

**Entity Discovery**:
1. Entity IDから`.well-known/openid-federation`を取得
2. Entity ConfigurationのJWTを検証
3. クライアントメタデータを抽出
4. Request Objectのメタデータとマージ（Request Objectが優先）

### 3. Trust Chain Validator

**ファイル**: `src/federation/integratedTrustChainValidator.ts`

**責務**:
- Trust Chainの構築と検証
- JWT署名の検証
- Trust Anchorの検証
- メタデータの検証

**主要メソッド**:
- `validateTrustChain()`: Trust Chain全体の検証
- `buildTrustChain()`: Trust Chainの構築
- `verifyJwtSignature()`: JWT署名の検証
- `validateTrustAnchor()`: Trust Anchorの検証

**検証ステップ**:
1. Entity ConfigurationのJWT署名を検証
2. Trust Chainを構築（Entity → Intermediate → Trust Anchor）
3. 各Entity StatementのJWT署名を検証
4. Trust Anchorに登録されているか確認
5. メタデータの整合性を検証

### 4. Authlete Integration Service

**ファイル**: `src/federation/authleteIntegrationService.ts`

**責務**:
- Authlete APIとの通信
- クライアント登録リクエストの構築
- レスポンスの処理
- エラーハンドリング

**主要メソッド**:
- `registerFederatedClient()`: クライアント登録
- `buildRegistrationRequest()`: 登録リクエストの構築
- `processRegistrationResponse()`: レスポンスの処理

**Authlete API連携**:
- エンドポイント: `/api/{serviceId}/client/registration`
- メソッド: POST
- リクエスト: Entity ID、メタデータ、Trust Chain
- レスポンス: Client ID、Client Secret、登録情報

### 5. Entity Discovery Service

**ファイル**: `src/federation/entityDiscovery.ts`

**責務**:
- Entity Configurationの取得
- JWTの解析
- メタデータの抽出

**主要メソッド**:
- `discoverEntityConfiguration()`: Entity Configurationの取得
- `extractClientMetadata()`: クライアントメタデータの抽出

**Discovery Process**:
1. `{entity_id}/.well-known/openid-federation`にGETリクエスト
2. JWTレスポンスを取得
3. JWTを解析してメタデータを抽出
4. `openid_relying_party`メタデータを返却

## データフロー

### 動的クライアント登録フロー

```
1. Client → OP: POST /federation/registration
   {
     "entity_configuration": "eyJ..." (JWT)
   }

2. OP: Entity Configurationを解析
   - JWT署名を検証
   - Entity IDを抽出
   - メタデータを抽出

3. OP: Trust Chainを構築
   - Entity Configuration → Trust Anchor
   - 各Entity StatementのJWT署名を検証

4. OP: Trust Anchorを検証
   - Trust AnchorにEntity IDが登録されているか確認
   - Trust Anchor Entity Statementを取得

5. OP → Authlete: POST /api/{serviceId}/client/registration
   {
     "entity_id": "https://client.example.com",
     "redirect_uris": ["https://client.example.com/callback"],
     "client_name": "Example Client",
     ...
   }

6. Authlete → OP: 200 OK
   {
     "client_id": "1234567890",
     "client_secret": "secret...",
     ...
   }

7. OP → Client: 200 OK
   {
     "client_id": "1234567890",
     "client_secret": "secret...",
     "entity_id": "https://client.example.com",
     ...
   }
```

### Request Object処理フロー

```
1. Client → OP: GET /authorize?request=eyJ... (JWT)

2. OP: Request Objectを解析
   - JWT署名を検証
   - client_idを抽出（Entity ID）
   - 認可パラメータを抽出

3. OP: Entity Discoveryを実行
   - GET https://client.example.com/.well-known/openid-federation
   - Entity Configurationを取得
   - メタデータを抽出

4. OP: クライアントが未登録の場合
   - 動的登録フローを実行（上記参照）

5. OP: 認可フローを継続
   - 通常のOAuth 2.0フローを実行
```

## セキュリティ機能

### 1. JWT署名検証

**実装**: `src/federation/jwtSignatureVerifier.ts`

- すべてのEntity StatementのJWT署名を検証
- RS256アルゴリズムを使用
- JWKSから公開鍵を取得して検証

### 2. Trust Chain検証

**実装**: `src/federation/integratedTrustChainValidator.ts`

- Entity IDからTrust Anchorまでの信頼チェーンを検証
- 各Entity StatementのJWT署名を検証
- Trust Anchorに登録されているか確認

### 3. 入力検証

**実装**: `src/middleware/validation.ts`

- SQLインジェクション対策
- XSS対策
- コマンドインジェクション対策
- OAuth 2.0パラメータの検証
- Request Object（JWT）は検証から除外

### 4. レート制限

**実装**: `src/middleware/federationRateLimit.ts`

- Federation APIへの過度なリクエストを制限
- IP単位でレート制限
- Exponential Backoffによるリトライ対策

### 5. HTTPS強制

- 本番環境ではHTTPSを必須化
- localhostは開発用に許可
- Entity IDはHTTPS URLを要求（OpenID Federation 1.0仕様）

## エラーハンドリング

### エラーコード

| エラーコード | 説明 | HTTPステータス |
|------------|------|---------------|
| `invalid_request` | リクエストが不正 | 400 |
| `invalid_client_metadata` | クライアントメタデータが不正 | 400 |
| `trust_chain_validation_failed` | Trust Chain検証失敗 | 400 |
| `discovery_failed` | Entity Discovery失敗 | 400 |
| `invalid_request_object` | Request Objectが不正 | 400 |
| `registration_failed` | Authlete登録失敗 | 500 |
| `server_error` | サーバー内部エラー | 500 |

### エラーレスポンス形式

```json
{
  "error": "trust_chain_validation_failed",
  "error_description": "Trust chain validation failed: Entity not found in trust anchor"
}
```

## テスト戦略

### 1. ユニットテスト

**ファイル**: `*.test.ts`

- 各コンポーネントの単体テスト
- モックを使用した独立テスト
- エッジケースのテスト

### 2. Property-Based Testing

**ファイル**: `*.property.test.ts`

- fast-checkライブラリを使用
- ランダム入力による網羅的テスト
- 不変条件の検証

### 3. 統合テスト

**ファイル**: `src/federation/integration.test.ts`

- コンポーネント間の連携テスト
- End-to-Endフローのテスト
- 実際のHTTPリクエスト/レスポンスのテスト

## パフォーマンス最適化

### 1. Exponential Backoff

**実装**: `src/authlete/client.ts`

- Authleteのレート制限に対応
- 指数バックオフによるリトライ
- 最大5回のリトライ

### 2. キャッシング

- Entity Configurationのキャッシング（将来実装予定）
- Trust Chain検証結果のキャッシング（将来実装予定）

### 3. 並列処理

- 複数のEntity Statementの並列検証
- 非同期処理の活用

## 設定管理

### 環境変数

| 変数名 | 説明 | デフォルト |
|-------|------|----------|
| `AUTHLETE_API_KEY` | Authlete APIキー | 必須 |
| `AUTHLETE_API_SECRET` | Authlete APIシークレット | 必須 |
| `TRUST_ANCHOR_ENTITY_ID` | Trust AnchorのEntity ID | 必須 |
| `TRUST_ANCHOR_JWKS_URI` | Trust AnchorのJWKS URI | 必須 |
| `PORT` | サーバーポート | 3001 |
| `NODE_ENV` | 環境（development/production） | development |

### 設定ファイル

**ファイル**: `src/config/index.ts`

- 環境変数の読み込み
- デフォルト値の設定
- 設定の検証

## ロギング

### ログレベル

- `debug`: デバッグ情報
- `info`: 通常の情報
- `warn`: 警告
- `error`: エラー

### ログ出力

**実装**: `src/utils/logger.ts`

- 構造化ログ（JSON形式）
- コンポーネント名の記録
- リクエストIDの記録
- タイムスタンプの記録

### ログ例

```json
{
  "timestamp": "2026-01-29T12:34:56.789Z",
  "level": "info",
  "message": "Trust chain validation successful",
  "component": "IntegratedTrustChainValidator",
  "context": {
    "entityId": "https://client.example.com",
    "trustAnchor": "https://trust-anchor.example.com",
    "chainLength": 2
  }
}
```

## デプロイメント

### 本番環境の推奨事項

1. **HTTPS必須**: すべてのエンドポイントでHTTPSを使用
2. **環境変数**: 機密情報は環境変数で管理
3. **ロギング**: CloudWatchやDatadogなどの監視サービスと統合
4. **レート制限**: 適切なレート制限を設定
5. **キャッシング**: Entity ConfigurationとTrust Chain検証結果をキャッシュ
6. **モニタリング**: エラー率、レスポンスタイム、リクエスト数を監視

### スケーリング

- ステートレス設計により水平スケーリングが可能
- セッション情報はRedisなどの外部ストアに保存推奨
- Trust Chain検証結果のキャッシュを共有

## 参考資料

- [OpenID Federation 1.0 Specification](https://openid.net/specs/openid-federation-1_0.html)
- [OAuth 2.0 Dynamic Client Registration](https://tools.ietf.org/html/rfc7591)
- [Authlete API Documentation](https://docs.authlete.com/)
- [JWT (RFC 7519)](https://tools.ietf.org/html/rfc7519)
- [JWS (RFC 7515)](https://tools.ietf.org/html/rfc7515)

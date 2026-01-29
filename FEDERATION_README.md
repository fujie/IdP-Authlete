# OpenID Federation 動的クライアント登録 実装ガイド

## 概要

このプロジェクトは、OpenID Federation 1.0仕様に基づいた動的クライアント登録機能を実装したOAuth 2.0 / OpenID Connect認可サーバーです。

### 主な機能

- **OpenID Federation 動的クライアント登録**: Trust Chainを検証した上でクライアントを自動登録
- **Trust Anchor管理**: エンティティの登録・削除を行う管理UI
- **Request Object処理**: JWT形式のリクエストオブジェクトをサポート
- **Entity Discovery**: エンティティ設定の自動検出
- **Trust Chain検証**: Trust Anchorまでの信頼チェーンを検証

## アーキテクチャ

```
┌─────────────────────┐
│  Relying Party      │
│  (Test Client)      │
└──────────┬──────────┘
           │ 1. Request Object (JWT)
           ↓
┌─────────────────────┐
│ Authorization       │
│ Server (OP)         │
│                     │
│ ┌─────────────────┐ │
│ │ Request Object  │ │ 2. Entity Discovery
│ │ Handler         │─┼────────────────┐
│ └─────────────────┘ │                │
│                     │                ↓
│ ┌─────────────────┐ │    ┌──────────────────┐
│ │ Dynamic         │ │    │ Relying Party    │
│ │ Registration    │ │    │ Entity Config    │
│ └────────┬────────┘ │    └──────────────────┘
│          │          │
│          │ 3. Trust Chain Validation
│          ↓          │
│ ┌─────────────────┐ │
│ │ Trust Chain     │─┼────────────────┐
│ │ Validator       │ │                │
│ └─────────────────┘ │                ↓
└─────────────────────┘    ┌──────────────────┐
                           │ Trust Anchor     │
                           │                  │
                           │ - Entity List    │
                           │ - Admin UI       │
                           └──────────────────┘
```

## ディレクトリ構造

```
.
├── src/
│   ├── federation/              # Federation関連の実装
│   │   ├── dynamicRegistration.ts       # 動的登録サービス
│   │   ├── entityDiscovery.ts           # エンティティ検出
│   │   ├── requestObject.ts             # Request Object処理
│   │   ├── trustChainValidator.ts       # Trust Chain検証
│   │   ├── trustAnchorValidator.ts      # Trust Anchor検証
│   │   └── authleteIntegrationService.ts # Authlete統合
│   ├── controllers/             # エンドポイントコントローラー
│   │   ├── federation.ts        # Federationエンドポイント
│   │   ├── authorization.ts     # 認可エンドポイント
│   │   └── token.ts            # トークンエンドポイント
│   └── middleware/              # ミドルウェア
│       ├── validation.ts        # 入力検証
│       └── federationRateLimit.ts # レート制限
├── trust-anchor/                # Trust Anchor実装
│   ├── server.js               # Trust Anchorサーバー
│   └── views/
│       └── admin.ejs           # 管理UI
├── test-client-federation-valid/    # 正常系テストクライアント
└── test-client-federation-invalid/  # 異常系テストクライアント
```

## セットアップ

### 1. 依存関係のインストール

```bash
# メインサーバー
npm install

# Trust Anchor
cd trust-anchor
npm install

# テストクライアント（Valid）
cd ../test-client-federation-valid
npm install

# テストクライアント（Invalid）
cd ../test-client-federation-invalid
npm install
```

### 2. 環境変数の設定

#### メインサーバー (.env)
```env
# Authlete設定
AUTHLETE_API_KEY=your_api_key
AUTHLETE_API_SECRET=your_api_secret
AUTHLETE_SERVICE_API_KEY=your_service_api_key
AUTHLETE_SERVICE_API_SECRET=your_service_api_secret

# Trust Anchor設定
TRUST_ANCHOR_ENTITY_ID=https://your-trust-anchor-url.com
TRUST_ANCHOR_JWKS_URI=http://localhost:3010/.well-known/openid-federation
```

#### Trust Anchor (trust-anchor/.env)
```env
PORT=3010
ENTITY_ID=https://your-trust-anchor-url.com
ORGANIZATION_NAME=Your Trust Anchor
```

#### テストクライアント (test-client-federation-valid/.env)
```env
PORT=3006
ENTITY_ID=https://your-client-url.com
AUTHORIZATION_SERVER=http://localhost:3001
REDIRECT_URI=http://localhost:3006/callback
TRUST_ANCHOR_ID=https://your-trust-anchor-url.com
```

### 3. サーバーの起動

```bash
# ターミナル1: Trust Anchor
cd trust-anchor
npm start

# ターミナル2: 認可サーバー
npm run dev

# ターミナル3: テストクライアント（Valid）
cd test-client-federation-valid
npm start

# ターミナル4: テストクライアント（Invalid）
cd test-client-federation-invalid
npm start
```

## 使用方法

### Trust Anchorの管理

1. 管理UIにアクセス: http://localhost:3010/admin
2. エンティティの追加:
   - エンティティIDを入力（例: https://client.example.com）
   - "Add Entity"ボタンをクリック
3. エンティティの削除:
   - 削除したいエンティティの"Remove"ボタンをクリック

### 動的クライアント登録のテスト

#### 正常系（Valid Client）

1. http://localhost:3006 にアクセス
2. Trust Anchorの管理UIでクライアントのEntity IDを登録
3. "Start Federation Login"ボタンをクリック
4. 動的登録が成功し、認可フローが開始される
5. 同意画面で承認
6. トークンが発行され、ログイン完了

#### 異常系（Invalid Client）

1. http://localhost:3007 にアクセス
2. Trust AnchorにクライアントのEntity IDが**登録されていない**ことを確認
3. "Start Federation Login"ボタンをクリック
4. 動的登録が失敗し、エラー画面が表示される
5. "✅ Expected Error"と表示され、Trust Chainの検証が正しく機能していることを確認

## 実装の詳細

### 動的クライアント登録フロー

1. **Request Object受信**: クライアントからJWT形式のRequest Objectを受信
2. **Entity Discovery**: クライアントのEntity IDから`.well-known/openid-federation`を取得
3. **Trust Chain構築**: Trust AnchorまでのTrust Chainを構築
4. **Trust Chain検証**: 
   - 各エンティティのJWT署名を検証
   - Trust Anchorに登録されているか確認
   - メタデータの整合性を検証
5. **クライアント登録**: Authleteにクライアント情報を登録
6. **認可フロー開始**: 通常のOAuth 2.0フローを実行

### セキュリティ機能

- **JWT署名検証**: すべてのEntity StatementのJWT署名を検証
- **Trust Chain検証**: Trust Anchorまでの信頼チェーンを検証
- **入力検証**: SQLインジェクション、XSS等の攻撃を防止
- **レート制限**: Federation APIへの過度なリクエストを制限
- **HTTPS強制**: 本番環境ではHTTPSを必須化（localhostを除く）

### エラーハンドリング

- **discovery_failed**: Entity Configurationの取得に失敗
- **trust_chain_validation_failed**: Trust Chainの検証に失敗
- **invalid_request_object**: Request Objectの形式が不正
- **registration_failed**: Authleteへの登録に失敗

## テスト

### ユニットテスト

```bash
npm test
```

### Property-Based Testing

```bash
npm test -- --grep "property"
```

### 統合テスト

```bash
npm test src/federation/integration.test.ts
```

## トラブルシューティング

### 動的登録が失敗する

1. Trust AnchorにクライアントのEntity IDが登録されているか確認
2. クライアントの`.well-known/openid-federation`エンドポイントが正しく動作しているか確認
3. Entity IDがHTTPSを使用しているか確認（localhostを除く）

### Trust Chain検証エラー

1. Trust AnchorのEntity IDが正しく設定されているか確認
2. 各エンティティのJWT署名が正しいか確認
3. Trust Anchorのエンドポイントが正しく動作しているか確認

### クライアント認証情報の問題

1. テストクライアントの`/clear-registration`エンドポイントで認証情報をクリア
2. Authleteコンソールでクライアントを削除
3. 再度動的登録を実行

## 参考資料

- [OpenID Federation 1.0 Specification](https://openid.net/specs/openid-federation-1_0.html)
- [OAuth 2.0 Dynamic Client Registration](https://tools.ietf.org/html/rfc7591)
- [Authlete Documentation](https://docs.authlete.com/)

## ライセンス

MIT License

# Entity IDをClient IDとして使用する設計

## アーキテクチャ概要

```
┌─────────────────────────────────────────────────────────────┐
│                     Client (RP)                              │
│  - Entity ID: https://client.example.com                    │
│  - 常にEntity IDをclient_idとして使用                        │
└──────────────────────┬──────────────────────────────────────┘
                       │
                       │ 1. Authorization Request
                       │    client_id=https://client.example.com
                       │    (Request Object内)
                       ↓
┌─────────────────────────────────────────────────────────────┐
│              Authorization Server (OP)                       │
│                                                              │
│  ┌────────────────────────────────────────────────────┐    │
│  │  Authorization Endpoint                             │    │
│  │  1. Request Objectを解析                            │    │
│  │  2. client_id (entity_id)を抽出                     │    │
│  │  3. クライアント登録状態を確認                       │    │
│  └────────────────┬───────────────────────────────────┘    │
│                   │                                          │
│                   ↓                                          │
│  ┌────────────────────────────────────────────────────┐    │
│  │  Client Lookup Service (新規)                      │    │
│  │  - Authleteでentity_idを検索                       │    │
│  │  - 登録済み/未登録を判定                            │    │
│  └────────────────┬───────────────────────────────────┘    │
│                   │                                          │
│         ┌─────────┴─────────┐                               │
│         │                   │                               │
│    登録済み              未登録                              │
│         │                   │                               │
│         ↓                   ↓                               │
│  ┌─────────────┐   ┌──────────────────────┐               │
│  │ 認可処理継続 │   │ Dynamic Registration │               │
│  │             │   │  - Entity Discovery  │               │
│  │             │   │  - Trust Chain検証   │               │
│  │             │   │  - Authlete登録      │               │
│  └─────────────┘   └──────────┬───────────┘               │
│                               │                              │
│                               ↓                              │
│                        ┌─────────────┐                      │
│                        │ 認可処理継続 │                      │
│                        └─────────────┘                      │
└─────────────────────────────────────────────────────────────┘
```

## コンポーネント設計

### 1. Client Lookup Service（新規）

**責務**: Entity IDでクライアントの登録状態を確認する

**インターフェース**:
```typescript
interface ClientLookupService {
  /**
   * Entity IDでクライアントを検索
   * @param entityId - クライアントのEntity ID
   * @returns クライアント情報（登録済みの場合）またはnull
   */
  lookupClientByEntityId(entityId: string): Promise<ClientInfo | null>;
  
  /**
   * クライアントが登録済みかチェック
   * @param entityId - クライアントのEntity ID
   * @returns 登録済みの場合true
   */
  isClientRegistered(entityId: string): Promise<boolean>;
}

interface ClientInfo {
  entityId: string;
  clientId: string; // Authlete内部ID（数値）
  clientSecret?: string;
  registeredAt: number;
  trustChainExpiresAt?: number;
}
```

**実装方法**:
- Authlete APIを使用してクライアントを検索
- `entity_id`フィールドでフィルタリング
- 結果をキャッシュ（将来の最適化）

### 2. Authorization Controller（変更）

**変更点**:
1. Request Object解析後、client_idを変更しない
2. Client Lookup Serviceを使用して登録状態を確認
3. 未登録の場合のみ動的登録を実行
4. 登録済みの場合は、entity_idをそのまま使用して認可処理を継続

**処理フロー**:
```typescript
async handleAuthorizationRequest(req: Request, res: Response): Promise<void> {
  // 1. Request Objectを解析
  const requestObject = req.query.request as string;
  const claims = parseRequestObject(requestObject);
  const entityId = claims.client_id; // URI形式
  
  // 2. クライアント登録状態を確認
  const clientInfo = await clientLookupService.lookupClientByEntityId(entityId);
  
  if (!clientInfo) {
    // 3a. 未登録の場合: 動的登録を実行
    const registrationResult = await requestObjectProcessor.processClientRegistration(claims);
    
    if (!registrationResult.success) {
      return res.status(400).json({
        error: registrationResult.error,
        error_description: registrationResult.errorDescription
      });
    }
  }
  
  // 3b. 登録済みの場合: そのまま継続
  // 4. 認可パラメータを抽出（client_idはentity_idのまま）
  const authParams = extractAuthorizationParameters(claims);
  
  // 5. Authleteに認可リクエストを送信
  const authResponse = await authleteClient.authorization({
    parameters: buildQueryString(authParams),
    clientId: entityId // Entity IDを使用
  });
  
  // 6. レスポンスを処理
  await handleAuthorizationResponse(req, res, authResponse);
}
```

### 3. Request Object Processor（変更）

**変更点**:
- `processClientRegistration`メソッドで、client_idを変更しない
- 登録成功後も、entity_idを返す

**変更前**:
```typescript
return {
  success: true,
  clientId: registrationResult.client_id, // 文字列形式のID
  clientSecret: registrationResult.client_secret
};
```

**変更後**:
```typescript
return {
  success: true,
  entityId: claims.client_id, // URI形式のまま
  clientSecret: registrationResult.client_secret
};
```

### 4. Test Client（変更）

**変更点**:
1. 登録後も`registeredClientId`を保存しない
2. Request Object内のclient_idは常にentity_id
3. トークンリクエスト時のclient_idもentity_id

**変更前**:
```javascript
// 登録後
registeredClientId = response.data.client_id; // 文字列形式
registeredClientSecret = response.data.client_secret;

// Request Object作成時
const clientId = registeredClientId || FEDERATION_CONFIG.entityId;
```

**変更後**:
```javascript
// 登録後
registeredClientSecret = response.data.client_secret;
// client_idは常にentity_idを使用

// Request Object作成時
const clientId = FEDERATION_CONFIG.entityId; // 常にentity_id
```

## データフロー

### シーケンス図: 未登録クライアントの初回認可

```
Client          OP              ClientLookup    DynamicReg      Authlete
  |              |                    |              |              |
  |--Auth Req--->|                    |              |              |
  | (entity_id)  |                    |              |              |
  |              |                    |              |              |
  |              |--Lookup----------->|              |              |
  |              |  (entity_id)       |              |              |
  |              |                    |--Search----->|              |
  |              |                    |  (entity_id) |              |
  |              |                    |<--Not Found--|              |
  |              |<--null-------------|              |              |
  |              |                    |              |              |
  |              |--Register------------------------>|              |
  |              |  (entity_id, metadata)            |              |
  |              |                    |              |--Register--->|
  |              |                    |              |  (entity_id) |
  |              |                    |              |<--OK---------|
  |              |<--Success-------------------------|              |
  |              |  (entity_id, secret)              |              |
  |              |                    |              |              |
  |              |--Authorize-------------------------------->|
  |              |  (entity_id)                               |
  |              |<--Ticket-----------------------------------|
  |              |                    |              |              |
  |<--Redirect---|                    |              |              |
  | (login)      |                    |              |              |
```

### シーケンス図: 登録済みクライアントの認可

```
Client          OP              ClientLookup    Authlete
  |              |                    |              |
  |--Auth Req--->|                    |              |
  | (entity_id)  |                    |              |
  |              |                    |              |
  |              |--Lookup----------->|              |
  |              |  (entity_id)       |              |
  |              |                    |--Search----->|
  |              |                    |  (entity_id) |
  |              |                    |<--Found------|
  |              |<--ClientInfo-------|              |
  |              |  (entity_id, ...)  |              |
  |              |                    |              |
  |              |--Authorize----------------------->|
  |              |  (entity_id)                      |
  |              |<--Ticket--------------------------|
  |              |                    |              |
  |<--Redirect---|                    |              |
  | (login)      |                    |              |
```

## API設計

### Client Lookup Service API

#### lookupClientByEntityId

```typescript
/**
 * Entity IDでクライアントを検索
 */
async lookupClientByEntityId(entityId: string): Promise<ClientInfo | null> {
  // Authlete APIを使用してクライアントを検索
  // GET /api/{serviceId}/client/get/list?entityId={entityId}
  
  const response = await authleteClient.getClientList({
    entityId: entityId
  });
  
  if (response.clients && response.clients.length > 0) {
    const client = response.clients[0];
    return {
      entityId: client.entityId,
      clientId: client.clientId.toString(),
      clientSecret: client.clientSecret,
      registeredAt: client.createdAt,
      trustChainExpiresAt: client.trustChainExpiresAt
    };
  }
  
  return null;
}
```

#### isClientRegistered

```typescript
/**
 * クライアントが登録済みかチェック
 */
async isClientRegistered(entityId: string): Promise<boolean> {
  const clientInfo = await this.lookupClientByEntityId(entityId);
  return clientInfo !== null;
}
```

## エラーハンドリング

### エラーケース

1. **Invalid Entity ID**: Entity IDの形式が不正
   - HTTPステータス: 400
   - エラーコード: `invalid_request`
   - 説明: "Invalid entity_id format"

2. **Registration Failed**: 動的登録に失敗
   - HTTPステータス: 400
   - エラーコード: `registration_failed`
   - 説明: Trust Chain検証失敗などの詳細

3. **Client Lookup Failed**: クライアント検索に失敗
   - HTTPステータス: 500
   - エラーコード: `server_error`
   - 説明: "Failed to lookup client"

## セキュリティ考慮事項

### 1. Entity ID検証

- Entity IDは必ずHTTPS URLである必要がある（localhostを除く）
- URLの形式を厳密に検証する
- クエリパラメータやフラグメントを含まない

### 2. Trust Chain検証

- 未登録クライアントの動的登録時は、Trust Chainを必ず検証する
- Trust Chainの有効期限を確認する
- Trust Anchorの検証を厳密に行う

### 3. レート制限

- Client Lookup APIへのリクエストにレート制限を適用する
- 動的登録のレート制限を維持する

## パフォーマンス最適化

### キャッシング戦略（将来の拡張）

```typescript
interface ClientCache {
  // Entity IDをキーとしてクライアント情報をキャッシュ
  cache: Map<string, CachedClientInfo>;
  
  // TTL: 5分
  ttl: number;
  
  get(entityId: string): ClientInfo | null;
  set(entityId: string, clientInfo: ClientInfo): void;
  invalidate(entityId: string): void;
}
```

## テスト戦略

### ユニットテスト

1. **ClientLookupService**
   - 登録済みクライアントの検索
   - 未登録クライアントの検索
   - エラーハンドリング

2. **AuthorizationController**
   - 未登録クライアントの動的登録フロー
   - 登録済みクライアントの認可フロー
   - エラーケース

### 統合テスト

1. **End-to-Endフロー**
   - 初回認可（動的登録 + 認可）
   - 2回目以降の認可（登録スキップ）
   - トークン取得

### Property-Based Testing

1. **Entity ID検証**
   - 様々な形式のURLでテスト
   - 不正な形式の検出

## 移行戦略

### 段階的な移行

1. **Phase 1**: Client Lookup Serviceの実装
2. **Phase 2**: Authorization Controllerの変更
3. **Phase 3**: Test Clientの変更
4. **Phase 4**: 既存クライアントの互換性確認

### 後方互換性

- 既存の文字列形式のclient_idも引き続きサポート
- client_idの形式（URI vs 文字列）を自動判定
- 段階的に新しい方式に移行

## 実装優先順位

1. **高**: Client Lookup Service実装
2. **高**: Authorization Controller変更
3. **中**: Test Client変更
4. **低**: キャッシング実装
5. **低**: 既存クライアントの移行ツール

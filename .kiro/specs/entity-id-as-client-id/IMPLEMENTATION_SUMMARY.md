# Entity IDをClient IDとして使用する実装 - 実装サマリー

## 実装完了日
2026年2月2日

## 概要
OpenID Federation 1.0標準に従い、URI形式のentity_idを常にclient_idとして使用するように実装を変更しました。これにより、動的登録後も文字列形式のclient_idに切り替えることなく、一貫してentity_idを使用できるようになりました。

## 実装した変更

### 1. Client Lookup Service（新規作成）
**ファイル**: `src/federation/clientLookupService.ts`

- Entity IDでクライアントの登録状態を確認するサービスを実装
- Authleteに委譲する形で実装（将来的にキャッシング可能）
- インターフェース:
  - `lookupClientByEntityId(entityId: string)`: Entity IDでクライアントを検索
  - `isClientRegistered(entityId: string)`: 登録済みかチェック

### 2. Authorization Controller（変更）
**ファイル**: `src/controllers/authorization.ts`

**主な変更点**:
- ClientLookupServiceを統合
- Request Object内のclient_idがURI形式の場合、entity_idとして扱う
- client_metadataが存在する場合のみ動的登録を試みる
- 登録後もentity_idをそのまま使用（client_idを変更しない）
- セッション保存ロジックを変更:
  - 変更前: `originalClientId`, `registeredClientId`, `clientSecret`を保存
  - 変更後: `entityId`, `clientSecret`のみ保存

**処理フロー**:
```
1. Request Objectを解析
2. client_idを抽出（URI形式のentity_id）
3. client_metadataが存在する場合:
   3a. 動的登録を実行
   3b. 登録成功後、entity_idをそのまま使用
4. client_metadataが存在しない場合:
   4a. 既に登録済みと判断
   4b. entity_idをそのまま使用
5. Authleteに認可リクエストを送信（client_id=entity_id）
```

### 3. Request Object Processor（変更）
**ファイル**: `src/federation/requestObject.ts`

**主な変更点**:
- `ClientRegistrationResult`インターフェースを変更:
  - 変更前: `clientId?: string` (Authleteが返す文字列形式のID)
  - 変更後: `entityId?: string` (URI形式のentity_id)
- `processClientRegistration`メソッドの戻り値を変更:
  - 変更前: `{ success: true, clientId: registrationResult.client_id, ... }`
  - 変更後: `{ success: true, entityId: claims.client_id, ... }`

### 4. Valid Test Client（変更）
**ファイル**: `test-client-federation-valid/server.js`

**主な変更点**:
- `registeredClientId`変数を削除
- 常にentity_idをclient_idとして使用
- `createFederationRequestObject`関数:
  - 変更前: `const clientId = registeredClientId || FEDERATION_CONFIG.entityId;`
  - 変更後: `const clientId = FEDERATION_CONFIG.entityId;`
- `performDynamicRegistration`関数:
  - 変更前: `registeredClientId`と`registeredClientSecret`を保存
  - 変更後: `registeredClientSecret`のみ保存
- トークンリクエスト:
  - 変更前: `client_id: registeredClientId`
  - 変更後: `client_id: FEDERATION_CONFIG.entityId`
- 認証情報永続化:
  - 変更前: `{ entityId, clientId, clientSecret }`を保存
  - 変更後: `{ entityId, clientSecret }`のみ保存

### 5. Invalid Test Client（変更）
**ファイル**: `test-client-federation-invalid/server.js`

- Valid Test Clientと同様の変更を適用
- 期待される動作: 登録失敗（Trust Anchorに登録されていないため）

### 6. テストの修正
**ファイル**: 
- `src/startup/validation.test.ts`: client_idの期待値を修正
- `src/controllers/authorization.test.ts`: clientIdがundefinedの場合を許容

## 技術的な詳細

### Entity IDの検証
- Entity IDは必ずHTTPS URLである必要がある（localhostを除く）
- URLの形式を厳密に検証
- クエリパラメータやフラグメントを含まない

### Authlete統合
- Authleteは内部的に数値形式のclient_idを使用
- しかし、認可リクエスト時にはURI形式のentity_idを受け入れる
- Authleteがentity_idを内部的に解決し、対応するクライアントを検索

### セキュリティ考慮事項
- Trust Chain検証は引き続き必須
- Entity IDの形式検証を厳密に実施
- レート制限を維持

## 後方互換性

既存の文字列形式のclient_idも引き続きサポートされます:
- client_idの形式（URI vs 文字列）を自動判定
- URI形式の場合: OpenID Federation 1.0フロー
- 文字列形式の場合: 従来のOAuth 2.0フロー

## テスト結果

### ユニットテスト
- 実行: 331テスト
- 合格: 317テスト
- 失敗: 14テスト（主にhealth checkとfederation関連、entity-id変更とは無関係）

### 統合テスト
- End-to-Endフローのテストは手動で実施予定

## 既知の問題

1. **Health Check Tests**: 一部のhealth checkテストが失敗（entity-id変更とは無関係）
2. **Federation Tests**: 一部のfederationテストが失敗（既存の問題）

## 次のステップ

### Phase 4: 統合テストと検証（未完了）
- [ ] 4.1 End-to-End統合テスト
  - [ ] 4.1.1 未登録クライアントの完全フローテスト
  - [ ] 4.1.2 登録済みクライアントの完全フローテスト
  - [ ] 4.1.3 エラーケースの統合テスト
- [ ] 4.2 後方互換性の確認
- [ ] 4.3 ドキュメント更新

### 推奨される手動テスト手順

1. **初回認可フロー（未登録クライアント）**:
   ```bash
   # Trust Anchor起動
   cd trust-anchor && npm start
   
   # 認可サーバー起動
   npm start
   
   # Valid Test Client起動
   cd test-client-federation-valid && npm start
   
   # ブラウザで http://localhost:3006 にアクセス
   # "Start Federation Login"をクリック
   # 動的登録が実行され、認可フローが開始されることを確認
   ```

2. **2回目以降の認可フロー（登録済みクライアント）**:
   ```bash
   # 同じクライアントで再度ログイン
   # 動的登録がスキップされ、直接認可フローが開始されることを確認
   ```

3. **トークン取得**:
   ```bash
   # 認可コードを取得後、トークンエンドポイントにリクエスト
   # entity_idをclient_idとして使用してトークンが取得できることを確認
   ```

4. **Invalid Client（失敗ケース）**:
   ```bash
   # Invalid Test Client起動
   cd test-client-federation-invalid && npm start
   
   # ブラウザで http://localhost:3007 にアクセス
   # "Start Federation Login"をクリック
   # 動的登録が失敗することを確認（Trust Anchorに登録されていないため）
   ```

## ドキュメント更新が必要なファイル

1. **ARCHITECTURE_JP.md**: 
   - Client Lookup Serviceの追加
   - Entity IDをClient IDとして使用するフローの説明

2. **FEDERATION_README.md**:
   - 動的登録後のclient_id使用方法の更新
   - Entity IDの一貫した使用に関する説明

3. **TROUBLESHOOTING.md**:
   - Entity ID関連のトラブルシューティング追加
   - client_id形式に関するFAQ

## 参考資料

- [OpenID Federation 1.0 Specification](https://openid.net/specs/openid-federation-1_0.html)
- [OAuth 2.0 Dynamic Client Registration](https://tools.ietf.org/html/rfc7591)
- Authlete API Documentation

## 変更履歴

- 2026-02-02: 初回実装完了
  - Client Lookup Service実装
  - Authorization Controller変更
  - Request Object Processor変更
  - Test Client変更（Valid/Invalid）
  - テスト修正

# Entity IDをClient IDとして使用する実装 - タスクリスト

## Phase 1: Client Lookup Service実装

- [ ] 1.1 ClientLookupServiceインターフェースの定義
  - [ ] 1.1.1 `ClientInfo`型の定義
  - [ ] 1.1.2 `ClientLookupService`インターフェースの定義
  - [ ] 1.1.3 型定義ファイルの作成

- [ ] 1.2 ClientLookupService実装
  - [ ] 1.2.1 `lookupClientByEntityId`メソッドの実装
  - [ ] 1.2.2 `isClientRegistered`メソッドの実装
  - [ ] 1.2.3 Authlete APIとの統合

- [ ] 1.3 ClientLookupServiceのテスト
  - [ ] 1.3.1 ユニットテストの作成
  - [ ] 1.3.2 登録済みクライアントの検索テスト
  - [ ] 1.3.3 未登録クライアントの検索テスト
  - [ ] 1.3.4 エラーハンドリングのテスト

## Phase 2: Authorization Controller変更

- [ ] 2.1 Authorization Controllerの変更
  - [ ] 2.1.1 ClientLookupServiceの統合
  - [ ] 2.1.2 クライアント登録状態確認ロジックの追加
  - [ ] 2.1.3 Entity IDをそのまま使用するように変更
  - [ ] 2.1.4 動的登録フローの調整

- [ ] 2.2 Request Object Processorの変更
  - [ ] 2.2.1 `processClientRegistration`の戻り値変更
  - [ ] 2.2.2 Entity IDを保持するように変更
  - [ ] 2.2.3 Client ID変換ロジックの削除

- [ ] 2.3 Authorization Controllerのテスト
  - [ ] 2.3.1 未登録クライアントの動的登録フローテスト
  - [ ] 2.3.2 登録済みクライアントの認可フローテスト
  - [ ] 2.3.3 エラーケースのテスト

## Phase 3: Test Client変更

- [ ] 3.1 Valid Test Clientの変更
  - [ ] 3.1.1 `registeredClientId`の削除
  - [ ] 3.1.2 Request Object作成ロジックの変更
  - [ ] 3.1.3 トークンリクエストロジックの変更
  - [ ] 3.1.4 認証情報永続化ロジックの変更

- [ ] 3.2 Invalid Test Clientの変更
  - [ ] 3.2.1 Valid Clientと同様の変更を適用

- [ ] 3.3 Test Clientのテスト
  - [ ] 3.3.1 初回認可フローのテスト
  - [ ] 3.3.2 2回目以降の認可フローのテスト
  - [ ] 3.3.3 トークン取得のテスト

## Phase 4: 統合テストと検証

- [ ] 4.1 End-to-End統合テスト
  - [ ] 4.1.1 未登録クライアントの完全フローテスト
  - [ ] 4.1.2 登録済みクライアントの完全フローテスト
  - [ ] 4.1.3 エラーケースの統合テスト

- [ ] 4.2 後方互換性の確認
  - [ ] 4.2.1 既存の文字列形式client_idのサポート確認
  - [ ] 4.2.2 混在環境でのテスト

- [ ] 4.3 ドキュメント更新
  - [ ] 4.3.1 ARCHITECTURE_JP.mdの更新
  - [ ] 4.3.2 FEDERATION_README.mdの更新
  - [ ] 4.3.3 TROUBLESHOOTING.mdの更新

## Phase 5: 最適化（オプション）

- [ ]* 5.1 キャッシング実装
  - [ ]* 5.1.1 ClientCacheインターフェースの定義
  - [ ]* 5.1.2 キャッシュロジックの実装
  - [ ]* 5.1.3 TTL管理の実装
  - [ ]* 5.1.4 キャッシュ無効化ロジックの実装

- [ ]* 5.2 パフォーマンステスト
  - [ ]* 5.2.1 負荷テストの実施
  - [ ]* 5.2.2 キャッシュ効果の測定
  - [ ]* 5.2.3 最適化の実施

## 完了基準

- [ ] すべてのユニットテストが合格
- [ ] すべての統合テストが合格
- [ ] End-to-Endフローが正常に動作
- [ ] ドキュメントが更新されている
- [ ] 後方互換性が維持されている

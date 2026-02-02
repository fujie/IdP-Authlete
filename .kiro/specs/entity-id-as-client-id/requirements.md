# Entity IDをClient IDとして使用する実装

## 概要

現在の実装では、動的登録後にAuthleteから返される文字列形式のclient_idを使用していますが、OpenID Federation 1.0の標準的なアプローチに従い、URI形式のentity_idをclient_idとして使い続ける実装に変更します。

## 背景

### 現在の実装の問題点

1. **非標準的なアプローチ**: 登録後に文字列形式のclient_idに切り替えるのは、OpenID Federation 1.0の標準的な使い方ではない
2. **クライアント側の複雑性**: クライアントが2つのIDを管理する必要がある
3. **トレーサビリティの低下**: Entity IDとClient IDの対応関係を追跡する必要がある

### 望ましい実装

1. **一貫性**: 常にURI形式のentity_idをclient_idとして使用
2. **シンプル性**: クライアントは1つのID（entity_id）のみを管理
3. **標準準拠**: OpenID Federation 1.0の標準的なアプローチ

## 要件

### 1. 認可リクエスト処理

#### 1.1 URI形式のclient_idの受け入れ

**要件**: 認可エンドポイントは、URI形式のclient_id（entity_id）を受け入れる必要がある

**受入基準**:
- URI形式のclient_idを含む認可リクエストを正常に処理できる
- Request Object内のclient_idがURI形式である場合も正常に処理できる

#### 1.2 クライアント登録状態の確認

**要件**: 認可リクエスト処理時に、指定されたentity_idのクライアントが既に登録されているかを確認する必要がある

**受入基準**:
- Authleteに問い合わせて、entity_idで登録されたクライアントの存在を確認できる
- 登録済みの場合は、そのまま認可処理を継続できる
- 未登録の場合は、動的登録を実行できる

#### 1.3 動的登録の実行

**要件**: クライアントが未登録の場合、Request Objectから情報を抽出して動的登録を実行する必要がある

**受入基準**:
- Request Objectからclient_metadataを抽出できる
- Entity Discoveryを実行してEntity Configurationを取得できる
- Trust Chainを検証できる
- Authleteに登録できる
- 登録後、そのまま認可処理を継続できる

### 2. トークンエンドポイント処理

#### 2.1 URI形式のclient_idでの認証

**要件**: トークンエンドポイントは、URI形式のclient_idを使用したクライアント認証を受け入れる必要がある

**受入基準**:
- client_idとclient_secretを使用した認証が正常に動作する
- entity_idをclient_idとして使用できる

### 3. クライアント側の変更

#### 3.1 常にentity_idを使用

**要件**: テストクライアントは、登録後も常にentity_idをclient_idとして使用する必要がある

**受入基準**:
- Request Object内のclient_idがentity_idである
- トークンリクエスト時のclient_idがentity_idである
- 認証情報の永続化でentity_idを使用する

### 4. Authlete統合

#### 4.1 Entity IDでのクライアント検索

**要件**: Authleteに登録されたクライアントをentity_idで検索できる必要がある

**受入基準**:
- Authlete APIを使用してentity_idでクライアントを検索できる
- 検索結果から登録済みかどうかを判定できる

## 非機能要件

### パフォーマンス

- クライアント登録状態の確認は、認可リクエストごとに実行されるため、高速である必要がある
- キャッシングを検討する（将来の拡張）

### セキュリティ

- URI形式のclient_idの検証を厳密に行う必要がある
- Trust Chainの検証は引き続き必須

### 互換性

- 既存の登録済みクライアント（文字列形式のclient_id）も引き続きサポートする必要がある
- 段階的な移行をサポートする

## 制約事項

1. **Authlete API**: Authleteがentity_idでのクライアント検索をサポートしている必要がある
2. **Request Object必須**: URI形式のclient_idを使用する場合、Request Objectが必須
3. **HTTPS必須**: Entity IDはHTTPS URLである必要がある（localhostを除く）

## 成功基準

1. ✅ URI形式のclient_idを使用した認可リクエストが成功する
2. ✅ 未登録クライアントの動的登録が自動的に実行される
3. ✅ 登録済みクライアントは動的登録をスキップして認可処理が継続される
4. ✅ トークンエンドポイントでURI形式のclient_idが使用できる
5. ✅ 既存の文字列形式のclient_idも引き続き動作する

## 参考資料

- [OpenID Federation 1.0 Specification](https://openid.net/specs/openid-federation-1_0.html)
- [OAuth 2.0 Dynamic Client Registration](https://tools.ietf.org/html/rfc7591)

# Duplicate Registration Fix - Testing Guide

## 問題の説明
以前は、テストクライアントサーバーを再起動すると、登録済みのクライアント認証情報が失われ、再度登録を試みることで、Authleteから重複登録エラーが発生していました。

## 実装した解決策

### 1. 認証情報の永続化
クライアント認証情報を `.client-credentials.json` ファイルに保存します：

```json
{
  "entityId": "https://med-cia-sample-annie.trycloudflare.com",
  "clientId": "3768641751",
  "clientSecret": "[secret]",
  "registeredAt": "2026-01-29T..."
}
```

### 2. 主な機能

#### 自動認証情報読み込み
- サーバー起動時に、保存された認証情報を自動的に読み込みます
- 現在のエンティティIDと照合して検証します
- エンティティIDが変更された場合、古い認証情報は無視されます

#### スマート登録ロジック
- 登録を試みる前に既存の認証情報を確認します
- "already in use" エラーで登録が失敗した場合、保存された認証情報の読み込みを試みます
- 認証情報が見つからない場合、明確なエラーメッセージを提供します

#### 認証情報管理エンドポイント
テスト用に認証情報をクリアする新しいエンドポイント：
```
GET /clear-registration
```

### 3. テスト手順

#### ステップ1: 初回登録のテスト

1. テストクライアントを起動：
```bash
cd test-client-federation-valid
npm start
```

2. ブラウザで `http://localhost:3006` にアクセス

3. "Login with OpenID Federation" をクリック

4. 登録が成功することを確認

5. `.client-credentials.json` ファイルが作成されたことを確認：
```bash
ls -la test-client-federation-valid/.client-credentials.json
```

6. コンソールログで以下を確認：
```
✓ Saved client credentials to persistent storage
```

#### ステップ2: サーバー再起動後のテスト

1. サーバーを停止（Ctrl+C）

2. サーバーを再起動：
```bash
npm start
```

3. コンソールログで以下を確認：
```
✓ Loaded persisted client credentials
  Client ID: 3768641751
- Client Registration: Loaded from storage
```

4. ブラウザで `http://localhost:3006` にアクセス

5. "Login with OpenID Federation" をクリック

6. **重要**: 重複登録エラーが発生しないことを確認

7. ログインフローが正常に完了することを確認

#### ステップ3: 認証情報クリアのテスト

1. ブラウザで `http://localhost:3006/clear-registration` にアクセス

2. 以下のレスポンスが表示されることを確認：
```json
{
  "success": true,
  "message": "Client registration cleared. You can now register again."
}
```

3. コンソールログで以下を確認：
```
✓ Cleared persisted credentials
```

4. `.client-credentials.json` ファイルが削除されたことを確認：
```bash
ls -la test-client-federation-valid/.client-credentials.json
# ファイルが見つからないはず
```

5. `http://localhost:3006` に戻る

6. "Login with OpenID Federation" をクリック

7. 新しい登録が実行されることを確認

8. 新しい `.client-credentials.json` ファイルが作成されることを確認

### 4. 期待される動作

#### 正常なケース
- ✅ 初回登録が成功する
- ✅ 認証情報がファイルに保存される
- ✅ サーバー再起動後、認証情報が自動的に読み込まれる
- ✅ 再起動後のログインで重複登録エラーが発生しない
- ✅ 認証情報クリア後、新規登録が可能

#### エラーハンドリング
- ✅ 重複登録エラーが検出された場合、保存された認証情報を使用
- ✅ エンティティIDが変更された場合、古い認証情報を無視
- ✅ 認証情報が見つからない場合、明確なエラーメッセージを表示

### 5. トラブルシューティング

#### 問題: 重複登録エラーが発生する
**解決策:**
1. `.client-credentials.json` ファイルが存在するか確認
2. ファイルのエンティティIDが現在の設定と一致するか確認
3. `/clear-registration` エンドポイントで認証情報をクリア
4. Authleteコンソールから古いクライアントを削除

#### 問題: 認証情報が読み込まれない
**解決策:**
1. サーバーログで "Loaded persisted client credentials" メッセージを確認
2. `.client-credentials.json` ファイルの内容を確認
3. ファイルのJSON形式が正しいか確認
4. ファイルの読み取り権限を確認

#### 問題: ログイン後にエラーが発生する
**解決策:**
1. Authleteに登録されたクライアントIDが有効か確認
2. リダイレクトURIが正しく設定されているか確認
3. Trust Anchorが正しく設定されているか確認
4. cloudflared URLが最新か確認

### 6. セキュリティに関する注意事項

#### 開発環境
- `.client-credentials.json` は `.gitignore` に追加済み
- ファイルにはクライアントシークレットが含まれます
- ローカルファイルシステムに保存されます

#### 本番環境での推奨事項
- 認証情報ファイルを暗号化する
- Key Management Service (KMS) を使用する
- 認証情報のローテーションを実装する
- 環境変数を使用して機密データを管理する

### 7. 変更されたファイル

1. **test-client-federation-valid/server.js**
   - 認証情報の永続化機能を追加
   - 登録ロジックを強化
   - クリアエンドポイントを追加
   - 起動シーケンスを変更

2. **.gitignore**
   - `.client-credentials.json` を追加

3. **FEDERATION_IMPLEMENTATION.md** (新規)
   - 実装の詳細なドキュメント

4. **DUPLICATE_REGISTRATION_FIX.md** (このファイル)
   - テストガイド（日本語）

## ステータス: ✅ 実装完了

認証情報の永続化実装が完了し、テストの準備が整いました。システムはサーバーの再起動を適切に処理し、重複登録エラーを発生させません。

## 次のステップ

上記のテスト手順に従って、実装を検証してください：
1. 初回登録のテスト
2. サーバー再起動後のテスト
3. 認証情報クリアのテスト

すべてのテストが成功すれば、実装は完全に機能しています。

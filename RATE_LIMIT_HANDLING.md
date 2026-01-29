# Authlete API Rate Limit対策 - Exponential Backoff実装

## 概要

Authlete APIのRate Limit（429 Too Many Requests）に対応するため、exponential backoff（指数バックオフ）とRetry-Afterヘッダーのサポートを実装しました。

## 実装内容

### 1. Exponential Backoff戦略

リトライ時の待機時間を指数関数的に増加させることで、サーバーへの負荷を軽減します。

**バックオフパターン:**
```
試行1: 1秒
試行2: 2秒
試行3: 4秒
試行4: 8秒
試行5: 16秒
最大: 32秒
```

### 2. Jitter（ランダム化）

複数のクライアントが同時にリトライすることを防ぐため、待機時間に±25%のランダム性を追加します。

**例:**
- 基本待機時間: 2秒
- Jitter適用後: 1.5秒〜2.5秒の範囲でランダム

### 3. Retry-Afterヘッダーのサポート

Authlete APIが`Retry-After`ヘッダーを返す場合、そのヘッダーの値を優先的に使用します。

**サポート形式:**
- 秒数: `Retry-After: 5` → 5秒待機
- HTTP日時: `Retry-After: Wed, 21 Oct 2026 07:28:00 GMT` → 指定時刻まで待機

### 4. リトライ可能なエラー

以下のエラーに対して自動リトライを実行します：

- **429 Too Many Requests** - Rate Limit
- **5xx Server Errors** - サーバーエラー
- **Network Errors** - ネットワーク接続エラー

### 5. リトライ不可能なエラー

以下のエラーはリトライせず、即座に失敗します：

- **4xx Client Errors** (429を除く) - クライアント側のエラー
  - 400 Bad Request
  - 401 Unauthorized
  - 403 Forbidden
  - 404 Not Found
  - など

## 設定方法

### 環境変数

`.env`ファイルでリトライ回数を設定できます：

```bash
# リトライ回数（デフォルト: 3、推奨: 5）
HTTP_RETRY_ATTEMPTS=5

# HTTPタイムアウト（ミリ秒）
HTTP_TIMEOUT=10000
```

### 推奨設定

Rate Limit対策として、以下の設定を推奨します：

```bash
HTTP_RETRY_ATTEMPTS=5
```

**理由:**
- 5回のリトライで最大63秒（1+2+4+8+16+32）の待機時間
- ほとんどのRate Limitは1分以内に解除される
- 過度なリトライによるリソース消費を防ぐ

## 動作例

### ケース1: Rate Limitに達した場合

```
[試行1] → 429 Too Many Requests
  ↓ 1秒待機
[試行2] → 429 Too Many Requests
  ↓ 2秒待機
[試行3] → 429 Too Many Requests
  ↓ 4秒待機
[試行4] → 200 OK ✓ 成功
```

### ケース2: Retry-Afterヘッダーがある場合

```
[試行1] → 429 Too Many Requests
         Retry-After: 10
  ↓ 10秒待機（ヘッダーの値を使用）
[試行2] → 200 OK ✓ 成功
```

### ケース3: 最大リトライ回数に達した場合

```
[試行1] → 429 Too Many Requests
  ↓ 1秒待機
[試行2] → 429 Too Many Requests
  ↓ 2秒待機
[試行3] → 429 Too Many Requests
  ↓ 4秒待機
[試行4] → 429 Too Many Requests
  ↓ 8秒待機
[試行5] → 429 Too Many Requests
  ✗ エラー: Rate limit exceeded
```

## ログ出力

### 通常のリトライ

```json
{
  "level": "warn",
  "message": "Rate limit hit, backing off before retry",
  "component": "AuthleteClient",
  "context": {
    "attempt": 1,
    "maxRetries": 5,
    "retryDelayMs": 1000,
    "retryDelaySeconds": 1,
    "statusCode": 429,
    "isRateLimited": true,
    "hasRetryAfterHeader": false
  }
}
```

### Retry-Afterヘッダー使用時

```json
{
  "level": "info",
  "message": "Using Retry-After header for backoff delay",
  "component": "AuthleteClient",
  "context": {
    "retryAfterMs": 5000,
    "retryAfterSeconds": 5
  }
}
```

### 最大リトライ到達時

```json
{
  "level": "error",
  "message": "Rate limit exceeded and max retries reached",
  "component": "AuthleteClient",
  "error": {
    "name": "RateLimitError",
    "message": "Authlete API rate limit exceeded",
    "code": 429
  },
  "context": {
    "attempts": 5,
    "maxRetries": 5,
    "endpoint": "/api/xxx/federation/registration"
  }
}
```

## コンソール出力

リトライ時には、わかりやすいコンソールメッセージも表示されます：

```
⚠️  Rate limit hit (attempt 1/5), retrying in 1s...
⚠️  Rate limit hit (attempt 2/5), retrying in 2s...
⚠️  Rate limit hit (attempt 3/5), retrying in 4s...
```

## テスト

実装の正確性を確認するため、包括的なテストスイートを用意しています：

```bash
# Rate Limit関連のテストを実行
npm test -- src/authlete/client-retry.test.ts
```

**テストカバレッジ:**
- ✅ 429エラーの検出
- ✅ Exponential backoffの計算
- ✅ Jitterの適用
- ✅ Retry-Afterヘッダーの解析
- ✅ 最大リトライ回数の制限
- ✅ リトライ不可能なエラーの処理

## ベストプラクティス

### 1. 適切なリトライ回数の設定

```bash
# 開発環境: 少なめ（デバッグしやすい）
HTTP_RETRY_ATTEMPTS=3

# 本番環境: 多め（可用性重視）
HTTP_RETRY_ATTEMPTS=5
```

### 2. タイムアウトの設定

```bash
# リトライを考慮したタイムアウト
# 5回リトライ × 最大32秒 = 160秒以上推奨
HTTP_TIMEOUT=180000  # 3分
```

### 3. モニタリング

Rate Limitエラーを監視し、頻繁に発生する場合は以下を検討：

- API呼び出しの最適化
- キャッシュの導入
- バッチ処理の実装
- Authleteプランのアップグレード

### 4. エラーハンドリング

```typescript
try {
  const result = await authleteClient.federationRegistration(request);
  // 成功処理
} catch (error) {
  if (error.statusCode === 429) {
    // Rate Limitエラー（最大リトライ後）
    logger.error('Rate limit exceeded after retries');
    // ユーザーに適切なメッセージを表示
  } else {
    // その他のエラー
    logger.error('API call failed', error);
  }
}
```

## トラブルシューティング

### 問題: Rate Limitエラーが頻繁に発生

**原因:**
- API呼び出しが多すぎる
- 短時間に大量のリクエスト

**解決策:**
1. リトライ回数を増やす: `HTTP_RETRY_ATTEMPTS=5`
2. API呼び出しを最適化
3. キャッシュを導入
4. リクエストをバッチ化

### 問題: リトライが長すぎる

**原因:**
- リトライ回数が多すぎる
- Exponential backoffで待機時間が長い

**解決策:**
1. リトライ回数を減らす: `HTTP_RETRY_ATTEMPTS=3`
2. タイムアウトを短く設定
3. 非同期処理に変更

### 問題: Retry-Afterヘッダーが無視される

**原因:**
- ヘッダー名の大文字小文字が異なる
- ヘッダー形式が不正

**確認方法:**
```bash
# ログでRetry-Afterヘッダーの有無を確認
grep "hasRetryAfterHeader" logs/app.log
```

## 参考資料

### 関連ファイル

- `src/authlete/client.ts` - Exponential backoff実装
- `src/authlete/client-retry.test.ts` - テストスイート
- `src/config/index.ts` - 設定管理
- `.env.example` - 環境変数テンプレート

### 外部リソース

- [Authlete API Documentation](https://docs.authlete.com/)
- [HTTP 429 Too Many Requests](https://developer.mozilla.org/en-US/docs/Web/HTTP/Status/429)
- [Exponential Backoff And Jitter](https://aws.amazon.com/blogs/architecture/exponential-backoff-and-jitter/)
- [Retry-After Header](https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Retry-After)

## まとめ

この実装により、Authlete APIのRate Limitに対して以下の対策が可能になりました：

✅ **自動リトライ** - 429エラー時に自動的にリトライ
✅ **Exponential Backoff** - 待機時間を指数関数的に増加
✅ **Jitter** - 複数クライアントの同時リトライを防止
✅ **Retry-Afterサポート** - サーバー指定の待機時間を尊重
✅ **詳細なログ** - デバッグとモニタリングが容易
✅ **設定可能** - 環境に応じてリトライ回数を調整可能

これにより、一時的なRate Limitによるサービス中断を最小限に抑え、システムの可用性を向上させることができます。

---

**最終更新**: 2026-01-29
**バージョン**: 1.0.0

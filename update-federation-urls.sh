#!/bin/bash

# OpenID Federation URL Update Script
# cloudflaredのURL変更時に使用するスクリプト

set -e

echo "=========================================="
echo "OpenID Federation URL Update Script"
echo "=========================================="
echo ""

# 現在の設定を表示
echo "📋 現在の設定:"
echo ""
echo "Trust Anchor:"
grep "^ENTITY_ID=" trust-anchor/.env | cut -d'=' -f2
echo ""
echo "Valid Test Client:"
grep "^ENTITY_ID=" test-client-federation-valid/.env | cut -d'=' -f2
echo ""
echo "Invalid Test Client:"
grep "^ENTITY_ID=" test-client-federation-invalid/.env | cut -d'=' -f2
echo ""
echo "=========================================="
echo ""

# 新しいURLの入力
read -p "🔗 Trust AnchorのcloudflaredURL (例: https://xxx.trycloudflare.com): " TRUST_ANCHOR_URL
read -p "🔗 Valid Test ClientのcloudflaredURL (例: https://yyy.trycloudflare.com): " VALID_CLIENT_URL
read -p "🔗 Invalid Test ClientのcloudflaredURL (例: https://zzz.trycloudflare.com): " INVALID_CLIENT_URL

# URLの検証
if [[ ! $TRUST_ANCHOR_URL =~ ^https:// ]]; then
    echo "❌ エラー: Trust Anchor URLはhttpsで始まる必要があります"
    exit 1
fi

if [[ ! $VALID_CLIENT_URL =~ ^https:// ]]; then
    echo "❌ エラー: Valid Client URLはhttpsで始まる必要があります"
    exit 1
fi

if [[ ! $INVALID_CLIENT_URL =~ ^https:// ]]; then
    echo "❌ エラー: Invalid Client URLはhttpsで始まる必要があります"
    exit 1
fi

echo ""
echo "=========================================="
echo "📝 更新内容:"
echo "=========================================="
echo "Trust Anchor URL: $TRUST_ANCHOR_URL"
echo "Valid Client URL: $VALID_CLIENT_URL"
echo "Invalid Client URL: $INVALID_CLIENT_URL"
echo ""
read -p "この内容で更新しますか？ (y/n): " CONFIRM

if [[ $CONFIRM != "y" && $CONFIRM != "Y" ]]; then
    echo "❌ キャンセルしました"
    exit 0
fi

echo ""
echo "🔄 設定ファイルを更新中..."
echo ""

# Trust Anchor の .env を更新
echo "  - trust-anchor/.env"
sed -i.bak "s|^ENTITY_ID=.*|ENTITY_ID=$TRUST_ANCHOR_URL|" trust-anchor/.env
sed -i.bak "s|^HOMEPAGE_URI=.*|HOMEPAGE_URI=$TRUST_ANCHOR_URL|" trust-anchor/.env
sed -i.bak "s|^SUBORDINATE_ENTITIES=.*|SUBORDINATE_ENTITIES=$VALID_CLIENT_URL|" trust-anchor/.env

# Valid Test Client の .env を更新
echo "  - test-client-federation-valid/.env"
sed -i.bak "s|^ENTITY_ID=.*|ENTITY_ID=$VALID_CLIENT_URL|" test-client-federation-valid/.env
sed -i.bak "s|^CLIENT_URI=.*|CLIENT_URI=$VALID_CLIENT_URL|" test-client-federation-valid/.env
sed -i.bak "s|^TRUST_ANCHOR_ID=.*|TRUST_ANCHOR_ID=$TRUST_ANCHOR_URL|" test-client-federation-valid/.env

# CONTACTSも更新（ドメイン部分のみ）
VALID_CLIENT_DOMAIN=$(echo $VALID_CLIENT_URL | sed 's|https://||')
sed -i.bak "s|^CONTACTS=.*|CONTACTS=admin@$VALID_CLIENT_DOMAIN|" test-client-federation-valid/.env

# Invalid Test Client の .env を更新（Trust Anchor IDのみ）
echo "  - test-client-federation-invalid/.env"
sed -i.bak "s|^ENTITY_ID=.*|ENTITY_ID=$INVALID_CLIENT_URL|" test-client-federation-invalid/.env
sed -i.bak "s|^CLIENT_URI=.*|CLIENT_URI=$INVALID_CLIENT_URL|" test-client-federation-invalid/.env
sed -i.bak "s|^TRUST_ANCHOR_ID=.*|TRUST_ANCHOR_ID=$TRUST_ANCHOR_URL|" test-client-federation-invalid/.env

# CONTACTSも更新（ドメイン部分のみ）
INVALID_CLIENT_DOMAIN=$(echo $INVALID_CLIENT_URL | sed 's|https://||')
sed -i.bak "s|^CONTACTS=.*|CONTACTS=admin@$INVALID_CLIENT_DOMAIN|" test-client-federation-invalid/.env

# バックアップファイルを削除
rm -f trust-anchor/.env.bak
rm -f test-client-federation-valid/.env.bak
rm -f test-client-federation-invalid/.env.bak

echo ""
echo "✅ 更新完了！"
echo ""
echo "=========================================="
echo "📋 更新後の設定:"
echo "=========================================="
echo ""
echo "Trust Anchor:"
grep "^ENTITY_ID=" trust-anchor/.env | cut -d'=' -f2
echo ""
echo "Valid Test Client:"
grep "^ENTITY_ID=" test-client-federation-valid/.env | cut -d'=' -f2
echo ""
echo "Invalid Test Client:"
grep "^ENTITY_ID=" test-client-federation-invalid/.env | cut -d'=' -f2
echo ""
echo "Trust Anchor ID (Valid Client):"
grep "^TRUST_ANCHOR_ID=" test-client-federation-valid/.env | cut -d'=' -f2
echo ""
echo "Trust Anchor ID (Invalid Client):"
grep "^TRUST_ANCHOR_ID=" test-client-federation-invalid/.env | cut -d'=' -f2
echo ""
echo "=========================================="
echo ""
echo "⚠️  次のステップ:"
echo "1. Authlete管理画面でTrust Anchor URLを更新してください"
echo "2. すべてのサーバーを再起動してください:"
echo "   - Trust Anchor: cd trust-anchor && npm start"
echo "   - Valid Client: cd test-client-federation-valid && npm start"
echo "   - Invalid Client: cd test-client-federation-invalid && npm start"
echo "   - Authorization Server: npm start"
echo ""
echo "3. cloudflaredトンネルを起動してください:"
echo "   - Trust Anchor (port 3010): cloudflared tunnel --url http://localhost:3010"
echo "   - Valid Client (port 3006): cloudflared tunnel --url http://localhost:3006"
echo "   - Invalid Client (port 3007): cloudflared tunnel --url http://localhost:3007"
echo ""

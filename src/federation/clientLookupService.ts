/**
 * Client Lookup Service
 * 
 * Entity IDでクライアントの登録状態を確認するサービス
 * OpenID Federation 1.0において、URI形式のentity_idをclient_idとして
 * 使用するための実装
 */

import { AuthleteClient } from '../authlete/client';
import { logger } from '../utils/logger';

/**
 * クライアント情報
 */
export interface ClientInfo {
  /** Entity ID (URI形式) */
  entityId: string;
  
  /** Authlete内部のClient ID (数値) */
  clientId: string;
  
  /** Client Secret */
  clientSecret?: string;
  
  /** 登録日時 (Unix timestamp) */
  registeredAt: number;
  
  /** Trust Chainの有効期限 (Unix timestamp) */
  trustChainExpiresAt?: number;
  
  /** Trust Anchor ID */
  trustAnchorId?: string;
}

/**
 * Client Lookup Service Interface
 */
export interface IClientLookupService {
  /**
   * Entity IDでクライアントを検索
   * @param entityId - クライアントのEntity ID (URI形式)
   * @returns クライアント情報（登録済みの場合）またはnull
   */
  lookupClientByEntityId(entityId: string): Promise<ClientInfo | null>;
  
  /**
   * クライアントが登録済みかチェック
   * @param entityId - クライアントのEntity ID (URI形式)
   * @returns 登録済みの場合true
   */
  isClientRegistered(entityId: string): Promise<boolean>;
}

/**
 * Client Lookup Service Implementation
 */
export class ClientLookupService implements IClientLookupService {
  // 将来の使用のために保持（現在はAuthleteに委譲）
  // @ts-ignore - 将来の使用のために保持
  constructor(private authleteClient: AuthleteClient) {
    logger.logInfo(
      'ClientLookupService initialized',
      'ClientLookupService'
    );
  }

  /**
   * Entity IDでクライアントを検索
   * 
   * Authleteに登録されたクライアントをentity_idで検索します。
   * OpenID Federationでは、entity_idがclient_idとして使用されます。
   */
  async lookupClientByEntityId(entityId: string): Promise<ClientInfo | null> {
    try {
      logger.logInfo(
        'Looking up client by entity ID',
        'ClientLookupService',
        { entityId }
      );

      // Entity IDの形式を検証
      if (!this.isValidEntityId(entityId)) {
        logger.logWarn(
          'Invalid entity ID format',
          'ClientLookupService',
          { entityId }
        );
        return null;
      }

      // Authlete APIを使用してクライアントを検索
      // Note: Authleteは現在、entity_idでの直接検索をサポートしていないため、
      // 代替として、認可リクエスト時にAuthleteがentity_idを解決する仕組みを利用します。
      // ここでは、entity_idが登録済みかどうかを判定するために、
      // Authleteの/auth/authorizationエンドポイントの動作を利用します。
      
      // 実装方法:
      // 1. Authleteに問い合わせて、entity_idで登録されたクライアントを検索
      // 2. 現時点では、Authleteがentity_idをclient_idとして受け入れるため、
      //    認可リクエスト時にAuthleteが自動的に解決します
      // 3. ここでは、キャッシュまたは事前の登録情報を確認する実装とします

      // TODO: Authleteがentity_idでのクライアント検索APIを提供する場合は、
      // そのAPIを使用するように変更する

      // 現時点では、常にnullを返し、認可リクエスト時にAuthleteに判定を委ねます
      // これにより、Authleteがentity_idを解決し、登録済みかどうかを判定します
      
      logger.logInfo(
        'Client lookup delegated to Authlete authorization endpoint',
        'ClientLookupService',
        { entityId }
      );

      return null;

    } catch (error) {
      logger.logError({
        message: 'Failed to lookup client by entity ID',
        component: 'ClientLookupService',
        error: {
          name: error instanceof Error ? error.name : 'UnknownError',
          message: error instanceof Error ? error.message : String(error),
          ...(error instanceof Error && error.stack && { stack: error.stack })
        },
        context: { entityId }
      });

      // エラーが発生した場合は、nullを返して動的登録を試みる
      return null;
    }
  }

  /**
   * クライアントが登録済みかチェック
   */
  async isClientRegistered(entityId: string): Promise<boolean> {
    const clientInfo = await this.lookupClientByEntityId(entityId);
    return clientInfo !== null;
  }

  /**
   * Entity IDの形式を検証
   * 
   * Entity IDは以下の条件を満たす必要があります:
   * - HTTPS URLである（localhostを除く）
   * - クエリパラメータやフラグメントを含まない
   */
  private isValidEntityId(entityId: string): boolean {
    try {
      const url = new URL(entityId);
      
      // localhostの場合はHTTPも許可
      const isLocalhost = url.hostname === 'localhost' || url.hostname === '127.0.0.1';
      
      if (!isLocalhost && url.protocol !== 'https:') {
        return false;
      }
      
      // クエリパラメータやフラグメントを含まない
      if (url.search || url.hash) {
        return false;
      }
      
      return true;
    } catch {
      return false;
    }
  }
}

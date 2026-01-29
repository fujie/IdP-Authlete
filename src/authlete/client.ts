import axios, { AxiosInstance, AxiosRequestConfig, AxiosResponse } from 'axios';
import { AuthleteConfig } from '../config';
import { logger } from '../utils/logger';
import {
  AuthorizationRequest,
  AuthorizationResponse,
  AuthorizationIssueRequest,
  AuthorizationIssueResponse,
  AuthorizationFailRequest,
  AuthorizationFailResponse,
  TokenRequest,
  TokenResponse,
  IntrospectionRequest,
  IntrospectionResponse,
  UserInfoRequest,
  UserInfoResponse,
  FederationFetchRequest,
  FederationFetchResponse,
  FederationListRequest,
  FederationListResponse,
  FederationResolveRequest,
  FederationResolveResponse,
  AuthleteFederationRegistrationRequest,
  AuthleteFederationRegistrationResponse,
  AuthleteFederationConfigurationRequest,
  AuthleteFederationConfigurationResponse,
  AuthleteClientCreateRequest,
  AuthleteClientCreateResponse,
  AuthleteDynamicRegistrationRequest,
  AuthleteDynamicRegistrationResponse
} from './types';

export class AuthleteApiError extends Error {
  constructor(
    public statusCode: number,
    public authleteResponse: any,
    message: string
  ) {
    super(message);
    this.name = 'AuthleteApiError';
  }
}

export interface AuthleteClient {
  authorization(request: AuthorizationRequest): Promise<AuthorizationResponse>;
  authorizationIssue(request: AuthorizationIssueRequest): Promise<AuthorizationIssueResponse>;
  authorizationFail(request: AuthorizationFailRequest): Promise<AuthorizationFailResponse>;
  token(request: TokenRequest): Promise<TokenResponse>;
  introspection(request: IntrospectionRequest): Promise<IntrospectionResponse>;
  userInfo(request: UserInfoRequest): Promise<UserInfoResponse>;
  // OpenID Federation 1.0 methods
  federationFetch(request: FederationFetchRequest): Promise<FederationFetchResponse>;
  federationList(request: FederationListRequest): Promise<FederationListResponse>;
  federationResolve(request: FederationResolveRequest): Promise<FederationResolveResponse>;
  // Federation Registration
  federationRegistration(request: AuthleteFederationRegistrationRequest): Promise<AuthleteFederationRegistrationResponse>;
  // Federation Configuration
  federationConfiguration(request: AuthleteFederationConfigurationRequest): Promise<AuthleteFederationConfigurationResponse>;
  // Client Management
  createClient(request: AuthleteClientCreateRequest): Promise<AuthleteClientCreateResponse>;
  // Dynamic Client Registration
  dynamicClientRegistration(request: AuthleteDynamicRegistrationRequest): Promise<AuthleteDynamicRegistrationResponse>;
}

export class AuthleteClientImpl implements AuthleteClient {
  private httpClient: AxiosInstance;
  private config: AuthleteConfig;

  constructor(config: AuthleteConfig) {
    this.config = config;
    this.httpClient = this.createHttpClient();
  }

  protected async delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  protected isRetryableError(error: any): boolean {
    // Retry on network errors, timeouts, and 5xx server errors
    if (axios.isAxiosError(error)) {
      // Network errors (no response)
      if (!error.response) {
        return true;
      }
      
      // Server errors (5xx)
      const status = error.response.status;
      if (status >= 500 && status < 600) {
        return true;
      }
      
      // Specific retryable status codes
      if (status === 429) { // Too Many Requests
        return true;
      }
    }
    
    return false;
  }

  private async callWithRetry<T>(
    apiCall: () => Promise<T>,
    maxRetries: number = this.config.retryAttempts
  ): Promise<T> {
    let lastError: any;
    
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        return await apiCall();
      } catch (error) {
        lastError = error;
        
        // Don't retry on the last attempt or non-retryable errors
        if (attempt === maxRetries || !this.isRetryableError(error)) {
          break;
        }
        
        // Calculate exponential backoff delay
        const baseDelay = 1000; // 1 second
        const backoffDelay = baseDelay * Math.pow(2, attempt - 1);
        const jitter = Math.random() * 0.1 * backoffDelay; // Add 10% jitter
        const totalDelay = backoffDelay + jitter;
        
        console.log(`Authlete API call failed (attempt ${attempt}/${maxRetries}), retrying in ${Math.round(totalDelay)}ms...`);
        
        logger.logWarn(
          `Authlete API call failed, retrying`,
          'AuthleteClient',
          {
            attempt,
            maxRetries,
            retryDelayMs: Math.round(totalDelay),
            error: error instanceof Error ? error.message : String(error),
            endpoint: (error as any)?.config?.url
          }
        );
        await this.delay(totalDelay);
      }
    }
    
    throw lastError;
  }

  private createHttpClient(): AxiosInstance {
    const client = axios.create({
      baseURL: this.config.baseUrl,
      timeout: this.config.timeout,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.config.serviceAccessToken}`,
        'User-Agent': 'OpenID-Connect-Authorization-Server/1.0.0'
      },
      // Connection pooling configuration
      maxRedirects: 0,
      validateStatus: (status) => status < 500, // Don't throw on 4xx errors
    });

    // Request interceptor for logging
    client.interceptors.request.use(
      (config) => {
        logger.logDebug(
          `Making Authlete API request`,
          'AuthleteClient',
          {
            method: config.method?.toUpperCase(),
            url: config.url,
            hasData: !!config.data
          }
        );
        return config;
      },
      (error) => {
        logger.logError({
          message: 'Request interceptor error',
          component: 'AuthleteClient',
          error: {
            name: error instanceof Error ? error.name : 'UnknownError',
            message: error instanceof Error ? error.message : String(error),
            ...(error instanceof Error && error.stack && { stack: error.stack })
          }
        });
        return Promise.reject(error);
      }
    );

    // Response interceptor for error handling
    client.interceptors.response.use(
      (response) => {
        logger.logDebug(
          `Authlete API response received`,
          'AuthleteClient',
          {
            status: response.status,
            statusText: response.statusText,
            url: response.config.url
          }
        );
        return response;
      },
      (error) => {
        logger.logError({
          message: 'Response interceptor error',
          component: 'AuthleteClient',
          error: {
            name: error instanceof Error ? error.name : 'UnknownError',
            message: error instanceof Error ? error.message : String(error),
            ...(error instanceof Error && error.stack && { stack: error.stack }),
            code: error?.response?.status
          },
          context: {
            url: error?.config?.url,
            method: error?.config?.method,
            status: error?.response?.status
          }
        });
        return Promise.reject(error);
      }
    );

    return client;
  }

  protected async makeRequest<T>(
    method: 'GET' | 'POST',
    endpoint: string,
    data?: any
  ): Promise<T> {
    return this.callWithRetry(async () => {
      try {
        const config: AxiosRequestConfig = {
          method,
          url: endpoint,
          ...(data && { data })
        };

        const response: AxiosResponse<T> = await this.httpClient.request(config);
        
        // Handle HTTP error status codes
        if (response.status >= 400) {
          throw new AuthleteApiError(
            response.status,
            response.data,
            `Authlete API error: ${response.status} ${response.statusText}`
          );
        }

        return response.data;
      } catch (error) {
        if (error instanceof AuthleteApiError) {
          throw error;
        }
        
        // Handle axios errors
        if (axios.isAxiosError(error)) {
          const statusCode = error.response?.status || 0;
          const responseData = error.response?.data;
          
          throw new AuthleteApiError(
            statusCode,
            responseData,
            `Authlete API request failed: ${error.message}`
          );
        }
        
        // Handle other errors
        throw new AuthleteApiError(
          0,
          null,
          `Unexpected error during Authlete API request: ${error instanceof Error ? error.message : 'Unknown error'}`
        );
      }
    });
  }

  private getApiPath(endpoint: string): string {
    return `/api/${this.config.serviceId}${endpoint}`;
  }

  async authorization(request: AuthorizationRequest): Promise<AuthorizationResponse> {
    return this.makeRequest<AuthorizationResponse>('POST', this.getApiPath('/auth/authorization'), request);
  }

  async authorizationIssue(request: AuthorizationIssueRequest): Promise<AuthorizationIssueResponse> {
    return this.makeRequest<AuthorizationIssueResponse>('POST', this.getApiPath('/auth/authorization/issue'), request);
  }

  async authorizationFail(request: AuthorizationFailRequest): Promise<AuthorizationFailResponse> {
    return this.makeRequest<AuthorizationFailResponse>('POST', this.getApiPath('/auth/authorization/fail'), request);
  }

  async token(request: TokenRequest): Promise<TokenResponse> {
    return this.makeRequest<TokenResponse>('POST', this.getApiPath('/auth/token'), request);
  }

  async introspection(request: IntrospectionRequest): Promise<IntrospectionResponse> {
    // Log the introspection request details
    logger.logDebug(
      'Calling Authlete introspection API',
      'AuthleteClient',
      {
        hasToken: !!request.token,
        tokenLength: request.token?.length,
        scopes: request.scopes,
        subject: request.subject,
        endpoint: this.getApiPath('/auth/introspection')
      }
    );
    
    return this.makeRequest<IntrospectionResponse>('POST', this.getApiPath('/auth/introspection'), request);
  }

  async userInfo(request: UserInfoRequest): Promise<UserInfoResponse> {
    // Log the userinfo request details
    logger.logDebug(
      'Calling Authlete userinfo API',
      'AuthleteClient',
      {
        hasToken: !!request.token,
        tokenLength: request.token?.length,
        endpoint: this.getApiPath('/auth/userinfo')
      }
    );
    
    return this.makeRequest<UserInfoResponse>('POST', this.getApiPath('/auth/userinfo'), request);
  }

  // OpenID Federation 1.0 API methods
  async federationFetch(request: FederationFetchRequest): Promise<FederationFetchResponse> {
    logger.logDebug(
      'Calling Authlete federation fetch API',
      'AuthleteClient',
      {
        iss: request.iss,
        sub: request.sub,
        endpoint: this.getApiPath('/federation/fetch')
      }
    );
    
    return this.makeRequest<FederationFetchResponse>('POST', this.getApiPath('/federation/fetch'), request);
  }

  async federationList(request: FederationListRequest): Promise<FederationListResponse> {
    logger.logDebug(
      'Calling Authlete federation list API',
      'AuthleteClient',
      {
        iss: request.iss,
        entity_type: request.entity_type,
        endpoint: this.getApiPath('/federation/list')
      }
    );
    
    return this.makeRequest<FederationListResponse>('POST', this.getApiPath('/federation/list'), request);
  }

  async federationResolve(request: FederationResolveRequest): Promise<FederationResolveResponse> {
    logger.logDebug(
      'Calling Authlete federation resolve API',
      'AuthleteClient',
      {
        sub: request.sub,
        anchor: request.anchor,
        type: request.type,
        endpoint: this.getApiPath('/federation/resolve')
      }
    );
    
    return this.makeRequest<FederationResolveResponse>('POST', this.getApiPath('/federation/resolve'), request);
  }

  async federationRegistration(request: AuthleteFederationRegistrationRequest): Promise<AuthleteFederationRegistrationResponse> {
    // Prepare the request body according to Authlete's specification
    // The body should contain EITHER entityConfiguration OR trustChain, not both
    const requestBody: { entityConfiguration?: string; trustChain?: string } = {};
    
    if (request.entityConfiguration) {
      // Use entityConfiguration (JWT string)
      requestBody.entityConfiguration = request.entityConfiguration;
    } else if (request.trustChain && request.trustChain.length > 0) {
      // Use trustChain (JSON string)
      requestBody.trustChain = JSON.stringify(request.trustChain);
    } else {
      throw new Error('Either entityConfiguration or trustChain must be provided');
    }
    
    logger.logInfo(
      'Calling Authlete federation registration API',
      'AuthleteClient',
      {
        hasEntityConfiguration: !!requestBody.entityConfiguration,
        hasTrustChain: !!requestBody.trustChain,
        endpoint: this.getApiPath('/federation/registration'),
        requestPayload: JSON.stringify(requestBody, null, 2)
      }
    );
    
    try {
      const response = await this.makeRequest<AuthleteFederationRegistrationResponse>(
        'POST', 
        this.getApiPath('/federation/registration'), 
        requestBody
      );
      
      logger.logInfo(
        'Authlete federation registration API response received',
        'AuthleteClient',
        {
          action: response.action,
          clientId: response.client_id,
          responsePayload: JSON.stringify(response, null, 2)
        }
      );
      
      return response;
    } catch (error) {
      logger.logError({
        message: 'Authlete federation registration API error',
        component: 'AuthleteClient',
        error: {
          name: error instanceof Error ? error.name : 'UnknownError',
          message: error instanceof Error ? error.message : String(error),
          ...(error instanceof Error && error.stack && { stack: error.stack })
        },
        context: {
          endpoint: this.getApiPath('/federation/registration'),
          hasEntityConfiguration: !!requestBody.entityConfiguration,
          hasTrustChain: !!requestBody.trustChain
        }
      });
      throw error;
    }
  }

  async federationConfiguration(request: AuthleteFederationConfigurationRequest): Promise<AuthleteFederationConfigurationResponse> {
    logger.logDebug(
      'Calling Authlete federation configuration API',
      'AuthleteClient',
      {
        endpoint: this.getApiPath('/federation/configuration')
      }
    );
    
    return this.makeRequest<AuthleteFederationConfigurationResponse>('POST', this.getApiPath('/federation/configuration'), request);
  }

  async createClient(request: AuthleteClientCreateRequest): Promise<AuthleteClientCreateResponse> {
    logger.logDebug(
      'Calling Authlete client create API',
      'AuthleteClient',
      {
        clientName: request.client_name,
        redirectUris: request.redirect_uris?.length || 0,
        endpoint: this.getApiPath('/client/create')
      }
    );
    
    return this.makeRequest<AuthleteClientCreateResponse>('POST', this.getApiPath('/client/create'), request);
  }

  async dynamicClientRegistration(request: AuthleteDynamicRegistrationRequest): Promise<AuthleteDynamicRegistrationResponse> {
    logger.logDebug(
      'Calling Authlete dynamic client registration API',
      'AuthleteClient',
      {
        clientName: request.client_name,
        redirectUris: request.redirect_uris?.length || 0,
        endpoint: this.getApiPath('/client/registration')
      }
    );
    
    return this.makeRequest<AuthleteDynamicRegistrationResponse>('POST', this.getApiPath('/client/registration'), request);
  }
}
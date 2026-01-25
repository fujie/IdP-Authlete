import { Request, Response } from 'express';
import { AuthleteClient } from '../authlete/client';
import { UserInfoRequest } from '../authlete/types';
import { logger } from '../utils/logger';

export interface UserInfoController {
  handleUserInfoRequest(req: Request, res: Response): Promise<void>;
}

export class UserInfoControllerImpl implements UserInfoController {
  constructor(private authleteClient: AuthleteClient) {}

  /**
   * Generate dummy user attributes based on subject
   */
  private generateDummyUserAttributes(subject: string): Record<string, any> {
    // Create consistent dummy data based on subject
    const subjectLower = subject.toLowerCase();
    
    // Base attributes for all users
    const baseAttributes = {
      name: this.generateFullName(subject),
      given_name: this.generateGivenName(subject),
      family_name: this.generateFamilyName(subject),
      preferred_username: subject,
      email: `${subjectLower}@example.com`,
      email_verified: true,
      locale: 'ja-JP',
      zoneinfo: 'Asia/Tokyo',
      updated_at: Math.floor(Date.now() / 1000)
    };

    // Add additional attributes based on subject
    if (subjectLower === 'demo') {
      return {
        ...baseAttributes,
        name: 'デモ ユーザー',
        given_name: 'デモ',
        family_name: 'ユーザー',
        nickname: 'Demo',
        profile: 'https://example.com/users/demo',
        picture: 'https://example.com/avatars/demo.jpg',
        website: 'https://demo.example.com',
        gender: 'other',
        birthdate: '1990-01-01',
        phone_number: '+81-90-1234-5678',
        phone_number_verified: true,
        address: {
          formatted: '東京都渋谷区1-1-1\n日本',
          street_address: '1-1-1',
          locality: '渋谷区',
          region: '東京都',
          postal_code: '150-0001',
          country: 'JP'
        }
      };
    } else if (subjectLower === 'user1') {
      return {
        ...baseAttributes,
        name: '田中 太郎',
        given_name: '太郎',
        family_name: '田中',
        nickname: 'Taro',
        profile: 'https://example.com/users/user1',
        picture: 'https://example.com/avatars/user1.jpg',
        gender: 'male',
        birthdate: '1985-05-15',
        phone_number: '+81-80-9876-5432',
        phone_number_verified: false,
        address: {
          formatted: '大阪府大阪市北区2-2-2\n日本',
          street_address: '2-2-2',
          locality: '大阪市北区',
          region: '大阪府',
          postal_code: '530-0001',
          country: 'JP'
        }
      };
    } else if (subjectLower === 'testuser') {
      return {
        ...baseAttributes,
        name: '佐藤 花子',
        given_name: '花子',
        family_name: '佐藤',
        nickname: 'Hanako',
        profile: 'https://example.com/users/testuser',
        picture: 'https://example.com/avatars/testuser.jpg',
        website: 'https://hanako.example.com',
        gender: 'female',
        birthdate: '1992-12-25',
        phone_number: '+81-70-1111-2222',
        phone_number_verified: true,
        address: {
          formatted: '神奈川県横浜市中区3-3-3\n日本',
          street_address: '3-3-3',
          locality: '横浜市中区',
          region: '神奈川県',
          postal_code: '231-0001',
          country: 'JP'
        }
      };
    }

    // Default attributes for unknown subjects
    return baseAttributes;
  }

  private generateFullName(subject: string): string {
    const names: Record<string, string> = {
      'demo': 'デモ ユーザー',
      'user1': '田中 太郎',
      'testuser': '佐藤 花子'
    };
    return names[subject.toLowerCase()] || `${subject} User`;
  }

  private generateGivenName(subject: string): string {
    const givenNames: Record<string, string> = {
      'demo': 'デモ',
      'user1': '太郎',
      'testuser': '花子'
    };
    return givenNames[subject.toLowerCase()] || subject;
  }

  private generateFamilyName(subject: string): string {
    const familyNames: Record<string, string> = {
      'demo': 'ユーザー',
      'user1': '田中',
      'testuser': '佐藤'
    };
    return familyNames[subject.toLowerCase()] || 'User';
  }

  /**
   * Clean up Authlete response by removing array-indexed properties
   */
  private cleanAuthleteResponse(response: any): any {
    if (!response || typeof response !== 'object') {
      return response;
    }

    const cleaned: any = {};
    
    // Only keep properties that are not numeric indices
    for (const [key, value] of Object.entries(response)) {
      // Skip numeric indices (like "0", "1", "2", etc.)
      if (!/^\d+$/.test(key)) {
        cleaned[key] = value;
      }
    }

    return cleaned;
  }

  /**
   * Enrich UserInfo response with dummy attributes
   */
  private enrichUserInfoResponse(baseResponse: any, subject?: string): any {
    if (!subject) {
      return baseResponse;
    }

    // Clean up Authlete response first
    const cleanedResponse = this.cleanAuthleteResponse(baseResponse);

    // Generate dummy attributes
    const dummyAttributes = this.generateDummyUserAttributes(subject);
    
    // Merge with cleaned response, giving priority to cleaned response
    const enrichedResponse = {
      ...dummyAttributes,
      ...cleanedResponse,
      sub: subject // Ensure subject is always present
    };

    return enrichedResponse;
  }

  async handleUserInfoRequest(req: Request, res: Response): Promise<void> {
    const requestId = logger.generateRequestId();
    const childLogger = logger.createChildLogger({ requestId });

    try {
      // Extract access token from Authorization header
      const authHeader = req.headers.authorization;
      if (!authHeader || !authHeader.startsWith('Bearer ')) {
        childLogger.logError({
          message: 'UserInfo request missing or invalid Authorization header',
          component: 'UserInfoController',
          error: {
            name: 'MissingAuthorizationHeader',
            message: 'Missing or invalid Authorization header'
          }
        });

        res.status(401).json({
          error: 'invalid_token',
          error_description: 'Missing or invalid access token'
        });
        return;
      }

      const accessToken = authHeader.substring(7); // Remove 'Bearer ' prefix

      // Prepare UserInfo request for Authlete
      const userInfoRequest: UserInfoRequest = {
        token: accessToken
      };

      // Log the userinfo request
      childLogger.logDebug(
        'Processing UserInfo request',
        'UserInfoController',
        {
          hasToken: !!accessToken,
          tokenLength: accessToken?.length
        }
      );

      // Call Authlete UserInfo API
      const userInfoResponse = await this.authleteClient.userInfo(userInfoRequest);

      // Handle response based on action
      switch (userInfoResponse.action) {
        case 'OK':
          if (userInfoResponse.responseContent) {
            try {
              const responseData = JSON.parse(userInfoResponse.responseContent);
              
              // Add dummy user attributes if not present
              const enrichedResponse = this.enrichUserInfoResponse(responseData, userInfoResponse.subject);
              
              // Log successful userinfo response
              childLogger.logInfo(
                'UserInfo request completed successfully',
                'UserInfoController',
                {
                  subject: userInfoResponse.subject,
                  hasClaims: !!userInfoResponse.claims,
                  claimsCount: Object.keys(enrichedResponse).length
                }
              );

              res.status(200).json(enrichedResponse);
            } catch (parseError) {
              // Log JSON parsing error
              childLogger.logError({
                message: 'Failed to parse Authlete UserInfo response as JSON',
                component: 'UserInfoController',
                error: {
                  name: parseError instanceof Error ? parseError.name : 'UnknownError',
                  message: parseError instanceof Error ? parseError.message : String(parseError),
                  ...(parseError instanceof Error && parseError.stack && { stack: parseError.stack })
                },
                context: {
                  responseContent: userInfoResponse.responseContent
                }
              });

              // Fall back to structured response data
              const response = {
                sub: userInfoResponse.subject,
                ...userInfoResponse.claims
              };

              // Add dummy user attributes
              const enrichedResponse = this.enrichUserInfoResponse(response, userInfoResponse.subject);

              childLogger.logInfo(
                'UserInfo request completed with fallback response',
                'UserInfoController',
                {
                  subject: userInfoResponse.subject,
                  claimsCount: Object.keys(enrichedResponse).length
                }
              );

              res.status(200).json(enrichedResponse);
            }
          } else {
            // Use structured response data
            const response = {
              sub: userInfoResponse.subject,
              ...userInfoResponse.claims
            };

            // Add dummy user attributes
            const enrichedResponse = this.enrichUserInfoResponse(response, userInfoResponse.subject);

            childLogger.logInfo(
              'UserInfo request completed using structured data',
              'UserInfoController',
              {
                subject: userInfoResponse.subject,
                claimsCount: Object.keys(enrichedResponse).length
              }
            );

            res.status(200).json(enrichedResponse);
          }
          break;

        case 'BAD_REQUEST':
          childLogger.logError({
            message: 'UserInfo request failed - bad request',
            component: 'UserInfoController',
            error: {
              name: 'BadRequest',
              message: 'The request is missing a required parameter or is otherwise malformed'
            }
          });

          res.status(400).json({
            error: 'invalid_request',
            error_description: 'The request is missing a required parameter or is otherwise malformed'
          });
          break;

        case 'UNAUTHORIZED':
          childLogger.logError({
            message: 'UserInfo request failed - unauthorized',
            component: 'UserInfoController',
            error: {
              name: 'Unauthorized',
              message: 'The access token is invalid or expired'
            }
          });

          res.status(401).json({
            error: 'invalid_token',
            error_description: 'The access token is invalid or expired'
          });
          break;

        case 'FORBIDDEN':
          childLogger.logError({
            message: 'UserInfo request failed - forbidden',
            component: 'UserInfoController',
            error: {
              name: 'Forbidden',
              message: 'The access token does not have sufficient scope'
            }
          });

          res.status(403).json({
            error: 'insufficient_scope',
            error_description: 'The access token does not have sufficient scope'
          });
          break;

        case 'INTERNAL_SERVER_ERROR':
        default:
          childLogger.logError({
            message: 'UserInfo request failed - server error',
            component: 'UserInfoController',
            error: {
              name: 'ServerError',
              message: 'The authorization server encountered an unexpected condition'
            }
          });

          res.status(500).json({
            error: 'server_error',
            error_description: 'The authorization server encountered an unexpected condition'
          });
          break;
      }
    } catch (error) {
      // Log error with detailed information and stack trace
      childLogger.logError({
        message: 'UserInfo request processing error',
        component: 'UserInfoController',
        error: {
          name: error instanceof Error ? error.name : 'UnknownError',
          message: error instanceof Error ? error.message : String(error),
          ...(error instanceof Error && error.stack && { stack: error.stack }),
          code: (error as any)?.code || (error as any)?.status
        }
      });

      res.status(500).json({
        error: 'server_error',
        error_description: 'Internal server error'
      });
    }
  }
}
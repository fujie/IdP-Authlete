/**
 * Integration tests for error UI rendering
 * 
 * Tests that error pages render correctly with proper error messages and details
 * Validates Requirements: 3.2
 */

import { describe, it, expect } from 'vitest';
import ejs from 'ejs';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe('Error UI Integration Tests', () => {
  const errorTemplatePath = path.join(__dirname, 'views', 'error.ejs');
  const errorTemplate = fs.readFileSync(errorTemplatePath, 'utf8');

  it('should render error page with untrusted_op error', () => {
    // Test data for untrusted OP error
    const errorData = {
      error: 'untrusted_op',
      error_description: 'OP http://localhost:3001 is not registered in Trust Anchor',
      opEntityId: 'http://localhost:3001',
      errors: [
        {
          code: 'trust_chain_invalid',
          message: 'Trust chain does not terminate at configured trust anchor',
          details: {
            expectedTrustAnchor: 'https://trust-anchor.example.com',
            actualTermination: null
          }
        }
      ]
    };

    // Render the template
    const html = ejs.render(errorTemplate, errorData);

    // Verify error page contains key elements
    expect(html).toContain('Error Occurred');
    expect(html).toContain('untrusted_op');
    expect(html).toContain('OP Entity ID');
    expect(html).toContain('http://localhost:3001');
    expect(html).toContain('not registered in Trust Anchor');
    
    console.log('✓ Error page rendered with untrusted_op error');
  });

  it('should display error message with OP entity ID', () => {
    // Test that error messages include the OP entity ID
    const errorData = {
      error: 'untrusted_op',
      error_description: 'OP https://op.example.com is not registered in Trust Anchor',
      opEntityId: 'https://op.example.com',
      errors: []
    };

    const html = ejs.render(errorTemplate, errorData);

    // Verify OP entity ID is displayed
    expect(html).toContain('OP Entity ID');
    expect(html).toContain('https://op.example.com');
    
    // Verify error description is present
    expect(html).toContain('not registered in Trust Anchor');
    
    console.log('✓ Error message includes OP entity ID');
  });

  it('should display detailed validation failure reasons', () => {
    // Test that detailed error information is displayed
    const errorData = {
      error: 'untrusted_op',
      error_description: 'OP validation failed',
      opEntityId: 'https://op.example.com',
      errors: [
        {
          code: 'signature_verification_failed',
          message: 'JWT signature verification failed',
          details: {
            algorithm: 'RS256',
            reason: 'Invalid signature'
          }
        },
        {
          code: 'missing_authority_hints',
          message: 'Entity configuration does not contain authority_hints',
          details: null
        }
      ]
    };

    const html = ejs.render(errorTemplate, errorData);

    // Verify error details section exists
    expect(html).toContain('Validation Failure Reasons');
    
    // Verify specific error codes are displayed
    expect(html).toContain('signature_verification_failed');
    expect(html).toContain('JWT signature verification failed');
    expect(html).toContain('missing_authority_hints');
    expect(html).toContain('Entity configuration does not contain authority_hints');
    
    // Verify technical details are present
    expect(html).toContain('Show technical details');
    
    console.log('✓ Error details section displays validation failure reasons');
  });

  it('should render error page without errors array', () => {
    // Test that error page renders correctly even without detailed errors
    const errorData = {
      error: 'validation_error',
      error_description: 'Failed to validate OP trust chain'
    };

    const html = ejs.render(errorTemplate, errorData);

    // Verify basic error information is displayed
    expect(html).toContain('Error Occurred');
    expect(html).toContain('validation_error');
    expect(html).toContain('Failed to validate OP trust chain');
    
    // Verify page doesn't break without errors array
    expect(html).not.toContain('undefined');
    
    console.log('✓ Error page renders without errors array');
  });

  it('should display troubleshooting information for untrusted_op', () => {
    // Test that troubleshooting section is displayed for untrusted OP errors
    const errorData = {
      error: 'untrusted_op',
      error_description: 'OP is not trusted',
      opEntityId: 'https://op.example.com',
      errors: []
    };

    const html = ejs.render(errorTemplate, errorData);

    // Verify troubleshooting section exists
    expect(html).toContain('Troubleshooting');
    expect(html).toContain('Verify the OP is registered');
    expect(html).toContain('openid_provider');
    expect(html).toContain('authority_hints');
    
    console.log('✓ Troubleshooting information displayed');
  });

  it('should include navigation buttons', () => {
    // Test that navigation buttons are present
    const errorData = {
      error: 'untrusted_op',
      error_description: 'OP is not trusted',
      opEntityId: 'https://op.example.com',
      errors: []
    };

    const html = ejs.render(errorTemplate, errorData);

    // Verify navigation buttons exist
    expect(html).toContain('Back to Home');
    expect(html).toContain('Test Registration Again');
    expect(html).toContain('href="/"');
    expect(html).toContain('href="/test-registration"');
    
    console.log('✓ Navigation buttons present');
  });
});

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Multi-OP Credentials Manager
 * 
 * Manages client credentials for multiple OPs with persistent storage.
 * Credentials are stored in .op-credentials.json file.
 */
class MultiOPCredentialsManager {
  constructor(options = {}) {
    this.rpEntityId = options.rpEntityId || 'https://localhost:3006';
    this.credentialsFile = options.credentialsFile || 
      path.join(__dirname, '..', '.op-credentials.json');
    
    // In-memory cache
    this.credentials = {
      rpEntityId: this.rpEntityId,
      ops: {}
    };

    // Load credentials from disk
    this._loadCredentials();

    console.log('MultiOPCredentialsManager initialized', {
      rpEntityId: this.rpEntityId,
      credentialsFile: this.credentialsFile,
      registeredOPs: Object.keys(this.credentials.ops).length
    });
  }

  /**
   * Store credentials for an OP
   * @param {string} opEntityId - OP's entity ID
   * @param {string} clientSecret - Client secret from registration
   */
  storeCredentials(opEntityId, clientSecret) {
    console.log('Storing credentials for OP', { opEntityId });

    this.credentials.ops[opEntityId] = {
      clientSecret: clientSecret,
      registeredAt: new Date().toISOString()
    };

    this._saveCredentials();

    console.log('Credentials stored successfully', {
      opEntityId,
      registeredAt: this.credentials.ops[opEntityId].registeredAt
    });
  }

  /**
   * Retrieve credentials for an OP
   * @param {string} opEntityId - OP's entity ID
   * @returns {Object|null} Credentials or null if not found
   */
  getCredentials(opEntityId) {
    const opCreds = this.credentials.ops[opEntityId];

    if (!opCreds) {
      console.log('No credentials found for OP', { opEntityId });
      return null;
    }

    return {
      opEntityId: opEntityId,
      clientSecret: opCreds.clientSecret,
      registeredAt: opCreds.registeredAt,
      rpEntityId: this.rpEntityId
    };
  }

  /**
   * Check if credentials exist for an OP
   * @param {string} opEntityId - OP's entity ID
   * @returns {boolean} True if credentials exist
   */
  hasCredentials(opEntityId) {
    return !!this.credentials.ops[opEntityId];
  }

  /**
   * Clear credentials for an OP
   * @param {string} opEntityId - OP's entity ID
   */
  clearCredentials(opEntityId) {
    if (this.credentials.ops[opEntityId]) {
      delete this.credentials.ops[opEntityId];
      this._saveCredentials();
      console.log('Credentials cleared for OP', { opEntityId });
    } else {
      console.log('No credentials to clear for OP', { opEntityId });
    }
  }

  /**
   * Clear all credentials for all OPs
   */
  clearAll() {
    console.log('Clearing all OP credentials', {
      opsCount: Object.keys(this.credentials.ops).length
    });
    
    this.credentials.ops = {};
    this._saveCredentials();
    
    console.log('All OP credentials cleared');
  }

  /**
   * Get all registered OPs
   * @returns {string[]} Array of OP entity IDs
   */
  getRegisteredOPs() {
    return Object.keys(this.credentials.ops);
  }

  /**
   * Get credentials statistics
   * @returns {Object} Statistics about stored credentials
   */
  getStats() {
    return {
      rpEntityId: this.rpEntityId,
      totalOPs: Object.keys(this.credentials.ops).length,
      ops: Object.keys(this.credentials.ops)
    };
  }

  /**
   * Load credentials from disk
   * @private
   */
  _loadCredentials() {
    try {
      if (fs.existsSync(this.credentialsFile)) {
        const data = fs.readFileSync(this.credentialsFile, 'utf8');
        const loaded = JSON.parse(data);

        // Verify RP entity ID matches
        if (loaded.rpEntityId === this.rpEntityId) {
          this.credentials = loaded;
          console.log('Loaded credentials from disk', {
            rpEntityId: loaded.rpEntityId,
            opsCount: Object.keys(loaded.ops || {}).length
          });
        } else {
          console.log('Credentials file has different RP entity ID, starting fresh', {
            fileRpEntityId: loaded.rpEntityId,
            currentRpEntityId: this.rpEntityId
          });
        }
      } else {
        console.log('No credentials file found, starting fresh');
      }
    } catch (error) {
      console.error('Failed to load credentials from disk', {
        error: error.message,
        file: this.credentialsFile
      });
    }
  }

  /**
   * Save credentials to disk
   * @private
   */
  _saveCredentials() {
    try {
      const data = JSON.stringify(this.credentials, null, 2);
      fs.writeFileSync(this.credentialsFile, data, 'utf8');
      console.log('Credentials saved to disk', {
        file: this.credentialsFile,
        opsCount: Object.keys(this.credentials.ops).length
      });
    } catch (error) {
      console.error('Failed to save credentials to disk', {
        error: error.message,
        file: this.credentialsFile
      });
      throw new Error(`CREDENTIALS_STORAGE_FAILED: ${error.message}`);
    }
  }

  /**
   * Migrate from old single-OP credentials format
   * @param {string} oldCredentialsFile - Path to old credentials file
   * @returns {boolean} True if migration was performed
   */
  migrateFromOldFormat(oldCredentialsFile) {
    try {
      if (!fs.existsSync(oldCredentialsFile)) {
        console.log('No old credentials file to migrate');
        return false;
      }

      const data = fs.readFileSync(oldCredentialsFile, 'utf8');
      const oldCreds = JSON.parse(data);

      // Check if it's the old format (has entityId and clientSecret at root level)
      if (oldCreds.entityId && oldCreds.clientSecret && !oldCreds.ops) {
        console.log('Migrating from old credentials format', {
          oldFormat: 'single-OP',
          rpEntityId: oldCreds.entityId
        });

        // Determine OP entity ID from environment or use default
        const opEntityId = process.env.AUTHORIZATION_SERVER || 'https://op.diddc.site';

        // Store in new format
        this.storeCredentials(opEntityId, oldCreds.clientSecret);

        console.log('Migration completed', {
          opEntityId,
          registeredAt: oldCreds.registeredAt
        });

        return true;
      }

      console.log('Old credentials file is not in expected format, skipping migration');
      return false;

    } catch (error) {
      console.error('Failed to migrate old credentials', {
        error: error.message,
        file: oldCredentialsFile
      });
      return false;
    }
  }
}

export { MultiOPCredentialsManager };

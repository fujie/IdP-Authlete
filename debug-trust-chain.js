// Debug script to decode trust chain JWTs
const axios = require('axios');
const https = require('https');

const RP_ENTITY_ID = 'https://rp1.diddc.site';
const TA_ENTITY_ID = 'https://ta.diddc.site';

// Base64URL decode
function base64UrlDecode(str) {
  const padding = '='.repeat((4 - (str.length % 4)) % 4);
  const base64 = str.replace(/-/g, '+').replace(/_/g, '/') + padding;
  return Buffer.from(base64, 'base64').toString('utf-8');
}

// Decode JWT
function decodeJWT(jwt) {
  const parts = jwt.split('.');
  if (parts.length !== 3) {
    throw new Error('Invalid JWT format');
  }
  
  const header = JSON.parse(base64UrlDecode(parts[0]));
  const payload = JSON.parse(base64UrlDecode(parts[1]));
  
  return { header, payload };
}

async function fetchAndDecodeEntityConfiguration(entityId) {
  try {
    const url = `${entityId}/.well-known/openid-federation`;
    console.log(`\nFetching: ${url}`);
    
    const response = await axios.get(url, {
      headers: { 'Accept': 'application/entity-statement+jwt' },
      httpsAgent: new https.Agent({ rejectUnauthorized: false })
    });
    
    const jwt = response.data;
    const decoded = decodeJWT(jwt);
    
    console.log('\n=== JWT Header ===');
    console.log(JSON.stringify(decoded.header, null, 2));
    
    console.log('\n=== JWT Payload ===');
    console.log(JSON.stringify(decoded.payload, null, 2));
    
    return { jwt, decoded };
  } catch (error) {
    console.error(`Error fetching ${entityId}:`, error.message);
    throw error;
  }
}

async function fetchTrustAnchorEntityStatement(sub) {
  try {
    const url = `${TA_ENTITY_ID}/federation/fetch?sub=${encodeURIComponent(sub)}`;
    console.log(`\nFetching: ${url}`);
    
    const response = await axios.get(url, {
      headers: { 'Accept': 'application/entity-statement+jwt' },
      httpsAgent: new https.Agent({ rejectUnauthorized: false })
    });
    
    const jwt = response.data;
    const decoded = decodeJWT(jwt);
    
    console.log('\n=== JWT Header ===');
    console.log(JSON.stringify(decoded.header, null, 2));
    
    console.log('\n=== JWT Payload ===');
    console.log(JSON.stringify(decoded.payload, null, 2));
    
    return { jwt, decoded };
  } catch (error) {
    console.error(`Error fetching TA statement for ${sub}:`, error.message);
    throw error;
  }
}

async function main() {
  console.log('========================================');
  console.log('Trust Chain Debug Tool');
  console.log('========================================');
  
  // 1. Fetch RP Entity Configuration
  console.log('\n\n1. RP Entity Configuration');
  console.log('========================================');
  const rpConfig = await fetchAndDecodeEntityConfiguration(RP_ENTITY_ID);
  
  // 2. Fetch Trust Anchor Entity Statement for RP
  console.log('\n\n2. Trust Anchor Entity Statement for RP');
  console.log('========================================');
  const taStatement = await fetchTrustAnchorEntityStatement(RP_ENTITY_ID);
  
  // 3. Show what would be sent to Authlete
  console.log('\n\n3. Trust Chain to be sent to Authlete');
  console.log('========================================');
  console.log('Array of 2 JWTs:');
  console.log('  [0] RP Entity Configuration (iss=sub=rp1.diddc.site)');
  console.log('  [1] TA Entity Statement (iss=ta.diddc.site, sub=rp1.diddc.site)');
  
  const trustChain = [rpConfig.jwt, taStatement.jwt];
  console.log('\nTrust Chain Length:', trustChain.length);
  console.log('\nJWT[0] (first 100 chars):', trustChain[0].substring(0, 100) + '...');
  console.log('JWT[1] (first 100 chars):', trustChain[1].substring(0, 100) + '...');
  
  // 4. Verify the chain structure
  console.log('\n\n4. Chain Verification');
  console.log('========================================');
  console.log('JWT[0] iss:', rpConfig.decoded.payload.iss);
  console.log('JWT[0] sub:', rpConfig.decoded.payload.sub);
  console.log('JWT[0] has jwks:', !!rpConfig.decoded.payload.jwks);
  console.log('JWT[0] has metadata:', !!rpConfig.decoded.payload.metadata);
  console.log('JWT[0] has authority_hints:', !!rpConfig.decoded.payload.authority_hints);
  
  console.log('\nJWT[1] iss:', taStatement.decoded.payload.iss);
  console.log('JWT[1] sub:', taStatement.decoded.payload.sub);
  console.log('JWT[1] has jwks:', !!taStatement.decoded.payload.jwks);
  console.log('JWT[1] has metadata:', !!taStatement.decoded.payload.metadata);
  
  // Check if chain is valid
  const isValidChain = 
    rpConfig.decoded.payload.iss === rpConfig.decoded.payload.sub &&
    rpConfig.decoded.payload.iss === RP_ENTITY_ID &&
    taStatement.decoded.payload.iss === TA_ENTITY_ID &&
    taStatement.decoded.payload.sub === RP_ENTITY_ID;
  
  console.log('\nChain structure valid:', isValidChain);
  
  if (!isValidChain) {
    console.log('\n⚠️  WARNING: Chain structure is invalid!');
  }
}

main().catch(console.error);

import { SCOPES } from './core';

/** Documentos de descubrimiento (RFC 9728 y RFC 8414) que leen Claude, ChatGPT y otros clientes MCP. */
export function protectedResourceMetadata(origin: string) {
  return {
    resource: `${origin}/api/v1/mcp`,
    authorization_servers: [origin],
    scopes_supported: Object.keys(SCOPES),
    bearer_methods_supported: ['header'],
    resource_name: 'GastroBar',
  };
}

export function authorizationServerMetadata(origin: string) {
  return {
    issuer: origin,
    authorization_endpoint: `${origin}/oauth/authorize`,
    token_endpoint: `${origin}/api/oauth/token`,
    registration_endpoint: `${origin}/api/oauth/register`,
    revocation_endpoint: `${origin}/api/oauth/revoke`,
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code', 'refresh_token'],
    code_challenge_methods_supported: ['S256'],
    token_endpoint_auth_methods_supported: ['none', 'client_secret_post', 'client_secret_basic'],
    revocation_endpoint_auth_methods_supported: ['none', 'client_secret_post', 'client_secret_basic'],
    scopes_supported: Object.keys(SCOPES),
  };
}

export const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type, MCP-Protocol-Version',
};

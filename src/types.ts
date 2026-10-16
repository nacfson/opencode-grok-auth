export interface XaiDiscovery {
  authorizationEndpoint: string;
  tokenEndpoint: string;
}

export interface XaiTokenPayload {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  idToken?: string;
  tokenType: string;
}

import { createRemoteJWKSet, jwtVerify, errors } from 'jose';
import { z } from 'zod';
const keys = createRemoteJWKSet(new URL('https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com'));
const claims = z.object({sub:z.string().min(1).max(128),email:z.email(),email_verified:z.literal(true),
 auth_time:z.number().int().positive(),iat:z.number().int().positive(),name:z.string().optional(),
 firebase:z.object({sign_in_provider:z.literal('google.com')})});
export class InvalidGoogleIdentity extends Error {}
export async function verifyGoogleIdentity(token:string, project:string) {
 try {
 const {payload}=await jwtVerify(token,keys,{algorithms:['RS256'],audience:project,
  issuer:`https://securetoken.google.com/${project}`,requiredClaims:['sub','exp','iat','auth_time']});
 const identity=claims.parse(payload), now=Math.floor(Date.now()/1000);
 if(identity.auth_time>now+60 || identity.iat>now+60 || now-identity.auth_time>300) throw new InvalidGoogleIdentity('FRESH_LOGIN_REQUIRED');
 return identity;
 } catch(error) {
  if(error instanceof z.ZodError || error instanceof errors.JWTExpired || error instanceof errors.JWTClaimValidationFailed || error instanceof errors.JWSSignatureVerificationFailed || error instanceof errors.JWSInvalid || error instanceof errors.JWTInvalid || error instanceof errors.JOSEAlgNotAllowed)throw new InvalidGoogleIdentity('INVALID_GOOGLE_IDENTITY');
  throw error;
 }
}

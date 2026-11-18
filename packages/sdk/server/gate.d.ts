export interface GateSettings {
 readonly clientId:string;
 readonly siteUrl:string;
 readonly authOrigin:string;
 readonly accessPolicy:'member'|'guest'|'admin';
 readonly provider?:'firebase';
 /** Request-driven authorization refresh; 1 second to 1 hour. Default: five minutes. */
 readonly authorizationLeaseMs?:number;
 /** Cannot exceed the centrally issued token expiration. Default: seven days. */
 readonly sessionMaxAgeSeconds?:number;
}
export interface GateIdentity {
 readonly id:string;
 readonly displayName:string;
 readonly membershipAdmin:boolean;
 readonly serviceDeveloper:boolean;
}
export interface GateHost {
 /** Optional trusted server transport, e.g. a Cloudflare service binding. */
 readonly fetchAuth?:(input:RequestInfo|URL,init?:RequestInit)=>Promise<Response>;
 readonly sessionSecret:string;
 readonly serveAsset:(request:Request,identity:GateIdentity)=>Promise<Response>;
}
export function createGate(settings:GateSettings):(request:Request,host:GateHost)=>Promise<Response>;
export const RUNTIME_VERSION:string;
export const COOKIE:string;
export const AUTHORIZATION_LEASE_MS:number;

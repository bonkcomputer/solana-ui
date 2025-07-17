import { proxyService } from './proxyService';

/**
 * Enhanced fetch that automatically uses proxy when VPN is enabled
 * This wraps the global fetch to route through proxy service
 */
export const fetchWithProxy = async (url: string, options?: RequestInit): Promise<Response> => {
  // Use the proxy service's fetch method which handles proxy logic
  return proxyService.fetch(url, options);
};

/**
 * Override global fetch to use proxy when enabled
 * Call this once at app initialization
 */
export const initializeProxyFetch = () => {
  // Check if already initialized to prevent double initialization
  if ((window as any).__proxyFetchInitialized) {
    return () => {}; // Return no-op cleanup function
  }
  
  // Store original fetch
  const originalFetch = window.fetch;
  
  // Override global fetch
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    // Handle different input types
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    
    // For Request objects, merge with init options
    if (input instanceof Request) {
      const requestInit: RequestInit = {
        method: input.method,
        headers: input.headers,
        body: input.body,
        mode: input.mode,
        credentials: input.credentials,
        cache: input.cache,
        redirect: input.redirect,
        referrer: input.referrer,
        referrerPolicy: input.referrerPolicy,
        integrity: input.integrity,
        keepalive: input.keepalive,
        signal: input.signal,
        ...init // Allow init to override
      };
      return proxyService.fetch(url, requestInit);
    }
    
    // For string/URL inputs
    return proxyService.fetch(url, init);
  };
  
  // Mark as initialized
  (window as any).__proxyFetchInitialized = true;
  
  // Return function to restore original fetch if needed
  return () => {
    window.fetch = originalFetch;
    (window as any).__proxyFetchInitialized = false;
  };
}; 
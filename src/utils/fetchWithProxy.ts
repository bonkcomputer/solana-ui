import { proxyService } from './proxyService';

// Default timeout for API requests (30 seconds)
const DEFAULT_TIMEOUT = 30000;

/**
 * Creates an AbortController with timeout functionality
 */
export const createTimeoutController = (timeoutMs: number = DEFAULT_TIMEOUT): { controller: AbortController; timeoutId: NodeJS.Timeout } => {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => {
    controller.abort();
  }, timeoutMs);
  
  return { controller, timeoutId };
};

/**
 * Standardized error response parsing
 */
export const parseApiResponse = async (response: Response): Promise<any> => {
  if (!response.ok) {
    throw new Error(`HTTP error! Status: ${response.status}`);
  }
  
  const data = await response.json();
  
  // Check for API-level errors
  if (data.error) {
    throw new Error(data.error.message || data.error || 'API error occurred');
  }
  
  if (data.success === false) {
    throw new Error(data.error || 'Operation failed');
  }
  
  return data;
};

/**
 * Standardized transaction response parsing
 * Handles different response formats: bundles, transactions, or plain arrays
 */
export const parseTransactionResponse = (data: any): string[] => {
  // Handle different response formats
  if (data.bundles && Array.isArray(data.bundles)) {
    // Flatten all bundles into a single array of transactions
    return data.bundles.flatMap((bundle: any) => 
      Array.isArray(bundle) ? bundle : bundle.transactions || []
    );
  } else if (data.transactions && Array.isArray(data.transactions)) {
    return data.transactions;
  } else if (Array.isArray(data)) {
    return data;
  } else {
    throw new Error('No transactions returned from API');
  }
};

/**
 * Standardized bundle response parsing
 * Handles different bundle response formats
 */
export const parseBundleResponse = (data: any): any[] => {
  if (data.bundles && Array.isArray(data.bundles)) {
    // Ensure each bundle is an object with a transactions property
    return data.bundles.map((bundle: any) =>
      Array.isArray(bundle) ? { transactions: bundle } : bundle
    );
  } else if (data.transactions && Array.isArray(data.transactions)) {
    return [{ transactions: data.transactions }];
  } else if (Array.isArray(data)) {
    return [{ transactions: data }];
  } else {
    throw new Error('No bundles returned from API');
  }
};

/**
 * Enhanced fetch that automatically uses proxy when VPN is enabled
 * This wraps the global fetch to route through proxy service
 */
export const fetchWithProxy = async (url: string, options?: RequestInit): Promise<Response> => {
  // Use the proxy service's fetch method which handles proxy logic
  return proxyService.fetch(url, options);
};

/**
 * Enhanced fetch with timeout support
 */
export const fetchWithTimeout = async (
  url: string, 
  options?: RequestInit, 
  timeoutMs: number = DEFAULT_TIMEOUT
): Promise<Response> => {
  const { controller, timeoutId } = createTimeoutController(timeoutMs);
  
  try {
    const response = await proxyService.fetch(url, {
      ...options,
      signal: options?.signal || controller.signal,
    });
    
    clearTimeout(timeoutId);
    return response;
  } catch (error) {
    clearTimeout(timeoutId);
    
    // Check if the error is due to timeout
    if (error.name === 'AbortError') {
      throw new Error(`Request timeout after ${timeoutMs}ms`);
    }
    
    throw error;
  }
};

/**
 * Enhanced fetch with timeout and standardized response parsing
 */
export const fetchApiWithTimeout = async (
  url: string, 
  options?: RequestInit, 
  timeoutMs: number = DEFAULT_TIMEOUT
): Promise<any> => {
  const response = await fetchWithTimeout(url, options, timeoutMs);
  return parseApiResponse(response);
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
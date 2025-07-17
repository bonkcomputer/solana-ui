// Proxy service for VPN-like functionality
export class ProxyService {
  private static instance: ProxyService;
  private isEnabled: boolean = false;
  private proxyUrl: string = '';
  private originalFetch: typeof fetch;
  
  // List of public CORS proxies (for demo - in production use your own proxy)
  private readonly proxyEndpoints = [
    'https://corsproxy.io/?',
    'https://api.allorigins.win/raw?url=',
    'https://proxy.cors.sh/',
  ];
  
  private constructor() {
    // Store reference to original fetch before any modifications
    this.originalFetch = window.fetch.bind(window);
    
    // Load saved state from localStorage
    const savedState = localStorage.getItem('vpnProxyEnabled');
    this.isEnabled = savedState === 'true';
    this.proxyUrl = this.proxyEndpoints[0];
  }
  
  static getInstance(): ProxyService {
    if (!ProxyService.instance) {
      ProxyService.instance = new ProxyService();
    }
    return ProxyService.instance;
  }
  
  enable(): void {
    this.isEnabled = true;
    localStorage.setItem('vpnProxyEnabled', 'true');
  }
  
  disable(): void {
    this.isEnabled = false;
    localStorage.setItem('vpnProxyEnabled', 'false');
  }
  
  toggle(): boolean {
    if (this.isEnabled) {
      this.disable();
    } else {
      this.enable();
    }
    return this.isEnabled;
  }
  
  isActive(): boolean {
    return this.isEnabled;
  }
  
  // Wrap URL with proxy if enabled
  wrapUrl(url: string): string {
    if (!this.isEnabled || !this.shouldProxyUrl(url)) {
      return url;
    }
    
    // Encode the URL to handle special characters
    const encodedUrl = encodeURIComponent(url);
    return `${this.proxyUrl}${encodedUrl}`;
  }
  
  // Determine if URL should be proxied
  private shouldProxyUrl(url: string): boolean {
    // Don't proxy local URLs
    if (url.startsWith('http://localhost') || 
        url.startsWith('http://127.0.0.1') ||
        url.startsWith('/')) {
      return false;
    }
    
    // Don't proxy WebSocket connections
    if (url.startsWith('ws://') || url.startsWith('wss://')) {
      return false;
    }
    
    // Don't proxy data URLs or blob URLs
    if (url.startsWith('data:') || url.startsWith('blob:')) {
      return false;
    }
    
    // Only proxy HTTP/HTTPS URLs
    return url.startsWith('http://') || url.startsWith('https://');
  }
  
  // Enhanced fetch that uses proxy when enabled
  async fetch(url: string, options?: RequestInit): Promise<Response> {
    const proxiedUrl = this.wrapUrl(url);
    
    // Use original options without adding problematic headers
    const enhancedOptions: RequestInit = {
      ...options,
      headers: {
        ...options?.headers,
        // Removed X-Requested-With header that was causing CORS issues
      },
    };
    
    try {
      const response = await this.originalFetch(proxiedUrl, enhancedOptions);
      
      // If proxy fails, try direct connection as fallback
      if (!response.ok && this.isEnabled) {
        console.warn('Proxy request failed, trying direct connection...');
        return this.originalFetch(url, options);
      }
      
      return response;
    } catch (error) {
      // If proxy fails, try direct connection
      if (this.isEnabled) {
        console.warn('Proxy request failed, trying direct connection...');
        return this.originalFetch(url, options);
      }
      throw error;
    }
  }
  
  // Get current proxy status info
  getStatus(): { active: boolean; endpoint: string } {
    return {
      active: this.isEnabled,
      endpoint: this.isEnabled ? this.proxyUrl : 'Direct connection'
    };
  }
}

// Export singleton instance
export const proxyService = ProxyService.getInstance(); 
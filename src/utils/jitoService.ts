// JitoService.ts
import { fetchApiWithTimeout } from './fetchWithProxy';

/**
 * Service to send transactions to Jito Bundle Service via the server endpoint
 */

/**
 * Sends a signed transaction to the server's /api/transactions/send endpoint
 * which then forwards it to the Jito bundle service
 * @param serializedTransaction - bs58-encoded serialized transaction
 * @returns Result from the bundle service
 */
export const sendToJitoBundleService = async (serializedTransaction: string) => {
  try {
    // Get the server base URL
    const baseUrl = (window as any).tradingServerUrl?.replace(/\/+$/, '') || "";
    const sendBundleEndpoint = `${baseUrl}/api/transactions/send`;
    
    // Create the request payload - this matches what the server endpoint expects
    const payload = {
      transactions: [serializedTransaction] // Server expects an array of transactions
    };
    
    // Send request to our server endpoint (not directly to Jito) with timeout
    const result = await fetchApiWithTimeout(sendBundleEndpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    }, 15000); // 15 second timeout for transaction sending
    
    return result.result;
  } catch (error) {
    console.error('Error sending transaction bundle:', error);
    throw error;
  }
};
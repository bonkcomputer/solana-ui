import { Connection, Keypair, VersionedTransaction } from '@solana/web3.js';
import bs58 from 'bs58';
import { loadConfigFromCookies } from '../Utils';
import { fetchApiWithTimeout, parseBundleResponse, fetchWithTimeout } from './fetchWithProxy';

// Constants
const MAX_BUNDLES_PER_SECOND = 2;

// Rate limiting state
const rateLimitState = {
  count: 0,
  lastReset: Date.now(),
  maxBundlesPerSecond: MAX_BUNDLES_PER_SECOND
};

// Interfaces
interface WalletMoonBuy {
  address: string;
  privateKey: string;
}

interface TokenConfig {
  tokenAddress: string;
  solAmount: number;
}

export interface MoonBuyBundle {
  transactions: string[]; // Base58 encoded transaction data
}

// Define interface for bundle result from sending
interface BundleResult {
  jsonrpc: string;
  id: number;
  result?: string;
  error?: {
    code: number;
    message: string;
  };
}

/**
 * Check rate limit and wait if necessary
 */
const checkRateLimit = async (): Promise<void> => {
  const now = Date.now();
  
  if (now - rateLimitState.lastReset >= 1000) {
    rateLimitState.count = 0;
    rateLimitState.lastReset = now;
  }
  
  if (rateLimitState.count >= rateLimitState.maxBundlesPerSecond) {
    const waitTime = 1000 - (now - rateLimitState.lastReset);
    await new Promise(resolve => setTimeout(resolve, waitTime));
    rateLimitState.count = 0;
    rateLimitState.lastReset = Date.now();
  }
  
  rateLimitState.count++;
};

/**
 * Send bundle to Jito block engine through our backend proxy
 */
const sendBundle = async (encodedBundle: string[]): Promise<BundleResult> => {
  try {
    const baseUrl = (window as any).tradingServerUrl?.replace(/\/+$/, '') || '';
    
    const response = await fetchWithTimeout(`${baseUrl}/api/transactions/send`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        transactions: encodedBundle
      }),
    }, 15000); // 15 second timeout for transaction sending

    const data = await response.json();
    
    if (data.error) {
      throw new Error(data.error.message || data.error || 'Unknown error from bundle server');
    }
    
    return data.result;
  } catch (error) {
    console.error('Error sending bundle:', error);
    throw error;
  }
};

/**
 * Get partially prepared moon buy transactions from backend
 */
const getPartiallyPreparedTransactions = async (
  walletAddresses: string[], 
  tokenConfig: TokenConfig,
  amounts?: number[]
): Promise<MoonBuyBundle[]> => {
  try {
    const baseUrl = (window as any).tradingServerUrl?.replace(/\/+$/, '') || '';
    
    const config = loadConfigFromCookies();
    // Get fee in SOL (string) with default if not found
    const feeInSol = config?.transactionFee || '0.005';
    const feeInLamports = Math.floor(parseFloat(feeInSol) * 1_000_000_000);
    
    const data = await fetchApiWithTimeout(`${baseUrl}/api/tokens/buy`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': config?.apiKey || '' 
      },
      body: JSON.stringify({
        walletAddresses,
        tokenAddress: tokenConfig.tokenAddress,
        protocol: "moonshot",
        solAmount: tokenConfig.solAmount,
        amounts: amounts, // Optional custom amounts per wallet
        jitoTipLamports: feeInLamports  // Now a number in lamports
      }),
    }, 20000); // 20 second timeout for buy transaction preparation
    
    return parseBundleResponse(data);
  } catch (error) {
    console.error('Error getting partially prepared transactions:', error);
    throw error;
  }
};

const completeBundleSigning = (
  bundle: MoonBuyBundle, 
  walletKeypairs: Keypair[]
): MoonBuyBundle => {
  // Check if the bundle has a valid transactions array
  if (!bundle.transactions || !Array.isArray(bundle.transactions)) {
    console.error("Invalid bundle format, transactions property is missing or not an array:", bundle);
    return { transactions: [] };
  }

  const signedTransactions = bundle.transactions.map(txBase58 => {
    // Deserialize transaction
    const txBuffer = bs58.decode(txBase58);
    const transaction = VersionedTransaction.deserialize(txBuffer);
    
    // Extract required signers from staticAccountKeys
    const signers: Keypair[] = [];
    for (const accountKey of transaction.message.staticAccountKeys) {
      const pubkeyStr = accountKey.toBase58();
      const matchingKeypair = walletKeypairs.find(
        kp => kp.publicKey.toBase58() === pubkeyStr
      );
      if (matchingKeypair && !signers.includes(matchingKeypair)) {
        signers.push(matchingKeypair);
      }
    }
    
    // Sign the transaction
    transaction.sign(signers);
    
    // Serialize and encode the fully signed transaction
    return bs58.encode(transaction.serialize());
  });
  return { transactions: signedTransactions };
};

/**
 * Execute moon buy operation
 */
export const executeMoonBuy = async (
  wallets: WalletMoonBuy[],
  tokenConfig: TokenConfig,
  customAmounts?: number[]
): Promise<{ success: boolean; result?: any; error?: string }> => {
  try {
    console.log(`Preparing to moon buy ${tokenConfig.tokenAddress} using ${wallets.length} wallets`);
    
    // Extract wallet addresses
    const walletAddresses = wallets.map(wallet => wallet.address);
    
    // Step 1: Get partially prepared transactions (bundles) from backend
    const partiallyPreparedBundles = await getPartiallyPreparedTransactions(
      walletAddresses,
      tokenConfig,
      customAmounts
    );
    console.log(`Received ${partiallyPreparedBundles.length} bundles from backend`);
    
    // Step 2: Create keypairs from private keys
    const walletKeypairs = wallets.map(wallet => 
      Keypair.fromSecretKey(bs58.decode(wallet.privateKey))
    );
    
    // Step 3: Complete transaction signing for each bundle
    const signedBundles = partiallyPreparedBundles.map(bundle =>
      completeBundleSigning(bundle, walletKeypairs)
    );
    console.log(`Completed signing for ${signedBundles.length} bundles`);
    
    // Step 4: Send each bundle with rate limiting and delay between bundles
    let results: BundleResult[] = [];
    for (let i = 0; i < signedBundles.length; i++) {
      const bundle = signedBundles[i];
      console.log(`Sending bundle ${i + 1}/${signedBundles.length} with ${bundle.transactions.length} transactions`);
      
      await checkRateLimit();
      const result = await sendBundle(bundle.transactions);
      results.push(result);
      
      // Add delay between bundles (except after the last one)
      if (i < signedBundles.length - 1) {
        await new Promise(resolve => setTimeout(resolve, 500)); // 500ms delay
      }
    }
    
    return {
      success: true,
      result: results
    };
  } catch (error) {
    console.error('Moon buy error:', error);
    return {
      success: false,
      error: error.message
    };
  }
};

/**
 * Validate moon buy inputs
 */
export const validateMoonBuyInputs = (
  wallets: WalletMoonBuy[],
  tokenConfig: TokenConfig,
  walletBalances: Map<string, number>
): { valid: boolean; error?: string } => {
  // Check if token config is valid
  if (!tokenConfig.tokenAddress) {
    return { valid: false, error: 'Invalid token address' };
  }
  
  if (isNaN(tokenConfig.solAmount) || tokenConfig.solAmount <= 0) {
    return { valid: false, error: 'Invalid SOL amount' };
  }
  
  // Check if wallets are valid
  if (!wallets.length) {
    return { valid: false, error: 'No wallets provided' };
  }
  
  for (const wallet of wallets) {
    if (!wallet.address || !wallet.privateKey) {
      return { valid: false, error: 'Invalid wallet data' };
    }
    
    const balance = walletBalances.get(wallet.address) || 0;
    if (balance < tokenConfig.solAmount) {
      return { valid: false, error: `Wallet ${wallet.address.substring(0, 6)}... has insufficient balance` };
    }
  }
  
  return { valid: true };
};

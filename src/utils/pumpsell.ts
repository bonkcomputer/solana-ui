import { Connection, PublicKey, Keypair, VersionedTransaction } from '@solana/web3.js';
import bs58 from 'bs58';
import { loadConfigFromCookies, WalletType } from '../Utils';

// Constants
const MAX_BUNDLES_PER_SECOND = 2;
const MAX_TRANSACTIONS_PER_BUNDLE = 5; // Added constant for max transactions per bundle

// Rate limiting state
const rateLimitState = {
  count: 0,
  lastReset: Date.now(),
  maxBundlesPerSecond: MAX_BUNDLES_PER_SECOND
};

// Interfaces
interface WalletPumpSell {
  address: string;
  privateKey: string;
}

interface TokenSellConfig {
  tokenAddress: string;
  sellPercent: number; // Percentage of tokens to sell (1-100)
}

export interface PumpSellBundle {
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
 * Split bundles to ensure each has at most MAX_TRANSACTIONS_PER_BUNDLE transactions
 */
const splitBundlesIntoMaxSize = (bundles: PumpSellBundle[]): PumpSellBundle[] => {
  const result: PumpSellBundle[] = [];
  
  for (const bundle of bundles) {
    if (!bundle.transactions || !Array.isArray(bundle.transactions)) {
      continue; // Skip invalid bundles
    }
    
    if (bundle.transactions.length <= MAX_TRANSACTIONS_PER_BUNDLE) {
      // If the bundle is already small enough, keep it as is
      result.push(bundle);
    } else {
      // Split the bundle into smaller ones
      for (let i = 0; i < bundle.transactions.length; i += MAX_TRANSACTIONS_PER_BUNDLE) {
        const chunkTransactions = bundle.transactions.slice(i, i + MAX_TRANSACTIONS_PER_BUNDLE);
        result.push({ transactions: chunkTransactions });
      }
    }
  }
  
  return result;
};

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
    
    // Send to our backend proxy instead of directly to Jito
    const response = await fetch(`${baseUrl}/api/transactions/send`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        transactions: encodedBundle
      }),
    });

    const data = await response.json();
    
    return data.result;
  } catch (error) {
    console.error('Error sending bundle:', error);
    throw error;
  }
};

/**
 * Get partially prepared pump sell transactions from backend
 * The backend will create transactions without signing them and group them into bundles
 */
const getPartiallyPreparedSellTransactions = async (
  walletAddresses: string[], 
  tokenConfig: TokenSellConfig
): Promise<PumpSellBundle[]> => {
  try {
    const baseUrl = (window as any).tradingServerUrl?.replace(/\/+$/, '') || '';
    

    const config = loadConfigFromCookies();
    // Get fee in SOL (string) with default if not found
    const feeInSol = config?.transactionFee || '0.005';
    const feeInLamports = Math.floor(parseFloat(feeInSol) * 1_000_000_000);
    const response = await fetch(`${baseUrl}/api/tokens/sell`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': config?.apiKey || '' 
      },
      body: JSON.stringify({
        walletAddresses,
        tokenAddress: tokenConfig.tokenAddress,
        protocol: "pumpfun",
        percentage: tokenConfig.sellPercent,
        jitoTipLamports: feeInLamports  // Now a number in lamports
      })
    });

    if (!response.ok) {
      throw new Error(`HTTP error! Status: ${response.status}`);
    }
    
    const data = await response.json();
    
    if (!data.success) {
      throw new Error(data.error || 'Failed to get partially prepared transactions');
    }
    
    // Handle different response formats to ensure compatibility
    if (data.bundles && Array.isArray(data.bundles)) {
      // Wrap any bundle that is a plain array
      return data.bundles.map((bundle: any) =>
        Array.isArray(bundle) ? { transactions: bundle } : bundle
      );
    } else if (data.transactions && Array.isArray(data.transactions)) {
      // If we get a flat array of transactions, create a single bundle
      return [{ transactions: data.transactions }];
    } else if (Array.isArray(data)) {
      // Legacy format where data itself is an array
      return [{ transactions: data }];
    } else {
      throw new Error('No transactions returned from backend');
    }
  } catch (error) {
    console.error('Error getting partially prepared sell transactions:', error);
    throw error;
  }
};

/**
 * Complete bundle signing
 */
const completeBundleSigning = (
  bundle: PumpSellBundle, 
  walletKeypairs: Keypair[]
): PumpSellBundle => {
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
 * Execute pump sell operation
 */
export const executePumpSell = async (
  wallets: WalletPumpSell[],
  tokenConfig: TokenSellConfig
): Promise<{ success: boolean; result?: any; error?: string }> => {
  try {
    console.log(`Preparing to pump sell ${tokenConfig.tokenAddress} using ${wallets.length} wallets, sell percentage: ${tokenConfig.sellPercent}%`);
    
    // Extract wallet addresses
    const walletAddresses = wallets.map(wallet => wallet.address);
    
    // Step 1: Get partially prepared bundles from backend
    const partiallyPreparedBundles = await getPartiallyPreparedSellTransactions(
      walletAddresses,
      tokenConfig
    );
    console.log(`Received ${partiallyPreparedBundles.length} bundles from backend`);
    
    // Step 2: Split bundles to ensure each has at most MAX_TRANSACTIONS_PER_BUNDLE transactions
    const splitBundles = splitBundlesIntoMaxSize(partiallyPreparedBundles);
    console.log(`Split into ${splitBundles.length} bundles with max ${MAX_TRANSACTIONS_PER_BUNDLE} transactions each`);
    
    // Step 3: Create keypairs from private keys
    const walletKeypairs = wallets.map(wallet => 
      Keypair.fromSecretKey(bs58.decode(wallet.privateKey))
    );
    
    // Step 4: Complete transaction signing for each bundle
    const signedBundles = splitBundles.map(bundle =>
      completeBundleSigning(bundle, walletKeypairs)
    );
    console.log(`Completed signing for ${signedBundles.length} bundles`);
    
    // Step 5: Send each bundle with rate limiting and delay between bundles
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
    console.error('Pump sell error:', error);
    return {
      success: false,
      error: error.message
    };
  }
};

/**
 * Validate pump sell inputs
 */
export const validatePumpSellInputs = (
  wallets: WalletPumpSell[],
  tokenConfig: TokenSellConfig,
  tokenBalances: Map<string, number>
): { valid: boolean; error?: string } => {
  // Check if token config is valid
  if (!tokenConfig.tokenAddress) {
    return { valid: false, error: 'Invalid token address' };
  }
  
  if (isNaN(tokenConfig.sellPercent) || tokenConfig.sellPercent <= 0 || tokenConfig.sellPercent > 100) {
    return { valid: false, error: 'Invalid sell percentage (must be between 1-100)' };
  }
  
  // Check if wallets are valid
  if (!wallets.length) {
    return { valid: false, error: 'No wallets provided' };
  }
  
  for (const wallet of wallets) {
    if (!wallet.address || !wallet.privateKey) {
      return { valid: false, error: 'Invalid wallet data' };
    }
    
    const balance = tokenBalances.get(wallet.address) || 0;
    if (balance <= 0) {
      return { valid: false, error: `Wallet ${wallet.address.substring(0, 6)}... has no tokens to sell` };
    }
  }
  
  return { valid: true };
};
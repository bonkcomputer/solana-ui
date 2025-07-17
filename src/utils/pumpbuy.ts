import { Connection, PublicKey, Keypair, VersionedTransaction } from '@solana/web3.js';
import bs58 from 'bs58';
import { loadConfigFromCookies, WalletType } from '../Utils';
import { fetchWithTimeout, parseApiResponse, parseTransactionResponse } from './fetchWithProxy';

// Constants
const MAX_BUNDLES_PER_SECOND = 2;
const MAX_TRANSACTIONS_PER_BUNDLE = 5; // New constant for max transactions per bundle

// Rate limiting state
const rateLimitState = {
  count: 0,
  lastReset: Date.now(),
  maxBundlesPerSecond: MAX_BUNDLES_PER_SECOND
};

// Interfaces
interface WalletPumpBuy {
  address: string;
  privateKey: string;
}

interface TokenConfig {
  tokenAddress: string;
  solAmount: number;
}

export interface PumpBuyBundle {
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
    
    // Send to our backend proxy instead of directly to Jito
    const response = await fetchWithTimeout(`${baseUrl}/api/transactions/send`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        transactions: encodedBundle
      }),
    }, 15000); // 15 second timeout for transaction sending

    const data = await response.json();
    
    return data.result;
  } catch (error) {
    console.error('Error sending bundle:', error);
    throw error;
  }
};

/**
 * Get partially prepared pump buy transactions from backend
 * The backend will create transactions without signing them and group them into bundles
 */
const getPartiallyPreparedTransactions = async (
  walletAddresses: string[], 
  tokenConfig: TokenConfig,
  amounts?: number[]
): Promise<PumpBuyBundle[]> => {
  try {
    const baseUrl = (window as any).tradingServerUrl?.replace(/\/+$/, '') || '';
    
    const config = loadConfigFromCookies();
    const feeInSol = config?.transactionFee || '0.005';
    const feeInLamports = Math.floor(parseFloat(feeInSol) * 1_000_000_000);
    const response = await fetchWithTimeout(`${baseUrl}/api/tokens/buy`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': config?.apiKey || '' 
      },
      body: JSON.stringify({
        walletAddresses,
        tokenAddress: tokenConfig.tokenAddress,
        solAmount: tokenConfig.solAmount,
        protocol: "pumpfun",
        amounts: amounts,
        jitoTipLamports: feeInLamports  
      }),
    }, 20000); // 20 second timeout for API calls

    const data = await parseApiResponse(response);
    
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
    console.error('Error getting partially prepared transactions:', error);
    throw error;
  }
};

/**
 * Complete bundle signing
 */
const completeBundleSigning = (
  bundle: PumpBuyBundle, 
  walletKeypairs: Keypair[]
): PumpBuyBundle => {
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
 * Split large bundles into smaller ones with maximum MAX_TRANSACTIONS_PER_BUNDLE transactions
 * Preserves the original order of transactions across the split bundles
 */
const splitLargeBundles = (bundles: PumpBuyBundle[]): PumpBuyBundle[] => {
  const result: PumpBuyBundle[] = [];
  
  for (const bundle of bundles) {
    if (!bundle.transactions || !Array.isArray(bundle.transactions)) {
      continue;
    }
    
    // If the bundle is small enough, just add it to the result
    if (bundle.transactions.length <= MAX_TRANSACTIONS_PER_BUNDLE) {
      result.push(bundle);
      continue;
    }
    
    // Split the large bundle into smaller ones while preserving transaction order
    for (let i = 0; i < bundle.transactions.length; i += MAX_TRANSACTIONS_PER_BUNDLE) {
      const chunkTransactions = bundle.transactions.slice(i, i + MAX_TRANSACTIONS_PER_BUNDLE);
      result.push({ transactions: chunkTransactions });
    }
  }
  
  return result;
};

/**
 * Execute pump buy operation
 */
export const executePumpBuy = async (
  wallets: WalletPumpBuy[],
  tokenConfig: TokenConfig,
  customAmounts?: number[]
): Promise<{ success: boolean; result?: any; error?: string }> => {
  try {
    console.log(`Preparing to pump buy ${tokenConfig.tokenAddress} using ${wallets.length} wallets`);
    
    // Extract wallet addresses
    const walletAddresses = wallets.map(wallet => wallet.address);
    
    // Step 1: Get partially prepared bundles from backend
    const partiallyPreparedBundles = await getPartiallyPreparedTransactions(
      walletAddresses,
      tokenConfig,
      customAmounts
    );
    console.log(`Received ${partiallyPreparedBundles.length} bundles from backend`);
    
    // Step 1.5: Split large bundles to ensure max transactions per bundle (preserves original transaction order)
    const splitBundles = splitLargeBundles(partiallyPreparedBundles);
    console.log(`Split into ${splitBundles.length} bundles with max ${MAX_TRANSACTIONS_PER_BUNDLE} transactions each (original order maintained)`);
    
    // Step 2: Create keypairs from private keys
    const walletKeypairs = wallets.map(wallet => 
      Keypair.fromSecretKey(bs58.decode(wallet.privateKey))
    );
    
    // Step 3: Complete transaction signing for each bundle
    const signedBundles = splitBundles.map(bundle =>
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
    console.error('Pump buy error:', error);
    return {
      success: false,
      error: error.message
    };
  }
};

/**
 * Validate pump buy inputs
 */
export const validatePumpBuyInputs = (
  wallets: WalletPumpBuy[],
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
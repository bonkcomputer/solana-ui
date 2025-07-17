import { Connection, PublicKey, Keypair, VersionedTransaction } from '@solana/web3.js';
import bs58 from 'bs58';
import { loadConfigFromCookies } from '../Utils';
import { fetchWithTimeout, parseApiResponse, parseTransactionResponse } from './fetchWithProxy';

// Constants

interface WalletJupSwap {
  address: string;
  privateKey: string;
}

interface SwapConfig {
  inputMint: string;  // Usually SOL = So11111111111111111111111111111111111111112
  outputMint: string; // Target token to buy
  solAmount: number;  // Amount of SOL to use per wallet
  slippageBps: number; // Slippage tolerance in basis points (e.g., 100 = 1%)
}

interface JupSwapBundle {
  transactions: string[]; // Base58 encoded transaction data
}

// Define interface for bundle result
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
 * Fetch Jupiter quote from the public Jupiter API.
 * This quote will later be sent to the backend.
 */
const getJupiterQuoteFromAPI = async (swapConfig: SwapConfig, solAmount: number): Promise<any> => {
  try {
    // Convert SOL amount to lamports
    const amountLamports = Math.floor(solAmount * 1e9).toString();
    // You can choose your preferred Jupiter endpoint here.
    const baseEndpoint = 'https://api.jup.ag/swap/v1';
    const endpoint = `${baseEndpoint}/quote?inputMint=${swapConfig.inputMint}&outputMint=${swapConfig.outputMint}&amount=${amountLamports}&slippageBps=${swapConfig.slippageBps}`;
    console.log("Fetching Jupiter quote from:", endpoint);
    const response = await fetchWithTimeout(endpoint, {
      headers: { 'Accept': 'application/json' },
    }, 20000); // 20 second timeout for API calls
    
    const quoteResponse = await parseApiResponse(response);
    return quoteResponse;
  } catch (error) {
    console.error('Error fetching Jupiter quote:', error);
    throw error;
  }
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
 * Get partially prepared Jupiter swap transactions from backend.
 * In this updated version, the frontend fetches a Jupiter quote and
 * includes it in the payload sent to the backend.
 */
const getPartiallyPreparedSwapTransactions = async (
  walletAddresses: string[], 
  swapConfig: SwapConfig,
  customAmounts?: number[]
): Promise<string[]> => {
  try {
    const baseUrl = (window as any).tradingServerUrl?.replace(/\/+$/, '') || '';
    
    const config = loadConfigFromCookies();
    // Get fee in SOL (string) with default if not found
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
        tokenAddress: swapConfig.outputMint,
        solAmount: swapConfig.solAmount,
        protocol: "auto",
        amounts: customAmounts, // Optional custom amounts per wallet
        jitoTipLamports: feeInLamports  // Now a number in lamports
      }),
    }, 20000); // 20 second timeout for API calls

    const data = await parseApiResponse(response);
    
    if (!data.success) {
      throw new Error(data.error || 'Failed to get partially prepared swap transactions');
    }
    
    return data.transactions; // Array of base58 encoded partially prepared transactions
  } catch (error) {
    console.error('Error getting partially prepared transactions:', error);
    throw error;
  }
};

/**
 * Complete transaction signing with wallets - improved with error handling
 */
const completeTransactionSigning = (
  partiallyPreparedTransactionsBase58: string[], 
  walletKeypairs: Keypair[]
): string[] => {
  try {
    return partiallyPreparedTransactionsBase58.map((txBase58, index) => {
      // Handle case where a transaction couldn't be prepared
      if (!txBase58) {
        console.warn(`Transaction at index ${index} is null or undefined`);
        return null;
      }

      try {
        // Deserialize transaction
        const txBuffer = bs58.decode(txBase58);
        const transaction = VersionedTransaction.deserialize(txBuffer);
        
        // Extract transaction message to determine required signers
        const message = transaction.message;
        const signers: Keypair[] = [];
        
        // Find the required signers for this transaction
        for (const accountKey of message.staticAccountKeys) {
          const pubkeyStr = accountKey.toBase58();
          const matchingKeypair = walletKeypairs.find(
            keypair => keypair.publicKey.toBase58() === pubkeyStr
          );
          
          if (matchingKeypair && !signers.includes(matchingKeypair)) {
            signers.push(matchingKeypair);
          }
        }
        
        if (signers.length === 0) {
          console.warn(`No matching signers found for transaction ${index}`);
          return null;
        }
        
        // Sign the transaction
        transaction.sign(signers);
        
        // Serialize and encode the fully signed transaction
        return bs58.encode(transaction.serialize());
      } catch (error) {
        console.error(`Error signing transaction at index ${index}:`, error);
        return null;
      }
    }).filter(tx => tx !== null); // Filter out any null transactions
  } catch (error) {
    console.error('Error completing transaction signing:', error);
    throw error;
  }
};

/**
 * Enhanced check for duplicate transactions in a bundle
 */
const checkForDuplicateInstructions = (transactions: VersionedTransaction[]): { hasDuplicates: boolean, duplicates: string[] } => {
  try {
    // Create a set of serialized instructions to check for duplicates
    const instructionSet = new Set<string>();
    const duplicates: string[] = [];
    
    for (const tx of transactions) {
      // Get all instructions from the transaction
      const instructions = tx.message.compiledInstructions;
      
      for (const instruction of instructions) {
        // Create a more comprehensive signature for this instruction
        // Use programIndex, accounts, and data to identify an instruction
        const programIndex = instruction.programIdIndex;
        const programId = tx.message.staticAccountKeys[programIndex].toBase58();
        const accountStr = instruction.accountKeyIndexes.map(idx => 
          tx.message.staticAccountKeys[idx].toBase58().slice(0, 8)
        ).join('-');
        
        const instructionKey = `${programId.slice(0, 8)}-${accountStr}-${instruction.data.slice(0, 10)}`;
        
        if (instructionSet.has(instructionKey)) {
          console.warn('Duplicate instruction detected:', instructionKey);
          duplicates.push(programId);
        }
        
        instructionSet.add(instructionKey);
      }
    }
    
    return { 
      hasDuplicates: duplicates.length > 0,
      duplicates
    };
  } catch (error) {
    console.error('Error checking for duplicate instructions:', error);
    return { hasDuplicates: false, duplicates: [] };
  }
};

/**
 * Prepare Jupiter swap bundles with improved duplicate instruction checking
 */
const prepareJupSwapBundles = (signedTransactions: string[]): JupSwapBundle[] => {
  const MAX_TXS_PER_BUNDLE = 5; // Jito typically allows up to 5 transactions per bundle
  const bundles: JupSwapBundle[] = [];
  
  // Deserialize transactions to check for duplicates
  const deserializedTransactions = signedTransactions
    .filter(txBase58 => txBase58) // Filter out any null/undefined transactions
    .map(txBase58 => VersionedTransaction.deserialize(bs58.decode(txBase58)));
  
  // Enhanced duplicate checking
  const { hasDuplicates, duplicates } = checkForDuplicateInstructions(deserializedTransactions);
  
  if (hasDuplicates) {
    console.warn('Duplicate instructions found in transactions:');
    duplicates.forEach(dup => console.warn(`- Program: ${dup}`));
    
    // Check if the duplicates are in the Associated Token Program (common issue with Jupiter)
    const hasATokenDuplicates = duplicates.some(dup => 
      dup.includes('AToken') || dup === 'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL'
    );
    
    if (hasATokenDuplicates) {
      console.warn('⚠️ Associated Token Program duplicates detected. This is a known issue with Jupiter swaps.');
      console.warn('These duplicates might be rejected by Jito. Consider reducing bundle size or trying again.');
    }
  }
  
  // Group transactions into bundles with MAX_TXS_PER_BUNDLE
  const validTransactions = signedTransactions.filter(tx => tx); // Filter out null/undefined
  
  for (let i = 0; i < validTransactions.length; i += MAX_TXS_PER_BUNDLE) {
    const bundleTransactions = validTransactions.slice(i, i + MAX_TXS_PER_BUNDLE);
    
    if (bundleTransactions.length > 0) {
      bundles.push({
        transactions: bundleTransactions
      });
    }
  }
  
  return bundles;
};

/**
 * Execute Jupiter swap operation for all wallets in one request.
 * This function processes all wallets at once without batching or rate limiting.
 */
export const executeJupSwap = async (
  wallets: WalletJupSwap[],
  swapConfig: SwapConfig,
  customAmounts?: number[]
): Promise<{ success: boolean; result?: any; error?: string }> => {
  try {
    console.log(`Preparing to swap ${swapConfig.inputMint} for ${swapConfig.outputMint} using ${wallets.length} wallets`);
    
    // Create wallet keypairs map for quick lookup
    const walletKeypairsMap = new Map<string, Keypair>();
    wallets.forEach(wallet => {
      walletKeypairsMap.set(
        wallet.address, 
        Keypair.fromSecretKey(bs58.decode(wallet.privateKey))
      );
    });
    
    // Extract all wallet addresses
    const walletAddresses = wallets.map(wallet => wallet.address);
    
    // Get partially prepared transactions from backend for all wallets at once
    const partiallyPreparedTransactions = await getPartiallyPreparedSwapTransactions(
      walletAddresses,
      swapConfig,
      customAmounts
    );
    
    console.log(`Received ${partiallyPreparedTransactions.length} prepared transactions from backend`);
    
    if (partiallyPreparedTransactions.length === 0) {
      return {
        success: false,
        error: 'No transactions returned from backend.'
      };
    }
    
    // Create keypairs array for all wallets
    const allKeypairs = wallets
      .map(wallet => walletKeypairsMap.get(wallet.address))
      .filter(keypair => keypair !== undefined) as Keypair[];
    
    // Sign all transactions
    const signedTransactions = completeTransactionSigning(
      partiallyPreparedTransactions,
      allKeypairs
    );
    
    if (signedTransactions.length === 0) {
      return {
        success: false,
        error: 'No transactions were successfully signed.'
      };
    }
    
    // Prepare bundles from all signed transactions
    const jupSwapBundles = prepareJupSwapBundles(signedTransactions);
    console.log(`Prepared ${jupSwapBundles.length} bundles with ${signedTransactions.length} total transactions`);
    
    // Send all bundles without rate limiting or delays
    const allResults: BundleResult[] = [];
    let successfulBundles = 0;
    let failedBundles = 0;
    
    // Send all bundles concurrently
    const bundlePromises = jupSwapBundles.map(async (bundle, bundleIndex) => {
      console.log(`Sending bundle ${bundleIndex + 1}/${jupSwapBundles.length} with ${bundle.transactions.length} transactions`);
      
      try {
        const result = await sendBundle(bundle.transactions);
        console.log(`Bundle ${bundleIndex + 1} sent successfully`);
        return { success: true, result };
      } catch (error) {
        console.error(`Error sending bundle ${bundleIndex + 1}:`, error);
        
        // Specific error handling for duplicate instructions
        if (error.message?.includes('duplicate instruction') || 
            error.message?.includes('-32602') ||
            error.message?.includes('identical instructions')) {
          console.error('Bundle has duplicate instructions. This is not allowed by Jito.');
        }
        
        return { success: false, error };
      }
    });
    
    // Wait for all bundles to complete
    const bundleResults = await Promise.allSettled(bundlePromises);
    
    // Process results
    bundleResults.forEach((result, index) => {
      if (result.status === 'fulfilled') {
        if (result.value.success) {
          if (result.value.result) {
            allResults.push(result.value.result);
          }
          successfulBundles++;
        } else {
          failedBundles++;
        }
      } else {
        console.error(`Bundle ${index + 1} promise rejected:`, result.reason);
        failedBundles++;
      }
    });
    
    // Return result based on success/failure count
    if (successfulBundles > 0) {
      if (failedBundles > 0) {
        return {
          success: true,
          result: allResults,
          error: `${failedBundles} bundles failed, but ${successfulBundles} succeeded. Some transactions may have duplicate instructions.`
        };
      } else {
        return {
          success: true,
          result: allResults
        };
      }
    } else {
      return {
        success: false,
        error: `All ${failedBundles} bundles failed. Check for duplicate instructions or other issues.`
      };
    }
  } catch (error) {
    console.error('Jupiter swap error:', error);
    return {
      success: false,
      error: error.message || 'Unknown error executing Jupiter swap'
    };
  }
};

/**
 * Validate Jupiter swap inputs
 */
export const validateJupSwapInputs = (
  wallets: WalletJupSwap[],
  swapConfig: SwapConfig,
  walletBalances: Map<string, number>
): { valid: boolean; error?: string } => {
  // Check if swap config is valid
  if (!swapConfig.inputMint || !swapConfig.outputMint) {
    return { valid: false, error: 'Invalid token addresses' };
  }
  
  if (isNaN(swapConfig.solAmount) || swapConfig.solAmount <= 0) {
    return { valid: false, error: 'Invalid SOL amount' };
  }
  
  if (isNaN(swapConfig.slippageBps) || swapConfig.slippageBps < 0) {
    return { valid: false, error: 'Invalid slippage value' };
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
    if (balance < swapConfig.solAmount) {
      return { valid: false, error: `Wallet ${wallet.address.substring(0, 6)}... has insufficient balance` };
    }
  }
  
  return { valid: true };
};

import { Connection } from "@solana/web3.js";
import { WalletType, fetchSolBalance, fetchTokenBalance, fetchSolBalanceWithRetry, fetchTokenBalanceWithRetry } from "./Utils";

/**
 * Extract API key from URL and clean the URL
 */
export const handleApiKeyFromUrl = (
  setConfig: Function,
  saveConfigToCookies: Function,
  showToast: Function
) => {
  const url = new URL(window.location.href);
  const apiKey = url.searchParams.get('apikey');
  
  // If API key is in the URL
  if (apiKey) {
    console.log('API key found in URL, saving to config');
    
    // Update config state with the new API key
    setConfig((prev: any) => {
      const newConfig = { ...prev, apiKey };
      // Save to cookies
      saveConfigToCookies(newConfig);
      return newConfig;
    });
    
    // Remove the apikey parameter from URL without reloading the page
    url.searchParams.delete('apikey');
    
    // Replace current URL without reloading the page
    window.history.replaceState({}, document.title, url.toString());
    
    // Optional: Show a toast notification that API key was set
    if (showToast) {
      showToast("API key has been set from URL", "success");
    }
  }
};

/**
 * Fetch SOL balances for all wallets with rate limiting and retries
 */
export const fetchSolBalances = async (
  connection: Connection,
  wallets: WalletType[],
  setSolBalances: Function
) => {
  const newBalances = new Map<string, number>();
  const BATCH_SIZE = 10; // Process 10 wallets at a time
  const DELAY_BETWEEN_BATCHES = 100; // 100ms delay between batches
  const DELAY_BETWEEN_REQUESTS = 50; // 50ms delay between individual requests
  
  // Process wallets in batches to avoid overwhelming the RPC
  for (let i = 0; i < wallets.length; i += BATCH_SIZE) {
    const batch = wallets.slice(i, i + BATCH_SIZE);
    
    // Process each wallet in the batch sequentially with delays
    for (const wallet of batch) {
      try {
        const balance = await fetchSolBalanceWithRetry(connection, wallet.address);
        newBalances.set(wallet.address, balance);
        
        // Update balances incrementally for better UX
        setSolBalances(new Map(newBalances));
        
        // Small delay between requests to avoid rate limiting
        await new Promise(resolve => setTimeout(resolve, DELAY_BETWEEN_REQUESTS));
      } catch (error) {
        console.error(`Error fetching SOL balance for ${wallet.address}:`, error);
        newBalances.set(wallet.address, 0);
      }
    }
    
    // Delay between batches
    if (i + BATCH_SIZE < wallets.length) {
      await new Promise(resolve => setTimeout(resolve, DELAY_BETWEEN_BATCHES));
    }
  }
  
  setSolBalances(newBalances);
  return newBalances;
};

/**
 * Fetch token balances for all wallets with rate limiting and retries
 */
export const fetchTokenBalances = async (
  connection: Connection,
  wallets: WalletType[],
  tokenAddress: string,
  setTokenBalances: Function
) => {
  if (!tokenAddress) return new Map<string, number>();
  
  const newBalances = new Map<string, number>();
  const BATCH_SIZE = 10; // Process 10 wallets at a time
  const DELAY_BETWEEN_BATCHES = 100; // 100ms delay between batches
  const DELAY_BETWEEN_REQUESTS = 50; // 50ms delay between individual requests
  
  // Process wallets in batches to avoid overwhelming the RPC
  for (let i = 0; i < wallets.length; i += BATCH_SIZE) {
    const batch = wallets.slice(i, i + BATCH_SIZE);
    
    // Process each wallet in the batch sequentially with delays
    for (const wallet of batch) {
      try {
        const balance = await fetchTokenBalanceWithRetry(connection, wallet.address, tokenAddress);
        newBalances.set(wallet.address, balance);
        
        // Update balances incrementally for better UX
        setTokenBalances(new Map(newBalances));
        
        // Small delay between requests to avoid rate limiting
        await new Promise(resolve => setTimeout(resolve, DELAY_BETWEEN_REQUESTS));
      } catch (error) {
        console.error(`Error fetching token balance for ${wallet.address}:`, error);
        newBalances.set(wallet.address, 0);
      }
    }
    
    // Delay between batches
    if (i + BATCH_SIZE < wallets.length) {
      await new Promise(resolve => setTimeout(resolve, DELAY_BETWEEN_BATCHES));
    }
  }
  
  setTokenBalances(newBalances);
  return newBalances;
};



/**
 * Handle market cap updates
 */
export const handleMarketCapUpdate = (
  marketcap: number | null,
  setCurrentMarketCap: Function
) => {
  setCurrentMarketCap(marketcap);
  console.log("Main component received marketcap update:", marketcap);
};

/**
 * Handle wallet sorting by balance
 */
export const handleSortWallets = (
  wallets: WalletType[],
  sortDirection: 'asc' | 'desc',
  setSortDirection: Function,
  solBalances: Map<string, number>,
  setWallets: Function
) => {
  const newDirection = sortDirection === 'asc' ? 'desc' : 'asc';
  setSortDirection(newDirection);
  
  const sortedWallets = [...wallets].sort((a, b) => {
    const balanceA = solBalances.get(a.address) || 0;
    const balanceB = solBalances.get(b.address) || 0;
    
    if (newDirection === 'asc') {
      return balanceA - balanceB;
    } else {
      return balanceB - balanceA;
    }
  });
  
  setWallets(sortedWallets);
};

/**
 * Clean up wallets by removing empty and duplicate wallets
 */
export const handleCleanupWallets = (
  wallets: WalletType[],
  solBalances: Map<string, number>,
  tokenBalances: Map<string, number>,
  setWallets: Function,
  showToast: Function
) => {
  // Keep track of seen addresses
  const seenAddresses = new Set<string>();
  // Keep track of removal counts
  let emptyCount = 0;
  let duplicateCount = 0;
  
  // Filter out empty wallets and duplicates
  const cleanedWallets = wallets.filter(wallet => {
    // Check for empty balance (no SOL and no tokens)
    const solBalance = solBalances.get(wallet.address) || 0;
    const tokenBalance = tokenBalances.get(wallet.address) || 0;
    
    if (solBalance <= 0 && tokenBalance <= 0) {
      emptyCount++;
      return false;
    }
    
    // Check for duplicates
    if (seenAddresses.has(wallet.address)) {
      duplicateCount++;
      return false;
    }
    
    seenAddresses.add(wallet.address);
    return true;
  });

  // Show appropriate toast message
  if (emptyCount > 0 || duplicateCount > 0) {
    const messages: string[] = [];
    if (emptyCount > 0) {
      messages.push(`${emptyCount} empty wallet${emptyCount === 1 ? '' : 's'}`);
    }
    if (duplicateCount > 0) {
      messages.push(`${duplicateCount} duplicate${duplicateCount === 1 ? '' : 's'}`);
    }
    showToast(`Removed ${messages.join(' and ')}`, "success");
  } else {
    showToast("No empty wallets or duplicates found", "success");
  }
  
  setWallets(cleanedWallets);
};
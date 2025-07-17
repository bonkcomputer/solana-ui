import React, { useState, useEffect, useRef } from 'react';
import { RefreshCw, ExternalLink, Wallet, CheckSquare, Square, DollarSign, Coins, ArrowDownAZ, ArrowUpAZ, Activity, DollarSignIcon, Zap } from 'lucide-react';
import { saveWalletsToCookies, WalletType, formatAddress, formatTokenBalance, copyToClipboard, toggleWallet, fetchSolBalance, fetchSolBalanceWithRetry, getWalletDisplayName } from './Utils';
import { useToast } from "./Notifications";
import { Connection } from '@solana/web3.js';
import { WalletOperationsButtons } from './OperationsWallets'; // Import the new component
import { executeJupSwap, validateJupSwapInputs } from './utils/jupbuy';

// Tooltip Component with cyberpunk styling
export const Tooltip = ({ 
  children, 
  content,
  position = 'top'
}: { 
  children: React.ReactNode;
  content: string;
  position?: 'top' | 'bottom' | 'left' | 'right';
}) => {
  const [isVisible, setIsVisible] = useState(false);

  const positionClasses = {
    top: 'bottom-full left-1/2 -translate-x-1/2 mb-2',
    bottom: 'top-full left-1/2 -translate-x-1/2 mt-2',
    left: 'right-full top-1/2 -translate-y-1/2 mr-2',
    right: 'left-full top-1/2 -translate-y-1/2 ml-2'
  };

  return (
    <div className="relative inline-block">
      <div
        onMouseEnter={() => setIsVisible(true)}
        onMouseLeave={() => setIsVisible(false)}
      >
        {children}
      </div>
      {isVisible && (
        <div className={`absolute z-50 ${positionClasses[position]}`}>
          <div className="bg-[#051014] cyberpunk-border text-[#02b36d] text-xs px-2 py-1 rounded shadow-lg whitespace-nowrap">
            {content}
          </div>
        </div>
      )}
    </div>
  );
};

// Max wallets configuration
export const maxWalletsConfig = {
  'raybuy': 1000,
  'raysell': 1000,
  'pumpbuy': 1000,
  'pumpsell': 1000,
  'jupbuy': 1000,
  'swapbuy': 1000,
  'swapsell': 1000,
  'jupsell': 1000,
  'moonbuy': 1000,
  'launchsell': 1000,
  'launchbuy': 1000,
  'moonsell': 1000,
  'boopbuy': 1000,
  'boopsell': 1000
} as const;

// Updated toggle function for wallets based on token and SOL conditions
export const toggleWalletsByBalance = (
  wallets: WalletType[], 
  showWithTokens: boolean,
  solBalances: Map<string, number>,
  tokenBalances: Map<string, number>
): WalletType[] => {
  return wallets.map(wallet => ({
    ...wallet,
    isActive: showWithTokens 
      ? (tokenBalances.get(wallet.address) || 0) > 0  // Select wallets with tokens
      : (solBalances.get(wallet.address) || 0) > 0 && (tokenBalances.get(wallet.address) || 0) === 0  // Select wallets with only SOL
  }));
};

export type ScriptType = keyof typeof maxWalletsConfig;

/**
 * Counts the number of active wallets in the provided wallet array
 * @param wallets Array of wallet objects
 * @returns Number of active wallets
 */
export const countActiveWallets = (wallets: WalletType[]): number => {
  return wallets.filter(wallet => wallet.isActive).length;
};

/**
 * Returns an array of only the active wallets
 * @param wallets Array of wallet objects
 * @returns Array of active wallets
 */
export const getActiveWallets = (wallets: WalletType[]): WalletType[] => {
  return wallets.filter(wallet => wallet.isActive);
};

/**
 * Checks if the number of active wallets exceeds the maximum allowed for a specific script
 * @param wallets Array of wallet objects
 * @param scriptName Name of the script to check against
 * @returns Object containing validation result and relevant information
 */
export const validateActiveWallets = (wallets: WalletType[], scriptName: ScriptType) => {
  const activeCount = countActiveWallets(wallets);
  const maxAllowed = maxWalletsConfig[scriptName];
  const isValid = activeCount <= maxAllowed;

  return {
    isValid,
    activeCount,
    maxAllowed,
    scriptName,
    message: isValid 
      ? `Valid: ${activeCount} active wallets (max ${maxAllowed})`
      : `Error: Too many active wallets (${activeCount}). Maximum allowed for ${scriptName} is ${maxAllowed}`
  };
};

// New function to toggle all wallets regardless of balance
export const toggleAllWallets = (wallets: WalletType[]): WalletType[] => {
  const allActive = wallets.every(wallet => wallet.isActive);
  return wallets.map(wallet => ({
    ...wallet,
    isActive: !allActive
  }));
};

// Updated to use separate SOL balance tracking
export const toggleAllWalletsWithBalance = (
  wallets: WalletType[],
  solBalances: Map<string, number>
): WalletType[] => {
  // Check if all wallets with balance are already active
  const walletsWithBalance = wallets.filter(wallet => 
    (solBalances.get(wallet.address) || 0) > 0
  );
  const allWithBalanceActive = walletsWithBalance.every(wallet => wallet.isActive);
  
  // Toggle based on current state
  return wallets.map(wallet => ({
    ...wallet,
    isActive: (solBalances.get(wallet.address) || 0) > 0 
      ? !allWithBalanceActive 
      : wallet.isActive
  }));
};

/**
 * Gets the appropriate script name based on selected DEX and mode
 * @param selectedDex Selected DEX name
 * @param isBuyMode Whether in buy mode
 * @returns The corresponding script name
 */
export const getScriptName = (selectedDex: string, isBuyMode: boolean): ScriptType => {
  switch(selectedDex) {
    case 'raydium':
      return isBuyMode ? 'raybuy' : 'raysell';
    case 'auto':
      return isBuyMode ? 'jupbuy' : 'jupsell';
    case 'pumpfun':
      return isBuyMode ? 'pumpbuy' : 'pumpsell';
    case 'pumpswap':
      return isBuyMode ? 'swapbuy' : 'swapsell';
    case 'moonshot':
      return isBuyMode ? 'moonbuy' : 'moonsell';
    case 'launchpad':
      return isBuyMode ? 'launchbuy' : 'launchsell';
    case 'boopfun':
      return isBuyMode ? 'boopbuy' : 'boopsell';
    default:
      return isBuyMode ? 'pumpbuy' : 'pumpsell';
  }
};

interface WalletsPageProps {
  wallets: WalletType[];
  setWallets: (wallets: WalletType[]) => void;
  handleRefresh: () => void;
  isRefreshing: boolean;
  setIsModalOpen: (open: boolean) => void;
  tokenAddress: string;
  sortDirection: string;
  handleSortWallets: () => void;
  connection: Connection;
  
  // Balance props
  solBalances?: Map<string, number>;
  setSolBalances?: (balances: Map<string, number>) => void;
  tokenBalances?: Map<string, number>;
  setTokenBalances?: (balances: Map<string, number>) => void;
  totalSol?: number;
  setTotalSol?: (total: number) => void;
  activeSol?: number;
  setActiveSol?: (active: number) => void;
  totalTokens?: number;
  setTotalTokens?: (total: number) => void;
  activeTokens?: number;
  setActiveTokens?: (active: number) => void;
  quickBuyEnabled?: boolean;
  setQuickBuyEnabled?: (enabled: boolean) => void;
  quickBuyAmount?: number;
  setQuickBuyAmount?: (amount: number) => void;
  quickBuyMinAmount?: number;
  setQuickBuyMinAmount?: (amount: number) => void;
  quickBuyMaxAmount?: number;
  setQuickBuyMaxAmount?: (amount: number) => void;
  useQuickBuyRange?: boolean;
  setUseQuickBuyRange?: (enabled: boolean) => void;
}
export const WalletsPage: React.FC<WalletsPageProps> = ({
  wallets,
  setWallets,
  handleRefresh,
  isRefreshing,
  setIsModalOpen,
  tokenAddress,
  sortDirection,
  handleSortWallets,
  connection,
  
  // Balance props with defaults
  solBalances: externalSolBalances,
  setSolBalances: setExternalSolBalances,
  tokenBalances: externalTokenBalances,
  setTokenBalances: setExternalTokenBalances,
  totalSol: externalTotalSol,
  setTotalSol: setExternalTotalSol,
  activeSol: externalActiveSol,
  setActiveSol: setExternalActiveSol,
  totalTokens: externalTotalTokens,
  setTotalTokens: setExternalTotalTokens,
  activeTokens: externalActiveTokens,
  setActiveTokens: setExternalActiveTokens,
  quickBuyEnabled = true,
  setQuickBuyEnabled,
  quickBuyAmount = 0.01,
  setQuickBuyAmount,
  quickBuyMinAmount = 0.01,
  setQuickBuyMinAmount,
  quickBuyMaxAmount = 0.05,
  setQuickBuyMaxAmount,
  useQuickBuyRange = false,
  setUseQuickBuyRange
}) => {
  const [copiedAddress, setCopiedAddress] = useState<string | null>(null);
  const [showingTokenWallets, setShowingTokenWallets] = useState(true);
  const [hoverRow, setHoverRow] = useState<number | null>(null);
  const [buyingWalletId, setBuyingWalletId] = useState<number | null>(null);
  const [recentlyUpdatedWallets, setRecentlyUpdatedWallets] = useState<Set<string>>(new Set());
  
  // Use internal state if external state is not provided
  const [internalSolBalances, setInternalSolBalances] = useState<Map<string, number>>(new Map());
  const [internalTokenBalances, setInternalTokenBalances] = useState<Map<string, number>>(new Map());
  const [refreshingWalletId, setRefreshingWalletId] = useState<number | null>(null);
  
  const solBalances = externalSolBalances || internalSolBalances;
  const setSolBalances = setExternalSolBalances || setInternalSolBalances;
  const tokenBalances = externalTokenBalances || internalTokenBalances;
  const setTokenBalances = setExternalTokenBalances || setInternalTokenBalances;
  
  const { showToast } = useToast();

  // Fetch SOL balances for all wallets with improved rate limiting
  const fetchSolBalances = async () => {
    const newBalances = new Map<string, number>(solBalances);
    const DELAY_BETWEEN_REQUESTS = 100; // Increased delay for better reliability
    
    // Process wallets sequentially with rate limiting
    for (const wallet of wallets) {
      setRefreshingWalletId(wallet.id);
      try {
        const balance = await fetchSolBalanceWithRetry(connection, wallet.address);
        newBalances.set(wallet.address, balance);
        // Update balances after each wallet to show progress
        setSolBalances(new Map(newBalances));
      } catch (error) {
        console.error(`Error fetching SOL balance for ${wallet.address}:`, error);
        newBalances.set(wallet.address, 0);
      }
      
      // Add delay between requests to avoid rate limiting
      await new Promise(resolve => setTimeout(resolve, DELAY_BETWEEN_REQUESTS));
    }
    
    setRefreshingWalletId(null);
    return newBalances;
  };

  // Fetch SOL balances initially and when wallets change
  useEffect(() => {
    fetchSolBalances();
  }, [wallets.length, connection]);

  // Use refs to track previous balance values
  const prevSolBalancesRef = useRef<Map<string, number>>(new Map());
  const prevTokenBalancesRef = useRef<Map<string, number>>(new Map());

  // Monitor balance changes to show visual feedback for trade updates
  useEffect(() => {
    const prevSolBalances = prevSolBalancesRef.current;
    const prevTokenBalances = prevTokenBalancesRef.current;
    
    // Create a serialized version of current balances to compare
    const currentSolString = JSON.stringify(Array.from(solBalances.entries()).sort());
    const currentTokenString = JSON.stringify(Array.from(tokenBalances.entries()).sort());
    const prevSolString = JSON.stringify(Array.from(prevSolBalances.entries()).sort());
    const prevTokenString = JSON.stringify(Array.from(prevTokenBalances.entries()).sort());
    
    // Only proceed if balances actually changed
    if (currentSolString === prevSolString && currentTokenString === prevTokenString) {
      return;
    }
    
    // Check for balance changes and mark wallets as recently updated
    const updatedWallets = new Set<string>();
    
    wallets.forEach(wallet => {
      const currentSol = solBalances.get(wallet.address) || 0;
      const currentToken = tokenBalances.get(wallet.address) || 0;
      const prevSol = prevSolBalances.get(wallet.address) || 0;
      const prevToken = prevTokenBalances.get(wallet.address) || 0;
      
      // Check if balances changed significantly (to avoid minor rounding differences)
      const solChanged = Math.abs(currentSol - prevSol) > 0.001;
      const tokenChanged = Math.abs(currentToken - prevToken) > 0.001;
      
      if ((solChanged || tokenChanged) && (prevSol > 0 || prevToken > 0)) {
        updatedWallets.add(wallet.address);
        console.log(`Balance updated for wallet ${wallet.address}: SOL ${prevSol.toFixed(4)} → ${currentSol.toFixed(4)}, Tokens ${prevToken.toFixed(4)} → ${currentToken.toFixed(4)}`);
      }
    });
    
    if (updatedWallets.size > 0) {
      setRecentlyUpdatedWallets(updatedWallets);
      
      // Clear the visual indicator after 1 seconds
      setTimeout(() => {
        setRecentlyUpdatedWallets(new Set());
      }, 1000);
    }
    
    // Update previous balance references only after processing
    prevSolBalancesRef.current = new Map(solBalances);
    prevTokenBalancesRef.current = new Map(tokenBalances);
  }, [solBalances, tokenBalances]); // Removed wallets from dependency array to prevent triggering on selection changes

  // Calculate balances and update external state
  useEffect(() => {
    // Calculate total SOL and token balances
    const calculatedTotalSol = Array.from(solBalances.values()).reduce((sum, balance) => sum + balance, 0);
    const calculatedTotalTokens = Array.from(tokenBalances.values()).reduce((sum, balance) => sum + balance, 0);

    // Calculate SOL and token balances for active wallets only
    const activeWallets = wallets.filter(wallet => wallet.isActive);
    const calculatedActiveSol = activeWallets.reduce((sum, wallet) => sum + (solBalances.get(wallet.address) || 0), 0);
    const calculatedActiveTokens = activeWallets.reduce((sum, wallet) => sum + (tokenBalances.get(wallet.address) || 0), 0);

    // Update external state if provided
    if (setExternalTotalSol) setExternalTotalSol(calculatedTotalSol);
    if (setExternalActiveSol) setExternalActiveSol(calculatedActiveSol);
    if (setExternalTotalTokens) setExternalTotalTokens(calculatedTotalTokens);
    if (setExternalActiveTokens) setExternalActiveTokens(calculatedActiveTokens);
  }, [wallets, solBalances, tokenBalances]);

  // Use either external state or calculated values
  const totalSol = externalTotalSol !== undefined ? externalTotalSol : 
    Array.from(solBalances.values()).reduce((sum, balance) => sum + balance, 0);
  
  const totalTokens = externalTotalTokens !== undefined ? externalTotalTokens :
    Array.from(tokenBalances.values()).reduce((sum, balance) => sum + balance, 0);
  
  const activeWallets = wallets.filter(wallet => wallet.isActive);
  
  const activeSol = externalActiveSol !== undefined ? externalActiveSol :
    activeWallets.reduce((sum, wallet) => sum + (solBalances.get(wallet.address) || 0), 0);
  
  const activeTokens = externalActiveTokens !== undefined ? externalActiveTokens :
    activeWallets.reduce((sum, wallet) => sum + (tokenBalances.get(wallet.address) || 0), 0);

  const handleBalanceToggle = () => {
    setShowingTokenWallets(!showingTokenWallets);
    const newWallets = toggleWalletsByBalance(wallets, !showingTokenWallets, solBalances, tokenBalances);
    saveWalletsToCookies(newWallets);
    setWallets(newWallets);
  };

  const handleRefreshAll = async () => {
    if (isRefreshing || refreshingWalletId !== null) return;
    
    // Call the parent's refresh handler to indicate the refresh has started
    handleRefresh();
    
    // Perform the wallet-by-wallet refresh
    await fetchSolBalances();
  };

  const handleQuickBuy = async (wallet: WalletType, e: React.MouseEvent) => {
    e.stopPropagation();
    
    if (!tokenAddress) {
      showToast('No token address specified', 'error');
      return;
    }

    if (buyingWalletId === wallet.id) return; // Prevent double clicks
    
    setBuyingWalletId(wallet.id);
    
    try {
      // Calculate the SOL amount to use
      let solAmountToUse = quickBuyAmount;
      
      if (useQuickBuyRange && quickBuyMinAmount && quickBuyMaxAmount) {
        // Generate random amount between min and max
        solAmountToUse = Math.random() * (quickBuyMaxAmount - quickBuyMinAmount) + quickBuyMinAmount;
        // Round to 3 decimal places
        solAmountToUse = Math.round(solAmountToUse * 1000) / 1000;
      }
      
      // Quick buy configuration with calculated amount
      const swapConfig = {
        inputMint: 'So11111111111111111111111111111111111111112', // SOL
        outputMint: tokenAddress,
        solAmount: solAmountToUse, // Random or fixed amount
        slippageBps: 300 // 3% slippage
      };

      const walletForSwap = {
        address: wallet.address,
        privateKey: wallet.privateKey
      };

      // Check if wallet has sufficient SOL balance
      const walletBalance = solBalances.get(wallet.address) || 0;
      if (walletBalance < solAmountToUse) {
        showToast(`Insufficient SOL balance. Need ${solAmountToUse.toFixed(3)} SOL, have ${walletBalance.toFixed(3)} SOL`, 'error');
        return;
      }
      
      // Validate inputs
      const validation = validateJupSwapInputs([walletForSwap], swapConfig, solBalances);
      if (!validation.valid) {
        showToast(validation.error || 'Validation failed', 'error');
        return;
      }
      
      const result = await executeJupSwap([walletForSwap], swapConfig);
      
      if (result.success) {
        showToast('Quick buy executed successfully!', 'success');
      } else {
        showToast(result.error || 'Quick buy failed', 'error');
      }
    } catch (error) {
      console.error('Quick buy error:', error);
      showToast('Quick buy failed: ' + (error.message || 'Unknown error'), 'error');
    } finally {
      setBuyingWalletId(null);
    }
  };

  return (
    <div className="flex-1 bg-[#050a0e] relative cyberpunk-bg">
      {/* Cyberpunk scanline effect - pointer-events-none ensures it doesn't block clicks */}
      <div className="absolute top-0 left-0 w-full h-full cyberpunk-scanline pointer-events-none z-1 opacity-30"></div>
      
      {/* Enhanced header */}
      <div className="top-0 sticky bg-[#050a0e99] backdrop-blur-sm border-b border-[#02b36d40] z-10 shadow-sm">
        {/* Compact buttons row */}
        <div className="px-2 py-1 border-b border-[#02b36d20]">
          <WalletOperationsButtons
            wallets={wallets}
            solBalances={solBalances}
            connection={connection}
            tokenBalances={tokenBalances}
            handleRefresh={handleRefreshAll}
            isRefreshing={isRefreshing || refreshingWalletId !== null}
            showingTokenWallets={showingTokenWallets}
            handleBalanceToggle={handleBalanceToggle}
            setWallets={setWallets}
            sortDirection={sortDirection}
            handleSortWallets={handleSortWallets}
            setIsModalOpen={setIsModalOpen}
            quickBuyAmount={quickBuyAmount}
            setQuickBuyAmount={setQuickBuyAmount}
            quickBuyEnabled={quickBuyEnabled}
            setQuickBuyEnabled={setQuickBuyEnabled}
            quickBuyMinAmount={quickBuyMinAmount}
            setQuickBuyMinAmount={setQuickBuyMinAmount}
            quickBuyMaxAmount={quickBuyMaxAmount}
            setQuickBuyMaxAmount={setQuickBuyMaxAmount}
            useQuickBuyRange={useQuickBuyRange}
            setUseQuickBuyRange={setUseQuickBuyRange}
          />
        </div>
        
        {/* Improved balance info */}
        <div className="py-2 px-3 bg-[#0a141980]">
          <div className="flex justify-between text-sm">
            <div>
              <div className="text-[#7ddfbd] font-mono flex items-center gap-2">
                <DollarSign size={14} className="text-[#02b36d]" />
                <span>
                  <span className="text-[#e4fbf2]">{totalSol.toFixed(2)}</span> (
                  <span className="text-[#02b36d]">{activeSol.toFixed(2)}</span>) SOL
                </span>
              </div>
            </div>
            {tokenAddress && (
              <div className="text-right">
                <div className="text-[#7ddfbd] font-mono flex items-center justify-end gap-2">
                  <span>
                    <span className="text-[#e4fbf2]">{formatTokenBalance(totalTokens)}</span> (
                    <span className="text-[#02b36d]">{formatTokenBalance(activeTokens)}</span>) Tokens
                  </span>
                  <Activity size={14} className="text-[#02b36d]" />
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
      
      {/* Wallets table with improved row sizing */}
      <div className="pt-2 relative">
        <div className="min-w-full overflow-auto relative">
          <table className="w-full border-separate border-spacing-0">
            <tbody className="text-sm">
              {wallets.map((wallet) => (
                <tr 
                  key={wallet.id}
                  onClick={() => {
                    const newWallets = toggleWallet(wallets, wallet.id);
                    saveWalletsToCookies(newWallets);
                    setWallets(newWallets);
                  }}
                  onMouseEnter={() => setHoverRow(wallet.id)}
                  onMouseLeave={() => setHoverRow(null)}
                  className={`
                    border-b border-[#02b36d15] cursor-pointer transition-all duration-500
                    ${hoverRow === wallet.id ? 'bg-[#02b36d15]' : ''}
                    ${wallet.isActive ? 'bg-[#02b36d10]' : ''}
                    ${refreshingWalletId === wallet.id ? 'bg-[#02b36d20]' : ''}
                    ${recentlyUpdatedWallets.has(wallet.address) ? 'bg-gradient-to-r from-[#02b36d30] to-[#02b36d15] animate-pulse border-l-2 border-l-[#02b36d]' : ''}
                  `}
                >
                  {/* Quick Buy Button or Indicator */}
                  <td className="py-2.5 pl-3 pr-1 w-8">
                    {quickBuyEnabled ? (
                      <Tooltip content={
                        tokenAddress 
                          ? (useQuickBuyRange 
                              ? `Quick buy random ${quickBuyMinAmount?.toFixed(3)}-${quickBuyMaxAmount?.toFixed(3)} SOL` 
                              : `Quick buy ${quickBuyAmount} SOL`
                            )
                          : "No token selected"
                      } position="right">
                        <button
                          onClick={(e) => handleQuickBuy(wallet, e)}
                          disabled={!tokenAddress || buyingWalletId === wallet.id || (solBalances.get(wallet.address) || 0) < quickBuyAmount}
                          className={`
                            w-6 h-6 rounded-full transition-all duration-200 flex items-center justify-center
                            ${!tokenAddress || (solBalances.get(wallet.address) || 0) < 0.01
                              ? 'bg-[#091217] border border-[#02b36d20] cursor-not-allowed'
                              : buyingWalletId === wallet.id
                              ? 'bg-[#02b36d40] border border-[#02b36d]'
                              : 'bg-[#02b36d20] border border-[#02b36d60] hover:bg-[#02b36d30] hover:border-[#02b36d] cursor-pointer'
                            }
                          `}
                        >
                          {buyingWalletId === wallet.id ? (
                            <RefreshCw size={10} className="text-[#02b36d] animate-spin" />
                          ) : (
                            <Zap size={10} className={`
                              ${!tokenAddress || (solBalances.get(wallet.address) || 0) < quickBuyAmount
                                ? 'text-[#02b36d40]'
                                : 'text-[#02b36d]'
                              }
                            `} />
                          )}
                        </button>
                      </Tooltip>
                    ) : (
                      <div className="w-6 h-6 flex items-center justify-center">
                        <div className={`
                          w-2 h-2 rounded-full transition-all duration-200
                          ${wallet.isActive ? 'bg-[#02b36d]' : 'bg-[#02b36d40]'}
                        `} />
                      </div>
                    )}
                  </td>
                  
                  {/* Address with proper sizing */}
                  <td className="py-2.5 px-2 font-mono">
                    <div className="flex items-center">
                      {refreshingWalletId === wallet.id && (
                        <RefreshCw size={12} className="text-[#02b36d] mr-2 animate-spin" />
                      )}
                      <Tooltip 
                        content={wallet.label ? `${wallet.label} (${formatAddress(wallet.address)})` : `Click to copy: ${wallet.address}`}
                        position="top"
                      >
                        <span 
                          className={`text-sm font-mono cursor-pointer hover:text-[#02b36d] transition-colors duration-200 tracking-wide ${
                            wallet.isActive ? 'text-[#00ff88]' : 'text-[#e4fbf2]'
                          }`}
                          onClick={async (e) => {
                            e.stopPropagation();
                            const success = await copyToClipboard(wallet.address, showToast);
                            if (success) {
                              setCopiedAddress(wallet.address);
                              setTimeout(() => setCopiedAddress(null), 2000);
                            }
                          }}
                        >
                          {getWalletDisplayName(wallet)}
                          {copiedAddress === wallet.address && (
                            <span className="ml-1 text-xs text-[#02b36d] animate-pulse">
                              ✓
                            </span>
                          )}
                        </span>
                      </Tooltip>
                    </div>
                  </td>
                  
                  {/* SOL balance */}
                  <td className="py-2.5 px-2 text-right font-mono text-[#e4fbf2]">
                    <div className="flex items-center justify-end gap-1">
                      <span className={`${(solBalances.get(wallet.address) || 0) > 0 ? 'text-[#7ddfbd]' : 'text-[#7ddfbd60]'}`}>
                        {(solBalances.get(wallet.address) || 0).toFixed(3)}
                      </span>
                    </div>
                  </td>
                  
                  {/* Token balance if needed */}
                  {tokenAddress && (
                    <td className="py-2.5 px-2 text-right font-mono">
                      <div className="flex items-center justify-end gap-1">
                        <span className={`${(tokenBalances.get(wallet.address) || 0) > 0 ? 'text-[#02b36d]' : 'text-[#02b36d40]'}`}>
                          {formatTokenBalance(tokenBalances.get(wallet.address) || 0)}
                        </span>
                      </div>
                    </td>
                  )}
                  
                  {/* Explorer link */}
                  <td className="py-2.5 pl-2 pr-3 text-right">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        window.open(`https://solscan.io/account/${wallet.address}`, '_blank');
                      }}
                      className="text-[#7ddfbd60] hover:text-[#02b36d] transition-colors duration-200"
                      title="View on Solscan"
                    >
                      <ExternalLink size={14} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
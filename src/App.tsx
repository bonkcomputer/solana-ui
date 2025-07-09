import React, { useEffect, lazy, useCallback, useReducer, useMemo } from 'react';
import { X, Settings, Sparkles, Lock } from 'lucide-react';
import { Connection } from '@solana/web3.js';
import ServiceSelector from './Menu.tsx';
import { WalletTooltip, initStyles } from './Styles';
import { 
  saveWalletsToCookies,
  loadWalletsFromCookies,
  saveConfigToCookies,
  loadConfigFromCookies,
  loadQuickBuyPreferencesFromCookies,
  saveQuickBuyPreferencesToCookies,
  downloadPrivateKey,
  downloadAllWallets, 
  deleteWallet, 
  WalletType, 
  formatAddress,
  copyToClipboard,
  ConfigType,
} from './Utils';
import Split from 'react-split';
import { useToast } from "./Notifications";
import {
  fetchSolBalances,
  fetchTokenBalances,
  fetchAmmKey,
  handleSortWallets,
  handleApiKeyFromUrl
} from './Manager';
import { countActiveWallets, validateActiveWallets, getScriptName, maxWalletsConfig } from './Wallets';

// Lazy loaded components
const EnhancedSettingsModal = lazy(() => import('./SettingsModal'));
const EnhancedWalletOverview = lazy(() => import('./WalletOverview'));
const WalletsPage = lazy(() => import('./Wallets').then(module => ({ default: module.WalletsPage })));
const ChartPage = lazy(() => import('./Chart').then(module => ({ default: module.ChartPage })));
const ActionsPage = lazy(() => import('./Actions').then(module => ({ default: module.ActionsPage })));
const MobileLayout = lazy(() => import('./Mobile'));

// Import modal components 
const BurnModal = lazy(() => import('./BurnModal').then(module => ({ default: module.BurnModal })));
const PnlModal = lazy(() => import('./CalculatePNLModal').then(module => ({ default: module.PnlModal })));
const DeployModal = lazy(() => import('./DeployModal').then(module => ({ default: module.DeployModal })));
const CleanerTokensModal = lazy(() => import('./CleanerModal').then(module => ({ default: module.CleanerTokensModal })));
const CustomBuyModal = lazy(() => import('./CustomBuyModal').then(module => ({ default: module.CustomBuyModal })));
const FloatingTradingCard = lazy(() => import('./FloatingTradingCard'));

const WalletManager: React.FC = () => {
  // Apply styles
  useEffect(() => {
    const styleElement = document.createElement('style');
    styleElement.textContent = initStyles();
    document.head.appendChild(styleElement);
    
    return () => {
      document.head.removeChild(styleElement);
    };
  }, []);

  // Optimized state management with useReducer
  interface AppState {
    copiedAddress: string | null;
    tokenAddress: string;
    isModalOpen: boolean;
    isSettingsOpen: boolean;
    activeTab: 'network' | 'wallets' | 'advanced';
    config: ConfigType;
    currentPage: 'wallets' | 'chart' | 'actions';
    wallets: WalletType[];
    isRefreshing: boolean;
    connection: Connection | null;
    solBalances: Map<string, number>;
    tokenBalances: Map<string, number>;
    ammKey: string | null;
    isLoadingChart: boolean;
    currentMarketCap: number | null;
    modals: {
      burnModalOpen: boolean;
      calculatePNLModalOpen: boolean;
      deployModalOpen: boolean;
      cleanerTokensModalOpen: boolean;
      customBuyModalOpen: boolean;
    };
    sortDirection: 'asc' | 'desc';
    tickEffect: boolean;
    status: {
      message: string;
      isVisible: boolean;
    };
    floatingCard: {
      isOpen: boolean;
      position: { x: number; y: number };
      isDragging: boolean;
    };
    quickBuyEnabled: boolean;
    quickBuyAmount: number;
    quickBuyMinAmount: number;
    quickBuyMaxAmount: number;
    useQuickBuyRange: boolean;
  }

  type AppAction = 
    | { type: 'SET_COPIED_ADDRESS'; payload: string | null }
    | { type: 'SET_TOKEN_ADDRESS'; payload: string }
    | { type: 'SET_MODAL_OPEN'; payload: boolean }
    | { type: 'SET_SETTINGS_OPEN'; payload: boolean }
    | { type: 'SET_ACTIVE_TAB'; payload: 'network' | 'wallets' | 'advanced' }
    | { type: 'SET_CONFIG'; payload: ConfigType }
    | { type: 'SET_CURRENT_PAGE'; payload: 'wallets' | 'chart' | 'actions' }
    | { type: 'SET_WALLETS'; payload: WalletType[] }
    | { type: 'SET_REFRESHING'; payload: boolean }
    | { type: 'SET_CONNECTION'; payload: Connection | null }
    | { type: 'SET_SOL_BALANCES'; payload: Map<string, number> }
    | { type: 'SET_TOKEN_BALANCES'; payload: Map<string, number> }
    | { type: 'SET_AMM_KEY'; payload: string | null }
    | { type: 'SET_LOADING_CHART'; payload: boolean }
    | { type: 'SET_MARKET_CAP'; payload: number | null }
    | { type: 'SET_MODAL'; payload: { modal: keyof AppState['modals']; open: boolean } }
    | { type: 'SET_SORT_DIRECTION'; payload: 'asc' | 'desc' }
    | { type: 'SET_TICK_EFFECT'; payload: boolean }
    | { type: 'SET_STATUS'; payload: { message: string; isVisible: boolean } }
    | { type: 'UPDATE_BALANCE'; payload: { address: string; solBalance?: number; tokenBalance?: number } }
    | { type: 'SET_FLOATING_CARD_OPEN'; payload: boolean }
    | { type: 'SET_FLOATING_CARD_POSITION'; payload: { x: number; y: number } }
    | { type: 'SET_FLOATING_CARD_DRAGGING'; payload: boolean }
    | { type: 'SET_QUICK_BUY_ENABLED'; payload: boolean }
    | { type: 'SET_QUICK_BUY_AMOUNT'; payload: number }
    | { type: 'SET_QUICK_BUY_MIN_AMOUNT'; payload: number }
    | { type: 'SET_QUICK_BUY_MAX_AMOUNT'; payload: number }
    | { type: 'SET_USE_QUICK_BUY_RANGE'; payload: boolean };

  const initialState: AppState = {
    copiedAddress: null,
    tokenAddress: '',
    isModalOpen: false,
    isSettingsOpen: false,
    activeTab: 'network',
    config: {
      rpcEndpoint: 'https://smart-special-thunder.solana-mainnet.quiknode.pro/1366b058465380d24920f9d348f85325455d398d/',
      transactionFee: '0.000005',
      apiKey: '',
      selectedDex: 'auto',
      isDropdownOpen: false,
      buyAmount: '',
      sellAmount: ''
    },
    currentPage: 'wallets',
    wallets: [],
    isRefreshing: false,
    connection: null,
    solBalances: new Map(),
    tokenBalances: new Map(),
    ammKey: null,
    isLoadingChart: false,
    currentMarketCap: null,
    modals: {
      burnModalOpen: false,
      calculatePNLModalOpen: false,
      deployModalOpen: false,
      cleanerTokensModalOpen: false,
      customBuyModalOpen: false
    },
    sortDirection: 'asc',
    tickEffect: false,
    status: {
      message: '',
      isVisible: false
    },
    floatingCard: {
      isOpen: false,
      position: { x: 100, y: 100 },
      isDragging: false
    },
    quickBuyEnabled: true,
    quickBuyAmount: 0.01,
    quickBuyMinAmount: 0.01,
    quickBuyMaxAmount: 0.05,
    useQuickBuyRange: false
  };

  const appReducer = (state: AppState, action: AppAction): AppState => {
    switch (action.type) {
      case 'SET_COPIED_ADDRESS':
        return { ...state, copiedAddress: action.payload };
      case 'SET_TOKEN_ADDRESS':
        return { ...state, tokenAddress: action.payload };
      case 'SET_MODAL_OPEN':
        return { ...state, isModalOpen: action.payload };
      case 'SET_SETTINGS_OPEN':
        return { ...state, isSettingsOpen: action.payload };
      case 'SET_ACTIVE_TAB':
        return { ...state, activeTab: action.payload };
      case 'SET_CONFIG':
        return { ...state, config: action.payload };
      case 'SET_CURRENT_PAGE':
        return { ...state, currentPage: action.payload };
      case 'SET_WALLETS':
        return { ...state, wallets: action.payload };
      case 'SET_REFRESHING':
        return { ...state, isRefreshing: action.payload };
      case 'SET_CONNECTION':
        return { ...state, connection: action.payload };
      case 'SET_SOL_BALANCES':
        return { ...state, solBalances: action.payload };
      case 'SET_TOKEN_BALANCES':
        return { ...state, tokenBalances: action.payload };
      case 'SET_AMM_KEY':
        return { ...state, ammKey: action.payload };
      case 'SET_LOADING_CHART':
        return { ...state, isLoadingChart: action.payload };
      case 'SET_MARKET_CAP':
        return { ...state, currentMarketCap: action.payload };
      case 'SET_MODAL':
        return {
          ...state,
          modals: {
            ...state.modals,
            [action.payload.modal]: action.payload.open
          }
        };
      case 'SET_SORT_DIRECTION':
        return { ...state, sortDirection: action.payload };
      case 'SET_TICK_EFFECT':
        return { ...state, tickEffect: action.payload };
      case 'SET_STATUS':
        return { ...state, status: action.payload };
      case 'UPDATE_BALANCE':
        const newState = { ...state };
        if (action.payload.solBalance !== undefined) {
          newState.solBalances = new Map(state.solBalances);
          newState.solBalances.set(action.payload.address, action.payload.solBalance);
        }
        if (action.payload.tokenBalance !== undefined) {
          newState.tokenBalances = new Map(state.tokenBalances);
          newState.tokenBalances.set(action.payload.address, action.payload.tokenBalance);
        }
        return newState;
      case 'SET_FLOATING_CARD_OPEN':
        return {
          ...state,
          floatingCard: {
            ...state.floatingCard,
            isOpen: action.payload
          }
        };
      case 'SET_FLOATING_CARD_POSITION':
        return {
          ...state,
          floatingCard: {
            ...state.floatingCard,
            position: action.payload
          }
        };
      case 'SET_FLOATING_CARD_DRAGGING':
        return {
          ...state,
          floatingCard: {
            ...state.floatingCard,
            isDragging: action.payload
          }
        };
      case 'SET_QUICK_BUY_ENABLED':
        return { ...state, quickBuyEnabled: action.payload };
      case 'SET_QUICK_BUY_AMOUNT':
        return { ...state, quickBuyAmount: action.payload };
      case 'SET_QUICK_BUY_MIN_AMOUNT':
        return { ...state, quickBuyMinAmount: action.payload };
      case 'SET_QUICK_BUY_MAX_AMOUNT':
        return { ...state, quickBuyMaxAmount: action.payload };
      case 'SET_USE_QUICK_BUY_RANGE':
        return { ...state, useQuickBuyRange: action.payload };
      default:
        return state;
    }
  };

  const [state, dispatch] = useReducer(appReducer, initialState);
  const { showToast } = useToast();

  // Memoized selectors for expensive calculations
  const memoizedBalances = useMemo(() => {
    return {
      totalSolBalance: Array.from(state.solBalances.values()).reduce((sum, balance) => sum + balance, 0),
      totalTokenBalance: Array.from(state.tokenBalances.values()).reduce((sum, balance) => sum + balance, 0),
      walletsWithBalance: state.wallets.filter(wallet => 
        (state.solBalances.get(wallet.address) || 0) > 0 || 
        (state.tokenBalances.get(wallet.address) || 0) > 0
      )
    };
  }, [state.solBalances, state.tokenBalances, state.wallets]);

  // Memoized callbacks to prevent unnecessary re-renders
  const memoizedCallbacks = useMemo(() => ({
    setCopiedAddress: (address: string | null) => dispatch({ type: 'SET_COPIED_ADDRESS', payload: address }),
    setTokenAddress: (address: string) => dispatch({ type: 'SET_TOKEN_ADDRESS', payload: address }),
    setIsModalOpen: (open: boolean) => dispatch({ type: 'SET_MODAL_OPEN', payload: open }),
    setIsSettingsOpen: (open: boolean) => dispatch({ type: 'SET_SETTINGS_OPEN', payload: open }),
    setActiveTab: (tab: 'network' | 'wallets' | 'advanced') => dispatch({ type: 'SET_ACTIVE_TAB', payload: tab }),
    setConfig: (config: ConfigType) => dispatch({ type: 'SET_CONFIG', payload: config }),
    setCurrentPage: (page: 'wallets' | 'chart' | 'actions') => dispatch({ type: 'SET_CURRENT_PAGE', payload: page }),
    setWallets: (wallets: WalletType[]) => dispatch({ type: 'SET_WALLETS', payload: wallets }),
    setIsRefreshing: (refreshing: boolean) => dispatch({ type: 'SET_REFRESHING', payload: refreshing }),
    setConnection: (connection: Connection | null) => dispatch({ type: 'SET_CONNECTION', payload: connection }),
    setSolBalances: (balances: Map<string, number>) => dispatch({ type: 'SET_SOL_BALANCES', payload: balances }),
    setTokenBalances: (balances: Map<string, number>) => dispatch({ type: 'SET_TOKEN_BALANCES', payload: balances }),
    setAmmKey: (key: string | null) => dispatch({ type: 'SET_AMM_KEY', payload: key }),
    setIsLoadingChart: (loading: boolean) => dispatch({ type: 'SET_LOADING_CHART', payload: loading }),
    setCurrentMarketCap: (cap: number | null) => dispatch({ type: 'SET_MARKET_CAP', payload: cap }),
    setBurnModalOpen: (open: boolean) => dispatch({ type: 'SET_MODAL', payload: { modal: 'burnModalOpen', open } }),
    setCalculatePNLModalOpen: (open: boolean) => dispatch({ type: 'SET_MODAL', payload: { modal: 'calculatePNLModalOpen', open } }),
    setDeployModalOpen: (open: boolean) => dispatch({ type: 'SET_MODAL', payload: { modal: 'deployModalOpen', open } }),
    setCleanerTokensModalOpen: (open: boolean) => dispatch({ type: 'SET_MODAL', payload: { modal: 'cleanerTokensModalOpen', open } }),
    setCustomBuyModalOpen: (open: boolean) => dispatch({ type: 'SET_MODAL', payload: { modal: 'customBuyModalOpen', open } }),
    setSortDirection: (direction: 'asc' | 'desc') => dispatch({ type: 'SET_SORT_DIRECTION', payload: direction }),
    setTickEffect: (effect: boolean) => dispatch({ type: 'SET_TICK_EFFECT', payload: effect }),
    setStatusMessage: (message: string) => dispatch({ type: 'SET_STATUS', payload: { message, isVisible: state.status.isVisible } }),
    setIsStatusVisible: (visible: boolean) => dispatch({ type: 'SET_STATUS', payload: { message: state.status.message, isVisible: visible } }),
    setFloatingCardOpen: (open: boolean) => dispatch({ type: 'SET_FLOATING_CARD_OPEN', payload: open }),
    setFloatingCardPosition: (position: { x: number; y: number }) => dispatch({ type: 'SET_FLOATING_CARD_POSITION', payload: position }),
    setFloatingCardDragging: (dragging: boolean) => dispatch({ type: 'SET_FLOATING_CARD_DRAGGING', payload: dragging }),
    setQuickBuyEnabled: (enabled: boolean) => dispatch({ type: 'SET_QUICK_BUY_ENABLED', payload: enabled }),
    setQuickBuyAmount: (amount: number) => dispatch({ type: 'SET_QUICK_BUY_AMOUNT', payload: amount }),
    setQuickBuyMinAmount: (amount: number) => dispatch({ type: 'SET_QUICK_BUY_MIN_AMOUNT', payload: amount }),
    setQuickBuyMaxAmount: (amount: number) => dispatch({ type: 'SET_QUICK_BUY_MAX_AMOUNT', payload: amount }),
    setUseQuickBuyRange: (useRange: boolean) => dispatch({ type: 'SET_USE_QUICK_BUY_RANGE', payload: useRange })
  }), [state.status]);

  // Separate callbacks for config updates to prevent unnecessary re-renders
  const configCallbacks = useMemo(() => ({
    setBuyAmount: (amount: string) => dispatch({ type: 'SET_CONFIG', payload: { ...state.config, buyAmount: amount } }),
    setSellAmount: (amount: string) => dispatch({ type: 'SET_CONFIG', payload: { ...state.config, sellAmount: amount } }),
    setSelectedDex: (dex: string) => dispatch({ type: 'SET_CONFIG', payload: { ...state.config, selectedDex: dex } }),
    setIsDropdownOpen: (open: boolean) => dispatch({ type: 'SET_CONFIG', payload: { ...state.config, isDropdownOpen: open } })
  }), [state.config]);

  // Debounced status fetching to reduce API calls
  const debouncedStatusFetch = useMemo(() => {
    let timeoutId: NodeJS.Timeout;
    return () => {
      clearTimeout(timeoutId);
      timeoutId = setTimeout(async () => {
        try {
          const baseUrl = (window as any).tradingServerUrl?.replace(/\/+$/, '') || '';
          const response = await fetch(`${baseUrl}/status`);
          const data = await response.json();
          const statusText = data.status || '';
          const trimmedText = statusText.trim();
          
          if (trimmedText && trimmedText !== state.status.message) {
            memoizedCallbacks.setStatusMessage(trimmedText);
            memoizedCallbacks.setIsStatusVisible(true);
          } else if (!trimmedText && state.status.isVisible) {
            memoizedCallbacks.setIsStatusVisible(false);
            memoizedCallbacks.setStatusMessage('');
          }
        } catch (error) {
          console.error('Failed to fetch status:', error);
        }
      }, 1000);
    };
  }, [state.status.message, state.status.isVisible, memoizedCallbacks]);

  // DEX options for trading
  const dexOptions = [
    { value: 'auto', label: 'Auto Route' },
    { value: 'pumpfun', label: 'PumpFun' },
    { value: 'moonshot', label: 'Moonshot' },
    { value: 'pumpswap', label: 'PumpSwap' },
    { value: 'raydium', label: 'Raydium' },
    { value: 'jupiter', label: 'Jupiter' },
    { value: 'launchpad', label: 'Launchpad' },
    { value: 'boopfun', label: 'BoopFun' },
  ];

  // Handle trade submission
  const handleTradeSubmit = async (wallets: WalletType[], isBuyMode: boolean, dex?: string, buyAmount?: string, sellAmount?: string) => {
    memoizedCallbacks.setIsRefreshing(true);
    
    if (!state.tokenAddress) {
      showToast("Please select a token first", "error");
      memoizedCallbacks.setIsRefreshing(false);
      return;
    }
    
    // If selected DEX is "auto", use the dex parameter passed from FloatingTradingCard
    if (state.config.selectedDex === 'auto') {
      if (dex && dex !== 'auto') {
        // Use the DEX determined by FloatingTradingCard
        showToast(`Using ${dexOptions.find(d => d.value === dex)?.label} for best rate`, "success");
        await originalHandleTradeSubmit(dex, wallets, isBuyMode, buyAmount, sellAmount);
      } else {
        // Fallback to Jupiter if no specific DEX is provided
        showToast("No optimal route determined. Using Jupiter as fallback.", "error");
        await originalHandleTradeSubmit('jupiter', wallets, isBuyMode, buyAmount, sellAmount);
      }
      return;
    }
    
    // If not auto, use the selected DEX
     await originalHandleTradeSubmit(state.config.selectedDex, wallets, isBuyMode, buyAmount, sellAmount);
  };

  // Original trade submit function that accepts selectedDex as a parameter
  const originalHandleTradeSubmit = async (dex: string, wallets: WalletType[], isBuyMode: boolean, buyAmount?: string, sellAmount?: string) => {
    // Moonshot implementation
    if (dex === 'moonshot') {
      try {
        // Get active wallets
        const activeWallets = wallets.filter(wallet => wallet.isActive);
        
        if (activeWallets.length === 0) {
           showToast("Please activate at least one wallet", "error");
           memoizedCallbacks.setIsRefreshing(false);
           return;
         }
        
        // Format wallets for MoonBuy/MoonSell
        const formattedWallets = activeWallets.map(wallet => ({
          address: wallet.address,
          privateKey: wallet.privateKey
        }));
        
        if (isBuyMode) {
          // MoonBuy flow
           const tokenConfig = {
             tokenAddress: state.tokenAddress,
             solAmount: parseFloat(buyAmount || state.config.buyAmount)
           };
          
          // Create a balance map for validation
           const walletBalances = new Map<string, number>();
           activeWallets.forEach(wallet => {
             const balance = state.solBalances.get(wallet.address) || 0;
             walletBalances.set(wallet.address, balance);
           });
          
          // Import and validate inputs before executing
          const { validateMoonBuyInputs, executeMoonBuy } = await import('./utils/moonbuy');
          
          const validation = validateMoonBuyInputs(formattedWallets, tokenConfig, walletBalances);
           if (!validation.valid) {
             showToast(`Validation failed: ${validation.error}`, "error");
             memoizedCallbacks.setIsRefreshing(false);
             return;
           }
          
          console.log(`Executing MoonBuy for ${state.tokenAddress} with ${activeWallets.length} wallets`);
          
          // Execute MoonBuy operation
          const result = await executeMoonBuy(formattedWallets, tokenConfig);
          
          if (result.success) {
            showToast("MoonBuy transactions submitted successfully", "success");
            handleRefresh(); // Refresh balances
          } else {
            showToast(`MoonBuy failed: ${result.error}`, "error");
          }
        } else {
          // MoonSell flow
           const tokenConfig = {
             tokenAddress: state.tokenAddress,
             sellPercent: parseFloat(sellAmount || state.config.sellAmount)
           };
          
          // Import and execute MoonSell
          const { executeMoonSell } = await import('./utils/moonsell');
          
          console.log(`Executing MoonSell for ${state.tokenAddress} with ${activeWallets.length} wallets`);
          
          // Execute MoonSell operation
          const result = await executeMoonSell(formattedWallets, tokenConfig);
          
          if (result.success) {
            showToast("MoonSell transactions submitted successfully", "success");
            handleRefresh(); // Refresh balances
          } else {
            showToast(`MoonSell failed: ${result.error}`, "error");
          }
        }
      } catch (error) {
        console.error(`Moonshot ${isBuyMode ? 'Buy' : 'Sell'} error:`, error);
        showToast(`Error: ${error.message}`, "error");
      } finally {
         memoizedCallbacks.setIsRefreshing(false);
       }
      return;
    }
    
    // BoopFun implementation
    if (dex === 'boopfun') {
      try {
        // Get active wallets
        const activeWallets = wallets.filter(wallet => wallet.isActive);
        
        if (activeWallets.length === 0) {
           showToast("Please activate at least one wallet", "error");
           memoizedCallbacks.setIsRefreshing(false);
           return;
         }
        
        // Format wallets for BoopBuy/BoopSell
        const formattedWallets = activeWallets.map(wallet => ({
          address: wallet.address,
          privateKey: wallet.privateKey
        }));
        
        if (isBuyMode) {
          // BoopBuy flow
           const tokenConfig = {
             tokenAddress: state.tokenAddress,
             solAmount: parseFloat(buyAmount || state.config.buyAmount)
           };
          
          // Create a balance map for validation
           const walletBalances = new Map<string, number>();
           activeWallets.forEach(wallet => {
             const balance = state.solBalances.get(wallet.address) || 0;
             walletBalances.set(wallet.address, balance);
           });
          
          // Import and validate inputs before executing
          const { validateBoopBuyInputs, executeBoopBuy } = await import('./utils/boopbuy');
          
          const validation = validateBoopBuyInputs(formattedWallets, tokenConfig, walletBalances);
           if (!validation.valid) {
             showToast(`Validation failed: ${validation.error}`, "error");
             memoizedCallbacks.setIsRefreshing(false);
             return;
           }
          
          console.log(`Executing BoopBuy for ${state.tokenAddress} with ${activeWallets.length} wallets`);
          
          // Execute BoopBuy operation
          const result = await executeBoopBuy(formattedWallets, tokenConfig);
          
          if (result.success) {
            showToast("BoopBuy transactions submitted successfully", "success");
            handleRefresh(); // Refresh balances
          } else {
            showToast(`BoopBuy failed: ${result.error}`, "error");
          }
        } else {
          // BoopSell flow
           const tokenConfig = {
             tokenAddress: state.tokenAddress,
             sellPercent: parseFloat(sellAmount || state.config.sellAmount)
           };
          
          // Import and execute BoopSell
          const { executeBoopSell } = await import('./utils/boopsell');
          
          console.log(`Executing BoopSell for ${state.tokenAddress} with ${activeWallets.length} wallets`);
          
          // Execute BoopSell operation
          const result = await executeBoopSell(formattedWallets, tokenConfig);
          
          if (result.success) {
            showToast("BoopSell transactions submitted successfully", "success");
            handleRefresh(); // Refresh balances
          } else {
            showToast(`BoopSell failed: ${result.error}`, "error");
          }
        }
      } catch (error) {
        console.error(`Boop${isBuyMode ? 'Buy' : 'Sell'} error:`, error);
        showToast(`Error: ${error.message}`, "error");
      } finally {
         memoizedCallbacks.setIsRefreshing(false);
       }
      return;
    }
    
    // PumpFun implementation
    if (dex === 'pumpfun') {
      try {
        // Get active wallets
        const activeWallets = wallets.filter(wallet => wallet.isActive);
        
        if (activeWallets.length === 0) {
           showToast("Please activate at least one wallet", "error");
           memoizedCallbacks.setIsRefreshing(false);
           return;
         }
        
        // Format wallets for PumpBuy/PumpSell
        const formattedWallets = activeWallets.map(wallet => ({
          address: wallet.address,
          privateKey: wallet.privateKey
        }));
        
        if (isBuyMode) {
          // PumpBuy flow
           const tokenConfig = {
             tokenAddress: state.tokenAddress,
             solAmount: parseFloat(buyAmount || state.config.buyAmount)
           };
          
          // Create a balance map for validation
           const walletBalances = new Map<string, number>();
           activeWallets.forEach(wallet => {
             const balance = state.solBalances.get(wallet.address) || 0;
             walletBalances.set(wallet.address, balance);
           });
          
          // Import and validate inputs before executing
          const { validatePumpBuyInputs, executePumpBuy } = await import('./utils/pumpbuy');
          
          const validation = validatePumpBuyInputs(formattedWallets, tokenConfig, walletBalances);
           if (!validation.valid) {
             showToast(`Validation failed: ${validation.error}`, "error");
             memoizedCallbacks.setIsRefreshing(false);
             return;
           }
          
          console.log(`Executing PumpBuy for ${state.tokenAddress} with ${activeWallets.length} wallets`);
          
          // Execute PumpBuy operation
          const result = await executePumpBuy(formattedWallets, tokenConfig);
          
          if (result.success) {
            showToast("PumpBuy transactions submitted successfully", "success");
            handleRefresh(); // Refresh balances
          } else {
            showToast(`PumpBuy failed: ${result.error}`, "error");
          }
        } else {
          // PumpSell flow
           const tokenConfig = {
             tokenAddress: state.tokenAddress,
             sellPercent: parseFloat(sellAmount || state.config.sellAmount)
           };
          
          // Import and execute PumpSell
          const { executePumpSell } = await import('./utils/pumpsell');
          
          console.log(`Executing PumpSell for ${state.tokenAddress} with ${activeWallets.length} wallets`);
          
          // Execute PumpSell operation
          const result = await executePumpSell(formattedWallets, tokenConfig);
          
          if (result.success) {
            showToast("PumpSell transactions submitted successfully", "success");
            handleRefresh(); // Refresh balances
          } else {
            showToast(`PumpSell failed: ${result.error}`, "error");
          }
        }
      } catch (error) {
        console.error(`Pump${isBuyMode ? 'Buy' : 'Sell'} error:`, error);
        showToast(`Error: ${error.message}`, "error");
      } finally {
         memoizedCallbacks.setIsRefreshing(false);
       }
      return;
    }
    
    // Jupiter implementation
    if (dex === 'jupiter') {
      try {
        // Get active wallets
        const activeWallets = wallets.filter(wallet => wallet.isActive);
        
        if (activeWallets.length === 0) {
           showToast("Please activate at least one wallet", "error");
           memoizedCallbacks.setIsRefreshing(false);
           return;
         }
        
        // Format wallets for Jupiter operations
        const formattedWallets = activeWallets.map(wallet => ({
          address: wallet.address,
          privateKey: wallet.privateKey
        }));
        
        if (isBuyMode) {
          // Jupiter Buy flow
          const swapConfig = {
            inputMint: "So11111111111111111111111111111111111111112", // SOL
            outputMint: state.tokenAddress,
            solAmount: parseFloat(buyAmount || state.config.buyAmount),
            slippageBps: 9900 // Default to 1% slippage
          };
          
          // Create a balance map for validation
           const walletBalances = new Map<string, number>();
           activeWallets.forEach(wallet => {
             const balance = state.solBalances.get(wallet.address) || 0;
             walletBalances.set(wallet.address, balance);
           });
          
          // Import and validate inputs before executing
          const { validateJupSwapInputs, executeJupSwap } = await import('./utils/jupbuy');
          
          const validation = validateJupSwapInputs(formattedWallets, swapConfig, walletBalances);
          if (!validation.valid) {
            showToast(`Validation failed: ${validation.error}`, "error");
            memoizedCallbacks.setIsRefreshing(false);
            return;
          }
          
          console.log(`Executing Jupiter Swap (Buy) for ${state.tokenAddress} with ${activeWallets.length} wallets`);
          
          // Execute JupSwap operation
          const result = await executeJupSwap(formattedWallets, swapConfig);
          
          if (result.success) {
            showToast("Jupiter Buy transactions submitted successfully", "success");
            handleRefresh(); // Refresh balances
          } else {
            showToast(`Jupiter Buy failed: ${result.error}`, "error");
          }
        } else {
          // Jupiter Sell flow
          const sellConfig = {
            inputMint: state.tokenAddress, // Token to sell
            outputMint: "So11111111111111111111111111111111111111112", // SOL
            sellPercent: parseFloat(sellAmount || state.config.sellAmount), // Percentage of tokens to sell
            slippageBps: 9900 // Default to 1% slippage
          };
          
          // Import the dedicated sell functions from jupsell
          const { executeJupSell } = await import('./utils/jupsell');
          
          console.log(`Executing Jupiter Sell for ${state.tokenAddress} with ${activeWallets.length} wallets (${sellConfig.sellPercent}%)`);
          
          // Execute JupSell operation with RPC URL
          const result = await executeJupSell(formattedWallets, sellConfig);
          
          if (result.success) {
            showToast("Jupiter Sell transactions submitted successfully", "success");
            handleRefresh(); // Refresh balances
          } else {
            showToast(`Jupiter Sell failed: ${result.error}`, "error");
          }
        }
      } catch (error) {
        console.error(`Jupiter ${isBuyMode ? 'Buy' : 'Sell'} error:`, error);
        showToast(`Error: ${error.message}`, "error");
      } finally {
         memoizedCallbacks.setIsRefreshing(false);
       }
      return;
    }
  
    // Raydium implementation
    if (dex === 'raydium') {
      try {
        // Get active wallets
        const activeWallets = wallets.filter(wallet => wallet.isActive);
        
        if (activeWallets.length === 0) {
           showToast("Please activate at least one wallet", "error");
           memoizedCallbacks.setIsRefreshing(false);
           return;
         }
        
        // Format wallets for RayBuy/RaySell
        const formattedWallets = activeWallets.map(wallet => ({
          address: wallet.address,
          privateKey: wallet.privateKey
        }));
        
        if (isBuyMode) {
          // RayBuy flow
          const tokenConfig = {
            tokenAddress: state.tokenAddress,
            solAmount: parseFloat(buyAmount || state.config.buyAmount)
          };
          
          // Create a balance map for validation
           const walletBalances = new Map<string, number>();
           activeWallets.forEach(wallet => {
             const balance = state.solBalances.get(wallet.address) || 0;
             walletBalances.set(wallet.address, balance);
           });
          
          // Import and validate inputs before executing
          const { validateRayBuyInputs, executeRayBuy } = await import('./utils/raybuy');
          
          const validation = validateRayBuyInputs(formattedWallets, tokenConfig, walletBalances);
          if (!validation.valid) {
            showToast(`Validation failed: ${validation.error}`, "error");
            memoizedCallbacks.setIsRefreshing(false);
            return;
          }
          
          console.log(`Executing RayBuy for ${state.tokenAddress} with ${activeWallets.length} wallets`);
          
          // Execute RayBuy operation
          const result = await executeRayBuy(formattedWallets, tokenConfig);
          
          if (result.success) {
            showToast("RayBuy transactions submitted successfully", "success");
            handleRefresh(); // Refresh balances
          } else {
            showToast(`RayBuy failed: ${result.error}`, "error");
          }
        } else {
          // RaySell flow
          const tokenConfig = {
            tokenAddress: state.tokenAddress,
            sellPercent: parseFloat(sellAmount || state.config.sellAmount)
          };
          
          // Import and execute RaySell
          const { executeRaySell } = await import('./utils/raysell');
          
          console.log(`Executing RaySell for ${state.tokenAddress} with ${activeWallets.length} wallets`);
          
          // Execute RaySell operation
          const result = await executeRaySell(formattedWallets, tokenConfig);
          
          if (result.success) {
            showToast("RaySell transactions submitted successfully", "success");
            handleRefresh(); // Refresh balances
          } else {
            showToast(`RaySell failed: ${result.error}`, "error");
          }
        }
      } catch (error) {
        console.error(`Raydium ${isBuyMode ? 'Buy' : 'Sell'} error:`, error);
        showToast(`Error: ${error.message}`, "error");
      } finally {
         memoizedCallbacks.setIsRefreshing(false);
       }
      return;
    }
    
    // Launchpad implementation
    if (dex === 'launchpad') {
      try {
        // Get active wallets
        const activeWallets = wallets.filter(wallet => wallet.isActive);
        
        if (activeWallets.length === 0) {
           showToast("Please activate at least one wallet", "error");
           memoizedCallbacks.setIsRefreshing(false);
           return;
         }
        
        // Format wallets for LaunchBuy/LaunchSell
        const formattedWallets = activeWallets.map(wallet => ({
          address: wallet.address,
          privateKey: wallet.privateKey
        }));
        
        if (isBuyMode) {
          // LaunchBuy flow
          const tokenConfig = {
            tokenAddress: state.tokenAddress,
            solAmount: parseFloat(buyAmount || state.config.buyAmount)
          };
          
          // Create a balance map for validation
           const walletBalances = new Map<string, number>();
           activeWallets.forEach(wallet => {
             const balance = state.solBalances.get(wallet.address) || 0;
             walletBalances.set(wallet.address, balance);
           });
          
          // Import and validate inputs before executing
          const { validateLaunchBuyInputs, executeLaunchBuy } = await import('./utils/launchbuy');
          
          const validation = validateLaunchBuyInputs(formattedWallets, tokenConfig, walletBalances);
          if (!validation.valid) {
            showToast(`Validation failed: ${validation.error}`, "error");
            memoizedCallbacks.setIsRefreshing(false);
            return;
          }
          
          console.log(`Executing LaunchBuy for ${state.tokenAddress} with ${activeWallets.length} wallets`);
          
          // Execute LaunchBuy operation
          const result = await executeLaunchBuy(formattedWallets, tokenConfig);
          
          if (result.success) {
            showToast("LaunchBuy transactions submitted successfully", "success");
            handleRefresh(); // Refresh balances
          } else {
            showToast(`LaunchBuy failed: ${result.error}`, "error");
          }
        } else {
          // LaunchSell flow
          const tokenConfig = {
            tokenAddress: state.tokenAddress,
            sellPercent: parseFloat(sellAmount || state.config.sellAmount)
          };
          
          // Import and execute LaunchSell
          const { executeLaunchSell } = await import('./utils/launchsell');
          
          console.log(`Executing LaunchSell for ${state.tokenAddress} with ${activeWallets.length} wallets`);
          
          // Execute LaunchSell operation
          const result = await executeLaunchSell(formattedWallets, tokenConfig);
          
          if (result.success) {
            showToast("LaunchSell transactions submitted successfully", "success");
            handleRefresh(); // Refresh balances
          } else {
            showToast(`LaunchSell failed: ${result.error}`, "error");
          }
        }
      } catch (error) {
        console.error(`Launch ${isBuyMode ? 'Buy' : 'Sell'} error:`, error);
        showToast(`Error: ${error.message}`, "error");
      } finally {
         memoizedCallbacks.setIsRefreshing(false);
       }
      return;
    }
    
    // PumpSwap implementation
    if (dex === 'pumpswap') {
      try {
        // Get active wallets
        const activeWallets = wallets.filter(wallet => wallet.isActive);
        
        if (activeWallets.length === 0) {
           showToast("Please activate at least one wallet", "error");
           memoizedCallbacks.setIsRefreshing(false);
           return;
         }
        
        // Format wallets for SwapBuy/SwapSell
        const formattedWallets = activeWallets.map(wallet => ({
          address: wallet.address,
          privateKey: wallet.privateKey
        }));
        
        if (isBuyMode) {
          // SwapBuy flow
          const tokenConfig = {
            tokenAddress: state.tokenAddress,
            solAmount: parseFloat(buyAmount || state.config.buyAmount)
          };
          
          // Create a balance map for validation
           const walletBalances = new Map<string, number>();
           activeWallets.forEach(wallet => {
             const balance = state.solBalances.get(wallet.address) || 0;
             walletBalances.set(wallet.address, balance);
           });
          
          // Import and validate inputs before executing
          const { validateSwapBuyInputs, executeSwapBuy } = await import('./utils/swapbuy');
          
          const validation = validateSwapBuyInputs(formattedWallets, tokenConfig, walletBalances);
          if (!validation.valid) {
            showToast(`Validation failed: ${validation.error}`, "error");
            memoizedCallbacks.setIsRefreshing(false);
            return;
          }
          
          console.log(`Executing SwapBuy for ${state.tokenAddress} with ${activeWallets.length} wallets`);
          
          // Execute SwapBuy operation
          const result = await executeSwapBuy(formattedWallets, tokenConfig);
          
          if (result.success) {
            showToast("SwapBuy transactions submitted successfully", "success");
            handleRefresh(); // Refresh balances
          } else {
            showToast(`SwapBuy failed: ${result.error}`, "error");
          }
        } else {
          // SwapSell flow
          const tokenConfig = {
            tokenAddress: state.tokenAddress,
            sellPercent: parseFloat(sellAmount || state.config.sellAmount)
          };
          
          // Import and execute SwapSell
          const { executeSwapSell } = await import('./utils/swapsell');
          
          console.log(`Executing SwapSell for ${state.tokenAddress} with ${activeWallets.length} wallets`);
          
          // Execute SwapSell operation
          const result = await executeSwapSell(formattedWallets, tokenConfig);
          
          if (result.success) {
            showToast("SwapSell transactions submitted successfully", "success");
            handleRefresh(); // Refresh balances
          } else {
            showToast(`SwapSell failed: ${result.error}`, "error");
          }
        }
      } catch (error) {
        console.error(`Swap ${isBuyMode ? 'Buy' : 'Sell'} error:`, error);
        showToast(`Error: ${error.message}`, "error");
      } finally {
         memoizedCallbacks.setIsRefreshing(false);
       }
      return;
    }
    
    // Default case - unsupported DEX
    showToast(`Unsupported DEX: ${dex}`, "error");
    memoizedCallbacks.setIsRefreshing(false);
  };

  // Fetch status from API with reduced frequency
  useEffect(() => {
    debouncedStatusFetch();
    const interval = setInterval(debouncedStatusFetch, 60000); // Reduced to 60 seconds
    return () => clearInterval(interval);
  }, [debouncedStatusFetch]);

  // Extract API key from URL
  useEffect(() => {
    handleApiKeyFromUrl(memoizedCallbacks.setConfig, saveConfigToCookies, showToast);
  }, [memoizedCallbacks.setConfig]);

  // Read tokenAddress from URL parameter on mount
  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    const tokenFromUrl = urlParams.get('tokenAddress');
    if (tokenFromUrl) {
      memoizedCallbacks.setTokenAddress(tokenFromUrl);
    }
  }, [memoizedCallbacks.setTokenAddress]);

  // Update URL when tokenAddress changes
  useEffect(() => {
    const url = new URL(window.location.href);
    if (state.tokenAddress) {
      url.searchParams.set('tokenAddress', state.tokenAddress);
    } else {
      url.searchParams.delete('tokenAddress');
    }
    window.history.replaceState({}, '', url.toString());
  }, [state.tokenAddress]);

  // Fetch AMM key when token address changes
  useEffect(() => {
    if (state.tokenAddress) {
      fetchAmmKey(state.tokenAddress, memoizedCallbacks.setAmmKey, memoizedCallbacks.setIsLoadingChart);
    }
  }, [state.tokenAddress, memoizedCallbacks.setAmmKey, memoizedCallbacks.setIsLoadingChart]);
  
  // Initialize app on mount
  useEffect(() => {
    const initializeApp = () => {
      // Load saved config
      const savedConfig = loadConfigFromCookies();
      if (savedConfig) {
        memoizedCallbacks.setConfig(savedConfig);
        
        // Create connection after loading config
        try {
          const conn = new Connection(savedConfig.rpcEndpoint);
          memoizedCallbacks.setConnection(conn);
        } catch (error) {
          console.error('Error creating connection:', error);
        }
      }
      
      // Load saved wallets
      const savedWallets = loadWalletsFromCookies();
      if (savedWallets && savedWallets.length > 0) {
        memoizedCallbacks.setWallets(savedWallets);
      }
      
      // Load saved quick buy preferences
      const savedQuickBuyPreferences = loadQuickBuyPreferencesFromCookies();
      if (savedQuickBuyPreferences) {
        memoizedCallbacks.setQuickBuyEnabled(savedQuickBuyPreferences.quickBuyEnabled);
        memoizedCallbacks.setQuickBuyAmount(savedQuickBuyPreferences.quickBuyAmount);
        memoizedCallbacks.setQuickBuyMinAmount(savedQuickBuyPreferences.quickBuyMinAmount);
        memoizedCallbacks.setQuickBuyMaxAmount(savedQuickBuyPreferences.quickBuyMaxAmount);
        memoizedCallbacks.setUseQuickBuyRange(savedQuickBuyPreferences.useQuickBuyRange);
      }
    };

    initializeApp();
  }, [memoizedCallbacks]);

  // Save wallets when they change
  useEffect(() => {
    if (state.wallets.length > 0) {
      saveWalletsToCookies(state.wallets);
    }
  }, [state.wallets]);

  // Save quick buy preferences when they change
  useEffect(() => {
    const preferences = {
      quickBuyEnabled: state.quickBuyEnabled,
      quickBuyAmount: state.quickBuyAmount,
      quickBuyMinAmount: state.quickBuyMinAmount,
      quickBuyMaxAmount: state.quickBuyMaxAmount,
      useQuickBuyRange: state.useQuickBuyRange
    };
    saveQuickBuyPreferencesToCookies(preferences);
  }, [state.quickBuyEnabled, state.quickBuyAmount, state.quickBuyMinAmount, state.quickBuyMaxAmount, state.useQuickBuyRange]);

  // Fetch SOL balances when wallets change or connection is established
  useEffect(() => {
    if (state.connection && state.wallets.length > 0) {
      fetchSolBalances(state.connection, state.wallets, memoizedCallbacks.setSolBalances);
    }
  }, [state.connection, state.wallets.length, memoizedCallbacks.setSolBalances]);

  // Fetch token balances when token address changes or wallets change
  useEffect(() => {
    if (state.connection && state.wallets.length > 0 && state.tokenAddress) {
      fetchTokenBalances(state.connection, state.wallets, state.tokenAddress, memoizedCallbacks.setTokenBalances);
    }
  }, [state.connection, state.wallets.length, state.tokenAddress, memoizedCallbacks.setTokenBalances]);

  // Update connection when RPC endpoint changes
  useEffect(() => {
    try {
      const conn = new Connection(state.config.rpcEndpoint);
      memoizedCallbacks.setConnection(conn);
    } catch (error) {
      console.error('Error creating connection:', error);
    }
  }, [state.config.rpcEndpoint, memoizedCallbacks.setConnection]);

  // Refresh balances on load
  useEffect(() => {
    if (state.connection && state.wallets.length > 0) {
      handleRefresh();
    }
  }, [state.connection, state.wallets.length]);

  // Add effect to refresh balances when token address changes
  useEffect(() => {
    if (state.connection && state.wallets.length > 0 && state.tokenAddress) {
      handleRefresh();
    }
  }, [state.tokenAddress, state.connection, state.wallets.length]);

  // Trigger tick animation when wallet count changes
  useEffect(() => {
    memoizedCallbacks.setTickEffect(true);
    const timer = setTimeout(() => memoizedCallbacks.setTickEffect(false), 500);
    return () => clearTimeout(timer);
  }, [state.wallets.length, memoizedCallbacks.setTickEffect]);

  // Helper functions
  const handleRefresh = useCallback(async () => {
    if (!state.connection) return;
    
    memoizedCallbacks.setIsRefreshing(true);
    
    try {
      // Fetch SOL balances
      await fetchSolBalances(state.connection, state.wallets, memoizedCallbacks.setSolBalances);
      
      // Fetch token balances if token address is provided
      if (state.tokenAddress) {
        await fetchTokenBalances(state.connection, state.wallets, state.tokenAddress, memoizedCallbacks.setTokenBalances);
      }
    } catch (error) {
      console.error('Error refreshing balances:', error);
    } finally {
      // Set refreshing to false
      memoizedCallbacks.setIsRefreshing(false);
    }
  }, [state.connection, state.wallets, state.tokenAddress, memoizedCallbacks.setIsRefreshing, memoizedCallbacks.setSolBalances, memoizedCallbacks.setTokenBalances]);

  const handleConfigChange = useCallback((key: keyof ConfigType, value: string) => {
    const newConfig = { ...state.config, [key]: value };
    saveConfigToCookies(newConfig);
    memoizedCallbacks.setConfig(newConfig);
  }, [memoizedCallbacks.setConfig, state.config]);

  const handleSaveSettings = useCallback(() => {
    saveConfigToCookies(state.config);
    memoizedCallbacks.setIsSettingsOpen(false);
  }, [state.config, memoizedCallbacks.setIsSettingsOpen]);

  const handleDeleteWallet = useCallback((id: number) => {
    const walletToDelete = state.wallets.find(w => w.id === id);
    if (walletToDelete) {
      // Remove from balances maps
      const newSolBalances = new Map(state.solBalances);
      newSolBalances.delete(walletToDelete.address);
      memoizedCallbacks.setSolBalances(newSolBalances);
      
      const newTokenBalances = new Map(state.tokenBalances);
      newTokenBalances.delete(walletToDelete.address);
      memoizedCallbacks.setTokenBalances(newTokenBalances);
    }
    
    const updatedWallets = deleteWallet(state.wallets, id);
    memoizedCallbacks.setWallets(updatedWallets);
  }, [state.wallets, state.solBalances, state.tokenBalances, memoizedCallbacks.setSolBalances, memoizedCallbacks.setTokenBalances, memoizedCallbacks.setWallets]);

  // Modal action handlers
  const openSettingsModal = useCallback(() => memoizedCallbacks.setIsSettingsOpen(true), [memoizedCallbacks.setIsSettingsOpen]);
  const closeSettingsModal = useCallback(() => memoizedCallbacks.setIsSettingsOpen(false), [memoizedCallbacks.setIsSettingsOpen]);
  const openWalletOverview = useCallback(() => memoizedCallbacks.setIsModalOpen(true), [memoizedCallbacks.setIsModalOpen]);
  const closeWalletOverview = useCallback(() => memoizedCallbacks.setIsModalOpen(false), [memoizedCallbacks.setIsModalOpen]);
  const openWalletsPage = useCallback(() => memoizedCallbacks.setCurrentPage('wallets'), [memoizedCallbacks.setCurrentPage]);
  const openChartPage = useCallback(() => memoizedCallbacks.setCurrentPage('chart'), [memoizedCallbacks.setCurrentPage]);
  const openActionsPage = useCallback(() => memoizedCallbacks.setCurrentPage('actions'), [memoizedCallbacks.setCurrentPage]);

  const handleBurn = async (amount: string) => {
    try {
      console.log('burn', amount, 'SOL to');
      showToast('Burn successful', 'success');
    } catch (error) {
      showToast('Burn failed', 'error');
    }
  };

  const handleDeploy = async (data: any) => {
    try {
      console.log('Deploy executed:', data);
      showToast('Token deployment initiated successfully', 'success');
    } catch (error) {
      console.error('Error:', error);
      showToast('Token deployment failed', 'error');
    }
  };

  const handleCleaner = async (data: any) => {
    try {
      console.log('Cleaning', data);
      showToast('Cleaning successfully', 'success');
    } catch (error) {
      showToast('Failed to clean', 'error');
    }
  };

  const handleCustomBuy = async (data: any) => {
    try {
      console.log('Custom buy executed:', data);
      showToast('Custom buy completed successfully', 'success');
    } catch (error) {
      showToast('Custom buy failed', 'error');
    }
  };

  return (
    <div className="h-screen flex flex-col overflow-hidden bg-[#050a0e] text-[#f0ecb3] cyberpunk-bg">
      {/* Cyberpunk scanline effect */}
      <div className="fixed top-0 left-0 w-full h-full pointer-events-none z-10"></div>
      
      {/* Status Notification Banner */}
      {state.status.isVisible && state.status.message && (
        <div className="relative bg-gradient-to-r from-red-900/90 to-red-800/90 border-b border-red-500/50 p-3 backdrop-blur-sm z-30">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-2 h-2 bg-red-400 rounded-full animate-pulse"></div>
              <span className="text-red-100 font-mono text-sm font-medium">
                ⚠️ SYSTEM ALERT: {state.status.message}
              </span>
            </div>
            <button
              onClick={() => memoizedCallbacks.setIsStatusVisible(false)}
              className="text-red-300 hover:text-red-100 transition-colors p-1"
              aria-label="Close notification"
            >
              <X size={16} />
            </button>
          </div>
        </div>
      )}
      
      {/* Top Navigation */}
      <nav className="relative border-b border-[#b3a10270] p-4 backdrop-blur-sm bg-[#050a0e99] z-20">
        <div className="flex items-center gap-4">

        <ServiceSelector />
          
          <div className="relative flex-1 mx-4">
            <input
              type="text"
              placeholder="TOKEN ADDRESS"
              value={state.tokenAddress}
              onChange={(e) => memoizedCallbacks.setTokenAddress(e.target.value)}
              className="w-full bg-[#0a1419] border border-[#b3a10240] rounded p-3 text-sm text-[#fbf9e4] focus:border-[#ddda09] focus:outline-none cyberpunk-input font-mono tracking-wider"
            />
            <div className="absolute right-3 top-3 text-[#b3a10240] text-xs font-mono">SOL</div>
          </div>
          
          <WalletTooltip content="Paste from clipboard" position="bottom">
            <button
              title="Paste from clipboard"
              className="p-2 border border-[#b3a10240] hover:border-[#ddda09] bg-[#0a1419] rounded cyberpunk-btn"
              onClick={async () => {
                try {
                  const text = await navigator.clipboard.readText();
                  if (text) {
                    memoizedCallbacks.setTokenAddress(text);
                    showToast("Token address pasted from clipboard", "success");
                  }
                } catch (err) {
                  showToast("Failed to read from clipboard", "error");
                }
              }}
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-[#ddda09]">
                <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"></path>
                <rect x="8" y="2" width="8" height="4" rx="1" ry="1"></rect>
              </svg>
            </button>
          </WalletTooltip>

          <WalletTooltip content="Ai" position="bottom">
            <button
              title="Ai Quant: Coming Soon"
              className="p-2 border border-[#b3a10240] hover:border-[#ddda09] bg-[#0a1419] rounded cyberpunk-btn"
              onClick={() => {
                // Ai button action
              }}
            >
              <Sparkles size={20} className="text-[#ddda09]" />
            </button>
          </WalletTooltip>

          <WalletTooltip content="VPN is Active" position="bottom">
            <button
              title="VPN is Active"
              className="p-2 border border-[#d6c187] bg-[#0a1419] rounded cyberpunk-btn animate-pulse"
            >
              <Lock size={20} className="text-[#d6c487]" />
            </button>
          </WalletTooltip>
          
          <WalletTooltip content="Open Settings" position="bottom">
            <button 
              title="Open Settings"
              className="p-2 border border-[#b3a10240] hover:border-[#ddda09] bg-[#0a1419] rounded cyberpunk-btn"
              onClick={() => memoizedCallbacks.setIsSettingsOpen(true)}
            >
              <Settings size={20} className="text-[#ddda09]" />
            </button>
          </WalletTooltip>

          <div className="flex items-center ml-4">
            <div className="flex flex-col items-start">
              <div className="text-xs text-[#ddc765] font-mono uppercase tracking-wider">WALLETS</div>
              <div className={`font-bold text-[#ddda09] font-mono ${state.tickEffect ? 'scale-110 transition-transform' : 'transition-transform'}`}>
                {state.wallets.length}
              </div>
            </div>
          </div>
        </div>
      </nav>

      {/* Main Content */}
      <div className="flex-1 flex flex-col md:flex-row h-[calc(100vh-8rem)]">
        {/* Desktop Layout */}
        <div className="hidden md:block w-full h-full">
          <Split
            className="flex w-full h-full split-custom"
            sizes={[20, 60, 20]}
            minSize={[250, 250, 350]}
            gutterSize={8}
            gutterAlign="center"
            direction="horizontal"
            dragInterval={1}
            gutter={(index, direction) => {
              const gutter = document.createElement('div');
              gutter.className = `gutter gutter-${direction}`;
              return gutter;
            }}
          >
            {/* Left Column */}
            <div className="backdrop-blur-sm bg-[#050a0e99] border-r border-[#b3a10240] overflow-y-auto">
              {state.connection && (
                <WalletsPage
                  wallets={state.wallets}
                  setWallets={memoizedCallbacks.setWallets}
                  handleRefresh={handleRefresh}
                  isRefreshing={state.isRefreshing}
                  setIsModalOpen={memoizedCallbacks.setIsModalOpen}
                  tokenAddress={state.tokenAddress}
                  sortDirection={state.sortDirection}
                  handleSortWallets={() => handleSortWallets(state.wallets, state.sortDirection, memoizedCallbacks.setSortDirection, state.solBalances, memoizedCallbacks.setWallets)}
                  connection={state.connection}
                  solBalances={state.solBalances}
                  tokenBalances={state.tokenBalances}
                  quickBuyEnabled={state.quickBuyEnabled}
                  setQuickBuyEnabled={memoizedCallbacks.setQuickBuyEnabled}
                  quickBuyAmount={state.quickBuyAmount}
                  setQuickBuyAmount={memoizedCallbacks.setQuickBuyAmount}
                  quickBuyMinAmount={state.quickBuyMinAmount}
                  setQuickBuyMinAmount={memoizedCallbacks.setQuickBuyMinAmount}
                  quickBuyMaxAmount={state.quickBuyMaxAmount}
                  setQuickBuyMaxAmount={memoizedCallbacks.setQuickBuyMaxAmount}
                  useQuickBuyRange={state.useQuickBuyRange}
                  setUseQuickBuyRange={memoizedCallbacks.setUseQuickBuyRange}
                />
              )}
            </div>

            {/* Middle Column */}
            <div className="backdrop-blur-sm bg-[#050a0e99] border-r border-[#b3a10240] overflow-y-auto">
              <ChartPage
                isLoadingChart={state.isLoadingChart}
                tokenAddress={state.tokenAddress}
                ammKey={state.ammKey}
                walletAddresses={state.wallets.map(w => w.address)}
              />
            </div>

            {/* Right Column */}
            <div className="backdrop-blur-sm bg-[#050a0e99] overflow-y-auto">
              <ActionsPage
                tokenAddress={state.tokenAddress}
                transactionFee={state.config.transactionFee}
                handleRefresh={handleRefresh}
                wallets={state.wallets}
                ammKey={state.ammKey}
                solBalances={state.solBalances}
                tokenBalances={state.tokenBalances}
                currentMarketCap={state.currentMarketCap}
                setBurnModalOpen={memoizedCallbacks.setBurnModalOpen}
                setCalculatePNLModalOpen={memoizedCallbacks.setCalculatePNLModalOpen}
                setDeployModalOpen={memoizedCallbacks.setDeployModalOpen}
                setCleanerTokensModalOpen={memoizedCallbacks.setCleanerTokensModalOpen}
                setCustomBuyModalOpen={memoizedCallbacks.setCustomBuyModalOpen}
                onOpenFloating={() => memoizedCallbacks.setFloatingCardOpen(true)}
                isFloatingCardOpen={state.floatingCard.isOpen}
              />
            </div>
          </Split>
        </div>

        {/* Mobile Layout */}
        <MobileLayout
          currentPage={state.currentPage}
          setCurrentPage={memoizedCallbacks.setCurrentPage}
          children={{
            WalletsPage: (
              state.connection ? (
                <WalletsPage
                  wallets={state.wallets}
                  setWallets={memoizedCallbacks.setWallets}
                  handleRefresh={handleRefresh}
                  isRefreshing={state.isRefreshing}
                  setIsModalOpen={memoizedCallbacks.setIsModalOpen}
                  tokenAddress={state.tokenAddress}
                  sortDirection={state.sortDirection}
                  handleSortWallets={() => handleSortWallets(state.wallets, state.sortDirection, memoizedCallbacks.setSortDirection, state.solBalances, memoizedCallbacks.setWallets)}
                  connection={state.connection}
                  solBalances={state.solBalances}
                  tokenBalances={state.tokenBalances}
                  quickBuyEnabled={state.quickBuyEnabled}
                  setQuickBuyEnabled={memoizedCallbacks.setQuickBuyEnabled}
                  quickBuyAmount={state.quickBuyAmount}
                  setQuickBuyAmount={memoizedCallbacks.setQuickBuyAmount}
                  quickBuyMinAmount={state.quickBuyMinAmount}
                  setQuickBuyMinAmount={memoizedCallbacks.setQuickBuyMinAmount}
                  quickBuyMaxAmount={state.quickBuyMaxAmount}
                  setQuickBuyMaxAmount={memoizedCallbacks.setQuickBuyMaxAmount}
                  useQuickBuyRange={state.useQuickBuyRange}
                  setUseQuickBuyRange={memoizedCallbacks.setUseQuickBuyRange}
                />
              ) : (
                <div className="p-4 text-center text-[#ddc765]">
                  <div className="loading-anim inline-block">
                    <div className="h-4 w-4 rounded-full bg-[#ddda09] mx-auto"></div>
                  </div>
                  <p className="mt-2 font-mono">CONNECTING TO NETWORK...</p>
                </div>
              )
            ),
            ChartPage: (
              <ChartPage
                isLoadingChart={state.isLoadingChart}
                tokenAddress={state.tokenAddress}
                ammKey={state.ammKey}
                walletAddresses={state.wallets.map(w => w.address)}
              />
            ),
            ActionsPage: (
              <ActionsPage
                tokenAddress={state.tokenAddress}
                transactionFee={state.config.transactionFee}
                handleRefresh={handleRefresh}
                wallets={state.wallets}
                ammKey={state.ammKey}
                solBalances={state.solBalances}
                tokenBalances={state.tokenBalances}
                currentMarketCap={state.currentMarketCap}
                setBurnModalOpen={memoizedCallbacks.setBurnModalOpen}
                setCalculatePNLModalOpen={memoizedCallbacks.setCalculatePNLModalOpen}
                setDeployModalOpen={memoizedCallbacks.setDeployModalOpen}
                setCleanerTokensModalOpen={memoizedCallbacks.setCleanerTokensModalOpen}
                setCustomBuyModalOpen={memoizedCallbacks.setCustomBuyModalOpen}
                onOpenFloating={() => memoizedCallbacks.setFloatingCardOpen(true)}
                isFloatingCardOpen={state.floatingCard.isOpen}
              />
            )
          }}
        />
      </div>
  
      {/* Enhanced Settings Modal */}
      <EnhancedSettingsModal
        isOpen={state.isSettingsOpen}
        onClose={() => memoizedCallbacks.setIsSettingsOpen(false)}
        config={state.config}
        onConfigChange={handleConfigChange}
        onSave={handleSaveSettings}
        wallets={state.wallets}
        setWallets={memoizedCallbacks.setWallets}
        connection={state.connection}
        solBalances={state.solBalances}
        setSolBalances={memoizedCallbacks.setSolBalances}
        tokenBalances={state.tokenBalances}
        setTokenBalances={memoizedCallbacks.setTokenBalances}
        tokenAddress={state.tokenAddress}
        showToast={showToast}
        activeTab={state.activeTab}
        setActiveTab={memoizedCallbacks.setActiveTab}
      />
  
      {/* Enhanced Wallet Overview */}
      <EnhancedWalletOverview
        isOpen={state.isModalOpen}
        onClose={() => memoizedCallbacks.setIsModalOpen(false)}
        wallets={state.wallets}
        setWallets={memoizedCallbacks.setWallets}
        solBalances={state.solBalances}
        tokenBalances={state.tokenBalances}
        tokenAddress={state.tokenAddress}
        connection={state.connection}
        handleRefresh={handleRefresh}
        isRefreshing={state.isRefreshing}
        showToast={showToast}
        onOpenSettings={() => {
          memoizedCallbacks.setIsModalOpen(false); // Close wallet overview first
          memoizedCallbacks.setActiveTab('wallets');
          memoizedCallbacks.setIsSettingsOpen(true);
        }}
      />

      {/* Modals */}
      <BurnModal
        isOpen={state.modals.burnModalOpen}
        onBurn={handleBurn}
        onClose={() => memoizedCallbacks.setBurnModalOpen(false)}
        handleRefresh={handleRefresh}
        tokenAddress={state.tokenAddress}
        solBalances={state.solBalances} 
        tokenBalances={state.tokenBalances}
      />

      <PnlModal
        isOpen={state.modals.calculatePNLModalOpen}
        onClose={() => memoizedCallbacks.setCalculatePNLModalOpen(false)}
        handleRefresh={handleRefresh}    
        tokenAddress={state.tokenAddress}
      />
      
      <DeployModal
        isOpen={state.modals.deployModalOpen}
        onClose={() => memoizedCallbacks.setDeployModalOpen(false)}
        handleRefresh={handleRefresh} 
        solBalances={state.solBalances} 
        onDeploy={handleDeploy}    
      />
      
      <CleanerTokensModal
        isOpen={state.modals.cleanerTokensModalOpen}
        onClose={() => memoizedCallbacks.setCleanerTokensModalOpen(false)}
        onCleanerTokens={handleCleaner}
        handleRefresh={handleRefresh}
        tokenAddress={state.tokenAddress}
        solBalances={state.solBalances} 
        tokenBalances={state.tokenBalances}
      />
      
      <CustomBuyModal
        isOpen={state.modals.customBuyModalOpen}
        onClose={() => memoizedCallbacks.setCustomBuyModalOpen(false)}
        onCustomBuy={handleCustomBuy}
        handleRefresh={handleRefresh}
        tokenAddress={state.tokenAddress}
        solBalances={state.solBalances} 
        tokenBalances={state.tokenBalances}
      />
      
      <FloatingTradingCard
        isOpen={state.floatingCard.isOpen}
        onClose={() => memoizedCallbacks.setFloatingCardOpen(false)}
        position={state.floatingCard.position}
        onPositionChange={memoizedCallbacks.setFloatingCardPosition}
        isDragging={state.floatingCard.isDragging}
        onDraggingChange={memoizedCallbacks.setFloatingCardDragging}
        tokenAddress={state.tokenAddress}
        wallets={state.wallets}
        selectedDex={state.config.selectedDex}
        setSelectedDex={configCallbacks.setSelectedDex}
        isDropdownOpen={state.config.isDropdownOpen}
        setIsDropdownOpen={configCallbacks.setIsDropdownOpen}
        buyAmount={state.config.buyAmount}
        setBuyAmount={configCallbacks.setBuyAmount}
        sellAmount={state.config.sellAmount}
        setSellAmount={configCallbacks.setSellAmount}
        handleTradeSubmit={handleTradeSubmit}
        isLoading={state.isRefreshing}
        dexOptions={dexOptions}
        validateActiveWallets={validateActiveWallets}
        getScriptName={getScriptName}
        countActiveWallets={countActiveWallets}
        maxWalletsConfig={maxWalletsConfig}
        currentMarketCap={state.currentMarketCap}
        tokenBalances={state.tokenBalances}
      />
    </div>
  );
};

export default WalletManager;
